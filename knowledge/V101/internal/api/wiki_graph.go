package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/textutil"
	"net/http"
)

func (s *Server) wikiGraphRoutes() {
	s.handle("GET /api/v1/knowledge-bases/{id}/wiki/pages", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		page, size := paging(r)
		s.list(w, r, "SELECT row_to_json(p) FROM (SELECT id,knowledge_base_id,title,content,source_ids,folder_id,state,updated_at FROM wiki_pages WHERE knowledge_base_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3)p", id, size, (page-1)*size)
	})
	s.handle("POST /api/v1/knowledge-bases/{id}/wiki/pages", s.saveWiki)
	s.handle("PUT /api/v1/knowledge-bases/{id}/wiki/pages/{page}", s.saveWiki)
	s.handle("GET /api/v1/knowledge-bases/{id}/wiki/pages/{page}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		page, ok := identifier(w, r, "page")
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(p) FROM wiki_pages p WHERE id=$1 AND knowledge_base_id=$2", page, id)
	})
	s.handle("DELETE /api/v1/knowledge-bases/{id}/wiki/pages/{page}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		page, ok := identifier(w, r, "page")
		if !ok {
			return
		}
		tag, e := s.Services.DB.Exec(r.Context(), "DELETE FROM wiki_pages WHERE id=$1 AND knowledge_base_id=$2", page, id)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if tag.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "页面不存在")
			return
		}
		JSON(w, 200, map[string]bool{"deleted": true})
	})
	s.handle("GET /api/v1/knowledge-bases/{id}/wiki/pages/{page}/revisions", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		page, ok := identifier(w, r, "page")
		if !ok {
			return
		}
		s.list(w, r, "SELECT row_to_json(v) FROM wiki_revisions v JOIN wiki_pages p ON p.id=v.page_id WHERE p.knowledge_base_id=$1 AND p.id=$2 ORDER BY v.created_at DESC", id, page)
	})
	s.handle("GET /api/v1/knowledge-bases/{id}/graph", s.graphView)
	s.handle("POST /api/v1/knowledge-bases/{id}/graph/query", s.graphView)
	s.handle("GET /api/v1/knowledge-bases/{id}/graph/stats", s.graphStats)
}
func (s *Server) saveWiki(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	id := r.PathValue("page")
	if id == "" {
		id = uuid.NewString()
	} else if uuid.Validate(id) != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "页面 ID 无效")
		return
	}
	var in struct {
		Title     string   `json:"title"`
		Content   string   `json:"content"`
		SourceIDs []string `json:"source_ids"`
		Folder    *string  `json:"folder_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !validName(in.Title) || in.Content == "" {
		Failure(w, 400, "INVALID_ARGUMENT", "标题和正文必填")
		return
	}
	for _, ref := range in.SourceIDs {
		var exists bool
		if uuid.Validate(ref) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "来源 ID 无效")
			return
		}
		_ = s.Services.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM source_refs s JOIN knowledge k ON k.id=s.knowledge_id WHERE s.id=$1 AND k.knowledge_base_id=$2)", ref, kb).Scan(&exists)
		if !exists {
			Failure(w, 400, "INVALID_ARGUMENT", "来源不属于此知识库")
			return
		}
	}
	if in.SourceIDs == nil {
		in.SourceIDs = []string{}
	}
	if in.Folder != nil {
		var valid bool
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM wiki_folders WHERE id::text=$1 AND knowledge_base_id=$2)", *in.Folder, kb).Scan(&valid); e != nil {
			dbFailure(w, e)
			return
		}
		if !valid {
			Failure(w, 400, "INVALID_ARGUMENT", "目录不属于此知识库")
			return
		}
	}
	b, _ := json.Marshal(in.SourceIDs)
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	if r.Method == "PUT" {
		tag, e := tx.Exec(r.Context(), "UPDATE wiki_pages SET title=$3,content=$4,source_ids=$5,search_vector=to_tsvector('simple',$6),updated_at=now(),state='ready',folder_id=$7 WHERE id=$1 AND knowledge_base_id=$2", id, kb, in.Title, in.Content, b, textutil.Tokens(in.Content), in.Folder)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if tag.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "页面不存在")
			return
		}
	} else {
		_, e = tx.Exec(r.Context(), "INSERT INTO wiki_pages(id,knowledge_base_id,title,content,source_ids,search_vector,folder_id) VALUES($1,$2,$3,$4,$5,to_tsvector('simple',$6),$7)", id, kb, in.Title, in.Content, b, textutil.Tokens(in.Content), in.Folder)
		if e != nil {
			dbFailure(w, e)
			return
		}
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO wiki_revisions(id,page_id,content,source_ids) VALUES($1,$2,$3,$4)", uuid.NewString(), id, in.Content, b)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, map[string]string{"id": id, "title": in.Title})
}
func (s *Server) graphView(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Query   string `json:"query"`
		Limit   int    `json:"limit"`
		MaxHops int    `json:"max_hops"`
	}
	if r.Method == "POST" && !decode(w, r, &in) {
		return
	}
	if in.MaxHops == 0 {
		in.MaxHops = 1
	}
	if in.MaxHops < 1 || in.MaxHops > 2 {
		Failure(w, 400, "INVALID_ARGUMENT", "图谱查询支持 1–2 跳")
		return
	}
	if in.Limit <= 0 {
		in.Limit = 50
	}
	if in.Limit > 100 {
		in.Limit = 100
	}
	query := fmt.Sprintf(`MATCH(seed:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb}) WHERE $query='' OR seed.name CONTAINS $query WITH seed LIMIT $limit MATCH p=(seed)-[:NEBULAEKNO_RELATION*0..%d]-(n:NebulaeKnoEntity) WHERE all(v IN nodes(p) WHERE v.installation_id=$installation AND v.kb_id=$kb) RETURN DISTINCT n.name AS name,n.type AS type,n.description AS description,n.source_ids AS source_ids LIMIT $limit`, in.MaxHops)
	result, e := bootstrap.GraphQuery(r.Context(), s.Services.Graph, query, map[string]any{"installation": s.Services.Identity.ID, "kb": id, "query": in.Query, "limit": in.Limit})
	if e != nil {
		Failure(w, 503, "GRAPH_UNAVAILABLE", "图谱查询失败")
		return
	}
	nodes := []any{}
	names := []string{}
	for _, row := range result.Records {
		node := row.AsMap()
		nodes = append(nodes, node)
		if name, ok := node["name"].(string); ok {
			names = append(names, name)
		}
	}
	relations, e := bootstrap.GraphQuery(r.Context(), s.Services.Graph, `MATCH(a:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb})-[r:NEBULAEKNO_RELATION]->(b:NebulaeKnoEntity) WHERE a.name IN $names AND b.name IN $names RETURN elementId(r) AS id,r.record_id AS evidence_id,a.name AS source,b.name AS target,r.relation AS relation,r.source_ref_id AS source_ref_id,r.quote AS quote LIMIT 100`, map[string]any{"installation": s.Services.Identity.ID, "kb": id, "names": names})
	if e != nil {
		Failure(w, 503, "GRAPH_UNAVAILABLE", "图谱关系查询失败")
		return
	}
	edges := []any{}
	for _, row := range relations.Records {
		edges = append(edges, row.AsMap())
	}
	JSON(w, 200, map[string]any{"nodes": nodes, "relations": edges, "truncated": len(nodes) == in.Limit || len(edges) == 100, "limits": map[string]int{"nodes": in.Limit, "relations": 100}})
}
