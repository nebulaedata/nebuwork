package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"nebulaekno/internal/jobs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type sheetCell struct {
	Address      string `json:"address"`
	Row          int    `json:"row"`
	Column       int    `json:"column"`
	Value        any    `json:"value"`
	Display      string `json:"display"`
	Format       string `json:"format"`
	Formula      string `json:"formula,omitempty"`
	Warning      string `json:"warning,omitempty"`
	ImageFormula string `json:"image_formula,omitempty"`
}
type sheetRow struct {
	Row   int         `json:"row"`
	Cells []sheetCell `json:"cells"`
}
type sheetInfo struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Rows    int      `json:"row_count"`
	Columns int      `json:"column_count"`
	Merges  []string `json:"merged_ranges"`
	Hidden  bool     `json:"hidden"`
	Pages   []int    `json:"pages"`
}
type sheetManifest struct {
	Version      int            `json:"version"`
	PageRows     int            `json:"page_rows"`
	Path         string         `json:"path,omitempty"`
	Sheets       []sheetInfo    `json:"sheets"`
	FileVersion  string         `json:"file_version_id,omitempty"`
	ParseVersion string         `json:"parse_version_id,omitempty"`
	Settings     map[string]any `json:"settings,omitempty"`
}

var sheetCacheLock sync.Mutex

func isSpreadsheet(ext string) bool {
	return ext == "xls" || ext == "xlsx" || ext == "et" || ext == "ett"
}

func validateExcel(v map[string]any) string {
	raw, exists := v["excel"]
	if !exists {
		return ""
	}
	cfg, ok := raw.(map[string]any)
	if !ok || cfg == nil {
		return "excel 必须为对象"
	}
	checkRows := func(value any) bool {
		rows, ok := value.([]any)
		if !ok || len(rows) > 20 {
			return false
		}
		seen := map[int]bool{}
		for _, value := range rows {
			n, ok := value.(float64)
			if !ok || n < 1 || n > 200000 || n != float64(int(n)) || seen[int(n)] {
				return false
			}
			seen[int(n)] = true
		}
		return true
	}
	for k, value := range cfg {
		switch k {
		case "header_rows":
			if !checkRows(value) {
				return "表头行必须为不重复的原始行号数组（1–200000，最多 20 行）"
			}
		case "sheets":
			sheets, ok := value.(map[string]any)
			if !ok || len(sheets) > 1000 {
				return "工作表配置无效"
			}
			for name, raw := range sheets {
				item, ok := raw.(map[string]any)
				if !ok || name == "" || len(item) != 1 || !checkRows(item["header_rows"]) {
					return "每个工作表须配置 header_rows 数组"
				}
			}
		default:
			return "未知 Excel 配置项：" + k
		}
	}
	return ""
}

func (s *Server) spreadsheetRoutes() {
	s.handle("GET /api/v1/knowledge/{id}/sheets", func(w http.ResponseWriter, r *http.Request) {
		data, err := s.workbook(r)
		if err != nil {
			Failure(w, 422, "SPREADSHEET_UNAVAILABLE", err.Error())
			return
		}
		data.Path = ""
		JSON(w, 200, data)
	})
	s.handle("GET /api/v1/knowledge/{id}/sheets/{sheet_id}/cells", s.sheetCells)
	s.handle("PUT /api/v1/knowledge/{id}/spreadsheet-settings", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var input struct {
			FileVersion string         `json:"file_version_id"`
			Excel       map[string]any `json:"excel"`
		}
		if !decode(w, r, &input) {
			return
		}
		if uuid.Validate(input.FileVersion) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "必须指定当前文件版本")
			return
		}
		if msg := validateExcel(map[string]any{"excel": input.Excel}); msg != "" {
			Failure(w, 400, "INVALID_ARGUMENT", msg)
			return
		}
		query := r.URL.Query()
		query.Set("file_version_id", input.FileVersion)
		r.URL.RawQuery = query.Encode()
		workbook, err := s.workbook(r)
		if err != nil {
			Failure(w, 409, "VERSION_MISMATCH", "文件版本不存在或无法读取工作表")
			return
		}
		if sheets, ok := input.Excel["sheets"].(map[string]any); ok {
			for name, raw := range sheets {
				found := false
				for _, sheet := range workbook.Sheets {
					if sheet.Name != name {
						continue
					}
					found = true
					for _, row := range raw.(map[string]any)["header_rows"].([]any) {
						if int(row.(float64)) > sheet.Rows {
							Failure(w, 400, "INVALID_ARGUMENT", "表头行超出工作表范围："+name)
							return
						}
					}
				}
				if !found {
					Failure(w, 400, "INVALID_ARGUMENT", "工作表不存在："+name)
					return
				}
			}
		}
		raw, _ := json.Marshal(input.Excel)
		tag, err := s.Services.DB.Exec(r.Context(), `UPDATE knowledge SET config=jsonb_set(config,'{excel}',$3::jsonb),updated_at=now() WHERE id=$1 AND current_file_version_id=$2 AND file_type IN ('xls','xlsx','et','ett')`, id, input.FileVersion, raw)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if tag.RowsAffected() != 1 {
			Failure(w, 409, "VERSION_MISMATCH", "文件版本已变化或不是 Excel 文件")
			return
		}
		JSON(w, 200, map[string]any{"excel": input.Excel, "requires_reparse": true})
	})
}

// Old documents get a separate source preview cache. Their parse versions and
// successful results are never backfilled or rewritten by a GET request.
func (s *Server) workbook(r *http.Request) (*sheetManifest, error) {
	id := r.PathValue("id")
	file, parse := r.URL.Query().Get("file_version_id"), r.URL.Query().Get("parse_version_id")
	if uuid.Validate(id) != nil || file != "" && uuid.Validate(file) != nil || parse != "" && uuid.Validate(parse) != nil {
		return nil, fmt.Errorf("文件或解析版本无效")
	}
	var path, ext string
	var metadata, settings map[string]any
	var parseID *string
	err := s.Services.DB.QueryRow(r.Context(), `SELECT f.path,k.file_type,f.id::text,p.id::text,coalesce(p.metadata,'{}'),coalesce((k.config->'excel'),(b.config->'excel'),'{}') FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id JOIN file_versions f ON f.knowledge_id=k.id LEFT JOIN LATERAL(SELECT id,metadata FROM parse_versions WHERE knowledge_id=k.id AND file_version_id=f.id AND ($3='' OR id=nullif($3,'')::uuid) ORDER BY created_at DESC LIMIT 1)p ON true WHERE k.id=$1 AND f.id=coalesce(nullif($2,'')::uuid,(SELECT file_version_id FROM parse_versions WHERE id=nullif($3,'')::uuid AND knowledge_id=k.id),k.current_file_version_id) AND ($3='' OR p.id IS NOT NULL)`, id, file, parse).Scan(&path, &ext, &file, &parseID, &metadata, &settings)
	if err != nil {
		return nil, fmt.Errorf("指定文件或解析版本不存在")
	}
	if !isSpreadsheet(ext) {
		return nil, fmt.Errorf("当前文件不是 XLS/XLSX/ET/ETT")
	}
	data := &sheetManifest{}
	raw, _ := json.Marshal(metadata["spreadsheet"])
	_ = json.Unmarshal(raw, data)
	if data.Path == "" {
		sheetCacheLock.Lock()
		defer sheetCacheLock.Unlock()
		output := filepath.Join(s.Config.DataDir, "derived", id, "spreadsheet-preview-v1-"+file)
		manifest := filepath.Join(output, "spreadsheet", "manifest.json")
		if b, e := os.ReadFile(manifest); e == nil {
			err = json.Unmarshal(b, data)
		} else {
			job := uuid.NewString()
			body, _ := json.Marshal(map[string]any{"job_id": job, "path": path, "output": output, "mode": "spreadsheet", "options": map[string]any{}})
			req, e := http.NewRequestWithContext(r.Context(), "POST", "http://127.0.0.1:8091/parse", bytes.NewReader(body))
			if e != nil {
				return nil, e
			}
			stop := context.AfterFunc(r.Context(), func() {
				c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				b, _ := json.Marshal(map[string]string{"job_id": job})
				q, _ := http.NewRequestWithContext(c, "POST", "http://127.0.0.1:8091/cancel", bytes.NewReader(b))
				resp, e := http.DefaultClient.Do(q)
				if e == nil {
					resp.Body.Close()
				}
			})
			defer stop()
			response, e := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
			if e != nil {
				return nil, fmt.Errorf("工作表预览读取失败")
			}
			defer response.Body.Close()
			var result struct {
				Spreadsheet sheetManifest `json:"spreadsheet"`
				Error       string        `json:"error"`
			}
			if e = json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(&result); e != nil || result.Error != "" {
				if strings.HasPrefix(result.Error, "WPS_") {
					return nil, fmt.Errorf("%s（%s）", jobs.WPSErrorMessage(result.Error), result.Error)
				}
				return nil, fmt.Errorf("工作表结构读取失败：%s", result.Error)
			}
			*data = result.Spreadsheet
		}
	}
	base := filepath.Join(s.Config.DataDir, "derived", id)
	rel, e := filepath.Rel(base, data.Path)
	if err != nil || e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || data.PageRows != 200 || data.Version != 1 {
		return nil, fmt.Errorf("工作表派生数据无效")
	}
	data.FileVersion = file
	data.Settings = settings
	if parseID != nil {
		data.ParseVersion = *parseID
	}
	return data, nil
}

func sheetBounds(value string) (c1, r1, c2, r2 int) {
	parts := strings.Split(value, ":")
	if len(parts) == 1 {
		parts = append(parts, parts[0])
	}
	if len(parts) != 2 {
		return
	}
	parse := func(s string) (c, r int) {
		i := 0
		for i < len(s) && s[i] >= 'A' && s[i] <= 'Z' {
			c = c*26 + int(s[i]-'A'+1)
			i++
		}
		r, _ = strconv.Atoi(s[i:])
		return
	}
	c1, r1 = parse(parts[0])
	c2, r2 = parse(parts[1])
	return
}
func (s *Server) sheetCells(w http.ResponseWriter, r *http.Request) {
	data, err := s.workbook(r)
	if err != nil {
		Failure(w, 422, "SPREADSHEET_UNAVAILABLE", err.Error())
		return
	}
	var sheet *sheetInfo
	for i := range data.Sheets {
		if data.Sheets[i].ID == r.PathValue("sheet_id") {
			sheet = &data.Sheets[i]
			break
		}
	}
	if sheet == nil {
		Failure(w, 404, "NOT_FOUND", "工作表不存在")
		return
	}
	args := map[string]int{"row_start": 1, "column_start": 1, "row_count": 50, "column_count": 20}
	for key, fallback := range args {
		raw := r.URL.Query().Get(key)
		n := fallback
		if raw != "" {
			n, err = strconv.Atoi(raw)
		}
		if err != nil || n < 1 || (key == "row_count" && n > 200) || (key == "column_count" && n > 50) || (key == "column_start" && n > 16384) || n > 200000 {
			Failure(w, 400, "INVALID_ARGUMENT", "工作表范围无效，单次最多 200 行、50 列")
			return
		}
		args[key] = n
	}
	rs, cs := args["row_start"], args["column_start"]
	re, ce := min(sheet.Rows, rs+args["row_count"]-1), min(sheet.Columns, cs+args["column_count"]-1)
	loaded := map[int][]sheetRow{}
	load := func(row int) ([]sheetRow, error) {
		page := (row - 1) / 200
		if v, ok := loaded[page]; ok {
			return v, nil
		}
		exists := false
		for _, p := range sheet.Pages {
			if p == page {
				exists = true
			}
		}
		if !exists {
			loaded[page] = []sheetRow{}
			return loaded[page], nil
		}
		b, e := os.ReadFile(filepath.Join(data.Path, sheet.ID+"-"+strconv.Itoa(page)+".json"))
		if e != nil {
			return nil, e
		}
		var rows []sheetRow
		e = json.Unmarshal(b, &rows)
		loaded[page] = rows
		return rows, e
	}
	selected := map[int]sheetRow{}
	for start := rs; start <= re; start = ((start-1)/200+1)*200 + 1 {
		rows, e := load(start)
		if e != nil {
			Failure(w, 409, "PREVIEW_CACHE_MISSING", "表格预览数据丢失，请重新生成预览")
			return
		}
		for _, row := range rows {
			if row.Row >= rs && row.Row <= re {
				cells := []sheetCell{}
				for _, cell := range row.Cells {
					if cell.Column >= cs && cell.Column <= ce {
						cells = append(cells, cell)
					}
				}
				row.Cells = cells
				selected[row.Row] = row
			}
		}
	}
	rows := []sheetRow{}
	for n := rs; n <= re; n++ {
		row, ok := selected[n]
		if !ok {
			row = sheetRow{Row: n, Cells: []sheetCell{}}
		}
		rows = append(rows, row)
	}
	merged := []any{}
	for _, value := range sheet.Merges {
		c1, r1, c2, r2 := sheetBounds(value)
		if r2 < rs || r1 > re || c2 < cs || c1 > ce {
			continue
		}
		master := sheetCell{}
		source, e := load(r1)
		if e != nil {
			Failure(w, 409, "PREVIEW_CACHE_MISSING", "合并单元格源数据丢失")
			return
		}
		for _, row := range source {
			if row.Row == r1 {
				for _, cell := range row.Cells {
					if cell.Column == c1 {
						master = cell
					}
				}
			}
		}
		merged = append(merged, map[string]any{"range": value, "row_start": r1, "row_end": r2, "column_start": c1, "column_end": c2, "master": master})
	}
	JSON(w, 200, map[string]any{"file_version_id": data.FileVersion, "parse_version_id": data.ParseVersion, "sheet": sheet, "row_start": rs, "column_start": cs, "row_end": re, "column_end": ce, "rows": rows, "merged_ranges": merged})
}
