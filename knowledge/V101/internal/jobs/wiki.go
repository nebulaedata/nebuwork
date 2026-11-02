package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/textutil"
)

const wikiBatchSize = 16
const wikiMaxAttempts = 3 // One initial request plus at most two retries per manual round.

type WikiFailure struct {
	Code            string            `json:"code"`
	Message         string            `json:"message"`
	Issues          []GenerationIssue `json:"issues,omitempty"`
	ResponseExcerpt string            `json:"response_excerpt,omitempty"`
}
type WikiAttempt struct {
	Number     int          `json:"number"`
	Round      int          `json:"round"`
	StartedAt  time.Time    `json:"started_at"`
	FinishedAt *time.Time   `json:"finished_at,omitempty"`
	Error      *WikiFailure `json:"error,omitempty"`
}
type WikiBatch struct {
	Pending  []json.RawMessage `json:"pending_pages,omitempty"`
	Accepted []string          `json:"accepted_pages,omitempty"`
	Index    int               `json:"index"`
	Start    int               `json:"start"`
	Count    int               `json:"count"`
	Status   string            `json:"status"`
	Attempts int               `json:"attempts"`
	Round    int               `json:"round"`
	Error    *WikiFailure      `json:"error,omitempty"`
	History  []WikiAttempt     `json:"history,omitempty"`
}
type WikiPlan struct {
	Version       int         `json:"version"`
	ParseID       string      `json:"parse_version_id"`
	InputHash     string      `json:"input_hash"`
	MaxRetries    int         `json:"max_retries"`
	Batches       []WikiBatch `json:"batches"`
	PreparedPages []string    `json:"prepared_pages,omitempty"`
}
type WikiPage struct {
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	SourceIDs []string `json:"source_ref_ids"`
}

func LoadWikiPlan(raw any) (*WikiPlan, error) {
	if raw == nil {
		return nil, nil
	}
	b, e := json.Marshal(raw)
	if e != nil {
		return nil, e
	}
	var p WikiPlan
	if e = json.Unmarshal(b, &p); e != nil {
		return nil, e
	}
	if p.Version != 1 || len(p.Batches) == 0 {
		return nil, fmt.Errorf("Wiki 批次检查点版本无效")
	}
	return &p, nil
}

// Called only by an explicit task retry, under the task row lock. Successful
// batches and their revisions are immutable; a restart does not reset budgets.
func ResetWikiFailures(checkpoint map[string]any) error {
	p, e := LoadWikiPlan(checkpoint["wiki_batches"])
	if e != nil {
		return e
	}
	if p == nil {
		return nil
	} // Legacy tasks have no trustworthy per-batch checkpoints.
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
	checkpoint["wiki_batches"] = p
	return nil
}

func wikiInput(chunks []Chunk) ([]byte, map[string]string) {
	type material struct {
		Source  string `json:"source_ref_id"`
		Content string `json:"content"`
	}
	items := make([]material, 0, len(chunks))
	aliases := map[string]string{}
	// A source can span several chunks. Give that source one unambiguous alias.
	reverse := map[string]string{}
	for _, c := range chunks {
		alias := reverse[c.SourceID]
		if alias == "" {
			alias = fmt.Sprintf("S%d", len(aliases)+1)
			aliases[alias] = c.SourceID
			reverse[c.SourceID] = alias
		}
		items = append(items, material{alias, c.Content})
	}
	b, _ := json.Marshal(items)
	return b, aliases
}

var wikiSourceToken = regexp.MustCompile(`(?i)source:[^\s)<>"'\x60]+`)
var wikiCitation = regexp.MustCompile(`\[[^\]\r\n]+\]\(source:(S[1-9][0-9]*)\)`)

func validateWiki(text string, aliases map[string]string) ([]WikiPage, error) {
	var result struct {
		Pages []WikiPage `json:"pages"`
	}
	if e := ai.ParseJSON(text, &result); e != nil {
		return nil, e
	}
	invalid := func(message string) ([]WikiPage, error) {
		return nil, &ai.Error{Code: "WIKI_SOURCE_INVALID", Message: message}
	}
	if len(result.Pages) == 0 {
		return invalid("Wiki 未返回页面；请根据材料生成有来源的页面，不得编造事实")
	}
	titles := map[string]bool{}
	for i := range result.Pages {
		p := &result.Pages[i]
		p.Title = strings.TrimSpace(p.Title)
		if p.Title == "" || strings.TrimSpace(p.Content) == "" || len(p.SourceIDs) == 0 {
			return invalid("Wiki 缺少标题、正文或来源列表")
		}
		if titles[p.Title] {
			return invalid("同一批次的页面标题重复，请合并同主题内容并保留全部依据")
		}
		titles[p.Title] = true
		if strings.Contains(p.Content, "<!--") {
			return invalid("Wiki 正文请勿包含 HTML 注释或内部来源标记")
		}
		listed := map[string]bool{}
		for _, id := range p.SourceIDs {
			if aliases[id] == "" {
				return invalid("来源列表引用了本批材料以外的编号；只能使用材料中的 S 编号")
			}
			listed[id] = true
		}
		matches := wikiCitation.FindAllStringSubmatch(p.Content, -1)
		tokens := wikiSourceToken.FindAllString(p.Content, -1)
		if len(matches) == 0 || len(matches) != len(tokens) {
			return invalid("正文引用格式无效；必须使用 [来源](source:S1) 这种行内链接")
		}
		cited := map[string]bool{}
		for _, m := range matches {
			if aliases[m[1]] == "" || !listed[m[1]] {
				return invalid("正文引用了未列入本页来源列表的编号；正文与列表必须对应且属于本批材料")
			}
			cited[m[1]] = true
		}
		for id := range listed {
			if !cited[id] {
				return invalid("来源列表存在正文未引用的编号；请在对应事实后补充引用")
			}
		}
		// Replace only validated link destinations, never prose or substrings such as S1 in S10.
		p.Content = wikiCitation.ReplaceAllStringFunc(p.Content, func(link string) string {
			m := wikiCitation.FindStringSubmatch(link)
			return strings.Replace(link, "(source:"+m[1]+")", "(source:"+aliases[m[1]]+")", 1)
		})
		ids := []string{}
		for _, alias := range p.SourceIDs {
			id := aliases[alias]
			if !slices.Contains(ids, id) {
				ids = append(ids, id)
			}
		}
		p.SourceIDs = ids
	}
	return result.Pages, nil
}

func wikiFailure(e error) *WikiFailure {
	var a *ai.Error
	if errors.As(e, &a) {
		return &WikiFailure{Code: a.Code, Message: a.Message}
	}
	return &WikiFailure{Code: "WIKI_BATCH_FAILED", Message: "Wiki 批次处理失败"}
}
func wikiRetryable(e error) bool {
	var a *ai.Error
	return errors.As(e, &a) && (a.Retryable || a.Code == "WIKI_SOURCE_INVALID" || a.Code == "MODEL_RESPONSE_INVALID")
}

func (w *Worker) wiki(ctx context.Context, t *Task) error {
	chunks, e := w.chunks(ctx, t)
	if e != nil {
		return e
	}
	if len(chunks) == 0 {
		return nil
	}
	m, e := ai.Bound(ctx, w.Services, "text", t.Config)
	if e != nil {
		return e
	}
	raw, _ := json.Marshal(chunks)
	hash := fmt.Sprintf("%x", sha256.Sum256(append(raw, []byte(wikiPrompt(t.Config))...)))
	plan, e := LoadWikiPlan(t.Checkpoint["wiki_batches"])
	if e != nil {
		return e
	}
	parseID, _ := t.Checkpoint["parse_version_id"].(string)
	if plan == nil {
		plan = &WikiPlan{Version: 1, ParseID: parseID, InputHash: hash, MaxRetries: 2}
		for start := 0; start < len(chunks); start += wikiBatchSize {
			plan.Batches = append(plan.Batches, WikiBatch{Index: len(plan.Batches) + 1, Start: start, Count: min(wikiBatchSize, len(chunks)-start), Status: "pending", Round: 1})
		}
	} else if plan.ParseID != parseID || plan.InputHash != hash {
		return &ai.Error{Code: "WIKI_INPUT_CHANGED", Message: "Wiki 材料或生成配置已变化，不能混用旧批次；请重新处理当前文档"}
	}
	t.Checkpoint["wiki_batches"] = plan
	quality, e := w.ocrIssues(ctx, t)
	if e != nil {
		return e
	}
	for i := range plan.Batches {
		b := &plan.Batches[i]
		if b.Status == "succeeded" || b.Status == "failed" {
			continue
		}
		if b.Status == "running" {
			now := time.Now().UTC()
			b.Error = &WikiFailure{Code: "WIKI_INTERRUPTED", Message: "上次请求中断，已保留成功页面与批次"}
			if n := len(b.History); n > 0 && b.History[n-1].FinishedAt == nil {
				b.History[n-1].FinishedAt = &now
				b.History[n-1].Error = b.Error
			}
		}
		qualityIssues := []GenerationIssue{}
		for _, chunk := range chunks[b.Start : b.Start+b.Count] {
			if issue, ok := quality[chunk.SourceID]; ok {
				qualityIssues = append(qualityIssues, issue)
			}
		}
		if len(qualityIssues) > 0 {
			b.Status = "failed"
			b.Error = &WikiFailure{Code: "OCR_QUALITY_SUSPECT", Message: "本批原文 OCR 疑似异常；已保留成功页面，请核对来源区域后重新解析，避免生成错误事实", Issues: qualityIssues}
			if e = w.saveWikiProgress(ctx, t, plan, b); e != nil {
				return e
			}
			continue
		}
		input, aliases := wikiInput(chunks[b.Start : b.Start+b.Count])
		for b.Attempts < wikiMaxAttempts {
			if e = ctx.Err(); e != nil {
				return e
			}
			feedback := ""
			if b.Error != nil {
				feedback = "上次生成未通过校验：" + b.Error.Message + "。修复引用或格式，保留原有事实和细节，不得删除有依据的内容。\n"
				details, _ := json.Marshal(b.Error.Issues)
				feedback += "具体校验项：" + string(details) + "\n"
			}
			if len(b.Pending) > 0 {
				draft, _ := json.Marshal(b.Pending)
				accepted, _ := json.Marshal(b.Accepted)
				feedback += "局部修复：仅返回下列待修复页面，保持主题、正文块数量及顺序；只修正错误引用，正文、数值、表格逐字保留，修复前须对照完整原文；不可删除页面、简化事实或重复已保留的页面。待修复页面：" + string(draft) + "\n已保留页面（不要重新生成）：" + string(accepted) + "\n"
			}
			b.Attempts++
			b.Status = "running"
			b.History = append(b.History, WikiAttempt{Number: b.Attempts, Round: b.Round, StartedAt: time.Now().UTC()})
			if e = w.saveWikiProgress(ctx, t, plan, b); e != nil {
				return e
			}
			prompt := wikiPrompt(t.Config) + structuredWikiContract + "\n" + feedback + "材料：\n" + string(input)
			text, callErr := ai.Chat(ctx, m, prompt, nil)
			if ctx.Err() != nil {
				return ctx.Err()
			}
			var pages []WikiPage
			var pending []json.RawMessage
			var issues []GenerationIssue
			if callErr == nil {
				pages, pending, issues, callErr = validateWikiDraft(text, aliases, b)
				b.Pending = pending
			}
			now := time.Now().UTC()
			b.History[len(b.History)-1].FinishedAt = &now
			if callErr == nil {
				b.Status = "succeeded"
				b.Error = nil
			} else {
				b.Error = wikiFailure(callErr)
				b.Error.Issues = issues
				b.Error.ResponseExcerpt = excerpt(text)
				b.History[len(b.History)-1].Error = b.Error
			}
			for _, page := range pages {
				b.Accepted = append(b.Accepted, page.Title)
			}
			// Verified pages and the repair draft commit together, even when siblings fail.
			if len(pages) > 0 || callErr == nil {
				if e = w.saveWikiBatch(ctx, t, plan, b, pages); e != nil {
					return e
				}
			}
			if callErr == nil {
				break
			}
			b.Status = "retrying"
			if b.Attempts >= wikiMaxAttempts || !wikiRetryable(callErr) {
				b.Status = "failed"
			}
			if e = w.saveWikiProgress(ctx, t, plan, b); e != nil {
				return e
			}
			if b.Status == "failed" {
				break
			}
			timer := time.NewTimer(time.Duration(b.Attempts) * 2 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		// A crashed final request consumes its budget; explicit retry can start a new round.
		if b.Status != "succeeded" {
			b.Status = "failed"
		}
		if e = w.saveWikiProgress(ctx, t, plan, b); e != nil {
			return e
		}
	}
	failed := 0
	for _, b := range plan.Batches {
		if b.Status != "succeeded" {
			failed++
		}
	}
	if failed > 0 {
		return &ai.Error{Code: "WIKI_BATCHES_FAILED", Message: fmt.Sprintf("Wiki 有 %d / %d 批未完成，成功结果已保存，可仅补跑失败批次", failed, len(plan.Batches))}
	}
	return nil
}

func (w *Worker) saveWikiProgress(ctx context.Context, t *Task, p *WikiPlan, b *WikiBatch) error {
	span := t.traceStage("wiki", "running")
	if len(span.Children) == 0 {
		span.Children = append(span.Children, &WorkSpan{Name: "generate_wiki", Status: "running", StartedAt: time.Now().UTC()})
	}
	progress := &WorkProgress{Retrying: b.Status == "retrying", Unit: "chunk", Batch: b.Index, Batches: len(p.Batches), Attempt: b.Attempts, MaxRetries: 2}
	for _, item := range p.Batches {
		progress.Total += item.Count
		if item.Status == "succeeded" {
			progress.Completed += item.Count
		}
		if item.Status == "failed" {
			progress.FailedBatches++
		}
	}
	child := span.Children[0]
	child.Progress = progress
	if progress.Completed == progress.Total {
		closeSpan(child, "succeeded", time.Now().UTC())
	}
	ledger, _ := json.Marshal(p)
	trace, _ := json.Marshal(t.Pipeline)
	tag, e := w.Services.DB.Exec(ctx, `UPDATE tasks SET checkpoint=jsonb_set(jsonb_set(checkpoint,'{wiki_batches}',$3::jsonb),'{pipeline}',$4::jsonb),updated_at=now() WHERE id=$1 AND owner=$2 AND state='running' AND NOT cancel_requested`, t.ID, t.Owner, ledger, trace)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return context.Canceled
	}
	w.event(ctx, t.ID, map[string]any{"stage": "wiki", "progress": true})
	return nil
}

func (w *Worker) saveWikiBatch(ctx context.Context, t *Task, plan *WikiPlan, batch *WikiBatch, pages []WikiPage) error {
	tx, e := w.Services.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(context.Background())
	if e = Owned(ctx, tx, t); e != nil {
		return e
	}
	// Stable lock order for pages shared with concurrently ingested documents.
	sort.Slice(pages, func(i, j int) bool { return pages[i].Title < pages[j].Title })
	prepared := slices.Clone(plan.PreparedPages)
	for _, p := range pages {
		pageID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(t.KBID+":"+p.Title)).String()
		if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", pageID); e != nil {
			return e
		}
		var old string
		e = tx.QueryRow(ctx, "SELECT content FROM wiki_pages WHERE id=$1", pageID).Scan(&old)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		endMarker := "\n<!-- /source-document -->\n"
		if !slices.Contains(prepared, pageID) {
			rows, err := tx.Query(ctx, "SELECT id::text FROM tasks WHERE knowledge_id=$1", t.KnowledgeID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var id string
				if err = rows.Scan(&id); err != nil {
					rows.Close()
					return err
				}
				old = removeWikiSections(old, "\n<!-- source-task:"+id+":", "\n<!-- /source-task -->\n")
			}
			rows.Close()
			if err = rows.Err(); err != nil {
				return err
			}
			old = removeWikiSections(old, "\n<!-- source-document:"+t.KnowledgeID+":", endMarker)
			if _, e = tx.Exec(ctx, `UPDATE wiki_pages SET source_ids=(SELECT coalesce(jsonb_agg(v),'[]') FROM jsonb_array_elements_text(source_ids) v WHERE NOT v IN (SELECT id::text FROM source_refs WHERE knowledge_id=$2)) WHERE id=$1`, pageID, t.KnowledgeID); e != nil {
				return e
			}
			prepared = append(prepared, pageID)
		}
		marker := fmt.Sprintf("\n<!-- source-document:%s:%d -->\n", t.KnowledgeID, batch.Start)
		old = removeWikiSections(old, marker, endMarker)
		content := old + marker + p.Content + endMarker
		sources, _ := json.Marshal(p.SourceIDs)
		_, e = tx.Exec(ctx, `INSERT INTO wiki_pages(id,knowledge_base_id,title,content,source_ids,search_vector) VALUES($1,$2,$3,$4,$5,to_tsvector('simple',$6)) ON CONFLICT(id) DO UPDATE SET state='ready',content=excluded.content,source_ids=(SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements(wiki_pages.source_ids||excluded.source_ids) v),search_vector=excluded.search_vector,updated_at=now()`, pageID, t.KBID, p.Title, content, sources, textutil.Tokens(content))
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO wiki_revisions(id,page_id,content,source_ids) SELECT $1,id,content,source_ids FROM wiki_pages WHERE id=$2", uuid.NewString(), pageID); e != nil {
			return e
		}
	}
	// Commit all pages and the successful checkpoint together. An interrupted
	// commit is resolved by reloading the persisted ledger on the next lease.
	saved := *plan
	saved.PreparedPages = prepared
	saved.Batches = slices.Clone(plan.Batches)
	saved.Batches[batch.Index-1] = *batch
	ledger, _ := json.Marshal(saved)
	if _, e = tx.Exec(ctx, `UPDATE tasks SET checkpoint=jsonb_set(checkpoint,'{wiki_batches}',$2::jsonb) WHERE id=$1`, t.ID, ledger); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	plan.PreparedPages = prepared
	return nil
}
