package api

import (
	"encoding/json"
	"testing"
)

func TestProcessingConfigValidation(t *testing.T) {
	for _, test := range []struct {
		body  string
		valid bool
	}{
		{`{"parser_engines":{"pdf":"paddleocr_vl","image":"tesseract","media":"ffmpeg"},"extract_config":{"tags":["设备"],"relations":["连接"]},"image_instructions":"识别铭牌"}`, true},
		{`{"parser_engines":{"pdf":"unsupported"}}`, false},
		{`{"parser_engines":{"media":"paddleocr_vl"}}`, false},
		{`{"parser_engines":null}`, false},
		{`{"image_instructions":123}`, false},
		{`{"extract_config":{"tags":[]}}`, false},
		{`{"extract_config":{"relations":[123]}}`, false},
		{`{"max_frames":241}`, false},
	} {
		var cfg map[string]any
		json.Unmarshal([]byte(test.body), &cfg)
		if (validateParser(cfg) == "") != test.valid {
			t.Errorf("unexpected result for %s", test.body)
		}
	}
}
func TestMergeNilPreservesSettings(t *testing.T) {
	if merge(nil, map[string]any{"enabled": true})["enabled"] != true {
		t.Fatal("missing setting")
	}
}
