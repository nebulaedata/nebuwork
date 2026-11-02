package api

import (
	"encoding/json"
	"testing"
)

func TestExcelSettingsValidation(t *testing.T) {
	for _, raw := range []string{`{"excel":{"header_rows":[],"sheets":{"设备清单":{"header_rows":[1,2]}}}}`, `{"excel":{"header_rows":[1]}}`} {
		var v map[string]any
		json.Unmarshal([]byte(raw), &v)
		if msg := validateParser(v); msg != "" {
			t.Fatal(msg)
		}
	}
	for _, raw := range []string{`{"excel":null}`, `{"excel":{"header_rows":[0]}}`, `{"excel":{"header_rows":[1,1]}}`, `{"excel":{"header_rows":[1.5]}}`, `{"excel":{"header_rows":["1"]}}`, `{"excel":{"sheets":{"工作表":{}}}}`, `{"excel":{"unexpected":true}}`} {
		var v map[string]any
		json.Unmarshal([]byte(raw), &v)
		if validateParser(v) == "" {
			t.Fatal("accepted invalid settings", raw)
		}
	}
}
func TestSheetBounds(t *testing.T) {
	c1, r1, c2, r2 := sheetBounds("AA12:BC25")
	if c1 != 27 || r1 != 12 || c2 != 55 || r2 != 25 {
		t.Fatal(c1, r1, c2, r2)
	}
}
