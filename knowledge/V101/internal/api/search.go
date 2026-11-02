package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/google/uuid"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/jobs"
	"nebulaekno/internal/textutil"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

type SearchFilters struct {
	FileTypes     []string `json:"file_types"`
	MediaTypes    []string `json:"media_types"`
	Origins       []string `json:"content_origins"`
	Tags          []string `json:"tags"`
	FolderIDs     []string `json:"folder_ids"`
	CreatedAfter  string   `json:"created_after"`
	CreatedBefore string   `json:"created_before"`
	TimeStart     *int64   `json:"time_start_ms"`
	TimeEnd       *int64   `json:"time_end_ms"`
}
type SearchInput struct {
	Query          string        `json:"query_text"`
	ImageID        string        `json:"query_image_id"`
	Mode           string        `json:"mode"`
	KBIDs          []string      `json:"knowledge_base_ids"`
	IDs            []string      `json:"knowledge_ids"`
	Filters        SearchFilters `json:"filters"`
	TopK           int           `json:"top_k"`
	Candidates     int           `json:"candidate_k"`
	IncludeSources *bool         `json:"include_sources"`
	IncludeContext *bool         `json:"include_context"`
	Explain        bool          `json:"explain"`
	AllowPartial   *bool         `json:"allow_partial"`
	Rerank         struct {
		Mode    string `json:"mode"`
		ModelID string `json:"model_id"`
	} `json:"rerank"`
	Graph struct {
		MaxHops       int      `json:"max_hops"`
		RelationTypes []string `json:"relation_types"`
	} `json:"graph"`
	Multi struct {
		Channels []string `json:"channels"`
	} `json:"multi"`
}
type Hit struct {
	ID          string           `json:"result_id"`
	Type        string           `json:"result_type"`
	KBID        string           `json:"knowledge_base_id"`
	KnowledgeID string           `json:"knowledge_id,omitempty"`
	ChunkID     string           `json:"chunk_id,omitempty"`
	Title       string           `json:"title"`
	Content     string           `json:"content"`
	Matched     string           `json:"matched_content"`
	Channels    []string         `json:"channels"`
	Scores      map[string]any   `json:"scores"`
	Sources     []map[string]any `json:"source_refs"`
	SourceIDs   []string         `json:"-"`
	Origin      string           `json:"content_origin,omitempty"`
	Score       float64          `json:"-"`
	ScoreType   string           `json:"-"`
	RawScore    float64          `json:"-"`
	SpaceID     string           `json:"-"`
	Context     []map[string]any `json:"context,omitempty"`
}

var searchModes = map[string]bool{"keyword": true, "vector": true, "hybrid": true, "graph": true, "wiki": true, "image_text": true, "image_vector": true, "multi": true}

func (s *Server) searchRoutes() {
	s.handle("POST /api/v1/search", s.search)
	for _, mode := range []string{"keyword", "vector", "hybrid", "graph", "wiki", "image-text", "image-vector", "multi"} {
		s.handle("POST /api/v1/search/"+mode, s.search)
	}
	s.handle("POST /api/v1/knowledge-bases/{id}/search", s.search)
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	var in SearchInput
	if !decode(w, r, &in) {
		return
	}
	if id := r.PathValue("id"); id != "" {
		if uuid.Validate(id) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "知识库 ID 无效")
			return
		}
		if len(in.KBIDs) > 0 && (len(in.KBIDs) != 1 || in.KBIDs[0] != id) {
			Failure(w, 400, "INVALID_ARGUMENT", "单知识库入口与请求范围冲突")
			return
		}
		in.KBIDs = []string{id}
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/search/") {
		fixed := strings.ReplaceAll(strings.TrimPrefix(r.URL.Path, "/api/v1/search/"), "-", "_")
		if in.Mode != "" && in.Mode != fixed {
			Failure(w, 400, "INVALID_ARGUMENT", "路径与请求中的检索方式冲突")
			return
		}
		in.Mode = fixed
	}
	result, err := s.executeSearch(r.Context(), in)
	if err != nil {
		if e, ok := err.(*SearchError); ok {
			Failure(w, e.Status, e.Code, e.Message)
		} else {
			dbFailure(w, err)
		}
		return
	}
	JSON(w, 200, result)
}

type SearchResult struct {
	Results []Hit          `json:"results"`
	Meta    map[string]any `json:"meta"`
}
type SearchError struct {
	Status        int
	Code, Message string
}

func (e *SearchError) Error() string { return e.Code + ": " + e.Message }

// executeSearch is shared by retrieval HTTP routes and knowledge QA.
func (s *Server) executeSearch(ctx context.Context, in SearchInput) (SearchResult, error) {
	return s.executeSearchWithin(ctx, in, 90*time.Second)
}

func (s *Server) executeSearchWithin(ctx context.Context, in SearchInput, budget time.Duration) (SearchResult, error) {
	requestContext := ctx
	start := time.Now()
	var defaults map[string]any
	_ = s.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='retrieval-defaults'").Scan(&defaults)
	if len(in.KBIDs) == 1 && uuid.Validate(in.KBIDs[0]) == nil {
		var stored map[string]any
		if e := s.Services.DB.QueryRow(ctx, "SELECT config->'retrieval_config' FROM knowledge_bases WHERE id=$1", in.KBIDs[0]).Scan(&stored); e == nil && stored != nil {
			defaults = merge(defaults, stored)
		}
	}
	if in.Mode == "" {
		in.Mode, _ = defaults["mode"].(string)
		if in.Mode == "" {
			in.Mode = "hybrid"
		}
	}
	if in.TopK == 0 {
		in.TopK = jobs.Number(defaults, "top_k", 10)
	}
	if in.Candidates == 0 {
		in.Candidates = jobs.Number(defaults, "candidate_k", 50)
	}
	if !searchModes[in.Mode] || len(in.KBIDs) == 0 || len(in.KBIDs) > 100 || in.TopK < 1 || in.TopK > 100 || in.Candidates < in.TopK || in.Candidates > 500 || len([]rune(in.Query)) > 4096 || (strings.TrimSpace(in.Query) == "" && in.ImageID == "") {
		return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "请提供有效检索方式、知识库、查询和候选数量"}
	}
	for _, id := range append(append(append([]string{}, in.KBIDs...), in.IDs...), in.Filters.FolderIDs...) {
		if uuid.Validate(id) != nil {
			return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "检索范围包含无效 ID"}
		}
	}
	if in.Rerank.Mode == "" {
		in.Rerank.Mode, _ = defaults["rerank"].(string)
		if in.Rerank.Mode == "" {
			in.Rerank.Mode = "auto"
		}
	}
	if in.Rerank.Mode != "auto" && in.Rerank.Mode != "enabled" && in.Rerank.Mode != "disabled" {
		return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "重排模式无效"}
	}
	if in.Rerank.ModelID != "" && uuid.Validate(in.Rerank.ModelID) != nil {
		return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "重排模型 ID 无效"}
	}
	if in.ImageID != "" {
		if uuid.Validate(in.ImageID) != nil || (in.Mode != "image_vector" && in.Mode != "multi") {
			return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "查询图片仅适用于图片向量或多路检索"}
		}
	}
	if in.Filters.TimeStart != nil && *in.Filters.TimeStart < 0 || in.Filters.TimeEnd != nil && *in.Filters.TimeEnd < 0 || in.Filters.TimeStart != nil && in.Filters.TimeEnd != nil && *in.Filters.TimeEnd < *in.Filters.TimeStart {
		return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "媒体时间范围无效"}
	}
	var kbCount int
	if e := s.Services.DB.QueryRow(ctx, "SELECT count(*) FROM knowledge_bases WHERE id=ANY($1::uuid[])", in.KBIDs).Scan(&kbCount); e != nil {
		return SearchResult{}, e
	}
	uniqueKB := map[string]bool{}
	for _, id := range in.KBIDs {
		uniqueKB[id] = true
	}
	if kbCount != len(uniqueKB) || kbCount != len(in.KBIDs) {
		return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "知识库不存在或重复"}
	}
	if in.Graph.MaxHops == 0 {
		in.Graph.MaxHops = 1
	}
	if in.Graph.MaxHops < 1 || in.Graph.MaxHops > 2 {
		return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "图谱最多支持两跳"}
	}
	for _, date := range []string{in.Filters.CreatedAfter, in.Filters.CreatedBefore} {
		if date != "" {
			if _, e := time.Parse(time.RFC3339, date); e != nil {
				return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "入库时间须为 RFC3339 格式"}
			}
		}
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	channels := []string{in.Mode}
	if in.Mode == "hybrid" {
		channels = []string{"keyword", "vector"}
	}
	if in.Mode == "multi" {
		channels = in.Multi.Channels
		if len(channels) == 0 {
			channels = []string{"keyword", "vector", "graph", "wiki", "image_text"}
			if strings.TrimSpace(in.Query) == "" && in.ImageID != "" {
				channels = []string{"image_vector"}
			}
		}
	}
	seen := map[string]bool{}
	for _, channel := range channels {
		if !searchModes[channel] || channel == "multi" || channel == "hybrid" || seen[channel] {
			return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "多路通道无效或重复"}
		}
		if strings.TrimSpace(in.Query) == "" && channel != "image_vector" {
			return SearchResult{}, &SearchError{400, "INVALID_ARGUMENT", "所选通道需要 query_text"}
		}
		seen[channel] = true
	}
	allowPartial := in.Mode == "multi"
	if in.AllowPartial != nil {
		allowPartial = *in.AllowPartial
	}
	all := map[string]*Hit{}
	warnings := []any{}
	counts := map[string]int{}
	successful := 0
	var graphCoverage *GraphSearchCoverage
	for _, channel := range channels {
		var hits []Hit
		var e error
		if channel == "graph" {
			graphCoverage, e = s.graphSearchCoverage(ctx, in)
			if e == nil {
				e = graphCoverage.ready()
			}
		}
		if e == nil {
			hits, e = s.recall(ctx, in, channel)
		}
		if e != nil {
			code, message := "RETRIEVAL_FAILED", "检索执行失败"
			if a, ok := e.(*ai.Error); ok {
				code, message = a.Code, a.Message
			}
			if !allowPartial {
				return SearchResult{}, &SearchError{409, code, message}
			}
			warnings = append(warnings, map[string]string{"channel": channel, "code": code, "message": message})
			continue
		}
		if channel == "graph" {
			if warning := graphCoverage.warning(); warning != nil {
				warnings = append(warnings, warning)
			}
		}
		successful++
		counts[channel] = len(hits)
		rrfK := float64(jobs.Number(defaults, "rrf_k", 60))
		weight := 1.0
		if in.Mode == "hybrid" {
			if channel == "vector" {
				weight = .7
				if v, ok := defaults["vector_weight"].(float64); ok {
					weight = v
				}
			} else {
				weight = .3
				if v, ok := defaults["keyword_weight"].(float64); ok {
					weight = v
				}
			}
		}
		for rank, h := range hits {
			existing, ok := all[h.ID]
			if !ok {
				copy := h
				copy.Channels = []string{}
				copy.Scores = map[string]any{}
				copy.Score = 0
				all[h.ID] = &copy
				existing = &copy
			}
			existing.Channels = append(existing.Channels, channel)
			scoreType := "pg_ts_rank_cd"
			if channel == "vector" || channel == "image_vector" {
				scoreType = "cosine_similarity"
			}
			if channel == "graph" {
				scoreType = "graph_evidence_match"
			}
			if h.ScoreType != "" {
				scoreType = h.ScoreType
			}
			existing.Scores[channel] = map[string]any{"value": h.Score, "type": scoreType}
			if h.SpaceID != "" {
				existing.Scores[channel] = map[string]any{"value": h.Score, "type": scoreType, "cosine_similarity": h.RawScore, "embedding_space_id": h.SpaceID}
			}
			if len(channels) > 1 {
				existing.Score += weight / (rrfK + float64(rank+1))
			} else {
				existing.Score = h.Score
			}
		}
	}
	if successful == 0 {
		return SearchResult{}, &SearchError{409, "NO_RETRIEVAL_CHANNEL_READY", "所有检索通道均不可用，请检查模型与索引状态"}
	}
	hits := make([]Hit, 0, len(all))
	for _, h := range all {
		hits = append(hits, *h)
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	if len(hits) > in.Candidates {
		hits = hits[:in.Candidates]
	}
	rerankStatus := "disabled"
	if in.Rerank.Mode != "disabled" && len(hits) > 0 && strings.TrimSpace(in.Query) != "" {
		var model ai.Model
		var e error
		if in.Rerank.ModelID != "" {
			model, e = ai.Load(ctx, s.Services, in.Rerank.ModelID)
		} else {
			model, e = ai.Bound(ctx, s.Services, "rerank", nil)
		}
		if e == nil && model.Purpose != "rerank" {
			e = ai.Missing("rerank")
		}
		if e == nil {
			docs := []string{}
			for _, h := range hits {
				docs = append(docs, h.Content)
			}
			ranks, err := ai.Rerank(ctx, model, in.Query, docs)
			if err != nil {
				if in.Rerank.Mode == "enabled" {
					return SearchResult{}, &SearchError{502, "RERANK_FAILED", "重排模型调用失败"}
				}
				warnings = append(warnings, map[string]string{"channel": "rerank", "message": "重排失败，保留原始召回排序"})
			} else {
				for _, rank := range ranks {
					hits[rank.Index].Score = rank.Score
					hits[rank.Index].Scores["rerank"] = map[string]any{"value": rank.Score, "type": "model_relevance"}
				}
				sort.Slice(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
				rerankStatus = "applied"
			}
		} else if in.Rerank.Mode == "enabled" {
			return SearchResult{}, &SearchError{409, "MODEL_NOT_CONFIGURED", "请绑定重排模型"}
		} else {
			rerankStatus = "not_configured"
		}
	}
	truncated := len(hits) > in.TopK
	if len(hits) > in.TopK {
		hits = hits[:in.TopK]
	}
	ids := []string{}
	for _, h := range hits {
		ids = append(ids, h.SourceIDs...)
	}
	// A timed-out optional channel must not discard successfully recalled hits
	// by using its expired context to resolve their immutable source identities.
	sourceContext, sourceCancel := context.WithTimeout(requestContext, 10*time.Second)
	defer sourceCancel()
	ctx = sourceContext
	sources, e := s.loadSources(ctx, ids)
	if e != nil {
		return SearchResult{}, e
	}
	for i := range hits {
		hits[i].Matched = hits[i].Content
		hits[i].Sources = []map[string]any{}
		if in.IncludeSources == nil || *in.IncludeSources {
			for _, id := range hits[i].SourceIDs {
				if source, ok := sources[id]; ok {
					hits[i].Sources = append(hits[i].Sources, source)
				}
			}
		}
		if in.IncludeContext != nil && *in.IncludeContext && hits[i].ChunkID != "" {
			rows, err := s.Services.DB.Query(ctx, `SELECT c.id::text,c.content,c.source_ref_id::text FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id JOIN chunks anchor ON anchor.id=$1 WHERE c.parse_version_id=anchor.parse_version_id AND abs(c.ordinal-anchor.ordinal)=1 AND `+jobs.SemanticSourceSQL+` ORDER BY c.ordinal`, hits[i].ChunkID)
			if err != nil {
				return SearchResult{}, err
			}
			for rows.Next() {
				var id, content, source string
				if err = rows.Scan(&id, &content, &source); err != nil {
					rows.Close()
					return SearchResult{}, err
				}
				hits[i].Context = append(hits[i].Context, map[string]any{"chunk_id": id, "content": content, "source_ref_id": source})
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return SearchResult{}, err
			}
		}
		if len(channels) > 1 {
			hits[i].Scores["rrf"] = map[string]any{"value": all[hits[i].ID].Score, "type": "weighted_rrf", "k": jobs.Number(defaults, "rrf_k", 60)}
		}
	}
	meta := map[string]any{"request_id": uuid.NewString(), "duration_ms": time.Since(start).Milliseconds(), "channels": channels, "candidate_counts": counts, "rerank_status": rerankStatus, "warnings": warnings, "truncated": truncated, "candidate_limit": in.Candidates, "top_k": in.TopK}
	if graphCoverage != nil {
		meta["graph_coverage"] = graphCoverage
	}
	return SearchResult{Results: hits, Meta: meta}, nil
}
func knowledgeFilterSQL(in SearchInput) (string, []any) {
	if in.IDs == nil {
		in.IDs = []string{}
	}
	args := []any{in.KBIDs, in.IDs}
	clauses := []string{"k.knowledge_base_id=ANY($1::uuid[])", "(cardinality($2::uuid[])=0 OR k.id=ANY($2::uuid[]))"}
	add := func(expr string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(expr, len(args)))
	}
	if len(in.Filters.FileTypes) > 0 {
		add("k.file_type=ANY($%d::text[])", in.Filters.FileTypes)
	}
	if len(in.Filters.FolderIDs) > 0 {
		add("k.folder_id::text=ANY($%d::text[])", in.Filters.FolderIDs)
	}
	if len(in.Filters.Tags) > 0 {
		add("k.tags ?| $%d::text[]", in.Filters.Tags)
	}
	if in.Filters.CreatedAfter != "" {
		add("k.created_at >= $%d::timestamptz", in.Filters.CreatedAfter)
	}
	if in.Filters.CreatedBefore != "" {
		add("k.created_at <= $%d::timestamptz", in.Filters.CreatedBefore)
	}
	if len(in.Filters.MediaTypes) > 0 {
		types := []string{}
		for _, kind := range in.Filters.MediaTypes {
			if kind == "audio" {
				types = append(types, "mp3", "wav", "ogg", "flac", "m4a", "aac")
			}
			if kind == "video" {
				types = append(types, "mp4", "mkv", "mov", "webm", "avi", "m4v")
			}
		}
		add("k.file_type=ANY($%d::text[])", types)
	}
	return strings.Join(clauses, " AND "), args
}

func filterSQL(in SearchInput) (string, []any) {
	base, args := knowledgeFilterSQL(in)
	clauses := []string{base, "k.current_parse_version_id=c.parse_version_id", "s.parse_version_id=c.parse_version_id", "s.knowledge_id=k.id", jobs.SemanticSourceSQL}
	add := func(expr string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(expr, len(args)))
	}
	if len(in.Filters.Origins) > 0 {
		add("s.origin=ANY($%d::text[])", in.Filters.Origins)
	}
	if in.Filters.TimeStart != nil {
		add("coalesce((s.locators->0->>'end_ms')::bigint,(s.locators->0->>'time_ms')::bigint) >= $%d", *in.Filters.TimeStart)
	}
	if in.Filters.TimeEnd != nil {
		add("coalesce((s.locators->0->>'start_ms')::bigint,(s.locators->0->>'time_ms')::bigint) <= $%d", *in.Filters.TimeEnd)
	}
	return strings.Join(clauses, " AND "), args
}

const hitSelect = "c.id::text,k.id::text,k.knowledge_base_id::text,k.name,c.content,s.id::text,s.origin,s.precision"
const hitFrom = " FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id JOIN knowledge k ON k.id=c.knowledge_id "

func (s *Server) chunkHits(ctx context.Context, q string, args []any, channel string) ([]Hit, error) {
	rows, e := s.Services.DB.Query(ctx, q, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Hit{}
	for rows.Next() {
		var h Hit
		var source, precision string
		if e = rows.Scan(&h.ID, &h.KnowledgeID, &h.KBID, &h.Title, &h.Content, &source, &h.Origin, &precision, &h.Score); e != nil {
			return nil, e
		}
		h.ChunkID = h.ID
		h.Type = "chunk"
		if precision == "time_segment" {
			h.Type = "media_segment"
		}
		if precision == "frame" {
			h.Type = "video_frame"
		}
		if channel == "image_text" || channel == "image_vector" {
			h.Type = "image"
			if precision == "frame" {
				h.Type = "video_frame"
			}
		}
		if channel == "graph" {
			h.Type = "graph_evidence"
		}
		h.SourceIDs = []string{source}
		out = append(out, h)
	}
	return out, rows.Err()
}
func (s *Server) recall(ctx context.Context, in SearchInput, channel string) ([]Hit, error) {
	if channel == "wiki" {
		var ready bool
		e := s.Services.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tasks t JOIN knowledge k ON k.id=t.knowledge_id WHERE k.knowledge_base_id=ANY($1::uuid[]) AND t.checkpoint->>$2='succeeded' AND t.checkpoint->>'parse_version_id'=k.current_parse_version_id::text) OR ($2='wiki' AND EXISTS(SELECT 1 FROM wiki_pages WHERE knowledge_base_id=ANY($1::uuid[]) AND state='ready' AND jsonb_array_length(source_ids)>0))`, in.KBIDs, channel).Scan(&ready)
		if e != nil {
			return nil, e
		}
		if !ready {
			return nil, &ai.Error{Code: "INDEX_NOT_READY", Message: "所选范围尚未完成" + channel + "索引，请查看文档任务阶段"}
		}
	}
	where, args := filterSQL(in)
	if channel == "image_vector" || channel == "image_text" {
		where += " AND " + jobs.ImageSourceSQL
	}
	switch channel {
	case "keyword", "image_text":
		args = append(args, textutil.Tokens(in.Query))
		p := len(args)
		if channel == "image_text" {
			where += " AND s.locators->0->>'type' IN ('image','frame')"
		}
		q := fmt.Sprintf("SELECT %s,ts_rank_cd(c.search_vector,plainto_tsquery('simple',$%d))::double precision%sWHERE %s AND c.search_vector @@ plainto_tsquery('simple',$%d) ORDER BY 9 DESC LIMIT %d", hitSelect, p, hitFrom, where, p, in.Candidates)
		return s.chunkHits(ctx, q, args, channel)
	case "vector", "image_vector":
		return s.vectorHits(ctx, in, channel)
	case "graph":
		where += " AND EXISTS(SELECT 1 FROM graph_records g WHERE g.knowledge_id=k.id AND g.source_ref_id=s.id AND g.synced_at IS NOT NULL)"
		q := fmt.Sprintf(`MATCH(n:NebulaeKnoEntity) WHERE n.installation_id=$installation AND n.kb_id IN $kbs AND (toLower(n.name) CONTAINS toLower($query) OR toLower($query) CONTAINS toLower(n.name)) WITH n LIMIT 50 OPTIONAL MATCH p=(n)-[:NEBULAEKNO_RELATION*1..%d]-(other) WHERE all(v IN nodes(p) WHERE v.installation_id=$installation AND v.kb_id=n.kb_id) AND all(r IN relationships(p) WHERE size($types)=0 OR r.relation IN $types) RETURN n.source_ids AS node_sources,[r IN relationships(p) WHERE size($types)=0 OR r.relation IN $types | r.source_ref_id] AS edge_sources LIMIT $limit`, in.Graph.MaxHops)
		types := in.Graph.RelationTypes
		if types == nil {
			types = []string{}
		}
		result, e := bootstrap.GraphQuery(ctx, s.Services.Graph, q, map[string]any{"installation": s.Services.Identity.ID, "kbs": in.KBIDs, "query": in.Query, "types": types, "limit": in.Candidates})
		if e != nil {
			return nil, e
		}
		ids := []string{}
		unique := map[string]bool{}
		for _, record := range result.Records {
			for _, key := range []string{"node_sources", "edge_sources"} {
				value, _ := record.Get(key)
				list, _ := value.([]any)
				for _, item := range list {
					if id, ok := item.(string); ok && !unique[id] {
						unique[id] = true
						ids = append(ids, id)
					}
				}
			}
		}
		if len(ids) == 0 {
			return []Hit{}, nil
		}
		args = append(args, ids)
		q = fmt.Sprintf("SELECT %s,1::double precision%sWHERE %s AND s.id=ANY($%d::uuid[]) ORDER BY c.ordinal LIMIT %d", hitSelect, hitFrom, where, len(args), in.Candidates)
		return s.chunkHits(ctx, q, args, channel)
	case "wiki":
		args = append(args, textutil.Tokens(in.Query))
		p := len(args)
		q := fmt.Sprintf(`SELECT w.id::text,w.knowledge_base_id::text,w.title,w.content,w.source_ids,ts_rank_cd(w.search_vector,plainto_tsquery('simple',$%d))::double precision FROM wiki_pages w WHERE w.state='ready' AND jsonb_array_length(w.source_ids)>0 AND w.knowledge_base_id=ANY($1::uuid[]) AND w.search_vector @@ plainto_tsquery('simple',$%d) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(w.source_ids) source WHERE NOT EXISTS(SELECT 1 %s WHERE %s AND s.id::text=source)) ORDER BY 6 DESC LIMIT %d`, p, p, hitFrom, where, in.Candidates)
		rows, e := s.Services.DB.Query(ctx, q, args...)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		out := []Hit{}
		for rows.Next() {
			h := Hit{Type: "wiki_page"}
			if e = rows.Scan(&h.ID, &h.KBID, &h.Title, &h.Content, &h.SourceIDs, &h.Score); e != nil {
				return nil, e
			}
			out = append(out, h)
		}
		return out, rows.Err()
	}
	return nil, &ai.Error{Code: "INVALID_ARGUMENT", Message: "检索方式无效"}
}
func (s *Server) vectorHits(ctx context.Context, in SearchInput, channel string) ([]Hit, error) {
	out := []Hit{}
	groups := map[string][]Hit{}
	vectorCache := map[string][][]float64{}
	purpose, kind := "embedding", "text"
	if channel == "image_vector" {
		purpose, kind = "multimodal_embedding", "image"
	}
	for _, kb := range in.KBIDs {
		var cfg map[string]any
		if e := s.Services.DB.QueryRow(ctx, "SELECT config FROM knowledge_bases WHERE id=$1", kb).Scan(&cfg); e != nil {
			return nil, e
		}
		m, e := ai.Bound(ctx, s.Services, purpose, cfg)
		if e != nil {
			return nil, e
		}
		var inputs any = []string{in.Query}
		if kind == "image" {
			inputs = []any{map[string]string{"text": in.Query}}
		}
		if kind == "image" && in.ImageID != "" {
			var path string
			if err := s.Services.DB.QueryRow(ctx, "SELECT path FROM query_images WHERE id=$1 AND expires_at>now()", in.ImageID).Scan(&path); err != nil {
				return nil, &ai.Error{Code: "QUERY_IMAGE_EXPIRED", Message: "查询图片不存在或已过期"}
			}
			data, err := ai.ImageData(path)
			if err != nil {
				return nil, err
			}
			inputs = []any{map[string]string{"image": data}}
		}
		vectors, cached := vectorCache[m.ID]
		if !cached {
			vectors, e = ai.Embeddings(ctx, m, inputs)
			vectorCache[m.ID] = vectors
		}
		if e != nil {
			return nil, e
		}
		dimension := len(vectors[0])
		hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d", m.BaseURL, m.ModelName, dimension)))
		signature := hex.EncodeToString(hash[:])
		var space string
		if e = s.Services.DB.QueryRow(ctx, "SELECT id::text FROM embedding_spaces WHERE model_id=$1 AND kind=$2 AND config_hash=$3", m.ID, kind, signature).Scan(&space); e != nil {
			return nil, &ai.Error{Code: "INDEX_NOT_READY", Message: "所选模型对应的向量索引尚未就绪"}
		}
		part := in
		part.KBIDs = []string{kb}
		where, args := filterSQL(part)
		if kind == "image" {
			where += " AND " + jobs.ImageSourceSQL
		}
		args = append(args, space, jobs.VectorLiteral(vectors[0]))
		q := fmt.Sprintf("SELECT %s,(1-(e.embedding <=> $%d::vector))::double precision%sJOIN embeddings e ON e.source_ref_id=s.id WHERE %s AND e.space_id=$%d::uuid ORDER BY 9 DESC LIMIT %d", hitSelect, len(args), hitFrom, where, len(args)-1, in.Candidates)
		hits, e := s.chunkHits(ctx, q, args, channel)
		if e != nil {
			return nil, e
		}
		for i := range hits {
			hits[i].SpaceID = space
			hits[i].RawScore = hits[i].Score
			hits[i].ScoreType = "cosine_similarity"
		}
		groups[space] = append(groups[space], hits...)
	}
	for _, group := range groups {
		sort.Slice(group, func(i, j int) bool { return group[i].Score > group[j].Score })
		if len(groups) > 1 {
			for i := range group {
				group[i].Score = 1 / (60 + float64(i+1))
				group[i].ScoreType = "cross_space_rrf"
			}
		}
		out = append(out, group...)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].ID < out[j].ID
		}
		return out[i].Score > out[j].Score
	})
	if len(out) > in.Candidates {
		out = out[:in.Candidates]
	}
	return out, nil
}
func (s *Server) loadSources(ctx context.Context, ids []string) (map[string]map[string]any, error) {
	out := map[string]map[string]any{}
	unique := map[string]bool{}
	clean := []string{}
	for _, id := range ids {
		if uuid.Validate(id) == nil && !unique[id] {
			unique[id] = true
			clean = append(clean, id)
		}
	}
	if len(clean) == 0 {
		return out, nil
	}
	q := strings.Replace(sourceQuery, "SELECT json_build_object", "SELECT f.path,json_build_object", 1)
	q = strings.Replace(q, "s.id=$1", "s.id=ANY($1::uuid[])", 1)
	rows, e := s.Services.DB.Query(ctx, q, clean)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		var value map[string]any
		if e = rows.Scan(&path, &value); e != nil {
			return nil, e
		}
		if _, e = os.Stat(path); e != nil {
			value["status"] = "missing"
		}
		id, _ := value["source_ref_id"].(string)
		out[id] = value
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	rows.Close()
	parseIDs := []string{}
	seen := map[string]bool{}
	for _, value := range out {
		origin, _ := value["content_origin"].(string)
		id, _ := value["parse_version_id"].(string)
		if strings.Contains(origin, "ocr") && id != "" && !seen[id] {
			seen[id] = true
			parseIDs = append(parseIDs, id)
		}
	}
	displays, e := s.ocrDisplays(ctx, parseIDs)
	if e != nil {
		return nil, e
	}
	for _, value := range out {
		origin, _ := value["content_origin"].(string)
		id, _ := value["parse_version_id"].(string)
		if strings.Contains(origin, "ocr") {
			displays[id].project(value, "quote", "display_quote")
		}
	}
	return out, nil
}
