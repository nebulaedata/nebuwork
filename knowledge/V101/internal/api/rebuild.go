package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/jobs"
	"net/http"
	"strings"
)

type rebuildInput struct {
	IDs    []string `json:"knowledge_ids"`
	Stages []string `json:"stages"`
	Mode   string   `json:"mode"`
}

var rebuildStages = []string{"keyword", "outline", "embedding", "wiki", "graph", "images", "image_embedding"}

type rebuildDocument struct {
	id, ext     string
	file, parse *string
	config      map[string]any
}

func (in *rebuildInput) validate() error {
	if in.Mode == "" {
		in.Mode = "stages"
	}
	if in.Mode != "stages" && in.Mode != "reparse" {
		return fmt.Errorf("重做方式无效")
	}
	if in.Mode == "reparse" && len(in.Stages) != 0 {
		return fmt.Errorf("完整重做不能同时指定部分阶段")
	}
	if in.Mode == "stages" && len(in.Stages) == 0 {
		in.Stages = []string{"embedding", "wiki", "graph"}
	}
	for _, stage := range in.Stages {
		valid := stage == "preview"
		for _, allowed := range rebuildStages {
			valid = valid || stage == allowed
		}
		if !valid {
			return fmt.Errorf("重建阶段无效")
		}
		if stage == "preview" && len(in.Stages) != 1 {
			return fmt.Errorf("原文预览请单独重建")
		}
	}
	for _, id := range in.IDs {
		if uuid.Validate(id) != nil {
			return fmt.Errorf("文档 ID 无效")
		}
	}
	return nil
}

// A partial rebuild stays on the current parse version; a full rebuild starts
// from the original file and freezes the current library/document settings.
func rebuildPlan(in rebuildInput, d rebuildDocument, library map[string]any) (string, map[string]any, map[string]any, string) {
	cfg := merge(library, d.config)
	if cfg["deleting"] == true {
		return "", nil, nil, "DELETING"
	}
	if d.ext == "zip" {
		return "", nil, nil, "ARCHIVE_TASK_REQUIRED"
	}
	if !supported(d.ext) {
		return "", nil, nil, "FORMAT_NOT_SUPPORTED"
	}
	if d.file == nil {
		return "", nil, nil, "FILE_NOT_READY"
	}
	checkpoint := map[string]any{}
	if in.Mode == "reparse" {
		if jobs.IsMedia(d.ext) && cfg["media_enabled"] == false {
			return "", nil, nil, "MEDIA_DISABLED"
		}
		cfg["partial_rebuild"] = false
		return "rebuild", cfg, checkpoint, ""
	}
	cfg["partial_rebuild"] = true
	if d.parse == nil {
		return "", nil, nil, "PARSE_NOT_READY"
	}
	if len(in.Stages) == 1 && in.Stages[0] == "preview" {
		if cfg["preview_enabled"] == false {
			return "", nil, nil, "PREVIEW_DISABLED"
		}
		return "preview", cfg, checkpoint, ""
	}
	checkpoint["parse"], checkpoint["parse_version_id"] = "succeeded", *d.parse
	for _, stage := range rebuildStages {
		checkpoint[stage] = "skipped"
	}
	flags := map[string]string{"outline": "outline_enabled", "wiki": "wiki_enabled", "graph": "graph_enabled", "images": "image_caption", "image_embedding": "image_embedding"}
	for _, stage := range in.Stages {
		delete(checkpoint, stage)
		if flag := flags[stage]; flag != "" {
			cfg[flag] = true
		}
	}
	return "rebuild", cfg, checkpoint, ""
}

func (s *Server) rebuildRoutes() {
	for _, path := range []string{"rebuild", "wiki/rebuild", "graph/rebuild"} {
		s.handle("POST /api/v1/knowledge-bases/{id}/"+path, s.rebuildKB)
	}
	s.handle("POST /api/v1/knowledge/{id}/cancel-parse", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.list(w, r, `WITH t AS (UPDATE tasks SET cancel_requested=true,state=CASE WHEN state='running' THEN state ELSE 'cancelled' END WHERE knowledge_id=$1 AND type IN ('ingest','rebuild') AND state IN ('queued','running','waiting_configuration') RETURNING *) SELECT row_to_json(t) FROM t`, id)
	})
}
func (s *Server) rebuildKB(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var in rebuildInput
	if !decode(w, r, &in) {
		return
	}
	if strings.Contains(r.URL.Path, "/wiki/") {
		in.Stages = []string{"wiki"}
	}
	if strings.Contains(r.URL.Path, "/graph/") {
		in.Stages = []string{"graph"}
	}
	if e := in.validate(); e != nil {
		Failure(w, 400, "INVALID_ARGUMENT", e.Error())
		return
	}
	if in.IDs == nil {
		in.IDs = []string{}
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		key = uuid.NewString()
	}
	if len(key) > 200 {
		Failure(w, 400, "INVALID_ARGUMENT", "操作标识过长")
		return
	}
	raw, _ := json.Marshal(in)
	digest := sha256.Sum256(raw)
	hash, scope := hex.EncodeToString(digest[:]), "kb-rebuild:"+kb
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", scope+":"+key); e != nil {
		dbFailure(w, e)
		return
	}
	var savedHash string
	var saved json.RawMessage
	e = tx.QueryRow(r.Context(), "SELECT request_hash,response FROM request_keys WHERE scope=$1 AND key=$2", scope, key).Scan(&savedHash, &saved)
	if e == nil {
		if savedHash != hash {
			Failure(w, 409, "IDEMPOTENCY_CONFLICT", "同一操作标识不能用于不同重做请求")
			return
		}
		JSON(w, 202, saved)
		return
	}
	if e != pgx.ErrNoRows {
		dbFailure(w, e)
		return
	}
	var cfg map[string]any
	if e := tx.QueryRow(r.Context(), "SELECT config FROM knowledge_bases WHERE id=$1 FOR SHARE", kb).Scan(&cfg); e != nil {
		dbFailure(w, e)
		return
	}
	// Lock documents in a stable order, just like single-document enqueue. Read
	// active tasks after acquiring these locks so concurrent submissions cannot
	// both enqueue work for the same document. There is no first-1000 cutoff.
	rows, e := tx.Query(r.Context(), "SELECT id::text,file_type,current_file_version_id::text,current_parse_version_id::text,config FROM knowledge WHERE knowledge_base_id=$1 AND (cardinality($2::uuid[])=0 OR id=ANY($2::uuid[])) ORDER BY id FOR UPDATE", kb, in.IDs)
	if e != nil {
		dbFailure(w, e)
		return
	}
	documents := []rebuildDocument{}
	ids := []string{}
	for rows.Next() {
		var d rebuildDocument
		if e = rows.Scan(&d.id, &d.ext, &d.file, &d.parse, &d.config); e != nil {
			rows.Close()
			dbFailure(w, e)
			return
		}
		documents = append(documents, d)
		ids = append(ids, d.id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		dbFailure(w, e)
		return
	}
	wanted := map[string]bool{}
	for _, id := range in.IDs {
		wanted[id] = true
	}
	if len(wanted) != 0 && len(wanted) != len(documents) {
		Failure(w, 404, "NOT_FOUND", "部分文件不属于当前知识库或已删除")
		return
	}
	active := map[string]bool{}
	rows, e = tx.Query(r.Context(), "SELECT DISTINCT knowledge_id::text FROM tasks WHERE knowledge_id=ANY($1::uuid[]) AND type<>'clause_extraction' AND state IN ('queued','running')", ids)
	if e != nil {
		dbFailure(w, e)
		return
	}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			dbFailure(w, e)
			return
		}
		active[id] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		dbFailure(w, e)
		return
	}
	result := []any{}
	reasons := map[string]int{}
	taskRows := [][]any{}
	taskIDs, fullIDs := []string{}, []string{}
	for _, d := range documents {
		kind, frozen, checkpoint, reason := rebuildPlan(in, d, cfg)
		if active[d.id] {
			reason = "TASK_ACTIVE"
		}
		if reason != "" {
			reasons[reason]++
			if len(result) < 100 {
				result = append(result, map[string]any{"knowledge_id": d.id, "accepted": false, "reason": reason})
			}
		} else {
			task := uuid.NewString()
			frozen["rebuild_batch_id"] = key
			configJSON, _ := json.Marshal(frozen)
			checkpointJSON, _ := json.Marshal(checkpoint)
			taskRows = append(taskRows, []any{task, kb, d.id, kind, configJSON, checkpointJSON, task})
			taskIDs = append(taskIDs, task)
			if in.Mode == "reparse" {
				fullIDs = append(fullIDs, d.id)
			}
			if len(result) < 100 {
				result = append(result, map[string]any{"knowledge_id": d.id, "accepted": true, "task_id": task})
			}
		}
	}
	if len(taskRows) != 0 {
		if _, e = tx.CopyFrom(r.Context(), pgx.Identifier{"tasks"}, []string{"id", "knowledge_base_id", "knowledge_id", "type", "config", "checkpoint", "idempotency_key"}, pgx.CopyFromRows(taskRows)); e != nil {
			dbFailure(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO outbox(task_id,kind,payload) SELECT id,'dispatch','{}'::jsonb FROM tasks WHERE id=ANY($1::uuid[])", taskIDs); e != nil {
			dbFailure(w, e)
			return
		}
	}
	if len(fullIDs) != 0 {
		if _, e = tx.Exec(r.Context(), "UPDATE tasks SET state='cancelled',cancel_requested=true,updated_at=now() WHERE knowledge_id=ANY($1::uuid[]) AND type<>'clause_extraction' AND state='waiting_configuration'", fullIDs); e != nil {
			dbFailure(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), "UPDATE knowledge SET status='queued',updated_at=now() WHERE id=ANY($1::uuid[])", fullIDs); e != nil {
			dbFailure(w, e)
			return
		}
	}
	response := map[string]any{"request_id": key, "total": len(documents), "accepted": len(taskRows), "skipped": len(documents) - len(taskRows), "reasons": reasons, "items": result, "items_truncated": len(result) < len(documents), "truncated": false}
	saved, _ = json.Marshal(response)
	if _, e = tx.Exec(r.Context(), "INSERT INTO request_keys(scope,key,request_hash,response) VALUES($1,$2,$3,$4)", scope, key, hash, saved); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 202, response)
}
