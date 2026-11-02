package api

import (
	"encoding/json"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"net/http"
	"time"
)

const Version = "0.1.0"

type Server struct {
	ExtractionOnly bool
	Config         config.Config
	State          *bootstrap.State
	Services       *bootstrap.Services
	mux            *http.ServeMux
	operations     []operation
}

func New(c config.Config, state *bootstrap.State) *Server {
	s := &Server{Config: c, State: state, mux: http.NewServeMux(), operations: []operation{{"GET", "/health/live"}, {"GET", "/health/ready"}}}
	s.systemRoutes()
	s.docsRoutes()
	s.kbRoutes()
	s.settingsRoutes()
	s.modelRoutes()
	s.connectionRoutes()
	s.documentRoutes()
	s.documentRelatedRoutes()
	s.extractionProxyRoutes()
	s.extractionModelGateway()
	s.spreadsheetRoutes()
	s.uploadRoutes()
	s.taskRoutes()
	s.sourceRoutes()
	s.searchRoutes()
	s.qaRoutes()
	s.wikiGraphRoutes()
	s.wikiToolRoutes()
	s.capabilityRoutes()
	s.imageRoutes()
	s.subtitleRoutes()
	s.rebuildRoutes()
	s.staticRoutes()
	return s
}
func writeJSON(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }
func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": status < 400, "data": data})
}
func Failure(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error": map[string]any{"code": code, "message": message, "retryable": status == 503}})
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key,Last-Event-ID,Upload-Offset,X-Content-SHA256")
	if r.URL.Path == "/health/live" {
		JSON(w, 200, map[string]any{"alive": true, "stage": s.State.Get().Stage})
		return
	}
	status := s.State.Get()
	if r.URL.Path == "/health/ready" {
		code := 503
		if status.Ready {
			code = 200
		}
		JSON(w, code, status)
		return
	}
	if !status.Ready {
		Failure(w, 503, "SERVICE_NOT_READY", "服务尚未就绪，请查看容器日志或健康接口")
		return
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.mux.ServeHTTP(w, r)
}
func (s *Server) systemRoutes() {
	s.handle("GET /api/v1/system/status", func(w http.ResponseWriter, r *http.Request) { JSON(w, 200, s.State.Get()) })
	s.handle("GET /api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"product": "NebulaeKno", "version": Version})
	})
	s.handle("GET /api/v1/system/infrastructure", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"postgres": config.Redacted(s.Config.DatabaseURL), "neo4j": config.Redacted(s.Config.Neo4jURL), "redis": config.Redacted(s.Config.RedisURL), "data_dir": s.Config.DataDir, "components": s.State.Get().Components})
	})
	s.handle("GET /api/v1/system/initialization", func(w http.ResponseWriter, r *http.Request) {
		rows, e := s.Services.DB.Query(r.Context(), "SELECT stage,status,error,created_at FROM initialization_events ORDER BY id DESC LIMIT 100")
		if e != nil {
			Failure(w, 503, "DATABASE_UNAVAILABLE", "无法读取初始化记录")
			return
		}
		defer rows.Close()
		out := []any{}
		for rows.Next() {
			var stage, status string
			var raw json.RawMessage
			var at time.Time
			if rows.Scan(&stage, &status, &raw, &at) != nil {
				Failure(w, 500, "DATABASE_ERROR", "初始化记录读取失败")
				return
			}
			out = append(out, map[string]any{"stage": stage, "status": status, "error": raw, "created_at": at})
		}
		if rows.Err() != nil {
			Failure(w, 503, "DATABASE_UNAVAILABLE", "初始化记录读取中断")
			return
		}
		JSON(w, 200, out)
	})
}
