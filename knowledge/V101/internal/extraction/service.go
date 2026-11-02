// Package extraction owns clause extraction independently of document processing.
package extraction

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
)

const TaskType = "clause_extraction"
const Queue = "clause-extraction"
const EngineVersion = "v3/1-nebulaekno"

type Service struct {
	Services *bootstrap.Services
	Config   config.Config
}
type Request struct {
	ParseVersionID string   `json:"parse_version_id,omitempty"`
	SectionIDs     []string `json:"section_ids,omitempty"`
	ModelID        string   `json:"model_id,omitempty"`
}
type Problem struct {
	Code, Message string
	Status        int
}

func (e *Problem) Error() string                          { return e.Message }
func New(s *bootstrap.Services, c config.Config) *Service { return &Service{s, c} }

func (s *Service) Input(ctx context.Context, id, version string) (map[string]any, error) {
	var document map[string]any
	var metadata map[string]any
	var content, file, parse, hash string
	err := s.Services.DB.QueryRow(ctx, `SELECT jsonb_build_object('id',k.id,'name',k.name,'knowledge_base_id',k.knowledge_base_id,'file_type',k.file_type),
 p.metadata,p.content,p.file_version_id::text,p.id::text,f.hash
 FROM knowledge k JOIN parse_versions p ON p.knowledge_id=k.id AND p.id=coalesce(nullif($2,'')::uuid,k.current_parse_version_id)
 JOIN file_versions f ON f.id=p.file_version_id
 WHERE k.id=$1 AND NOT coalesce((k.config->>'deleting')::boolean,false)
 AND NOT EXISTS(SELECT 1 FROM knowledge_bases b WHERE b.id=k.knowledge_base_id AND coalesce((b.config->>'deleting')::boolean,false))`, id, version).Scan(&document, &metadata, &content, &file, &parse, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &Problem{"PARSE_REQUIRED", "请先完成文件解析，或选择存在的解析版本", 409}
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.Services.DB.Query(ctx, `SELECT jsonb_build_object('id',id,'quote',quote,'locators',locators,'precision',precision,'char_start',char_start,'char_end',char_end)
 FROM source_refs WHERE parse_version_id=$1 AND origin NOT IN ('image_caption','frame_caption')
 AND NOT coalesce((metadata->'layout'->>'reference_only')::boolean,false) ORDER BY char_start,char_end,id`, parse)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := []map[string]any{}
	for rows.Next() {
		var ref map[string]any
		if err = rows.Scan(&ref); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	blocks, _ := metadata["blocks"].([]any)
	if len(blocks) == 0 && strings.TrimSpace(content) != "" {
		blocks = []any{map[string]any{"text": content, "method": "native", "precision": "document"}}
	}
	if len(blocks) == 0 || len(refs) == 0 {
		return nil, &Problem{"NO_SOURCE_TEXT", "该解析版本没有可用于提取的原文与来源引用", 409}
	}
	return map[string]any{"document": document, "blocks": blocks, "refs": refs, "file_version_id": file, "parse_version_id": parse, "input_hash": hash}, nil
}

func runnerPath() string {
	if value := os.Getenv("NEBULAEKNO_EXTRACTOR_PATH"); value != "" {
		return value
	}
	if _, err := os.Stat("/app/extractor/runner.py"); err == nil {
		return "/app/extractor/runner.py"
	}
	return filepath.Join("extractor", "runner.py")
}
func python() string {
	if v := os.Getenv("NEBULAEKNO_PYTHON"); v != "" {
		return v
	}
	return "python3"
}
func CheckRuntime(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if _, err := os.Stat(runnerPath()); err != nil {
		return config.Fail("EXTRACTOR_MISSING", "extractor", "提取引擎文件不存在")
	}
	if err := exec.CommandContext(ctx, python(), "-c", "import pydantic,openpyxl,sqlite3").Run(); err != nil {
		return config.Fail("EXTRACTOR_RUNTIME_MISSING", "extractor", "提取所需的 Python 依赖不完整")
	}
	return nil
}
func command(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, python(), append([]string{runnerPath()}, args...)...)
	cmd.Env = append(os.Environ(), "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8", "PYTHONUNBUFFERED=1")
	return cmd
}
func (s *Service) Sections(ctx context.Context, input map[string]any) ([]map[string]any, error) {
	f, err := os.CreateTemp("", "nebulaekno-extraction-*.json")
	if err != nil {
		return nil, err
	}
	name := f.Name()
	defer os.Remove(name)
	err = json.NewEncoder(f).Encode(input)
	f.Close()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	raw, err := command(ctx, "sections", name).Output()
	if err != nil {
		return nil, fmt.Errorf("无法读取提取章节：%w", err)
	}
	var sections []map[string]any
	if err = json.Unmarshal(raw, &sections); err != nil {
		return nil, err
	}
	return sections, nil
}
func (s *Service) Create(ctx context.Context, id string, request Request) (map[string]string, error) {
	if request.ParseVersionID != "" && uuid.Validate(request.ParseVersionID) != nil ||
		request.ModelID != "" && uuid.Validate(request.ModelID) != nil || len(request.SectionIDs) > 40 {
		return nil, &Problem{"INVALID_ARGUMENT", "解析版本、模型或章节范围无效", 400}
	}
	input, err := s.Input(ctx, id, request.ParseVersionID)
	if err != nil {
		return nil, err
	}
	if len(request.SectionIDs) > 0 {
		sections, e := s.Sections(ctx, input)
		if e != nil {
			return nil, e
		}
		known := map[string]bool{}
		for _, section := range sections {
			known[fmt.Sprint(section["id"])] = true
		}
		for _, section := range request.SectionIDs {
			if !known[section] {
				return nil, &Problem{"SECTION_NOT_FOUND", "所选章节不存在，请刷新章节列表", 400}
			}
		}
	}
	var settings map[string]any
	if err = s.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='extraction-defaults'").Scan(&settings); err != nil {
		return nil, err
	}
	modelID := request.ModelID
	if modelID == "" {
		modelID, _ = settings["model_id"].(string)
	}
	if modelID != "" {
		m, e := ai.Load(ctx, s.Services, modelID)
		if e != nil || !ai.SupportsPurpose(m.Purpose, "text") {
			return nil, &Problem{"INVALID_MODEL", "请选择已保存的文本生成模型", 400}
		}
	}
	input["section_ids"] = request.SectionIDs
	raw, _ := json.Marshal(input)
	sum := sha256.Sum256(raw)
	inputHash := hex.EncodeToString(sum[:])
	input["input_hash"] = inputHash
	raw, _ = json.Marshal(input)
	if len(raw) > 128<<20 {
		return nil, &Problem{"EXTRACTION_INPUT_LIMIT", "提取输入超过 128 MB，请缩小范围或拆分文件", 413}
	}
	doc := input["document"].(map[string]any)
	runID, taskID := uuid.NewString(), uuid.NewString()
	cfg := map[string]any{"run_id": runID, "model_id": modelID, "engine_version": EngineVersion, "section_ids": request.SectionIDs}
	cfgRaw, _ := json.Marshal(cfg)
	tx, err := s.Services.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	var kbDeleting bool
	if err = tx.QueryRow(ctx, "SELECT coalesce((config->>'deleting')::boolean,false) FROM knowledge_bases WHERE id=$1 FOR UPDATE", doc["knowledge_base_id"]).Scan(&kbDeleting); err != nil {
		return nil, err
	}
	if kbDeleting {
		return nil, &Problem{"DOCUMENT_DELETING", "知识库正在删除", 409}
	}
	var deleting bool
	if err = tx.QueryRow(ctx, "SELECT coalesce((config->>'deleting')::boolean,false) FROM knowledge WHERE id=$1 FOR UPDATE", id).Scan(&deleting); err != nil {
		return nil, err
	}
	if deleting {
		return nil, &Problem{"DOCUMENT_DELETING", "文档正在删除", 409}
	}
	var active bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tasks WHERE knowledge_id=$1 AND type=$2 AND state IN ('queued','running','waiting_configuration'))", id, TaskType).Scan(&active); err != nil {
		return nil, err
	}
	if active {
		return nil, &Problem{"EXTRACTION_ACTIVE", "该文件已有提取任务，请查看进度或先取消", 409}
	}
	_, err = tx.Exec(ctx, "INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,config,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)", taskID, doc["knowledge_base_id"], id, TaskType, cfgRaw, taskID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO extraction_runs(id,task_id,knowledge_id,file_version_id,parse_version_id,config,input,input_hash)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, runID, taskID, id, input["file_version_id"], input["parse_version_id"], cfgRaw, raw, inputHash)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO outbox(task_id,kind,payload) VALUES($1,'dispatch','{}')", taskID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return map[string]string{"run_id": runID, "task_id": taskID}, nil
}

func (s *Service) Retry(ctx context.Context, id string) error {
	tx, err := s.Services.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var document string
	if err = tx.QueryRow(ctx, "SELECT coalesce(knowledge_id::text,'') FROM tasks WHERE id=$1 AND type=$2", id, TaskType).Scan(&document); err != nil {
		return err
	}
	var deleting bool
	if err = tx.QueryRow(ctx, `SELECT coalesce((k.config->>'deleting')::boolean,false) OR coalesce((b.config->>'deleting')::boolean,false)
 FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id WHERE k.id=$1 FOR UPDATE OF k`, document).Scan(&deleting); err != nil {
		return err
	}
	if deleting {
		return &Problem{"DOCUMENT_DELETING", "文档正在删除", 409}
	}
	var active bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tasks WHERE knowledge_id=$1 AND id<>$2 AND type=$3 AND state IN ('queued','running','waiting_configuration'))", document, id, TaskType).Scan(&active); err != nil {
		return err
	}
	if active {
		return &Problem{"EXTRACTION_ACTIVE", "该文件已有提取任务", 409}
	}
	tag, err := tx.Exec(ctx, "UPDATE tasks SET state='queued',cancel_requested=false,error=NULL,attempts=0,next_run_at=now(),updated_at=now() WHERE id=$1 AND state IN ('failed','partially_failed','cancelled','waiting_configuration')", id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &Problem{"TASK_CONFLICT", "任务正在执行或已完成", 409}
	}
	return tx.Commit(ctx)
}
