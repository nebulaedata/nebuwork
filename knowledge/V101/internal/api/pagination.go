package api

import (
	"encoding/json"
	"net/http"
)

func (s *Server) page(w http.ResponseWriter, r *http.Request, query, countQuery string, args ...any) {
	s.pageView(w, r, nil, query, countQuery, args...)
}
func (s *Server) pageView(w http.ResponseWriter, r *http.Request, view func(map[string]any), query, countQuery string, args ...any) {
	page, size := paging(r)
	var total int64
	if e := s.Services.DB.QueryRow(r.Context(), countQuery, args...).Scan(&total); e != nil {
		dbFailure(w, e)
		return
	}
	params := append(append([]any{}, args...), size, (page-1)*size)
	rows, e := s.Services.DB.Query(r.Context(), query, params...)
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var raw json.RawMessage
		if e = rows.Scan(&raw); e != nil {
			dbFailure(w, e)
			return
		}
		if view != nil {
			var value map[string]any
			if e = json.Unmarshal(raw, &value); e != nil {
				dbFailure(w, e)
				return
			}
			view(value)
			raw, e = json.Marshal(value)
			if e != nil {
				dbFailure(w, e)
				return
			}
		}
		out = append(out, raw)
	}
	if e = rows.Err(); e != nil {
		dbFailure(w, e)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	writeJSON(w, map[string]any{"success": true, "data": out, "meta": map[string]any{"page": page, "page_size": size, "total": total, "has_more": int64(page*size) < total}})
}
