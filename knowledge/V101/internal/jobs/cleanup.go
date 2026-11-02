package jobs

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

func (w *Worker) cleanupTemporary(ctx context.Context) {
	// Closed/expired upload rows remain for a day after expiry, retaining idempotent completion responses.
	rows, e := w.Services.DB.Query(ctx, `WITH expired AS(SELECT id FROM upload_sessions WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED) DELETE FROM upload_sessions u USING expired e WHERE u.id=e.id RETURNING u.path`)
	if e != nil {
		return
	}
	paths := []string{}
	for rows.Next() {
		var path string
		if rows.Scan(&path) == nil {
			paths = append(paths, path)
		}
	}
	rows.Close()
	images, e := w.Services.DB.Query(ctx, "DELETE FROM query_images WHERE expires_at<now()-interval '5 minutes' RETURNING path")
	if e == nil {
		for images.Next() {
			var path string
			if images.Scan(&path) == nil {
				paths = append(paths, path)
			}
		}
		images.Close()
	}
	root, _ := filepath.Abs(filepath.Join(w.Config.DataDir, "tmp"))
	for _, path := range paths {
		absolute, e := filepath.Abs(path)
		if e == nil && strings.HasPrefix(absolute, root+string(filepath.Separator)) {
			os.RemoveAll(absolute)
		}
	}
}
