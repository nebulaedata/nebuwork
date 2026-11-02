package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var subtitlePattern = regexp.MustCompile(`(?m)^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})[^\r\n]*\r?\n`)
var subtitleTags = regexp.MustCompile(`<[^>]*>`)

func subtitleTime(value string) (int64, error) {
	parts := strings.Split(strings.ReplaceAll(value, ",", "."), ":")
	var hours, minutes int64
	var e error
	if len(parts) == 3 {
		hours, e = strconv.ParseInt(parts[0], 10, 64)
		if e != nil {
			return 0, e
		}
		parts = parts[1:]
	}
	minutes, e = strconv.ParseInt(parts[0], 10, 64)
	if e != nil || minutes >= 60 {
		return 0, fmt.Errorf("分钟无效")
	}
	seconds, e := strconv.ParseFloat(parts[1], 64)
	if e != nil || seconds >= 60 {
		return 0, fmt.Errorf("秒数无效")
	}
	return hours*3600000 + minutes*60000 + int64(seconds*1000+.5), nil
}
func parseSubtitles(content string, offset, duration int64) ([]map[string]any, error) {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	matches := subtitlePattern.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 || len(matches) > 50000 {
		return nil, fmt.Errorf("字幕没有有效时间段或超过 50000 段")
	}
	out := []map[string]any{}
	last := int64(-1)
	for i, m := range matches {
		a, e := subtitleTime(content[m[2]:m[3]])
		if e != nil {
			return nil, e
		}
		b, e := subtitleTime(content[m[4]:m[5]])
		if e != nil {
			return nil, e
		}
		a += offset
		b += offset
		if a < 0 || b <= a || b > duration || a < last {
			return nil, fmt.Errorf("字幕时间倒序、越界或偏移后无效")
		}
		last = a
		end := len(content)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		text := content[m[1]:end]
		if n := strings.Index(text, "\n\n"); n >= 0 {
			text = text[:n]
		}
		text = strings.TrimSpace(subtitleTags.ReplaceAllString(text, ""))
		if text == "" {
			continue
		}
		out = append(out, map[string]any{"start_ms": a, "end_ms": b, "text": text})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("字幕文本为空")
	}
	return out, nil
}
func (s *Server) subtitleRoutes() {
	s.handle("POST /api/v1/knowledge/{id}/subtitles", s.subtitles)
	s.handle("POST /api/v1/knowledge/{id}/media/reprocess", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Stages []string `json:"stages"`
		}
		if !decode(w, r, &in) {
			return
		}
		for _, stage := range in.Stages {
			if stage != "all" {
				Failure(w, 422, "CAPABILITY_NOT_READY", "当前媒体重处理支持 stages=[\"all\"]；阶段内检查点会在任务重试时自动复用")
				return
			}
		}
		s.reprocess(w, r)
	})
}
func (s *Server) subtitles(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		FileVersion string `json:"file_version_id"`
		Format      string `json:"format"`
		Content     string `json:"content"`
		Offset      int64  `json:"offset_ms"`
	}
	if !decode(w, r, &in) {
		return
	}
	if uuid.Validate(in.FileVersion) != nil || (in.Format != "srt" && in.Format != "vtt") {
		Failure(w, 400, "INVALID_ARGUMENT", "指定文件版本及 srt/vtt 字幕格式")
		return
	}
	var duration int64
	var kb string
	var cfg map[string]any
	e := s.Services.DB.QueryRow(r.Context(), `SELECT m.duration_ms,k.knowledge_base_id::text,b.config FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id JOIN media m ON m.file_version_id=k.current_file_version_id WHERE k.id=$1 AND k.current_file_version_id=$2`, id, in.FileVersion).Scan(&duration, &kb, &cfg)
	if e != nil {
		Failure(w, 409, "MEDIA_NOT_READY", "请先完成当前版本的媒体探测")
		return
	}
	segments, e := parseSubtitles(in.Content, in.Offset, duration)
	if e != nil {
		Failure(w, 400, "SUBTITLE_INVALID", e.Error())
		return
	}
	track := uuid.NewString()
	dir := filepath.Join(s.Config.DataDir, "media", id)
	if e = os.MkdirAll(dir, 0700); e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "字幕存储不可用")
		return
	}
	path := filepath.Join(dir, track+".json")
	b, _ := json.Marshal(segments)
	if e = os.WriteFile(path, b, 0600); e != nil {
		Failure(w, 500, "STORAGE_UNAVAILABLE", "字幕保存失败")
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		os.Remove(path)
		dbFailure(w, e)
		return
	}
	committed := false
	defer func() {
		tx.Rollback(context.Background())
		if !committed {
			os.Remove(path)
		}
	}()
	var exists bool
	if e = tx.QueryRow(r.Context(), "SELECT true FROM knowledge WHERE id=$1 FOR UPDATE", id).Scan(&exists); e != nil {
		dbFailure(w, e)
		return
	}
	var active bool
	if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM tasks WHERE knowledge_id=$1 AND state IN ('running','queued'))", id).Scan(&active); e != nil {
		dbFailure(w, e)
		return
	}
	if active {
		Failure(w, 409, "TASK_CONFLICT", "请先等待当前文档任务完成")
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO media_subtitles(id,file_version_id,path,format,offset_ms,segment_count) VALUES($1,$2,$3,$4,$5,$6)", track, in.FileVersion, path, in.Format, in.Offset, len(segments))
	if e != nil {
		dbFailure(w, e)
		return
	}
	cfg["subtitle_track_id"] = track
	task := uuid.NewString()
	configJSON, _ := json.Marshal(cfg)
	_, e = tx.Exec(r.Context(), "INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,config,idempotency_key) VALUES($1,$2,$3,'rebuild',$4,$5)", task, kb, id, configJSON, task)
	if e != nil {
		dbFailure(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO outbox(task_id,kind,payload) VALUES($1,'dispatch','{}')", task)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	committed = true
	JSON(w, 202, map[string]any{"task_id": task, "subtitle_track_id": track, "segment_count": len(segments), "file_version_id": in.FileVersion})
}
