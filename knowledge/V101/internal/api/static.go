package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) staticRoutes() {
	s.handle("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			Failure(w, 404, "NOT_FOUND", "接口不存在")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			Failure(w, 405, "METHOD_NOT_ALLOWED", "请求方法不支持")
			return
		}
		root := "/app/web"
		relative := strings.TrimPrefix(filepath.Clean("/"+r.URL.Path), "/")
		path := filepath.Join(root, relative)
		if st, e := os.Stat(path); e == nil && !st.IsDir() {
			if strings.HasPrefix(relative, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeFile(w, r, path)
			return
		}
		if strings.HasPrefix(relative, "assets/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})
}
