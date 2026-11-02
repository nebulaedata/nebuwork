package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"nebulaekno/internal/jobs"
)

type documentScope struct {
	KnowledgeID     string `json:"knowledge_id"`
	KnowledgeBaseID string `json:"knowledge_base_id"`
	FileVersionID   string `json:"file_version_id"`
	ParseVersionID  string `json:"parse_version_id"`
	Current         bool   `json:"is_current"`
	refs            map[string]bool
	config          map[string]any
}

func (s *Server) documentRelatedRoutes() {
	s.handle("GET /api/v1/knowledge/{id}/related/stats", s.documentRelatedStats)
	s.handle("GET /api/v1/knowledge/{id}/wiki/pages", s.documentWikiPages)
	s.handle("GET /api/v1/knowledge/{id}/wiki/pages/{page}", s.documentWikiPages)
	s.handle("GET /api/v1/knowledge/{id}/wiki/graph", s.documentWikiGraph)
	s.handle("GET /api/v1/knowledge/{id}/graph", s.documentGraph)
}

// Resolve once and echo the selected versions. An explicit bad/mismatched
// version never falls back to the current document.
func (s *Server) relatedScope(w http.ResponseWriter, r *http.Request) (documentScope, bool) {
	var scope documentScope
	id, ok := identifier(w, r, "id")
	if !ok {
		return scope, false
	}
	file, parse := r.URL.Query().Get("file_version_id"), r.URL.Query().Get("parse_version_id")
	if file != "" && uuid.Validate(file) != nil || parse != "" && uuid.Validate(parse) != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "文件或解析版本无效")
		return scope, false
	}
	var config []byte
	err := s.Services.DB.QueryRow(r.Context(), `SELECT k.id::text,k.knowledge_base_id::text,f.id::text,coalesce(p.id::text,''),coalesce(p.id=k.current_parse_version_id,f.id=k.current_file_version_id),b.config||k.config
 FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id
 JOIN file_versions f ON f.knowledge_id=k.id AND f.id=coalesce(nullif($2,'')::uuid,(SELECT file_version_id FROM parse_versions WHERE id=coalesce(nullif($3,'')::uuid,k.current_parse_version_id) AND knowledge_id=k.id),k.current_file_version_id)
 LEFT JOIN LATERAL (SELECT id FROM parse_versions WHERE knowledge_id=k.id AND file_version_id=f.id AND
 (($3<>'' AND id=nullif($3,'')::uuid) OR ($3='' AND $2<>'') OR ($3='' AND $2='' AND id=k.current_parse_version_id)) ORDER BY created_at DESC,id DESC LIMIT 1) p ON true
 WHERE k.id=$1 AND ($3='' OR p.id IS NOT NULL)`, id, file, parse).Scan(&scope.KnowledgeID, &scope.KnowledgeBaseID, &scope.FileVersionID, &scope.ParseVersionID, &scope.Current, &config)
	if err != nil {
		dbFailure(w, err)
		return scope, false
	}
	_ = json.Unmarshal(config, &scope.config)
	scope.refs = map[string]bool{}
	if scope.ParseVersionID != "" {
		rows, e := s.Services.DB.Query(r.Context(), "SELECT id::text FROM source_refs WHERE knowledge_id=$1 AND parse_version_id=$2", id, scope.ParseVersionID)
		if e != nil {
			dbFailure(w, e)
			return scope, false
		}
		defer rows.Close()
		for rows.Next() {
			var ref string
			if e = rows.Scan(&ref); e != nil {
				dbFailure(w, e)
				return scope, false
			}
			scope.refs[ref] = true
		}
		if e = rows.Err(); e != nil {
			dbFailure(w, e)
			return scope, false
		}
	}
	return scope, true
}

type documentWikiPage struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	State        string    `json:"state"`
	FolderID     *string   `json:"folder_id"`
	UpdatedAt    time.Time `json:"updated_at"`
	RevisionID   string    `json:"revision_id,omitempty"`
	Shared       bool      `json:"shared"`
	Content      string    `json:"content,omitempty"`
	ContentState string    `json:"content_state"`
	Reason       string    `json:"reason,omitempty"`
	SourceIDs    []string  `json:"source_ids"`
	FullPageURL  string    `json:"full_page_url"`
}

var wikiContribution = regexp.MustCompile(`(?s)<!--\s*source-(document|task):([a-fA-F0-9-]{36}):[^>]*-->\s*(.*?)\s*<!--\s*/source-(?:document|task)\s*-->`)
var wikiSourceLink = regexp.MustCompile(`\]\(source:([a-fA-F0-9-]{36})\)`)

// Only complete, version-verifiable contribution sections are returned. A
// shared page or manually edited prose must never be attributed by proximity.
func documentWikiContent(content, doc string, tasks, refs map[string]bool) (string, string, string) {
	parts := []string{}
	rejected := 0
	for _, m := range wikiContribution.FindAllStringSubmatch(content, -1) {
		if !(m[1] == "document" && m[2] == doc || m[1] == "task" && tasks[m[2]]) {
			continue
		}
		citations := wikiSourceLink.FindAllStringSubmatch(m[3], -1)
		valid := len(citations) > 0
		for _, c := range citations {
			if !refs[c[1]] {
				valid = false
			}
		}
		if valid {
			parts = append(parts, m[3])
		} else {
			rejected++
		}
	}
	if len(parts) == 0 {
		return "", "unavailable", "无法独立提取本文件正文：缺少完整贡献区段或引用无法与所选解析版本核验。"
	}
	if rejected > 0 {
		return strings.Join(parts, "\n\n"), "partial", "仅展示已核验的本文件区段；部分区段缺少引用或属于其他解析版本。"
	}
	return strings.Join(parts, "\n\n"), "ready", ""
}

func (s *Server) loadDocumentWiki(ctx context.Context, scope documentScope) ([]documentWikiPage, error) {
	pages := []documentWikiPage{}
	if len(scope.refs) == 0 {
		return pages, nil
	}
	tasks := map[string]bool{}
	tr, err := s.Services.DB.Query(ctx, "SELECT id::text FROM tasks WHERE knowledge_id=$1", scope.KnowledgeID)
	if err != nil {
		return nil, err
	}
	for tr.Next() {
		var id string
		if err = tr.Scan(&id); err != nil {
			tr.Close()
			return nil, err
		}
		tasks[id] = true
	}
	err = tr.Err()
	tr.Close()
	if err != nil {
		return nil, err
	}
	refs := make([]string, 0, len(scope.refs))
	for id := range scope.refs {
		refs = append(refs, id)
	}
	rows, err := s.Services.DB.Query(ctx, `WITH candidates AS (
 SELECT p.id,p.title,p.state,p.folder_id,p.updated_at,p.content,p.source_ids,''::text revision_id,CASE WHEN $3 THEN 0 ELSE 1 END priority FROM wiki_pages p WHERE p.knowledge_base_id=$1 AND p.source_ids ?| $2::text[]
 UNION ALL
 SELECT p.id,p.title,'historical',p.folder_id,v.created_at,v.content,v.source_ids,v.id::text,0 FROM wiki_revisions v JOIN wiki_pages p ON p.id=v.page_id
 WHERE NOT $3::boolean AND p.knowledge_base_id=$1 AND v.source_ids ?| $2::text[]
 ), chosen AS (SELECT DISTINCT ON(id) * FROM candidates ORDER BY id,priority,updated_at DESC,revision_id DESC)
 SELECT c.id::text,c.title,c.state,c.folder_id::text,c.updated_at,c.content,c.source_ids,c.revision_id,
 EXISTS(SELECT 1 FROM source_refs s WHERE c.source_ids ? s.id::text AND s.knowledge_id<>$4)
 FROM chosen c ORDER BY c.title,c.id`, scope.KnowledgeBaseID, refs, scope.Current, scope.KnowledgeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p documentWikiPage
		var all []string
		var raw []byte
		var content string
		if err = rows.Scan(&p.ID, &p.Title, &p.State, &p.FolderID, &p.UpdatedAt, &content, &raw, &p.RevisionID, &p.Shared); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &all); err != nil {
			return nil, err
		}
		p.SourceIDs = []string{}
		for _, id := range all {
			if scope.refs[id] {
				p.SourceIDs = append(p.SourceIDs, id)
			}
		}
		sort.Strings(p.SourceIDs)
		p.Content, p.ContentState, p.Reason = documentWikiContent(content, scope.KnowledgeID, tasks, scope.refs)
		p.FullPageURL = "/knowledge-bases/" + scope.KnowledgeBaseID + "?tab=wiki&wiki_page=" + p.ID
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

func (s *Server) documentWikiPages(w http.ResponseWriter, r *http.Request) {
	scope, ok := s.relatedScope(w, r)
	if !ok {
		return
	}
	wanted := r.PathValue("page")
	if wanted != "" && uuid.Validate(wanted) != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "Wiki 页面 ID 无效")
		return
	}
	pages, err := s.loadDocumentWiki(r.Context(), scope)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if wanted != "" {
		for _, p := range pages {
			if p.ID == wanted {
				JSON(w, 200, struct {
					documentScope
					documentWikiPage
				}{scope, p})
				return
			}
		}
		Failure(w, 404, "NOT_FOUND", "该 Wiki 页面不属于所选文档版本")
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	items := []documentWikiPage{}
	for _, p := range pages {
		if q == "" || strings.Contains(strings.ToLower(p.Title), q) {
			p.Content = ""
			items = append(items, p)
		}
	}
	page, size := paging(r)
	start := min((page-1)*size, len(items))
	end := min(start+size, len(items))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	writeJSON(w, map[string]any{"success": true, "data": items[start:end], "meta": map[string]any{"page": page, "page_size": size, "total": len(items), "has_more": end < len(items), "knowledge_id": scope.KnowledgeID, "knowledge_base_id": scope.KnowledgeBaseID, "is_current": scope.Current, "file_version_id": scope.FileVersionID, "parse_version_id": scope.ParseVersionID}})
}
func (s *Server) documentWikiGraph(w http.ResponseWriter, r *http.Request) {
	scope, ok := s.relatedScope(w, r)
	if !ok {
		return
	}
	pages, err := s.loadDocumentWiki(r.Context(), scope)
	if err != nil {
		dbFailure(w, err)
		return
	}
	input := []wikiGraphPage{}
	for _, p := range pages {
		input = append(input, wikiGraphPage{ID: p.ID, Title: p.Title, State: p.State, FolderID: p.FolderID, UpdatedAt: p.UpdatedAt, Content: p.Content})
	}
	graph := buildWikiPageGraph(input)
	for i := range pages {
		pages[i].Content = ""
	}
	JSON(w, 200, struct {
		documentScope
		Nodes      []documentWikiPage `json:"nodes"`
		Edges      []wikiPageLink     `json:"edges"`
		Unresolved int                `json:"unresolved_references"`
	}{scope, pages, graph.Edges, graph.Unresolved})
}

type documentEvidence struct {
	Text       string `json:"text"`
	Type       string `json:"type"`
	Quote      string `json:"quote"`
	SourceID   string `json:"source_ref_id"`
	EvidenceID string `json:"evidence_id"`
	Synced     bool   `json:"synced"`
}
type documentEntity struct {
	Name         string             `json:"name"`
	Type         string             `json:"type"`
	Types        []string           `json:"types"`
	Description  string             `json:"description"`
	Descriptions []documentEvidence `json:"descriptions"`
	SourceIDs    []string           `json:"source_ids"`
}
type documentRelation struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	Target     string `json:"target"`
	Relation   string `json:"relation"`
	Quote      string `json:"quote"`
	SourceID   string `json:"source_ref_id"`
	EvidenceID string `json:"evidence_id"`
	Synced     bool   `json:"synced"`
}
type documentGraphRecord struct {
	ID      string
	Created time.Time
	Synced  bool
	Payload jobs.GraphPayload
}
type documentGraphData struct {
	Nodes     []documentEntity   `json:"nodes"`
	Relations []documentRelation `json:"relations"`
}

func aggregateDocumentGraph(records []documentGraphRecord, refs map[string]bool) documentGraphData {
	nodes := map[string]*documentEntity{}
	relations := map[string]documentRelation{}
	add := func(name, kind, description, quote, source string, record documentGraphRecord) {
		if name == "" || !refs[source] {
			return
		}
		n := nodes[name]
		if n == nil {
			n = &documentEntity{Name: name, Types: []string{}, SourceIDs: []string{}, Descriptions: []documentEvidence{}}
			nodes[name] = n
		}
		if !containsString(n.SourceIDs, source) {
			n.SourceIDs = append(n.SourceIDs, source)
		}
		if kind != "" && !containsString(n.Types, kind) {
			n.Types = append(n.Types, kind)
		}
		if description != "" {
			e := documentEvidence{description, kind, quote, source, record.ID, record.Synced}
			found := false
			for _, old := range n.Descriptions {
				if old == e {
					found = true
					break
				}
			}
			if !found {
				n.Descriptions = append(n.Descriptions, e)
			}
		}
	}
	for _, record := range records {
		for _, e := range record.Payload.Entities {
			add(e.Name, e.Type, e.Description, e.Quote, e.SourceID, record)
		}
		for _, r := range record.Payload.Relations {
			if r.Source == "" || r.Target == "" || r.Relation == "" || !refs[r.SourceID] {
				continue
			}
			add(r.Source, "", "", "", r.SourceID, record)
			add(r.Target, "", "", "", r.SourceID, record)
			id := uuid.NewSHA1(uuid.NameSpaceOID, []byte(strings.Join([]string{record.ID, r.Source, r.Relation, r.Target, r.SourceID, r.Quote}, "\x00"))).String()
			relations[id] = documentRelation{id, r.Source, r.Target, r.Relation, r.Quote, r.SourceID, record.ID, record.Synced}
		}
	}
	out := documentGraphData{Nodes: []documentEntity{}, Relations: []documentRelation{}}
	for _, n := range nodes {
		sort.Strings(n.SourceIDs)
		sort.Strings(n.Types)
		n.Type = "未分类"
		if len(n.Types) > 0 {
			n.Type = n.Types[0]
		}
		sort.Slice(n.Descriptions, func(i, j int) bool {
			a, b := n.Descriptions[i], n.Descriptions[j]
			return a.Text+a.SourceID+a.EvidenceID < b.Text+b.SourceID+b.EvidenceID
		})
		texts := []string{}
		for _, d := range n.Descriptions {
			if !containsString(texts, d.Text) {
				texts = append(texts, d.Text)
			}
		}
		n.Description = strings.Join(texts, "\n\n")
		out.Nodes = append(out.Nodes, *n)
	}
	for _, r := range relations {
		out.Relations = append(out.Relations, r)
	}
	sort.Slice(out.Nodes, func(i, j int) bool { return out.Nodes[i].Name < out.Nodes[j].Name })
	sort.Slice(out.Relations, func(i, j int) bool { return out.Relations[i].ID < out.Relations[j].ID })
	return out
}
func containsString(items []string, value string) bool {
	for _, v := range items {
		if v == value {
			return true
		}
	}
	return false
}

type documentGraphCursor struct {
	Parse   string    `json:"parse"`
	ID      string    `json:"id"`
	Created time.Time `json:"created"`
}

func parseDocumentGraphCursor(raw, parse string) (documentGraphCursor, error) {
	var cursor documentGraphCursor
	if raw == "" {
		return cursor, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return cursor, err
	}
	if err = json.Unmarshal(data, &cursor); err != nil {
		return cursor, err
	}
	if cursor.Parse != parse || uuid.Validate(cursor.ID) != nil || cursor.Created.IsZero() {
		return cursor, fmt.Errorf("游标不属于所选解析版本")
	}
	return cursor, nil
}
func (s *Server) loadDocumentGraph(ctx context.Context, scope documentScope, cursor documentGraphCursor, limit int) ([]documentGraphRecord, int, error) {
	records := []documentGraphRecord{}
	if scope.ParseVersionID == "" {
		return records, 0, nil
	}
	var total int
	if err := s.Services.DB.QueryRow(ctx, `SELECT count(*) FROM graph_records g JOIN source_refs s ON s.id=g.source_ref_id WHERE g.knowledge_id=$1 AND s.knowledge_id=$1 AND s.parse_version_id=$2`, scope.KnowledgeID, scope.ParseVersionID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.Services.DB.Query(ctx, `SELECT g.id::text,g.created_at,g.synced_at IS NOT NULL,g.payload FROM graph_records g JOIN source_refs s ON s.id=g.source_ref_id WHERE g.knowledge_id=$1 AND s.knowledge_id=$1 AND s.parse_version_id=$2 AND ($3='' OR (g.created_at,g.id)>($4,nullif($3,'')::uuid)) ORDER BY g.created_at,g.id LIMIT $5`, scope.KnowledgeID, scope.ParseVersionID, cursor.ID, cursor.Created, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var record documentGraphRecord
		var raw []byte
		if err = rows.Scan(&record.ID, &record.Created, &record.Synced, &raw); err != nil {
			return nil, 0, err
		}
		if err = json.Unmarshal(raw, &record.Payload); err != nil {
			return nil, 0, err
		}
		records = append(records, record)
	}
	return records, total, rows.Err()
}
func (s *Server) documentGraph(w http.ResponseWriter, r *http.Request) {
	scope, ok := s.relatedScope(w, r)
	if !ok {
		return
	}
	cursor, err := parseDocumentGraphCursor(r.URL.Query().Get("cursor"), scope.ParseVersionID)
	if err != nil {
		Failure(w, 400, "INVALID_CURSOR", "游标无效或与解析版本不匹配")
		return
	}
	_, size := paging(r)
	records, total, err := s.loadDocumentGraph(r.Context(), scope, cursor, size+1)
	if err != nil {
		dbFailure(w, err)
		return
	}
	more := len(records) > size
	if more {
		records = records[:size]
	}
	next := ""
	if more {
		last := records[len(records)-1]
		raw, _ := json.Marshal(documentGraphCursor{scope.ParseVersionID, last.ID, last.Created})
		next = base64.RawURLEncoding.EncodeToString(raw)
	}
	pending := 0
	for _, record := range records {
		if !record.Synced {
			pending++
		}
	}
	JSON(w, 200, struct {
		documentScope
		documentGraphData
		Meta map[string]any `json:"meta"`
	}{scope, aggregateDocumentGraph(records, scope.refs), map[string]any{"page_size": size, "returned_records": len(records), "total_records": total, "has_more": more, "next_cursor": next, "pending_sync_records": pending}})
}

func (s *Server) documentRelatedStats(w http.ResponseWriter, r *http.Request) {
	scope, ok := s.relatedScope(w, r)
	if !ok {
		return
	}
	pages, err := s.loadDocumentWiki(r.Context(), scope)
	if err != nil {
		dbFailure(w, err)
		return
	}
	records, total, err := s.loadDocumentGraph(r.Context(), scope, documentGraphCursor{}, 2147483647)
	if err != nil {
		dbFailure(w, err)
		return
	}
	graph := aggregateDocumentGraph(records, scope.refs)
	pending := 0
	for _, g := range records {
		if !g.Synced {
			pending++
		}
	}
	stages, err := s.documentStageStates(r.Context(), scope, len(pages) > 0, total > 0)
	if err != nil {
		dbFailure(w, err)
		return
	}
	JSON(w, 200, struct {
		documentScope
		WikiPages int            `json:"wiki_pages"`
		Entities  int            `json:"entities"`
		Relations int            `json:"relations"`
		Evidence  int            `json:"evidence_records"`
		Pending   int            `json:"pending_sync_records"`
		Stages    map[string]any `json:"stages"`
		WikiURL   string         `json:"wiki_url"`
		GraphURL  string         `json:"graph_url"`
	}{scope, len(pages), len(graph.Nodes), len(graph.Relations), total, pending, stages, "/knowledge-bases/" + scope.KnowledgeBaseID + "?tab=wiki", "/knowledge-bases/" + scope.KnowledgeBaseID + "?tab=graph"})
}
func (s *Server) documentStageStates(ctx context.Context, scope documentScope, hasWiki, hasGraph bool) (map[string]any, error) {
	rows, err := s.Services.DB.Query(ctx, `SELECT id::text,state,stage,checkpoint,error FROM tasks WHERE knowledge_id=$1 AND (checkpoint->>'parse_version_id'=$2 OR ($3 AND coalesce(checkpoint->>'parse_version_id','')='' AND state IN ('queued','running','waiting_configuration','failed','cancelled'))) ORDER BY created_at DESC,id DESC LIMIT 50`, scope.KnowledgeID, scope.ParseVersionID, scope.Current && scope.ParseVersionID == "")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]any{}
	for rows.Next() {
		var id, state, stage string
		var raw, taskError []byte
		if err = rows.Scan(&id, &state, &stage, &raw, &taskError); err != nil {
			return nil, err
		}
		cp := map[string]any{}
		if err = json.Unmarshal(raw, &cp); err != nil {
			return nil, err
		}
		for _, kind := range []string{"wiki", "graph"} {
			if _, found := out[kind]; found {
				continue
			}
			status, _ := cp[kind].(string)
			var failure any = cp[kind+"_error"]
			if status == "" && scope.ParseVersionID == "" && (state == "failed" || state == "cancelled" || state == "waiting_configuration") {
				status = state
				if len(taskError) > 0 {
					_ = json.Unmarshal(taskError, &failure)
				}
			}
			if status == "" && (state == "running" || state == "queued" || state == "waiting_configuration") {
				status = "pending"
				if stage == kind {
					status = state
				}
			}
			if status != "" {
				if state == "running" && stage == kind {
					status = "running"
				}
				if status == "failed" && (kind == "wiki" && hasWiki || kind == "graph" && hasGraph) {
					status = "partially_failed"
				}
				out[kind] = map[string]any{"state": status, "error": failure, "task_id": id}
			}
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for _, kind := range []string{"wiki", "graph"} {
		if _, found := out[kind]; !found {
			status := "empty"
			if scope.ParseVersionID == "" {
				status = "pending"
			}
			if enabled, ok := scope.config[kind+"_enabled"].(bool); ok && !enabled {
				status = "disabled"
			}
			if kind == "wiki" && hasWiki || kind == "graph" && hasGraph {
				status = "ready"
			}
			out[kind] = map[string]any{"state": status}
		}
	}
	return out, nil
}
