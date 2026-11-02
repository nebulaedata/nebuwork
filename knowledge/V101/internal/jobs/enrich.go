package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"math"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
	"os"
	"path/filepath"
	"strings"
)

func (w *Worker) transcribe(ctx context.Context, t *Task, p *Parsed) error {
	if p.Media["has_audio"] != true || !Bool(t.Config, "transcription", true) {
		return nil
	}
	for _, b := range p.Blocks {
		if b.Precision == "time_segment" {
			t.Checkpoint["transcription"] = "succeeded"
			return nil
		}
	}
	m, e := ai.Bound(ctx, w.Services, "asr", t.Config)
	if e != nil {
		t.Checkpoint["transcription"] = "waiting_configuration"
		p.Media["transcription_status"] = "waiting_configuration"
		return nil
	}
	blocks := []Block{}
	total, completed := 0, 0
	for _, asset := range p.Assets {
		if asset["kind"] == "audio_segment" {
			total++
		}
	}
	for _, asset := range p.Assets {
		if asset["kind"] != "audio_segment" {
			continue
		}
		if e := w.progress(ctx, t, "transcribe_audio", "segment", completed, total, completed+1); e != nil {
			return e
		}
		path, _ := asset["path"].(string)
		signature := sha256.Sum256([]byte(m.ID + "|" + m.BaseURL + "|" + m.ModelName))
		cache := path + ".asr-" + hex.EncodeToString(signature[:8]) + ".json"
		var a ai.Transcript
		cached, readErr := os.ReadFile(cache)
		if readErr != nil || json.Unmarshal(cached, &a) != nil {
			a, e = ai.Transcribe(ctx, m, path)
			if e == nil {
				b, _ := json.Marshal(a)
				temporary := cache + "." + uuid.NewString()
				if os.WriteFile(temporary, b, 0600) == nil {
					if os.Rename(temporary, cache) != nil {
						os.Remove(temporary)
					}
				}
			}
		}
		if e != nil {
			return e
		}
		if len(a.Segments) == 0 && strings.TrimSpace(a.Text) != "" {
			return &ai.Error{Code: "ASR_TIMESTAMPS_REQUIRED", Message: "ASR 返回文本但没有分段时间戳"}
		}
		start := int64(asset["start_ms"].(float64))
		end := int64(asset["end_ms"].(float64))
		for _, segment := range a.Segments {
			if segment.Start < 0 || segment.End <= segment.Start || math.IsNaN(segment.Start) || math.IsNaN(segment.End) {
				return &ai.Error{Code: "ASR_TIMESTAMPS_INVALID", Message: "ASR 时间戳无效"}
			}
			a := start + int64(math.Round(segment.Start*1000))
			b := start + int64(math.Round(segment.End*1000))
			if b > end+500 {
				return &ai.Error{Code: "ASR_TIMESTAMPS_INVALID", Message: "ASR 时间戳超过源音频范围"}
			}
			if b > end {
				b = end
			}
			blocks = append(blocks, Block{Text: segment.Text, Locator: map[string]any{"type": "time", "start_ms": a, "end_ms": b}, Precision: "time_segment", Method: "asr"})
		}
		completed++
	}
	if e := w.progress(ctx, t, "transcribe_audio", "segment", completed, total, 0); e != nil {
		return e
	}
	p.Blocks = append(p.Blocks, blocks...)
	t.Checkpoint["transcription"] = "succeeded"
	p.Media["transcription_status"] = "succeeded"
	return nil
}

func (w *Worker) outline(ctx context.Context, t *Task) error {
	var version string
	var raw []byte
	if e := w.Services.DB.QueryRow(ctx, "SELECT p.id::text,p.metadata FROM parse_versions p WHERE p.knowledge_id=$1 AND p.id::text=$2", t.KnowledgeID, t.Checkpoint["parse_version_id"]).Scan(&version, &raw); e != nil {
		return e
	}
	var parsed Parsed
	json.Unmarshal(raw, &parsed)
	chunks, e := w.chunks(ctx, t)
	if e != nil {
		return e
	}
	nodes := parsed.Outline
	status := "ready"
	if len(nodes) == 0 && len(chunks) > 0 {
		m, e := ai.Bound(ctx, w.Services, "outline", t.Config)
		if e != nil {
			return e
		}
		nodes = []map[string]any{}
		for start := 0; start < len(chunks); start += 16 {
			if e := w.progress(ctx, t, "verify_outline", "chunk", start, len(chunks), start+1); e != nil {
				return e
			}
			end := start + 16
			if end > len(chunks) {
				end = len(chunks)
			}
			b, _ := json.Marshal(chunks[start:end])
			text, e := ai.Chat(ctx, m, "只提取原文中实际作为独立一行出现的章节标题，不创造摘要或主题。输出 JSON 对象 {\"headings\":[{\"title\":\"原文标题\",\"level\":1,\"source_ref_id\":\"提供的来源ID\"}]}，没有标题返回空数组。材料：\n"+string(b), nil)
			if e != nil {
				return e
			}
			var generated struct {
				Headings []map[string]any `json:"headings"`
			}
			if e = ai.ParseJSON(text, &generated); e != nil {
				return e
			}
			for _, n := range generated.Headings {
				source, _ := n["source_ref_id"].(string)
				title, _ := n["title"].(string)
				verified := false
				for _, c := range chunks[start:end] {
					if c.SourceID != source {
						continue
					}
					for _, line := range strings.Split(c.Content, "\n") {
						if strings.TrimSpace(strings.TrimLeft(line, "# ")) == strings.TrimSpace(title) && title != "" {
							verified = true
							break
						}
					}
				}
				if verified {
					n["position_status"] = "verified"
					n["method"] = "model_verified"
					nodes = append(nodes, n)
				} else {
					status = "partial"
				}
			}
		}
	}
	if len(chunks) > 0 && len(parsed.Outline) == 0 {
		if e := w.progress(ctx, t, "verify_outline", "chunk", len(chunks), len(chunks), 0); e != nil {
			return e
		}
	}
	for _, n := range nodes {
		if n["source_ref_id"] != nil {
			continue
		}
		title, _ := n["title"].(string)
		locator, _ := json.Marshal(n["locator"])
		if n["method"] == "sheet_structure" {
			source := uuid.NewSHA1(uuid.NameSpaceOID, []byte("sheet:"+version+":"+title)).String()
			_, err := w.Services.DB.Exec(ctx, `INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) SELECT $1,knowledge_id,file_version_id,id,jsonb_build_array($2::jsonb),$3,'range',0,0,'excel','{"supplemental_context":true}' FROM parse_versions WHERE id=$4 ON CONFLICT(id) DO NOTHING`, source, locator, title, version)
			if err != nil {
				return err
			}
			n["source_ref_id"] = source
			n["position_status"] = "verified"
			continue
		}
		var source string
		e = w.Services.DB.QueryRow(ctx, "SELECT id::text FROM source_refs WHERE parse_version_id=$1 AND locators @> jsonb_build_array($2::jsonb) AND position($3 in quote)>0 ORDER BY char_start LIMIT 1", version, locator, title).Scan(&source)
		if e == nil {
			n["source_ref_id"] = source
			n["position_status"] = "verified"
		} else {
			n["position_status"] = "unresolved"
			status = "partial"
		}
	}
	tree := []map[string]any{}
	stack := []map[string]any{}
	for _, n := range nodes {
		level := Number(n, "level", 1)
		if v, ok := n["level"].(int); ok {
			level = v
		}
		if level < 1 || level > 6 {
			level = 1
		}
		n["id"] = uuid.NewString()
		n["level"] = level
		n["children"] = []map[string]any{}
		for len(stack) > 0 {
			last := stack[len(stack)-1]
			if last["level"].(int) < level {
				break
			}
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			tree = append(tree, n)
		} else {
			parent := stack[len(stack)-1]
			parent["children"] = append(parent["children"].([]map[string]any), n)
		}
		stack = append(stack, n)
	}
	if len(tree) == 0 {
		status = "empty"
	}
	b, _ := json.Marshal(tree)
	_, e = w.Services.DB.Exec(ctx, "INSERT INTO outlines(id,knowledge_id,parse_version_id,status,structure) VALUES($1,$2,$3,$4,$5)", uuid.NewString(), t.KnowledgeID, version, status, b)
	if e != nil {
		return e
	}
	if status == "partial" {
		return &ai.Error{Code: "OUTLINE_PARTIAL", Message: "部分目录位置尚未通过核验"}
	}
	return nil
}

func VectorLiteral(values []float64) string { b, _ := json.Marshal(values); return string(b) }
func (w *Worker) embed(ctx context.Context, t *Task) error {
	chunks, e := w.chunks(ctx, t)
	if e != nil {
		return e
	}
	quality, e := w.ocrIssues(ctx, t)
	if e != nil {
		return e
	}
	eligible := chunks[:0]
	for _, chunk := range chunks {
		if _, suspect := quality[chunk.SourceID]; !suspect {
			eligible = append(eligible, chunk)
		}
	}
	chunks = eligible
	if len(chunks) == 0 {
		return nil
	}
	m, e := ai.Bound(ctx, w.Services, "embedding", t.Config)
	if e != nil {
		return e
	}
	for start := 0; start < len(chunks); start += 16 {
		if e := w.progress(ctx, t, "embed_chunks", "chunk", start, len(chunks), start+1); e != nil {
			return e
		}
		end := start + 16
		if end > len(chunks) {
			end = len(chunks)
		}
		texts := []string{}
		for _, c := range chunks[start:end] {
			texts = append(texts, c.Content)
		}
		vectors, e := ai.Embeddings(ctx, m, texts)
		if e != nil {
			return e
		}
		if len(vectors) != len(texts) {
			return &ai.Error{Code: "EMBEDDING_COUNT_MISMATCH", Message: "返回向量数量与分块不一致"}
		}
		dimension := len(vectors[0])
		hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d", m.BaseURL, m.ModelName, dimension)))
		signature := hex.EncodeToString(hash[:])
		space := uuid.NewSHA1(uuid.NameSpaceOID, []byte(m.ID+signature)).String()
		_, e = w.Services.DB.Exec(ctx, "INSERT INTO embedding_spaces(id,model_id,dimension,kind,config_hash) VALUES($1,$2,$3,'text',$4) ON CONFLICT DO NOTHING", space, m.ID, dimension, signature)
		if e != nil {
			return e
		}
		if e = w.ensureVectorIndex(ctx, space, dimension); e != nil {
			return e
		}
		for i, c := range chunks[start:end] {
			_, e = w.Services.DB.Exec(ctx, "INSERT INTO embeddings(id,space_id,chunk_id,source_ref_id,embedding) VALUES($1,$2,$3,$4,$5::vector) ON CONFLICT(space_id,source_ref_id) DO UPDATE SET embedding=excluded.embedding", uuid.NewString(), space, c.ID, c.SourceID, VectorLiteral(vectors[i]))
			if e != nil {
				return e
			}
		}
	}
	if e := w.progress(ctx, t, "embed_chunks", "chunk", len(chunks), len(chunks), 0); e != nil {
		return e
	}
	return nil
}

type Entity struct {
	Name, Type, Description string
	SourceID                string `json:"source_ref_id"`
	Quote                   string
}
type Relation struct {
	Source, Target, Relation string
	SourceID                 string `json:"source_ref_id"`
	Quote                    string
}
type GraphPayload struct {
	Entities  []Entity   `json:"entities"`
	Relations []Relation `json:"relations"`
}

func (w *Worker) remove(ctx context.Context, t *Task) error {
	if t.KBID == "" {
		t.KBID, _ = t.Config["knowledge_base_id"].(string)
	}
	if t.KnowledgeID == "" && t.Type == "delete_knowledge" {
		t.KnowledgeID, _ = t.Config["target_id"].(string)
	}
	var active bool
	if e := w.Services.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tasks WHERE id<>$1 AND state='running' AND lease_until>now() AND knowledge_base_id=$2 AND ($3='' OR knowledge_id::text=$3))", t.ID, t.KBID, t.KnowledgeID).Scan(&active); e != nil {
		return e
	}
	if active {
		return &ai.Error{Code: "TASKS_STOPPING", Message: "等待相关任务释放资源", Retryable: true}
	}
	if t.Type == "delete_kb" {
		_, e := bootstrap.GraphQuery(ctx, w.Services.Graph, "MATCH(n:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb}) DETACH DELETE n", map[string]any{"installation": w.Services.Identity.ID, "kb": t.KBID})
		if e != nil {
			return &ai.Error{Code: "GRAPH_DELETE_FAILED", Message: "清理图谱失败", Retryable: true}
		}
		rows, e := w.Services.DB.Query(ctx, "SELECT id::text FROM knowledge WHERE knowledge_base_id=$1", t.KBID)
		if e != nil {
			return e
		}
		ids := []string{}
		for rows.Next() {
			var id string
			rows.Scan(&id)
			ids = append(ids, id)
		}
		rows.Close()
		for _, id := range ids {
			if e = w.removeFiles(id); e != nil {
				return e
			}
		}
		_, e = w.Services.DB.Exec(ctx, "DELETE FROM knowledge_bases WHERE id=$1", t.KBID)
		return e
	}
	rows, e := w.Services.DB.Query(ctx, "SELECT id::text FROM source_refs WHERE knowledge_id=$1", t.KnowledgeID)
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	_, e = bootstrap.GraphQuery(ctx, w.Services.Graph, `MATCH(n:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb}) SET n.source_ids=[s IN coalesce(n.source_ids,[]) WHERE NOT s IN $ids] WITH n OPTIONAL MATCH(n)-[r:NEBULAEKNO_RELATION]-() WHERE r.source_ref_id IN $ids DELETE r`, map[string]any{"installation": w.Services.Identity.ID, "kb": t.KBID, "ids": ids})
	if e != nil {
		return &ai.Error{Code: "GRAPH_DELETE_FAILED", Message: "清理文档图谱证据失败", Retryable: true}
	}
	_, e = bootstrap.GraphQuery(ctx, w.Services.Graph, `MATCH(n:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb}) WHERE size(coalesce(n.source_ids,[]))=0 AND NOT (n)-[:NEBULAEKNO_RELATION]-() DELETE n`, map[string]any{"installation": w.Services.Identity.ID, "kb": t.KBID})
	if e != nil {
		return e
	}
	// Pages with removed evidence remain available in history, but cannot appear as valid recall results.
	_, e = w.Services.DB.Exec(ctx, `UPDATE wiki_pages SET state='stale',source_ids=(SELECT coalesce(jsonb_agg(v),'[]') FROM jsonb_array_elements_text(source_ids) v WHERE NOT v=ANY($2::text[])),search_vector=''::tsvector,updated_at=now() WHERE knowledge_base_id=$1 AND source_ids ?| $2::text[]`, t.KBID, ids)
	if e != nil {
		return e
	}
	if e = w.removeFiles(t.KnowledgeID); e != nil {
		return e
	}
	_, e = w.Services.DB.Exec(ctx, "DELETE FROM knowledge WHERE id=$1", t.KnowledgeID)
	return e
}
func (w *Worker) removeFiles(id string) error {
	if uuid.Validate(id) != nil {
		return fmt.Errorf("无效文件身份")
	}
	for _, base := range []string{"files", "derived", "previews", "media", "extractions"} {
		path := filepath.Join(w.Config.DataDir, base, id)
		if e := os.RemoveAll(path); e != nil {
			return fmt.Errorf("清理文件失败")
		}
	}
	return nil
}

func removeWikiSections(content, prefix, end string) string {
	for {
		start := strings.Index(content, prefix)
		if start < 0 {
			return content
		}
		finish := strings.Index(content[start:], end)
		if finish < 0 {
			return content
		}
		content = content[:start] + content[start+finish+len(end):]
	}
}
