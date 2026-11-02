package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"io"
	"mime"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"os"
	"path/filepath"
	"strings"
)

type Store struct {
	Services *bootstrap.Services
	Config   config.Config
}
type Options struct {
	RelativePath    string
	SourceArchiveID string
	ArchiveChild    bool
	Guard           func(context.Context, pgx.Tx) error
}

func (s Store) Save(ctx context.Context, kb, name string, input io.Reader, key string, options Options) (map[string]any, error) {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	relative, err := RelativePath(name, options.RelativePath)
	if err != nil {
		return nil, err
	}
	if IsTemporaryFile(name) {
		return SkippedFile(name, relative), nil
	}
	var cfg map[string]any
	if e := s.Services.DB.QueryRow(ctx, "SELECT config FROM knowledge_bases WHERE id=$1", kb).Scan(&cfg); e != nil {
		return nil, fmt.Errorf("知识库不存在")
	}
	if cfg["deleting"] == true {
		return nil, fmt.Errorf("知识库正在删除")
	}
	var media, wiki map[string]any
	_ = s.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='media-defaults'").Scan(&media)
	_ = s.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='wiki-defaults'").Scan(&wiki)
	mediaEnabled, exists := cfg["media_enabled"]
	if !exists {
		mediaEnabled = media["enabled"]
	}

	merged := map[string]any{}
	for k, v := range media {
		merged[k] = v
	}
	for k, v := range cfg {
		merged[k] = v
	}
	cfg = merged
	if _, exists := cfg["wiki_config"]; !exists {
		cfg["wiki_config"] = wiki
	}
	id, fileID, taskID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	dir := filepath.Join(s.Config.DataDir, "files", id)
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, fmt.Errorf("无法创建文件目录")
	}
	path := filepath.Join(dir, fileID+"."+ext)
	file, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return nil, fmt.Errorf("无法保存文件")
	}
	committed := false
	defer func() {
		file.Close()
		if !committed {
			os.RemoveAll(dir)
		}
	}()
	limit := Limit(s.Config, ext)
	hash := sha256.New()
	size, e := io.Copy(io.MultiWriter(file, hash), io.LimitReader(ContextReader{ctx, input}, limit+1))
	if e != nil {
		return nil, fmt.Errorf("上传中断")
	}
	if size > limit {
		return nil, fmt.Errorf("文件超过大小限制")
	}
	if e = file.Sync(); e != nil {
		return nil, fmt.Errorf("文件持久化失败")
	}
	file.Close()
	sum := hex.EncodeToString(hash.Sum(nil))
	state, reason, kind := "queued", "", "ingest"
	if !Supported(ext) {
		state, reason, kind = "stored", "unsupported_format", ""
	}
	if IsMedia(ext) && mediaEnabled == false {
		state, reason, kind = "stored", "media_disabled", ""
	}
	if ext == "zip" {
		state, reason, kind = "queued", "", "extract_archive"
	}
	if ext == "zip" && options.ArchiveChild {
		state, reason, kind = "stored", "archive_pending", ""
	}
	if size == 0 {
		state, reason, kind = "stored", "empty_file", ""
	}
	if kind == "" {
		taskID = ""
	}
	configJSON, _ := json.Marshal(cfg)
	tx, e := s.Services.DB.Begin(ctx)
	if e != nil {
		return nil, fmt.Errorf("数据库不可用")
	}
	defer tx.Rollback(context.Background())
	var existing bool
	if e = tx.QueryRow(ctx, "SELECT true FROM knowledge_bases WHERE id=$1 AND coalesce((config->>'deleting')::boolean,false)=false FOR KEY SHARE", kb).Scan(&existing); e != nil {
		return nil, fmt.Errorf("知识库不存在或正在删除")
	}
	if options.Guard != nil {
		if e = options.Guard(ctx, tx); e != nil {
			return nil, e
		}
	}
	if len(key) > 256 {
		return nil, fmt.Errorf("幂等键过长")
	}
	if key != "" {
		scope := "upload:" + kb
		_, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", scope+":"+key)
		if e != nil {
			return nil, e
		}
		var savedHash string
		var saved map[string]any
		e = tx.QueryRow(ctx, "SELECT request_hash,response FROM request_keys WHERE scope=$1 AND key=$2", scope, key).Scan(&savedHash, &saved)
		if e == nil {
			if savedHash != sum || saved["relative_path"] != nil && saved["relative_path"] != relative {
				return nil, fmt.Errorf("幂等键已用于不同文件")
			}
			return saved, nil
		}
		if e != pgx.ErrNoRows {
			return nil, e
		}
	}
	_, e = tx.Exec(ctx, "INSERT INTO knowledge(id,knowledge_base_id,name,file_type,current_file_version_id,relative_path,source_archive_id,status,storage_reason) VALUES($1,$2,$3,$4,$5,$6,nullif($7,'')::uuid,$8,$9)", id, kb, name, ext, fileID, relative, options.SourceArchiveID, state, reason)
	if e != nil {
		return nil, fmt.Errorf("创建文档失败")
	}
	contentType := mime.TypeByExtension("." + ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, e = tx.Exec(ctx, "INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES($1,$2,$3,$4,$5,$6)", fileID, id, sum, path, size, contentType)
	if e != nil {
		return nil, fmt.Errorf("保存文件版本失败")
	}
	if kind != "" {
		_, e = tx.Exec(ctx, "INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,config,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)", taskID, kb, id, kind, configJSON, kind+":"+fileID)
		if e != nil {
			return nil, fmt.Errorf("创建处理任务失败")
		}
		_, e = tx.Exec(ctx, "INSERT INTO outbox(task_id,kind,payload) VALUES($1,'dispatch',$2)", taskID, []byte(`{}`))
		if e != nil {
			return nil, e
		}
	}
	result := map[string]any{"knowledge_id": id, "knowledge_base_id": kb, "file_version_id": fileID, "file_hash": sum, "task_id": taskID, "state": state, "relative_path": relative, "storage_reason": reason, "source_archive_id": options.SourceArchiveID}
	if key != "" {
		b, _ := json.Marshal(result)
		_, e = tx.Exec(ctx, "INSERT INTO request_keys(scope,key,request_hash,response) VALUES($1,$2,$3,$4)", "upload:"+kb, key, sum, b)
		if e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, fmt.Errorf("提交上传记录失败")
	}
	committed = true
	return result, nil
}
