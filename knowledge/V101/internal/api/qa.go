package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/defaults"
)

type qaSession struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	KBIDs        []string `json:"knowledge_base_ids"`
	IDs          []string `json:"knowledge_ids"`
	SystemPrompt *string  `json:"system_prompt"`
	EnableWiki   bool     `json:"enable_wiki"`
	EnableGraph  bool     `json:"enable_graph"`
}
type qaConfig struct {
	qaSession
	Prompt       string    `json:"effective_system_prompt"`
	Model        ai.Model  `json:"model"`
	Vision       *ai.Model `json:"vision_model,omitempty"`
	HistoryTurns int       `json:"history_turns"`
	MaxImages    int       `json:"max_images"`
}

const qaMessageJSON = `to_jsonb(m)-'owner'-'lease_until'-'request_key'-'request_hash' || jsonb_build_object(
 'sources',coalesce((SELECT jsonb_agg(v || jsonb_build_object('available',EXISTS(SELECT 1 FROM source_refs s WHERE s.id::text=v->>'source_ref_id' AND s.file_version_id::text=v->>'file_version_id' AND s.parse_version_id::text=v->>'parse_version_id'))) FROM jsonb_array_elements(m.sources) v),'[]'),
 'images',coalesce((SELECT jsonb_agg(v || jsonb_build_object('available',EXISTS(SELECT 1 FROM assets a JOIN source_refs s ON s.metadata->>'image_path'=a.path AND s.knowledge_id=a.knowledge_id AND s.file_version_id=a.file_version_id WHERE a.id::text=v->>'id' AND s.id::text=v->>'source_ref_id' AND s.parse_version_id::text=v->>'parse_version_id'))) FROM jsonb_array_elements(m.images) v),'[]'))`

func (s *Server) qaRoutes() {
	s.operations = append(s.operations, operation{"GET", "/api/v1/settings/qa-defaults"}, operation{"PUT", "/api/v1/settings/qa-defaults"})
	s.handle("GET /api/v1/qa/sessions", func(w http.ResponseWriter, r *http.Request) {
		s.page(w, r, `SELECT to_jsonb(q) FROM qa_sessions q ORDER BY updated_at DESC,id LIMIT $1 OFFSET $2`, `SELECT count(*) FROM qa_sessions`)
	})
	s.handle("POST /api/v1/qa/sessions", s.qaSaveSession)
	s.handle("GET /api/v1/qa/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if ok {
			s.one(w, r, `SELECT to_jsonb(q) FROM qa_sessions q WHERE id=$1`, id)
		}
	})
	s.handle("PATCH /api/v1/qa/sessions/{id}", s.qaSaveSession)
	s.handle("DELETE /api/v1/qa/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		result, e := s.Services.DB.Exec(r.Context(), `DELETE FROM qa_sessions WHERE id=$1`, id)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if result.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "会话不存在")
			return
		}
		JSON(w, 200, map[string]any{"deleted": true})
	})
	s.handle("GET /api/v1/qa/sessions/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var exists bool
		if e := s.Services.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM qa_sessions WHERE id=$1)`, id).Scan(&exists); e != nil {
			dbFailure(w, e)
			return
		}
		if !exists {
			Failure(w, 404, "NOT_FOUND", "会话不存在")
			return
		}
		s.page(w, r, `SELECT `+qaMessageJSON+` FROM qa_messages m WHERE session_id=$1 ORDER BY created_at DESC,CASE WHEN role='assistant' THEN 1 ELSE 0 END DESC,id DESC LIMIT $2 OFFSET $3`, `SELECT count(*) FROM qa_messages WHERE session_id=$1`, id)
	})
	s.handle("POST /api/v1/qa/sessions/{id}/messages", s.qaSubmit)
	s.handle("POST /api/v1/qa/messages/{id}/retry", s.qaSubmit)
	s.handle("POST /api/v1/qa/messages/{id}/stop", s.qaStop)
	s.handle("GET /api/v1/qa/messages/{id}/events", s.qaEvents)
}

func (s *Server) qaStop(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var state string
	var requested bool
	if e = tx.QueryRow(r.Context(), `SELECT state,cancel_requested FROM qa_messages WHERE id=$1 AND role='assistant' FOR UPDATE`, id).Scan(&state, &requested); e != nil {
		dbFailure(w, e)
		return
	}
	if state == "queued" || state == "running" {
		requested = true
		queued := state == "queued"
		if queued {
			state = "cancelled"
		}
		if _, e = tx.Exec(r.Context(), `UPDATE qa_messages SET cancel_requested=true,state=$2,updated_at=now() WHERE id=$1`, id, state); e != nil {
			dbFailure(w, e)
			return
		}
		if queued {
			if _, e = tx.Exec(r.Context(), `INSERT INTO qa_events(message_id,kind,payload) VALUES($1,'done','{"state":"cancelled","content":"","sources":[],"images":[],"warnings":[],"error":{"code":"QA_CANCELLED","message":"回答已停止"}}')`, id); e != nil {
				dbFailure(w, e)
				return
			}
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, map[string]any{"id": id, "state": state, "cancel_requested": requested})
}

func (s *Server) qaValidateScope(ctx context.Context, in *qaSession, required bool) error {
	if in.KBIDs == nil {
		in.KBIDs = []string{}
	}
	if in.IDs == nil {
		in.IDs = []string{}
	}
	if len(in.KBIDs) > 100 || len(in.IDs) > 1000 || required && len(in.KBIDs) == 0 {
		return &SearchError{400, "INVALID_ARGUMENT", "请选择知识库，范围不能超过 100 个知识库和 1000 篇文档"}
	}
	for _, group := range [][]string{in.KBIDs, in.IDs} {
		seen := map[string]bool{}
		for i, id := range group {
			parsed, err := uuid.Parse(id)
			if err != nil || seen[parsed.String()] {
				return &SearchError{400, "INVALID_ARGUMENT", "范围包含无效或重复 ID"}
			}
			group[i] = parsed.String()
			seen[group[i]] = true
		}
	}
	var count int
	if e := s.Services.DB.QueryRow(ctx, `SELECT count(*) FROM knowledge_bases WHERE id=ANY($1::uuid[])`, in.KBIDs).Scan(&count); e != nil {
		return e
	}
	if count != len(in.KBIDs) {
		return &SearchError{400, "INVALID_ARGUMENT", "知识库不存在"}
	}
	if e := s.Services.DB.QueryRow(ctx, `SELECT count(*) FROM knowledge WHERE id=ANY($1::uuid[]) AND knowledge_base_id=ANY($2::uuid[])`, in.IDs, in.KBIDs).Scan(&count); e != nil {
		return e
	}
	if count != len(in.IDs) {
		return &SearchError{400, "INVALID_ARGUMENT", "限定文档不存在或不属于所选知识库"}
	}
	return nil
}
func qaFailure(w http.ResponseWriter, e error) {
	var search *SearchError
	var model *ai.Error
	if errors.As(e, &search) {
		Failure(w, search.Status, search.Code, search.Message)
	} else if errors.As(e, &model) {
		Failure(w, 409, model.Code, model.Message)
	} else {
		dbFailure(w, e)
	}
}

func (s *Server) qaSaveSession(w http.ResponseWriter, r *http.Request) {
	in := qaSession{Title: "新对话"}
	id := r.PathValue("id")
	if id != "" {
		if uuid.Validate(id) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "会话 ID 无效")
			return
		}
		var raw []byte
		if e := s.Services.DB.QueryRow(r.Context(), `SELECT to_jsonb(q) FROM qa_sessions q WHERE id=$1`, id).Scan(&raw); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				Failure(w, 404, "NOT_FOUND", "会话不存在")
			} else {
				dbFailure(w, e)
			}
			return
		}
		if json.Unmarshal(raw, &in) != nil {
			Failure(w, 500, "DATA_INVALID", "会话数据无效")
			return
		}
	}
	// Decode into the existing value for PATCH; JSON null restores inheritance.
	if !decode(w, r, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || len([]rune(in.Title)) > 120 || in.SystemPrompt != nil && len([]rune(*in.SystemPrompt)) > 16000 {
		Failure(w, 400, "INVALID_ARGUMENT", "标题须为 1–120 字，提示词不能超过 16000 字")
		return
	}
	if in.SystemPrompt != nil && strings.TrimSpace(*in.SystemPrompt) == "" {
		in.SystemPrompt = nil
	}
	if e := s.qaValidateScope(r.Context(), &in, false); e != nil {
		qaFailure(w, e)
		return
	}
	if id == "" {
		id = uuid.NewString()
	}
	in.ID = id
	kb, _ := json.Marshal(in.KBIDs)
	docs, _ := json.Marshal(in.IDs)
	status := 200
	if r.Method == "POST" {
		_, e := s.Services.DB.Exec(r.Context(), `INSERT INTO qa_sessions(id,title,knowledge_base_ids,knowledge_ids,system_prompt,enable_wiki,enable_graph) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, in.Title, kb, docs, in.SystemPrompt, in.EnableWiki, in.EnableGraph)
		if e != nil {
			dbFailure(w, e)
			return
		}
		status = 201
	} else {
		_, e := s.Services.DB.Exec(r.Context(), `UPDATE qa_sessions SET title=$2,knowledge_base_ids=$3,knowledge_ids=$4,system_prompt=$5,enable_wiki=$6,enable_graph=$7,updated_at=now() WHERE id=$1`, id, in.Title, kb, docs, in.SystemPrompt, in.EnableWiki, in.EnableGraph)
		if e != nil {
			dbFailure(w, e)
			return
		}
	}
	JSON(w, status, in)
}

func (s *Server) qaSnapshot(ctx context.Context, session qaSession) (qaConfig, error) {
	cfg := qaConfig{qaSession: session, HistoryTurns: 8, MaxImages: 4}
	var setting map[string]any
	if e := s.Services.DB.QueryRow(ctx, `SELECT value FROM settings WHERE key='qa-defaults'`).Scan(&setting); e != nil {
		return cfg, e
	}
	cfg.Prompt, _ = setting["system_prompt"].(string)
	if cfg.Prompt == "" {
		cfg.Prompt = defaults.QASystemPrompt
	}
	if session.SystemPrompt != nil {
		cfg.Prompt = *session.SystemPrompt
	}
	var e error
	if id, _ := setting["model_id"].(string); id != "" {
		cfg.Model, e = ai.Load(ctx, s.Services, id)
	} else {
		cfg.Model, e = ai.Bound(ctx, s.Services, "text", nil)
	}
	if e != nil {
		return cfg, e
	}
	if !ai.SupportsPurpose(cfg.Model.Purpose, "text") {
		return cfg, ai.Missing("问答文本生成")
	}
	cfg.Model.APIKey = ""
	var vision ai.Model
	if id, _ := setting["vision_model_id"].(string); id != "" {
		vision, e = ai.Load(ctx, s.Services, id)
	} else {
		vision, e = ai.Bound(ctx, s.Services, "vision", nil)
	}
	if e == nil && ai.AllowsImageInput(vision) {
		vision.APIKey = ""
		cfg.Vision = &vision
	}
	return cfg, nil
}

func (s *Server) qaSubmit(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var input struct {
		Query string `json:"query"`
	}
	retryID := ""
	if strings.HasSuffix(r.URL.Path, "/retry") {
		retryID = id
		var state string
		e := s.Services.DB.QueryRow(r.Context(), `SELECT a.session_id::text,u.content,a.state FROM qa_messages a JOIN qa_messages u ON u.id=a.user_message_id WHERE a.id=$1 AND a.role='assistant'`, id).Scan(&id, &input.Query, &state)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				Failure(w, 404, "NOT_FOUND", "回答不存在")
			} else {
				dbFailure(w, e)
			}
			return
		}
		if state == "queued" || state == "running" {
			Failure(w, 409, "QA_BUSY", "请先停止当前回答")
			return
		}
	} else if !decode(w, r, &input) {
		return
	}
	input.Query = strings.TrimSpace(input.Query)
	if input.Query == "" || len([]rune(input.Query)) > 4096 {
		Failure(w, 400, "INVALID_ARGUMENT", "问题须为 1–4096 字")
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 200 {
		Failure(w, 400, "INVALID_ARGUMENT", "幂等键过长")
		return
	}
	sum := sha256.Sum256([]byte(input.Query + "\n" + retryID))
	hash := hex.EncodeToString(sum[:])
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var raw []byte
	if e = tx.QueryRow(r.Context(), `SELECT to_jsonb(q) FROM qa_sessions q WHERE id=$1 FOR UPDATE`, id).Scan(&raw); e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			Failure(w, 404, "NOT_FOUND", "会话不存在")
		} else {
			dbFailure(w, e)
		}
		return
	}
	if key != "" {
		var prior, priorUser, priorHash string
		e = tx.QueryRow(r.Context(), `SELECT id::text,user_message_id::text,request_hash FROM qa_messages WHERE session_id=$1 AND request_key=$2`, id, key).Scan(&prior, &priorUser, &priorHash)
		if e == nil {
			if priorHash != hash {
				Failure(w, 409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同问题")
				return
			}
			JSON(w, 202, map[string]any{"user_message_id": priorUser, "assistant_message_id": prior})
			return
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			dbFailure(w, e)
			return
		}
	}
	var busy bool
	if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM qa_messages WHERE session_id=$1 AND role='assistant' AND state IN ('queued','running'))`, id).Scan(&busy); e != nil {
		dbFailure(w, e)
		return
	}
	if busy {
		Failure(w, 409, "QA_BUSY", "当前会话正在回答，请等待或停止后再发送")
		return
	}
	var session qaSession
	if json.Unmarshal(raw, &session) != nil {
		Failure(w, 500, "DATA_INVALID", "会话数据无效")
		return
	}
	if e = s.qaValidateScope(r.Context(), &session, true); e != nil {
		qaFailure(w, e)
		return
	}
	cfg, e := s.qaSnapshot(r.Context(), session)
	if e != nil {
		qaFailure(w, e)
		return
	}
	snapshot, _ := json.Marshal(cfg)
	userID, answerID := uuid.NewString(), uuid.NewString()
	if _, e = tx.Exec(r.Context(), `INSERT INTO qa_messages(id,session_id,role,content,config) VALUES($1,$2,'user',$3,$4)`, userID, id, input.Query, snapshot); e != nil {
		dbFailure(w, e)
		return
	}
	var retry, keyValue any
	if retryID != "" {
		retry = retryID
	}
	if key != "" {
		keyValue = key
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO qa_messages(id,session_id,role,state,user_message_id,retry_of,request_key,request_hash,config) VALUES($1,$2,'assistant','queued',$3,$4,$5,$6,$7)`, answerID, id, userID, retry, keyValue, hash, snapshot); e != nil {
		dbFailure(w, e)
		return
	}
	title := string([]rune(input.Query)[:min(30, len([]rune(input.Query)))])
	if _, e = tx.Exec(r.Context(), `UPDATE qa_sessions SET updated_at=now(),title=CASE WHEN title='新对话' THEN $2 ELSE title END WHERE id=$1`, id, title); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 202, map[string]any{"user_message_id": userID, "assistant_message_id": answerID})
}

func (s *Server) qaEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var exists bool
	if e := s.Services.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM qa_messages WHERE id=$1 AND role='assistant')`, id).Scan(&exists); e != nil {
		dbFailure(w, e)
		return
	}
	if !exists {
		Failure(w, 404, "NOT_FOUND", "回答不存在")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		Failure(w, 500, "STREAM_UNAVAILABLE", "事件流不可用")
		return
	}
	last, _ := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
	if last == 0 {
		last, _ = strconv.ParseInt(r.URL.Query().Get("last_event_id"), 10, 64)
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		rows, e := s.Services.DB.Query(r.Context(), `SELECT id,kind,payload FROM qa_events WHERE message_id=$1 AND id>$2 ORDER BY id LIMIT 200`, id, last)
		if e != nil {
			return
		}
		terminal := false
		count := 0
		for rows.Next() {
			var kind string
			var payload json.RawMessage
			if rows.Scan(&last, &kind, &payload) != nil {
				rows.Close()
				return
			}
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", last, kind, payload)
			terminal = terminal || kind == "done"
			count++
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return
		}
		flusher.Flush()
		if terminal {
			return
		}
		if count == 200 {
			continue
		}
		var state string
		if e = s.Services.DB.QueryRow(r.Context(), `SELECT state FROM qa_messages WHERE id=$1`, id).Scan(&state); e != nil {
			return
		}
		if state != "queued" && state != "running" {
			var pending bool
			if s.Services.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM qa_events WHERE message_id=$1 AND id>$2)`, id, last).Scan(&pending) != nil {
				return
			}
			if !pending {
				fmt.Fprintf(w, "event: done\ndata: {\"state\":%q}\n\n", state)
				flusher.Flush()
				return
			}
			continue
		}
		fmt.Fprint(w, ": heartbeat\n\n")
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
