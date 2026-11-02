package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
)

type GraphChunk struct {
	WikiBatch
	ChunkID           string        `json:"chunk_id"`
	SourceID          string        `json:"source_ref_id"`
	RecordID          string        `json:"record_id"`
	Generated         bool          `json:"generated"`
	Pending           *GraphPayload `json:"pending_items,omitempty"`
	AcceptedEntities  int           `json:"accepted_entities"`
	AcceptedRelations int           `json:"accepted_relations"`
}
type GraphPlan struct {
	Version   int          `json:"version"`
	ParseID   string       `json:"parse_version_id"`
	InputHash string       `json:"input_hash"`
	Batches   []GraphChunk `json:"batches"`
}

func LoadGraphPlan(raw any) (*GraphPlan, error) {
	if raw == nil {
		return nil, nil
	}
	b, e := json.Marshal(raw)
	if e != nil {
		return nil, e
	}
	var p GraphPlan
	if e = json.Unmarshal(b, &p); e != nil {
		return nil, e
	}
	if p.Version != 1 || len(p.Batches) == 0 {
		return nil, fmt.Errorf("图谱检查点版本无效")
	}
	return &p, nil
}
func ResetGraphFailures(checkpoint map[string]any) error {
	p, e := LoadGraphPlan(checkpoint["graph_batches"])
	if e != nil || p == nil {
		return e
	}
	for i := range p.Batches {
		b := &p.Batches[i]
		if b.Status == "succeeded" {
			continue
		}
		b.Status = "pending"
		b.Attempts = 0
		b.Round++
		b.Error = nil
	}
	checkpoint["graph_batches"] = p
	return nil
}

func validateGraph(payload GraphPayload, chunk Chunk) (GraphPayload, GraphPayload, []GenerationIssue) {
	good, bad := GraphPayload{Entities: []Entity{}, Relations: []Relation{}}, GraphPayload{Entities: []Entity{}, Relations: []Relation{}}
	issues := []GenerationIssue{}
	add := func(field, why, quote string) {
		issues = append(issues, GenerationIssue{Field: field, Message: why, SourceIDs: []string{chunk.SourceID}, Excerpt: excerpt(quote)})
	}
	for i, item := range payload.Entities {
		quote, ok := originalQuote(chunk.Content, item.Quote)
		_, nameOK := originalQuote(quote, item.Name)
		why := ""
		if item.SourceID != "" && item.SourceID != "S1" && item.SourceID != chunk.SourceID {
			why = "来源编号不是当前分块 S1"
		} else if !ok {
			why = "引文不在原文中（仅忽略空白，数字、单位及否定词必须一致）"
		} else if strings.TrimSpace(item.Name) == "" || !nameOK {
			why = "原文引文不包含实体名称"
		} else if strings.TrimSpace(item.Type) == "" {
			why = "实体缺少类型"
		}
		if why != "" {
			bad.Entities = append(bad.Entities, item)
			add(fmt.Sprintf("entities[%d]", i), why, item.Quote)
			continue
		}
		item.Quote = quote
		item.SourceID = chunk.SourceID
		good.Entities = append(good.Entities, item)
	}
	for i, item := range payload.Relations {
		quote, ok := originalQuote(chunk.Content, item.Quote)
		_, sourceOK := originalQuote(quote, item.Source)
		_, targetOK := originalQuote(quote, item.Target)
		why := ""
		if item.SourceID != "" && item.SourceID != "S1" && item.SourceID != chunk.SourceID {
			why = "来源编号不是当前分块 S1"
		} else if !ok {
			why = "关系引文无法在原文中逐字定位（仅忽略空白）"
		} else if !sourceOK || !targetOK {
			why = "原文引文未同时包含关系两端名称；不得用推测补齐证据"
		} else if strings.TrimSpace(item.Relation) == "" {
			why = "关系类型为空"
		}
		if why != "" {
			bad.Relations = append(bad.Relations, item)
			add(fmt.Sprintf("relations[%d]", i), why, item.Quote)
			continue
		}
		item.Quote = quote
		item.SourceID = chunk.SourceID
		good.Relations = append(good.Relations, item)
	}
	return good, bad, issues
}

func graphRepairShape(previous, next GraphPayload) bool {
	if len(previous.Entities) != len(next.Entities) || len(previous.Relations) != len(next.Relations) {
		return false
	}
	for i, p := range previous.Entities {
		if p.Name != "" && next.Entities[i].Name != p.Name {
			return false
		}
	}
	for i, p := range previous.Relations {
		n := next.Relations[i]
		if (p.Source != "" && p.Source != n.Source) || (p.Target != "" && p.Target != n.Target) || (p.Relation != "" && p.Relation != n.Relation) {
			return false
		}
	}
	return true
}

func (w *Worker) graph(ctx context.Context, t *Task) error {
	chunks, e := w.chunks(ctx, t)
	if e != nil || len(chunks) == 0 {
		return e
	}
	m, e := ai.Bound(ctx, w.Services, "text", t.Config)
	if e != nil {
		return e
	}
	raw, _ := json.Marshal(chunks)
	hash := fmt.Sprintf("%x", sha256.Sum256(append(raw, []byte(graphPrompt(t.Config))...)))
	plan, e := LoadGraphPlan(t.Checkpoint["graph_batches"])
	if e != nil {
		return e
	}
	parseID, _ := t.Checkpoint["parse_version_id"].(string)
	if plan == nil {
		plan = &GraphPlan{Version: 1, ParseID: parseID, InputHash: hash}
		for i, c := range chunks {
			plan.Batches = append(plan.Batches, GraphChunk{WikiBatch: WikiBatch{Index: i + 1, Start: i, Count: 1, Status: "pending", Round: 1}, ChunkID: c.ID, SourceID: c.SourceID, RecordID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("graph-v2:"+c.ID+":"+hash)).String()})
		}
	} else if plan.ParseID != parseID || plan.InputHash != hash {
		return &ai.Error{Code: "GRAPH_INPUT_CHANGED", Message: "图谱原文或抽取配置已变化，请重新处理文档，不能混用旧证据"}
	}
	t.Checkpoint["graph_batches"] = plan
	quality, e := w.ocrIssues(ctx, t)
	if e != nil {
		return e
	}
	for i := range plan.Batches {
		b := &plan.Batches[i]
		chunk := chunks[b.Start]
		if b.Status == "succeeded" || b.Status == "failed" {
			continue
		}
		if issue, ok := quality[chunk.SourceID]; ok {
			b.Status = "failed"
			b.Error = &WikiFailure{Code: "OCR_QUALITY_SUSPECT", Message: "原文 OCR 疑似异常，请核对对应区域后重新解析；未把异常文本作为事实", Issues: []GenerationIssue{issue}}
			if e = w.saveGraphProgress(ctx, t, plan, b); e != nil {
				return e
			}
			continue
		}
		if b.Status == "running" && len(b.History) > 0 && b.History[len(b.History)-1].FinishedAt == nil {
			now := time.Now().UTC()
			b.History[len(b.History)-1].FinishedAt = &now
			b.History[len(b.History)-1].Error = &WikiFailure{Code: "GRAPH_INTERRUPTED", Message: "上次处理被中断，已保留验证通过的实体和关系"}
		}
		saved := GraphPayload{Entities: []Entity{}, Relations: []Relation{}}
		var cached []byte
		e = w.Services.DB.QueryRow(ctx, "SELECT payload FROM graph_records WHERE id=$1", b.RecordID).Scan(&cached)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		if len(cached) > 0 {
			if e = json.Unmarshal(cached, &saved); e != nil {
				return e
			}
		}
		// Import only legacy evidence that still validates against this exact chunk.
		if !b.Generated && len(cached) == 0 {
			oldID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("graph:"+chunk.SourceID+graphPrompt(t.Config))).String()
			var old []byte
			e = w.Services.DB.QueryRow(ctx, "SELECT payload FROM graph_records WHERE id=$1", oldID).Scan(&old)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
			if len(old) > 0 {
				var prior GraphPayload
				if json.Unmarshal(old, &prior) == nil {
					good, _, issues := validateGraph(prior, chunk)
					// Legacy source-level caches may describe only a different chunk of the source.
					var count int
					if e = w.Services.DB.QueryRow(ctx, "SELECT count(*) FROM chunks WHERE source_ref_id=$1", chunk.SourceID).Scan(&count); e != nil {
						return e
					}
					if len(issues) == 0 && count == 1 {
						saved = good
						b.Generated = true
						b.RecordID = oldID
					}
				}
			}
		}
		for b.Attempts < wikiMaxAttempts {
			if e = ctx.Err(); e != nil {
				return e
			}
			b.Attempts++
			b.Status = "running"
			b.History = append(b.History, WikiAttempt{Number: b.Attempts, Round: b.Round, StartedAt: time.Now().UTC()})
			if e = w.saveGraphProgress(ctx, t, plan, b); e != nil {
				return e
			}
			var callErr error
			response := ""
			var issues []GenerationIssue
			if !b.Generated || b.Pending != nil {
				input, _ := json.Marshal(map[string]string{"source_ref_id": "S1", "content": chunk.Content})
				feedback := ""
				if b.Error != nil {
					feedback = "上次校验错误：" + b.Error.Message + "。"
					details, _ := json.Marshal(b.Error.Issues)
					feedback += "具体校验项：" + string(details) + "。"
				}
				if b.Pending != nil {
					pending, _ := json.Marshal(b.Pending)
					feedback += "局部修复：只修复下面未通过的项，按原顺序逐项返回，实体名称和关系两端/类型保持不变；不能删除项目或用无关事实替换。已保存的项不要重新生成。待修复项：" + string(pending) + "。"
				}
				prompt := graphPrompt(t.Config) + `抽取中文知识图谱，只保留有原文证据的事实，保留重要细节、数值、条件与限制，示例不能作为事实。返回 JSON {"entities":[{"name":"原文名称","type":"配置中的类型","description":"中文说明","quote":"包含名称的原文逐字引文"}],"relations":[{"source":"原文名称","target":"原文名称","relation":"配置中的关系类型","quote":"同时包含两端名称的原文逐字引文"}]}。来源由程序绑定到本分块，无需生成 UUID。可输出空数组表示本分块无可抽取事实，但局部修复不得输出空数组删除未通过项。` + feedback + "材料：" + string(input)
				response, callErr = ai.Chat(ctx, m, prompt, nil)
				var payload GraphPayload
				if callErr == nil {
					callErr = ai.ParseJSON(response, &payload)
				}
				if callErr == nil && (payload.Entities == nil || payload.Relations == nil) {
					callErr = &ai.Error{Code: "MODEL_RESPONSE_INVALID", Message: "图谱缺少 entities / relations 数组"}
				}
				if callErr == nil && b.Pending != nil && !graphRepairShape(*b.Pending, payload) {
					callErr = &ai.Error{Code: "GRAPH_EVIDENCE_INVALID", Message: "局部修复遗漏或替换了待修复项，必须保留所有项目及对应事实"}
				}
				if callErr == nil {
					good, bad, found := validateGraph(payload, chunk)
					issues = found
					saved.Entities = append(saved.Entities, good.Entities...)
					saved.Relations = append(saved.Relations, good.Relations...)
					b.Generated = true
					b.Pending = nil
					if len(issues) > 0 {
						b.Pending = &bad
						callErr = &ai.Error{Code: "GRAPH_EVIDENCE_INVALID", Message: fmt.Sprintf("%d 项证据需修复；有效实体和关系已保留", len(issues))}
					}
				}
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			b.AcceptedEntities = len(saved.Entities)
			b.AcceptedRelations = len(saved.Relations)
			now := time.Now().UTC()
			b.History[len(b.History)-1].FinishedAt = &now
			b.Error = nil
			if callErr != nil {
				b.Error = wikiFailure(callErr)
				b.Error.Issues = issues
				b.Error.ResponseExcerpt = excerpt(response)
			}
			// Persist accepted evidence and repair state atomically before Neo4j sync.
			if e = w.saveGraphChunk(ctx, t, plan, b, saved); e != nil {
				return e
			}
			if e = w.syncGraphChunk(ctx, t, b.RecordID, saved); e != nil {
				callErr = e
				b.Error = wikiFailure(e)
			}
			if callErr == nil {
				b.Status = "succeeded"
				b.Error = nil
			} else {
				b.History[len(b.History)-1].Error = b.Error
				b.Status = "retrying"
				if b.Attempts >= wikiMaxAttempts || !graphRetryable(callErr) {
					b.Status = "failed"
				}
			}
			if e = w.saveGraphProgress(ctx, t, plan, b); e != nil {
				return e
			}
			if b.Status == "succeeded" || b.Status == "failed" {
				break
			}
			if e = retryPause(ctx, b.Attempts); e != nil {
				return e
			}
		}
		if b.Status != "succeeded" {
			b.Status = "failed"
			if e = w.saveGraphProgress(ctx, t, plan, b); e != nil {
				return e
			}
		}
	}
	failed := 0
	for _, b := range plan.Batches {
		if b.Status != "succeeded" {
			failed++
		}
	}
	if failed > 0 {
		return &ai.Error{Code: "GRAPH_CHUNKS_FAILED", Message: fmt.Sprintf("图谱 %d / %d 个分块未完成，已保存有效证据，可只补跑失败分块", failed, len(plan.Batches))}
	}
	return nil
}

func retryPause(ctx context.Context, attempt int) error {
	timer := time.NewTimer(time.Duration(attempt) * 2 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func graphRetryable(e error) bool {
	var a *ai.Error
	return errors.As(e, &a) && (a.Retryable || a.Code == "GRAPH_EVIDENCE_INVALID" || a.Code == "MODEL_RESPONSE_INVALID")
}
func (w *Worker) saveGraphChunk(ctx context.Context, t *Task, plan *GraphPlan, b *GraphChunk, payload GraphPayload) error {
	tx, e := w.Services.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(context.Background())
	if e = Owned(ctx, tx, t); e != nil {
		return e
	}
	raw, _ := json.Marshal(payload)
	if _, e = tx.Exec(ctx, `INSERT INTO graph_records(id,knowledge_id,source_ref_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,synced_at=NULL`, b.RecordID, t.KnowledgeID, b.SourceID, raw); e != nil {
		return e
	}
	ledger, _ := json.Marshal(plan)
	if _, e = tx.Exec(ctx, `UPDATE tasks SET checkpoint=jsonb_set(checkpoint,'{graph_batches}',$2::jsonb) WHERE id=$1`, t.ID, ledger); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (w *Worker) syncGraphChunk(ctx context.Context, t *Task, recordID string, payload GraphPayload) error {
	for _, entity := range payload.Entities {
		_, e := bootstrap.GraphQuery(ctx, w.Services.Graph, `MERGE (n:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb,name:$name}) SET n.type=$type,n.description=$description,n.source_ids=apoc.coll.union(coalesce(n.source_ids,[]),[$source]) RETURN n.name`, map[string]any{"installation": w.Services.Identity.ID, "kb": t.KBID, "name": entity.Name, "type": entity.Type, "description": entity.Description, "source": entity.SourceID})
		if e != nil {
			return &ai.Error{Code: "GRAPH_WRITE_FAILED", Message: "图谱实体同步失败；已验证证据保存在数据库中", Retryable: true}
		}
	}
	for _, relation := range payload.Relations {
		_, e := bootstrap.GraphQuery(ctx, w.Services.Graph, `MERGE (a:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb,name:$source}) MERGE (b:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb,name:$target}) MERGE (a)-[r:NEBULAEKNO_RELATION {record_id:$record,relation:$relation}]->(b) SET r.source_ref_id=$ref,r.quote=$quote RETURN r.record_id`, map[string]any{"installation": w.Services.Identity.ID, "kb": t.KBID, "source": relation.Source, "target": relation.Target, "record": recordID, "relation": relation.Relation, "ref": relation.SourceID, "quote": relation.Quote})
		if e != nil {
			return &ai.Error{Code: "GRAPH_WRITE_FAILED", Message: "图谱关系同步失败；已验证证据保存在数据库中", Retryable: true}
		}
	}
	_, e := w.Services.DB.Exec(ctx, "UPDATE graph_records SET synced_at=now() WHERE id=$1", recordID)
	return e
}
func (w *Worker) saveGraphProgress(ctx context.Context, t *Task, p *GraphPlan, b *GraphChunk) error {
	span := t.traceStage("graph", "running")
	if len(span.Children) == 0 {
		span.Children = append(span.Children, &WorkSpan{Name: "extract_graph", Status: "running", StartedAt: time.Now().UTC()})
	}
	progress := &WorkProgress{Unit: "chunk", Total: len(p.Batches), Current: b.Index, Batch: b.Index, Batches: len(p.Batches), Attempt: b.Attempts, MaxRetries: 2, Retrying: b.Status == "retrying"}
	for _, item := range p.Batches {
		if item.Status == "succeeded" {
			progress.Completed++
		}
		if item.Status == "failed" {
			progress.FailedBatches++
		}
	}
	span.Children[0].Progress = progress
	if progress.Completed == progress.Total {
		closeSpan(span.Children[0], "succeeded", time.Now().UTC())
	}
	ledger, _ := json.Marshal(p)
	trace, _ := json.Marshal(t.Pipeline)
	tag, e := w.Services.DB.Exec(ctx, `UPDATE tasks SET checkpoint=jsonb_set(jsonb_set(checkpoint,'{graph_batches}',$3::jsonb),'{pipeline}',$4::jsonb),updated_at=now() WHERE id=$1 AND owner=$2 AND state='running' AND NOT cancel_requested`, t.ID, t.Owner, ledger, trace)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return context.Canceled
	}
	w.event(ctx, t.ID, map[string]any{"stage": "graph", "progress": true})
	return nil
}
