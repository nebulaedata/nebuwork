package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/textutil"
	"net/http"
)

func (s *Server) wikiToolRoutes() {
	for _, kind := range []string{"wiki", "knowledge"} {
		base := "/api/v1/knowledge-bases/{id}/" + kind + "/folders"
		s.handle("GET "+base, func(w http.ResponseWriter, r *http.Request) { s.folders(w, r, kind) })
		s.handle("POST "+base, func(w http.ResponseWriter, r *http.Request) { s.folders(w, r, kind) })
		s.handle("PUT "+base+"/{folder}", func(w http.ResponseWriter, r *http.Request) { s.folders(w, r, kind) })
		s.handle("DELETE "+base+"/{folder}", func(w http.ResponseWriter, r *http.Request) { s.folders(w, r, kind) })
	}
	s.handle("POST /api/v1/knowledge-bases/{id}/wiki/pages/{page}/revert", s.revertWiki)
	s.handle("GET /api/v1/knowledge-bases/{id}/wiki/stats", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		graph, e := loadWikiPageGraph(r.Context(), s.Services.DB, id)
		if e != nil {
			dbFailure(w, e)
			return
		}
		s.one(w, r, `SELECT json_build_object('pages',count(*),'stale_pages',count(*) FILTER(WHERE state='stale'),'revisions',(SELECT count(*) FROM wiki_revisions r JOIN wiki_pages p ON p.id=r.page_id WHERE p.knowledge_base_id=$1),'links',$2::int) FROM wiki_pages WHERE knowledge_base_id=$1`, id, len(graph.Edges))
	})
	s.handle("POST /api/v1/knowledge-bases/{id}/wiki/rebuild-links", s.wikiLinks)
	s.handle("GET /api/v1/knowledge-bases/{id}/wiki/graph", s.wikiLinks)
	s.handle("GET /api/v1/knowledge-bases/{id}/graph/evidence/{evidence}", func(w http.ResponseWriter, r *http.Request) {
		kb, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		id, ok := identifier(w, r, "evidence")
		if !ok {
			return
		}
		var source string
		var payload json.RawMessage
		e := s.Services.DB.QueryRow(r.Context(), `SELECT g.source_ref_id::text,g.payload FROM graph_records g JOIN knowledge k ON k.id=g.knowledge_id WHERE g.id=$1 AND k.knowledge_base_id=$2`, id, kb).Scan(&source, &payload)
		if e != nil {
			dbFailure(w, e)
			return
		}
		sources, e := s.loadSources(r.Context(), []string{source})
		if e != nil {
			dbFailure(w, e)
			return
		}
		JSON(w, 200, map[string]any{"id": id, "payload": payload, "source_ref": sources[source]})
	})
}
func (s *Server) folders(w http.ResponseWriter, r *http.Request, kind string) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	table := "document_folders"
	if kind == "wiki" {
		table = "wiki_folders"
	}
	if r.Method == "GET" {
		s.list(w, r, "SELECT row_to_json(f) FROM "+table+" f WHERE knowledge_base_id=$1 ORDER BY name", kb)
		return
	}
	id := r.PathValue("folder")
	if id != "" && uuid.Validate(id) != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "目录 ID 无效")
		return
	}
	if r.Method == "DELETE" {
		tag, e := s.Services.DB.Exec(r.Context(), "DELETE FROM "+table+" WHERE id=$1 AND knowledge_base_id=$2", id, kb)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if tag.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "目录不存在")
			return
		}
		JSON(w, 200, map[string]bool{"deleted": true})
		return
	}
	var in struct {
		Name   string  `json:"name"`
		Parent *string `json:"parent_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !validName(in.Name) {
		Failure(w, 400, "INVALID_ARGUMENT", "目录名称无效")
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", kb+":"+kind+":folders"); e != nil {
		dbFailure(w, e)
		return
	}
	if in.Parent != nil {
		if uuid.Validate(*in.Parent) != nil || *in.Parent == id {
			Failure(w, 400, "INVALID_ARGUMENT", "父目录无效")
			return
		}
		var valid bool
		e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM "+table+" WHERE id=$1 AND knowledge_base_id=$2)", *in.Parent, kb).Scan(&valid)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if !valid {
			Failure(w, 400, "INVALID_ARGUMENT", "父目录不属于此知识库")
			return
		}
		if id != "" {
			var cycle bool
			e = tx.QueryRow(r.Context(), "WITH RECURSIVE children AS(SELECT id FROM "+table+" WHERE id=$1 UNION ALL SELECT f.id FROM "+table+" f JOIN children c ON f.parent_id=c.id) SELECT EXISTS(SELECT 1 FROM children WHERE id=$2)", id, *in.Parent).Scan(&cycle)
			if e != nil {
				dbFailure(w, e)
				return
			}
			if cycle {
				Failure(w, 400, "INVALID_ARGUMENT", "目录不能形成循环")
				return
			}
		}
	}
	if id == "" {
		id = uuid.NewString()
		_, e = tx.Exec(r.Context(), "INSERT INTO "+table+"(id,knowledge_base_id,name,parent_id) VALUES($1,$2,$3,$4)", id, kb, in.Name, in.Parent)
	} else {
		tag, err := tx.Exec(r.Context(), "UPDATE "+table+" SET name=$3,parent_id=$4 WHERE id=$1 AND knowledge_base_id=$2", id, kb, in.Name, in.Parent)
		e = err
		if e == nil && tag.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "目录不存在")
			return
		}
	}
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, map[string]any{"id": id, "name": in.Name, "parent_id": in.Parent})
}
func (s *Server) revertWiki(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	page, ok := identifier(w, r, "page")
	if !ok {
		return
	}
	var in struct {
		Revision string `json:"revision_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	var content string
	var sources json.RawMessage
	e = tx.QueryRow(r.Context(), `SELECT r.content,r.source_ids FROM wiki_revisions r JOIN wiki_pages p ON p.id=r.page_id WHERE r.id::text=$1 AND p.id=$2 AND p.knowledge_base_id=$3 FOR UPDATE OF p`, in.Revision, page, kb).Scan(&content, &sources)
	if e != nil {
		dbFailure(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE wiki_pages SET content=$2,source_ids=$3,search_vector=to_tsvector('simple',$4),updated_at=now(),state='ready' WHERE id=$1", page, content, sources, textutil.Tokens(content))
	if e != nil {
		dbFailure(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO wiki_revisions(id,page_id,content,source_ids) VALUES($1,$2,$3,$4)", uuid.NewString(), page, content, sources)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, map[string]any{"page_id": page, "restored_from": in.Revision})
}
func (s *Server) wikiLinks(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	if r.Method == "GET" {
		graph, err := loadWikiPageGraph(r.Context(), s.Services.DB, kb)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if r.URL.Query().Get("view") == "overview" {
			JSON(w, 200, graph)
		} else {
			JSON(w, 200, graph.Edges)
		}
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", kb+":wiki-links"); e != nil {
		dbFailure(w, e)
		return
	}
	graph, e := loadWikiPageGraph(r.Context(), tx, kb)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM wiki_links WHERE source_id IN(SELECT id FROM wiki_pages WHERE knowledge_base_id=$1)", kb); e != nil {
		dbFailure(w, e)
		return
	}
	links := 0
	for _, link := range graph.Edges {
		tag, err := tx.Exec(r.Context(), "INSERT INTO wiki_links(source_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING", link.Source, link.Target)
		if err != nil {
			dbFailure(w, err)
			return
		}
		links += int(tag.RowsAffected())
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, map[string]int{"links": links})
}
func (s *Server) graphStats(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	result, e := bootstrap.GraphQuery(r.Context(), s.Services.Graph, `MATCH(n:NebulaeKnoEntity {installation_id:$installation,kb_id:$kb}) OPTIONAL MATCH(n)-[r:NEBULAEKNO_RELATION]->() RETURN count(DISTINCT n) AS nodes,count(DISTINCT r) AS relations`, map[string]any{"installation": s.Services.Identity.ID, "kb": kb})
	if e != nil {
		Failure(w, 503, "GRAPH_UNAVAILABLE", "图谱统计不可用")
		return
	}
	data := map[string]any{"nodes": 0, "relations": 0}
	if len(result.Records) > 0 {
		data = result.Records[0].AsMap()
	}
	var evidence int
	if e = s.Services.DB.QueryRow(r.Context(), "SELECT count(*) FROM graph_records g JOIN knowledge k ON k.current_parse_version_id=(SELECT parse_version_id FROM source_refs WHERE id=g.source_ref_id) WHERE k.knowledge_base_id=$1 AND g.synced_at IS NOT NULL", kb).Scan(&evidence); e != nil {
		dbFailure(w, e)
		return
	}
	data["evidence"] = evidence
	JSON(w, 200, data)
}
