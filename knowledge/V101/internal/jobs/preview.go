package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/http"
	"path/filepath"
	"time"
)

func (w *Worker) preview(ctx context.Context, t *Task) error {
	if e := w.stage(ctx, t, "preview", "running"); e != nil {
		return e
	}
	var path, file, parse string
	if e := w.Services.DB.QueryRow(ctx, `SELECT f.path,f.id::text,coalesce(k.current_parse_version_id::text,'') FROM knowledge k JOIN file_versions f ON f.id=k.current_file_version_id WHERE k.id=$1`, t.KnowledgeID).Scan(&path, &file, &parse); e != nil {
		return e
	}
	if parse == "" {
		return fmt.Errorf("正文解析尚未完成，请先完成解析")
	}
	id := uuid.NewString()
	body, _ := json.Marshal(map[string]any{"job_id": t.Owner, "mode": "preview", "path": path, "output": filepath.Join(w.Config.DataDir, "derived", t.KnowledgeID, id), "options": t.Config})
	req, _ := http.NewRequestWithContext(ctx, "POST", "http://127.0.0.1:8091/parse", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	stop := context.AfterFunc(ctx, func() {
		b, _ := json.Marshal(map[string]string{"job_id": t.Owner})
		client := http.Client{Timeout: 3 * time.Second}
		r, e := client.Post("http://127.0.0.1:8091/cancel", "application/json", bytes.NewReader(b))
		if e == nil {
			r.Body.Close()
		}
	})
	defer stop()
	client := http.Client{Timeout: 31 * time.Minute}
	response, e := client.Do(req)
	if e != nil {
		return fmt.Errorf("预览进程请求失败")
	}
	defer response.Body.Close()
	var parsed Parsed
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 128<<20)).Decode(&parsed) != nil || parsed.Error != "" {
		return fmt.Errorf("生成预览副本失败")
	}
	tx, e := w.Services.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(context.Background())
	if e = Owned(ctx, tx, t); e != nil {
		return e
	}
	if parsed.PreviewPath != nil {
		meta, _ := json.Marshal(map[string]any{"preview_path": *parsed.PreviewPath, "preview_version_id": id})
		_, e = tx.Exec(ctx, "UPDATE parse_versions SET metadata=metadata||$2 WHERE id=$1", parse, meta)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, "INSERT INTO assets(id,knowledge_id,file_version_id,kind,path,metadata) VALUES($1,$2,$3,'preview',$4,$5)", id, t.KnowledgeID, file, *parsed.PreviewPath, meta)
		if e != nil {
			return e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	return w.stage(ctx, t, "preview", "succeeded")
}
