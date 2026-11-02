package api

import (
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"net/http"
	"strconv"
	"strings"
)

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "请求 JSON 无效或包含未知字段")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		Failure(w, 400, "INVALID_ARGUMENT", "请求必须包含一个 JSON 对象")
		return false
	}
	return true
}
func identifier(w http.ResponseWriter, r *http.Request, key string) (string, bool) {
	v := r.PathValue(key)
	if uuid.Validate(v) != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "标识格式不正确")
		return "", false
	}
	return v, true
}
func paging(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return page, size
}
func dbFailure(w http.ResponseWriter, e error) {
	if errors.Is(e, pgx.ErrNoRows) {
		Failure(w, 404, "NOT_FOUND", "记录不存在")
		return
	}
	var pe *pgconn.PgError
	if errors.As(e, &pe) {
		switch pe.Code {
		case "23503":
			Failure(w, 409, "REFERENCE_CONFLICT", "记录不存在或仍被其他对象引用")
			return
		case "23505":
			Failure(w, 409, "ALREADY_EXISTS", "记录已存在")
			return
		case "22P02":
			Failure(w, 400, "INVALID_ARGUMENT", "参数格式无效")
			return
		}
	}
	Failure(w, 503, "DATABASE_UNAVAILABLE", "数据库操作失败")
}
func (s *Server) list(w http.ResponseWriter, r *http.Request, q string, args ...any) {
	rows, e := s.Services.DB.Query(r.Context(), q, args...)
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b json.RawMessage
		if e = rows.Scan(&b); e != nil {
			dbFailure(w, e)
			return
		}
		out = append(out, b)
	}
	if e = rows.Err(); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, out)
}
func (s *Server) one(w http.ResponseWriter, r *http.Request, q string, args ...any) {
	var b json.RawMessage
	if e := s.Services.DB.QueryRow(r.Context(), q, args...).Scan(&b); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, b)
}
func (s *Server) oneView(w http.ResponseWriter, r *http.Request, view func(map[string]any), q string, args ...any) {
	var value map[string]any
	if e := s.Services.DB.QueryRow(r.Context(), q, args...).Scan(&value); e != nil {
		dbFailure(w, e)
		return
	}
	view(value)
	JSON(w, 200, value)
}
func validName(s string) bool { return len([]rune(strings.TrimSpace(s))) > 0 && len([]rune(s)) <= 256 }
func cloneMap(in map[string]any) map[string]any {
	b, _ := json.Marshal(in)
	out := map[string]any{}
	_ = json.Unmarshal(b, &out)
	if out == nil {
		out = map[string]any{}
	}
	return out
}
func merge(base, override map[string]any) map[string]any {
	out := cloneMap(base)
	for k, v := range override {
		a, aok := out[k].(map[string]any)
		b, bok := v.(map[string]any)
		if aok && bok {
			out[k] = merge(a, b)
		} else {
			out[k] = v
		}
	}
	return out
}
