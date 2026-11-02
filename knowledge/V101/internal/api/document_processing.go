package api

import (
	"nebulaekno/internal/taskcontrol"
	"net/http"
)

// Select one current document-processing task, excluding independent clause
// extraction and partial rebuilds tied to a superseded parse version. Keep
// checkpoints out of the aggregate: only the visible page loads progress JSON.
const processingDocumentsSQL = `WITH processing_documents AS (
 SELECT k.id,k.name,k.relative_path,k.file_type,k.created_at,k.current_parse_version_id,
  k.current_parse_version_id IS NOT NULL AS has_parse_result,
  CASE
   WHEN coalesce((k.config->>'deleting')::boolean,false) THEN 'deleting'
   WHEN t.state='running' AND t.cancel_requested THEN 'stopping'
   WHEN t.state='pausing' THEN 'pausing'
   WHEN t.state='paused' THEN 'paused'
   WHEN t.state='running' THEN 'processing'
   WHEN t.state='queued' THEN 'queued'
   WHEN t.state='waiting_configuration' THEN 'waiting_configuration'
   WHEN t.partial_rebuild AND t.state IN ('failed','partially_failed') AND k.current_parse_version_id IS NOT NULL THEN 'partially_failed'
   WHEN k.status IN ('succeeded','ready') THEN 'succeeded'
   WHEN k.status='running' THEN 'processing'
   ELSE k.status END AS processing_status,
  t.id AS processing_task_id,t.type AS processing_task_type,t.state AS processing_task_state,
  t.stage AS processing_stage,t.cancel_requested,t.partial_rebuild
 FROM knowledge k
 LEFT JOIN LATERAL (
  SELECT t.id,t.type,(` + taskcontrol.StateSQL + `) AS state,t.stage,t.cancel_requested,coalesce((t.config->>'partial_rebuild')::boolean,false) AS partial_rebuild
  FROM tasks t WHERE t.knowledge_id=k.id AND t.type IN ('ingest','rebuild','extract_archive','preview')
   AND (coalesce((t.config->>'partial_rebuild')::boolean,false)=false OR t.type='preview' OR t.checkpoint->>'parse_version_id'=k.current_parse_version_id::text)
  ORDER BY CASE t.state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'waiting_configuration' THEN 2 ELSE 3 END,t.created_at DESC,t.id DESC LIMIT 1
 ) t ON true WHERE k.knowledge_base_id=$1
) `

const documentParsingSQL = `processing_status='processing' AND (processing_stage='parse' OR (processing_stage='pending' AND processing_task_type IN ('ingest','rebuild')))`

const processingDocumentFilterSQL = `WHERE (d.name ILIKE $2 OR d.relative_path ILIKE $2)
 AND ($3='' OR d.processing_status=$3 OR ($3='parsing' AND ` + documentParsingSQL + `))
 AND ($4='' OR ($4='parsed' AND d.has_parse_result) OR ($4='unparsed' AND NOT d.has_parse_result))`

func documentStatusFilter(value string) (string, bool) {
	if value == "ready" {
		value = "succeeded"
	}
	if value == "running" {
		value = "processing"
	}
	switch value {
	case "", "queued", "processing", "parsing", "succeeded", "partially_failed", "failed", "waiting_configuration", "cancelled", "stopping", "paused", "pausing", "stored", "extracted", "partially_extracted", "deleting":
		return value, true
	}
	return "", false
}

func (s *Server) processingDocuments(w http.ResponseWriter, r *http.Request) {
	kb, ok := s.taskLibrary(w, r)
	if !ok {
		return
	}
	status, ok := documentStatusFilter(r.URL.Query().Get("status"))
	if !ok {
		Failure(w, 400, "INVALID_ARGUMENT", "文档处理状态筛选无效")
		return
	}
	parsed := r.URL.Query().Get("parse_status")
	if parsed != "" && parsed != "parsed" && parsed != "unparsed" {
		Failure(w, 400, "INVALID_ARGUMENT", "原文解析状态筛选无效")
		return
	}
	args := []any{kb, "%" + r.URL.Query().Get("q") + "%", status, parsed}
	query := processingDocumentsSQL + `, visible_documents AS (
  SELECT d.* FROM processing_documents d ` + processingDocumentFilterSQL + ` ORDER BY d.created_at DESC,d.id DESC LIMIT $5 OFFSET $6
 ) SELECT row_to_json(n) FROM (
  SELECT k.*,f.size,f.hash,d.processing_status,d.has_parse_result,
   (SELECT o.status FROM outlines o WHERE o.parse_version_id=k.current_parse_version_id ORDER BY o.created_at DESC LIMIT 1) AS outline_status,
   CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id',p.id,'type',p.type,'state',d.processing_task_state,'stage',p.stage,'cancel_requested',p.cancel_requested,'partial_rebuild',d.partial_rebuild,'updated_at',p.updated_at,'checkpoint',json_build_object('pipeline',p.checkpoint->'pipeline')) END AS processing_task
  FROM visible_documents d JOIN knowledge k ON k.id=d.id LEFT JOIN file_versions f ON f.id=k.current_file_version_id LEFT JOIN tasks p ON p.id=d.processing_task_id
  ORDER BY d.created_at DESC,d.id DESC
 ) n`
	s.page(w, r, query, processingDocumentsSQL+`SELECT count(*) FROM processing_documents d `+processingDocumentFilterSQL, args...)
}

func (s *Server) documentProcessingSummary(w http.ResponseWriter, r *http.Request) {
	kb, ok := s.taskLibrary(w, r)
	if !ok {
		return
	}
	eligible := `file_type<>'zip' AND processing_status NOT IN ('stored','deleting')`
	query := processingDocumentsSQL + `, summary AS (
  SELECT count(*) AS total_documents,count(*) FILTER(WHERE ` + eligible + `) AS processable_documents,
   count(*) FILTER(WHERE ` + eligible + ` AND processing_status='succeeded') AS completed_documents,
   count(*) FILTER(WHERE ` + eligible + ` AND has_parse_result) AS parsed_documents,
   count(*) FILTER(WHERE ` + documentParsingSQL + `) AS parsing_documents
  FROM processing_documents
 ) SELECT json_build_object('total_documents',total_documents,'processable_documents',processable_documents,'completed_documents',completed_documents,'parsed_documents',parsed_documents,'parsing_documents',parsing_documents,
 'excluded_documents',total_documents-processable_documents,'completion_percent',CASE WHEN processable_documents=0 THEN NULL ELSE round(completed_documents*100.0/processable_documents,2) END,
 'parse_availability_percent',CASE WHEN processable_documents=0 THEN NULL ELSE round(parsed_documents*100.0/processable_documents,2) END,
 'counts',coalesce((SELECT json_object_agg(processing_status,n) FROM (SELECT processing_status,count(*) AS n FROM processing_documents GROUP BY processing_status) c),'{}'::json),
 'running_stages',coalesce((SELECT json_object_agg(stage,n) FROM (SELECT coalesce(nullif(processing_stage,''),'pending') AS stage,count(*) AS n FROM processing_documents WHERE processing_status IN ('processing','stopping') GROUP BY 1) c),'{}'::json),
 'tasks_paused',(SELECT tasks_paused FROM knowledge_bases WHERE id=$1),'updated_at',now()) FROM summary`
	s.one(w, r, query, kb)
}
