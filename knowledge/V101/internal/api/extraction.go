package api

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/google/uuid"
	"nebulaekno/internal/extraction"
	"nebulaekno/internal/taskcontrol"
)

func extractionFailure(w http.ResponseWriter, err error) {
	var problem *extraction.Problem
	if errors.As(err, &problem) {
		Failure(w, problem.Status, problem.Code, problem.Message)
		return
	}
	dbFailure(w, err)
}

const extractionRunQuery = `SELECT r.id,r.task_id,r.knowledge_id,r.file_version_id,r.parse_version_id,r.model_id,r.config,r.input_hash,r.summary,r.created_at,
 k.name,k.current_parse_version_id<>r.parse_version_id AS historical,(` + taskcontrol.StateSQL + `) AS state,t.stage,t.error,t.cancel_requested,t.updated_at,
 (SELECT count(*) FROM extraction_records e WHERE e.run_id=r.id) AS records,
 (SELECT count(*) FROM extraction_records e WHERE e.run_id=r.id AND e.data->'validation'->>'status'='needs_review') AS needs_review,
 (SELECT count(*) FROM extraction_blocks e WHERE e.run_id=r.id AND e.block_id NOT LIKE '%:%') AS blocks,
 (SELECT count(*) FROM extraction_blocks e WHERE e.run_id=r.id AND e.state='succeeded' AND e.block_id NOT LIKE '%:%') AS completed_blocks,
 (SELECT count(*) FROM extraction_blocks e WHERE e.run_id=r.id AND e.state='failed' AND e.block_id NOT LIKE '%:%') AS failed_blocks
 FROM extraction_runs r JOIN knowledge k ON k.id=r.knowledge_id JOIN tasks t ON t.id=r.task_id`

func (s *Server) extractionRoutes() {
	s.handle("GET /api/v1/extractions/documents", func(w http.ResponseWriter, r *http.Request) {
		kb := r.URL.Query().Get("knowledge_base_id")
		if kb != "" && uuid.Validate(kb) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "知识库 ID 无效")
			return
		}
		from := ` FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id
  LEFT JOIN LATERAL(SELECT r.id AS run_id,t.id AS task_id,t.state,r.parse_version_id,r.created_at,
  (SELECT count(*) FROM extraction_records e WHERE e.run_id=r.id) AS records,
  (SELECT count(*) FROM extraction_records e WHERE e.run_id=r.id AND e.data->'validation'->>'status'='needs_review') AS needs_review
  FROM extraction_runs r JOIN tasks t ON t.id=r.task_id WHERE r.knowledge_id=k.id ORDER BY r.created_at DESC LIMIT 1)x ON true
  WHERE ($1='' OR k.knowledge_base_id::text=$1) AND k.name ILIKE $2
  AND ($3='' OR coalesce(x.state,'not_started')=$3)
  AND NOT coalesce((k.config->>'deleting')::boolean,false) AND NOT coalesce((b.config->>'deleting')::boolean,false)`
		s.page(w, r, "SELECT row_to_json(d) FROM (SELECT k.id,k.name,k.file_type,k.current_parse_version_id,b.name AS knowledge_base_name,b.id AS knowledge_base_id,x.*"+from+" ORDER BY k.created_at DESC LIMIT $4 OFFSET $5)d",
			"SELECT count(*)"+from, kb, "%"+r.URL.Query().Get("q")+"%", r.URL.Query().Get("state"))
	})
	s.handle("POST /api/v1/knowledge/{id}/extractions", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var input extraction.Request
		if !decode(w, r, &input) {
			return
		}
		result, err := extraction.New(s.Services, s.Config).Create(r.Context(), id, input)
		if err != nil {
			extractionFailure(w, err)
			return
		}
		JSON(w, 202, result)
	})
	s.handle("GET /api/v1/knowledge/{id}/extractions/sections", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version := r.URL.Query().Get("parse_version_id")
		if version != "" && uuid.Validate(version) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "解析版本 ID 无效")
			return
		}
		service := extraction.New(s.Services, s.Config)
		input, err := service.Input(r.Context(), id, version)
		if err != nil {
			extractionFailure(w, err)
			return
		}
		sections, err := service.Sections(r.Context(), input)
		if err != nil {
			extractionFailure(w, err)
			return
		}
		JSON(w, 200, sections)
	})
	s.handle("GET /api/v1/knowledge/{id}/extractions", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version := r.URL.Query().Get("parse_version_id")
		if version != "" && uuid.Validate(version) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "解析版本 ID 无效")
			return
		}
		s.page(w, r, "SELECT row_to_json(d) FROM ("+extractionRunQuery+" WHERE r.knowledge_id=$1 AND ($2='' OR r.parse_version_id::text=$2) ORDER BY r.created_at DESC LIMIT $3 OFFSET $4)d",
			"SELECT count(*) FROM extraction_runs WHERE knowledge_id=$1 AND ($2='' OR parse_version_id::text=$2)", id, version)
	})
	s.handle("GET /api/v1/extractions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(d) FROM ("+extractionRunQuery+" WHERE r.id=$1)d", id)
	})
	s.handle("GET /api/v1/extractions/{id}/records", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		where := " FROM extraction_records e WHERE run_id=$1 AND ($2='' OR data->>'type'=$2) AND ($3='' OR data->'validation'->>'status'=$3) AND data::text ILIKE $4"
		s.page(w, r, "SELECT data"+where+" ORDER BY block_id,ordinal,id LIMIT $5 OFFSET $6", "SELECT count(*)"+where, id, r.URL.Query().Get("type"), r.URL.Query().Get("status"), "%"+r.URL.Query().Get("q")+"%")
	})
	s.handle("GET /api/v1/extractions/{id}/coverage", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		where := " FROM extraction_coverage c LEFT JOIN extraction_units u ON u.run_id=c.run_id AND u.unit_id=c.unit_id WHERE c.run_id=$1 AND ($2='' OR c.data->>'disposition'=$2)"
		s.page(w, r, "SELECT c.data||jsonb_build_object('text',u.data->>'text','source_refs',u.data->'source_refs')"+where+" ORDER BY c.unit_id LIMIT $3 OFFSET $4", "SELECT count(*)"+where, id, r.URL.Query().Get("disposition"))
	})
	s.handle("GET /api/v1/extractions/{id}/export.xlsx", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		data, err := extraction.New(s.Services, s.Config).Export(r.Context(), id)
		if err != nil {
			extractionFailure(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape("条款参数-"+id+".xlsx"))
		w.Header().Set("Cache-Control", "no-store")
		w.Write(data)
	})
}
