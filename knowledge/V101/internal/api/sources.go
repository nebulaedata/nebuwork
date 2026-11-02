package api

import (
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"strconv"
	"strings"
)

const sourceQuery = `SELECT json_build_object('source_ref_id',s.id,'asset_id',(SELECT a.id FROM assets a WHERE a.knowledge_id=s.knowledge_id AND a.file_version_id=s.file_version_id AND a.path=s.metadata->>'image_path' AND (a.metadata->>'parse_version_id'=s.parse_version_id::text OR NOT a.metadata ? 'parse_version_id') ORDER BY a.id LIMIT 1),'knowledge_id',k.id,'knowledge_base_id',k.knowledge_base_id,'file_version_id',f.id,'parse_version_id',s.parse_version_id,'content_origin',s.origin,'metadata',s.metadata-'image_path','context_source_ref_ids',coalesce(s.metadata->'context_source_ref_ids','[]'::jsonb),'context_sources',coalesce((SELECT jsonb_agg(jsonb_build_object('source_ref_id',h.id,'quote',h.quote,'locators',h.locators,'preview_url','/documents/'||h.knowledge_id||'?source_ref_id='||h.id||'&file_version_id='||h.file_version_id||'&parse_version_id='||h.parse_version_id)) FROM source_refs h WHERE h.parse_version_id=s.parse_version_id AND s.metadata->'context_source_ref_ids' ? h.id::text),'[]'::jsonb),'file_hash',f.hash,'file_name',k.name,'file_type',k.file_type,'locators',s.locators,'quote',s.quote,'precision',s.precision,'mapping_method',CASE WHEN s.locators->0->>'mapping'='exact' AND s.locators->0->>'type'='sheet' THEN 'source_cells' WHEN s.locators->0->>'mapping'='converted_structure' THEN 'converted_structure' WHEN s.origin='paddleocr_vl' AND s.locators->0 ? 'bbox' THEN 'ocr_layout_region' WHEN s.origin='asr' THEN 'asr_segment_timestamp' WHEN s.origin IN ('subtitle','embedded_subtitle') THEN 'subtitle_timestamp' WHEN s.origin IN ('image_caption','frame_caption') THEN 'generated_description' WHEN s.precision IN ('page','region','frame','document') THEN 'coarse' ELSE 'verified_text_match' END,'partial',(s.precision IN ('page','region','frame','document') OR coalesce(s.locators->0->>'mapping'='converted_structure',false)),'mapping_reason',CASE WHEN s.locators->0->>'mapping'='converted_structure' THEN '该位置来自转换副本，未核验为原文件的精确页码、段落或对象坐标' WHEN s.locators->0->>'type'='sheet' AND s.locators->0->>'mapping'='exact' THEN '原文件工作表及行列位置已核验' WHEN s.locators->0->>'type'='image' AND s.locators->0 ? 'page' AND s.locators->0 ? 'bbox' THEN '定位到原文件页内图片区域；图片描述单独保存，未提供逐字坐标' WHEN s.origin='anydoc' AND s.precision='document' THEN '已定位到源文件及解析片段，未核验原文页码或段落位置' WHEN s.origin='paddleocr_vl' AND s.locators->0 ? 'bbox' THEN '定位到 OCR 版面区域，未提供逐字坐标' WHEN s.precision IN ('page','region','frame','document') THEN '当前定位到整页、整图或代表帧，未提供逐字坐标' ELSE '' END,'char_start',s.char_start,'char_end',s.char_end,'status',s.status,'file_url','/api/v1/knowledge/'||k.id||'/download?file_version_id='||f.id,'preview_url','/documents/'||k.id||'?source_ref_id='||s.id||'&file_version_id='||f.id||'&parse_version_id='||s.parse_version_id) FROM source_refs s JOIN knowledge k ON k.id=s.knowledge_id JOIN file_versions f ON f.id=s.file_version_id WHERE s.id=$1`

func (s *Server) sourceRoutes() {
	s.handle("GET /api/v1/sources/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		sources, e := s.loadSources(r.Context(), []string{id})
		if e != nil {
			dbFailure(w, e)
			return
		}
		source, exists := sources[id]
		if !exists {
			Failure(w, 404, "NOT_FOUND", "来源不存在")
			return
		}
		JSON(w, 200, source)
	})
	s.handle("POST /api/v1/sources/resolve-batch", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			IDs []string `json:"source_ref_ids"`
		}
		if !decode(w, r, &in) {
			return
		}
		if len(in.IDs) > 100 {
			Failure(w, 400, "INVALID_ARGUMENT", "每次最多 100 个来源")
			return
		}
		out := []any{}
		sources, e := s.loadSources(r.Context(), in.IDs)
		if e != nil {
			dbFailure(w, e)
			return
		}
		for _, id := range in.IDs {
			if uuid.Validate(id) != nil {
				out = append(out, map[string]string{"source_ref_id": id, "status": "invalid"})
				continue
			}
			if source, exists := sources[id]; exists {
				out = append(out, source)
			} else {
				out = append(out, map[string]string{"source_ref_id": id, "status": "missing"})
			}
		}
		JSON(w, 200, out)
	})
	s.handle("POST /api/v1/knowledge/{id}/read", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var in struct {
			FileVersionID  string `json:"file_version_id"`
			ParseVersionID string `json:"parse_version_id"`
			Query          string `json:"query"`
			Cursor         string `json:"cursor"`
			Limit          int    `json:"limit"`
		}
		if !decode(w, r, &in) {
			return
		}
		if uuid.Validate(in.FileVersionID) != nil || in.ParseVersionID != "" && uuid.Validate(in.ParseVersionID) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "必须指定有效文件版本")
			return
		}
		var content, parseID string
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT content,id::text FROM parse_versions WHERE knowledge_id=$1 AND file_version_id=$2 AND ($3='' OR id::text=$3) ORDER BY created_at DESC LIMIT 1", id, in.FileVersionID, in.ParseVersionID).Scan(&content, &parseID); e != nil {
			dbFailure(w, e)
			return
		}
		runes := []rune(content)
		start, _ := strconv.Atoi(in.Cursor)
		if start < 0 || start > len(runes) {
			Failure(w, 400, "INVALID_ARGUMENT", "游标超出正文范围")
			return
		}
		if in.Limit <= 0 {
			in.Limit = 2000
		}
		if in.Limit > 10000 {
			in.Limit = 10000
		}
		if in.Query != "" {
			index := strings.Index(string(runes[start:]), in.Query)
			if index < 0 {
				JSON(w, 200, map[string]any{"content": "", "matched": false, "source_refs": []any{}})
				return
			}
			start += len([]rune(string(runes[start:])[:index]))
			if start > 100 {
				start -= 100
			}
		}
		end := start + in.Limit
		if end > len(runes) {
			end = len(runes)
		}
		var next any
		if end < len(runes) {
			next = fmt.Sprint(end)
		}
		rows, e := s.Services.DB.Query(r.Context(), "SELECT id::text FROM source_refs WHERE parse_version_id=$1 AND char_start<$3 AND char_end>$2 ORDER BY char_start", parseID, start, end)
		if e != nil {
			dbFailure(w, e)
			return
		}
		defer rows.Close()
		sources := []string{}
		for rows.Next() {
			var source string
			rows.Scan(&source)
			sources = append(sources, source)
		}
		JSON(w, 200, map[string]any{"content": string(runes[start:end]), "file_version_id": in.FileVersionID, "parse_version_id": parseID, "char_start": start, "char_end": end, "content_truncated": end < len(runes), "next_cursor": next, "source_ref_ids": sources})
	})
}
