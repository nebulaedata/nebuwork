package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"io"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/ingest"
	"nebulaekno/internal/jobs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const uploadPartSize int64 = 8 << 20

func (s *Server) uploadRoutes() {
	s.handle("POST /api/v1/knowledge-bases/{id}/uploads", s.createUpload)
	s.handle("GET /api/v1/uploads/{id}", s.uploadStatus)
	s.handle("PUT /api/v1/uploads/{id}/parts/{part}", s.uploadPart)
	s.handle("POST /api/v1/uploads/{id}/complete", s.completeUpload)
	s.handle("DELETE /api/v1/uploads/{id}", s.cancelUpload)
	s.handle("POST /api/v1/search/query-images", s.queryImage)
	s.handle("GET /api/v1/uploads/policy", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"file_max_bytes": s.Config.MaxUpload, "media_max_bytes": s.Config.MediaMaxUpload, "archive_max_bytes": s.Config.ArchiveMaxUpload, "archive_max_expanded_bytes": s.Config.ArchiveMaxExpanded, "archive_max_depth": s.Config.ArchiveMaxDepth, "archive_max_entries": s.Config.ArchiveMaxFiles, "unsupported_files": "store_only", "folder_paths": true, "ignored_file_prefixes": []string{ingest.OfficeTemporaryPrefix}})
	})
}
func (s *Server) createUpload(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Name         string `json:"file_name"`
		RelativePath string `json:"relative_path"`
		Size         int64  `json:"file_size"`
		Checksum     string `json:"sha256"`
	}
	if !decode(w, r, &in) {
		return
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(in.Name)), ".")
	limit := ingest.Limit(s.Config, ext)
	relative, err := ingest.RelativePath(in.Name, in.RelativePath)
	if err != nil || in.Size < 0 || in.Size > limit {
		Failure(w, 400, "INVALID_ARGUMENT", "文件名、相对路径或大小无效")
		return
	}
	if b, e := hex.DecodeString(in.Checksum); in.Checksum != "" && (e != nil || len(b) != 32) {
		Failure(w, 400, "INVALID_ARGUMENT", "sha256 校验值无效")
		return
	}
	var exists bool
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM knowledge_bases WHERE id=$1 AND coalesce((config->>'deleting')::boolean,false)=false)", kb).Scan(&exists); e != nil {
		dbFailure(w, e)
		return
	}
	if !exists {
		Failure(w, 404, "NOT_FOUND", "请先创建知识库")
		return
	}
	if ingest.IsTemporaryFile(in.Name) {
		JSON(w, 200, ingest.SkippedFile(in.Name, relative))
		return
	}
	id := uuid.NewString()
	dir := filepath.Join(s.Config.DataDir, "tmp", "uploads", id)
	if e := os.MkdirAll(dir, 0700); e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "无法创建上传目录")
		return
	}
	meta, _ := json.Marshal(map[string]any{"sha256": strings.ToLower(in.Checksum), "part_size": uploadPartSize, "relative_path": relative})
	var storage map[string]any
	_ = s.Services.DB.QueryRow(r.Context(), "SELECT value FROM settings WHERE key='storage'").Scan(&storage)
	expiry := time.Now().Add(time.Duration(jobs.Number(storage, "temporary_retention_hours", 24)) * time.Hour)
	_, e := s.Services.DB.Exec(r.Context(), "INSERT INTO upload_sessions(id,knowledge_base_id,name,size,path,expires_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)", id, kb, in.Name, in.Size, dir, expiry, meta)
	if e != nil {
		os.RemoveAll(dir)
		dbFailure(w, e)
		return
	}
	JSON(w, 201, map[string]any{"upload_id": id, "part_size": uploadPartSize, "part_count": (in.Size + uploadPartSize - 1) / uploadPartSize, "expires_at": expiry})
}
func (s *Server) uploadStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	s.one(w, r, `SELECT json_build_object('upload_id',u.id,'knowledge_base_id',u.knowledge_base_id,'file_name',u.name,'relative_path',u.metadata->'relative_path','file_size',u.size,'received_bytes',u.offset_bytes,'part_size',u.metadata->'part_size','state',CASE WHEN u.expires_at<now() AND u.state='uploading' THEN 'expired' ELSE u.state END,'expires_at',u.expires_at,'result',u.metadata->'result','parts',coalesce((SELECT json_agg(json_build_object('part_number',p.part_number,'size',p.size,'sha256',p.checksum) ORDER BY p.part_number) FROM upload_parts p WHERE p.upload_id=u.id),'[]')) FROM upload_sessions u WHERE id=$1`, id)
}
func (s *Server) uploadPart(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	number, e := strconv.Atoi(r.PathValue("part"))
	if e != nil || number < 1 {
		Failure(w, 400, "INVALID_ARGUMENT", "片号须从 1 开始")
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	var dir, state string
	var size int64
	var expiry time.Time
	if e = tx.QueryRow(r.Context(), "SELECT path,state,size,expires_at FROM upload_sessions WHERE id=$1 FOR UPDATE", id).Scan(&dir, &state, &size, &expiry); e != nil {
		dbFailure(w, e)
		return
	}
	if state != "uploading" || time.Now().After(expiry) {
		Failure(w, 409, "UPLOAD_CLOSED", "上传会话已结束或过期")
		return
	}
	count := (size + uploadPartSize - 1) / uploadPartSize
	if int64(number) > count {
		Failure(w, 400, "INVALID_ARGUMENT", "片号超过总片数")
		return
	}
	expected := uploadPartSize
	if int64(number) == count {
		expected = size - int64(number-1)*uploadPartSize
	}
	path := filepath.Join(dir, uuid.NewString()+".part")
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "无法保存分片")
		return
	}
	committed := false
	defer func() {
		f.Close()
		if !committed {
			os.Remove(path)
		}
	}()
	hash := sha256.New()
	n, e := io.Copy(io.MultiWriter(f, hash), io.LimitReader(r.Body, expected+1))
	if e != nil || n != expected {
		Failure(w, 400, "PART_SIZE_MISMATCH", "分片大小与声明不一致或传输中断")
		return
	}
	sum := hex.EncodeToString(hash.Sum(nil))
	if provided := r.Header.Get("X-Content-SHA256"); provided != "" && !strings.EqualFold(provided, sum) {
		Failure(w, 400, "CHECKSUM_MISMATCH", "分片校验失败")
		return
	}
	var old string
	e = tx.QueryRow(r.Context(), "SELECT checksum FROM upload_parts WHERE upload_id=$1 AND part_number=$2", id, number).Scan(&old)
	if e == nil {
		if old != sum {
			Failure(w, 409, "PART_CONFLICT", "此片号已接收不同内容")
			return
		}
		JSON(w, 200, map[string]any{"part_number": number, "sha256": sum, "size": n, "reused": true})
		return
	}
	if e != pgx.ErrNoRows {
		dbFailure(w, e)
		return
	}
	if e = f.Sync(); e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "分片持久化失败")
		return
	}
	f.Close()
	_, e = tx.Exec(r.Context(), "INSERT INTO upload_parts(upload_id,part_number,size,checksum,path) VALUES($1,$2,$3,$4,$5)", id, number, n, sum, path)
	if e != nil {
		dbFailure(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE upload_sessions SET offset_bytes=offset_bytes+$2 WHERE id=$1", id, n)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	committed = true
	JSON(w, 200, map[string]any{"part_number": number, "sha256": sum, "size": n})
}
func (s *Server) completeUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	var dir, kb, name, state string
	var size, received int64
	var expiry time.Time
	var meta map[string]any
	e = tx.QueryRow(r.Context(), "SELECT path,knowledge_base_id::text,name,state,size,offset_bytes,expires_at,metadata FROM upload_sessions WHERE id=$1 FOR UPDATE", id).Scan(&dir, &kb, &name, &state, &size, &received, &expiry, &meta)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if state == "completed" {
		JSON(w, 200, meta["result"])
		return
	}
	if state != "uploading" || time.Now().After(expiry) {
		Failure(w, 409, "UPLOAD_CLOSED", "上传会话已关闭或过期")
		return
	}
	if size != received {
		Failure(w, 409, "PARTS_MISSING", "尚有分片未上传")
		return
	}
	rows, e := tx.Query(r.Context(), "SELECT part_number,path,checksum FROM upload_parts WHERE upload_id=$1 ORDER BY part_number", id)
	if e != nil {
		dbFailure(w, e)
		return
	}
	type part struct {
		number         int
		path, checksum string
	}
	parts := []part{}
	for rows.Next() {
		var p part
		if e = rows.Scan(&p.number, &p.path, &p.checksum); e != nil {
			rows.Close()
			dbFailure(w, e)
			return
		}
		parts = append(parts, p)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		dbFailure(w, e)
		return
	}
	assembled := filepath.Join(dir, uuid.NewString()+".assembled")
	f, e := os.OpenFile(assembled, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "无法合并文件")
		return
	}
	defer func() { f.Close(); os.Remove(assembled) }()
	total := sha256.New()
	for i, p := range parts {
		if p.number != i+1 {
			Failure(w, 409, "PARTS_MISSING", "分片不连续")
			return
		}
		input, e := os.Open(p.path)
		if e != nil {
			Failure(w, 409, "PART_MISSING", "已接收的分片文件丢失，请重建上传会话")
			return
		}
		hash := sha256.New()
		_, e = io.Copy(io.MultiWriter(f, total, hash), input)
		input.Close()
		if e != nil || hex.EncodeToString(hash.Sum(nil)) != p.checksum {
			Failure(w, 409, "CHECKSUM_MISMATCH", "分片已损坏")
			return
		}
	}
	sum := hex.EncodeToString(total.Sum(nil))
	if expected, _ := meta["sha256"].(string); expected != "" && expected != sum {
		Failure(w, 409, "CHECKSUM_MISMATCH", "完整文件校验失败")
		return
	}
	if _, e = f.Seek(0, io.SeekStart); e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "无法读取合并文件")
		return
	}
	relative, _ := meta["relative_path"].(string)
	result, e := (ingest.Store{Services: s.Services, Config: s.Config}).Save(r.Context(), kb, name, f, "session:"+id, ingest.Options{RelativePath: relative})
	if e != nil {
		Failure(w, 409, "UPLOAD_FAILED", e.Error())
		return
	}
	meta["result"] = result
	meta["sha256"] = sum
	b, _ := json.Marshal(meta)
	_, e = tx.Exec(r.Context(), "UPDATE upload_sessions SET state='completed',knowledge_id=$2,metadata=$3 WHERE id=$1", id, result["knowledge_id"], b)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	for _, p := range parts {
		os.Remove(p.path)
	}
	JSON(w, 202, result)
}
func (s *Server) cancelUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	var dir, state string
	if e = tx.QueryRow(r.Context(), "SELECT path,state FROM upload_sessions WHERE id=$1 FOR UPDATE", id).Scan(&dir, &state); e != nil {
		dbFailure(w, e)
		return
	}
	if state == "completed" {
		Failure(w, 409, "UPLOAD_COMPLETED", "请通过文档接口删除已提交文档")
		return
	}
	if _, e = tx.Exec(r.Context(), "UPDATE upload_sessions SET state='cancelled' WHERE id=$1", id); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	expected := filepath.Join(s.Config.DataDir, "tmp", "uploads", id)
	if dir == expected {
		os.RemoveAll(dir)
	}
	JSON(w, 200, map[string]bool{"cancelled": true})
}
func (s *Server) queryImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 21<<20)
	reader, e := r.MultipartReader()
	if e != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "需要图片文件上传")
		return
	}
	part, e := reader.NextPart()
	if e != nil || part.FileName() == "" {
		Failure(w, 400, "INVALID_ARGUMENT", "需要图片文件")
		return
	}
	defer part.Close()
	id := uuid.NewString()
	dir := filepath.Join(s.Config.DataDir, "tmp", "query-images")
	if e = os.MkdirAll(dir, 0700); e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "存储不可用")
		return
	}
	path := filepath.Join(dir, id)
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "存储不可用")
		return
	}
	committed := false
	defer func() {
		f.Close()
		if !committed {
			os.Remove(path)
		}
	}()
	n, e := io.Copy(f, io.LimitReader(part, 20<<20+1))
	f.Close()
	if e != nil || n > 20<<20 {
		Failure(w, 413, "UPLOAD_TOO_LARGE", "查询图片最大 20 MiB")
		return
	}
	if _, e = ai.ImageData(path); e != nil {
		Failure(w, 400, "INVALID_IMAGE", e.Error())
		return
	}
	expiry := time.Now().Add(time.Hour)
	_, e = s.Services.DB.Exec(r.Context(), "INSERT INTO query_images(id,path,size,expires_at) VALUES($1,$2,$3,$4)", id, path, n, expiry)
	if e != nil {
		dbFailure(w, e)
		return
	}
	committed = true
	JSON(w, 201, map[string]any{"query_image_id": id, "expires_at": expiry})
}
