package jobs

import "testing"

func TestRegisterVisualAssets(t *testing.T) {
	p := Parsed{Assets: []map[string]any{{"kind": "image", "path": "embedded.png"}}, Blocks: []Block{
		{ImagePath: "page.png", Locator: map[string]any{"type": "page", "page": 3}},
		{ImagePath: "page.png", Locator: map[string]any{"type": "page", "page": 3, "bbox": []float64{0, 0, .5, .5}}},
		{ImagePath: "embedded.png", Locator: map[string]any{"type": "document"}},
		{ImagePath: "frame.png", Locator: map[string]any{"type": "frame", "time_ms": 1200}},
		{Text: "ordinary text"},
	}}
	registerVisualAssets(&p)
	registerVisualAssets(&p)
	if len(p.Assets) != 3 {
		t.Fatalf("expected one resource per path, got %#v", p.Assets)
	}
	if p.Assets[1]["kind"] != "pdf_page" || p.Assets[1]["page"] != 3 {
		t.Fatalf("page image must retain its locator: %#v", p.Assets[1])
	}
	if p.Assets[2]["kind"] != "video_frame" || p.Assets[2]["time_ms"] != 1200 {
		t.Fatalf("frame must retain its timestamp: %#v", p.Assets[2])
	}
}

func TestCropAndPreviewAreDifferentAssets(t *testing.T) {
	p := Parsed{Blocks: []Block{
		{Text: "text", PreviewImagePath: "page.png", Locator: map[string]any{"type": "page", "page": 1}},
		{ImagePath: "crop.png", BlockType: "image", VisualRole: "image_region", Locator: map[string]any{"type": "image", "page": 1, "bbox": []float64{.1, .2, .3, .4}, "region_id": "page-1-block-2"}},
	}}
	registerVisualAssets(&p)
	if len(p.Assets) != 2 || p.Assets[0]["kind"] != "pdf_page" || p.Assets[1]["kind"] != "image" || p.Assets[1]["visual_role"] != "image_region" || p.Assets[1]["region_id"] != "page-1-block-2" {
		t.Fatalf("crop must not be classified as page screenshot: %#v", p.Assets)
	}
}
func TestTableAndImageBlocksKeepTheirStructure(t *testing.T) {
	table := "<table><tr><td colspan=\"2\">合并单元格</td></tr></table>"
	spans := blockSpans(Block{BlockType: "table", Text: table}, 10, 2)
	if len(spans) != 1 || spans[0].Text != table || spans[0].End != len([]rune(table)) {
		t.Fatalf("table markup or Unicode source offset corrupted: %#v", spans)
	}
	spans = blockSpans(Block{BlockType: "image", Text: "这是一幅图像中的文字"}, 4, 1)
	if len(spans) != 1 {
		t.Fatal("a crop should have one OCR source")
	}
	if len(blockSpans(Block{BlockType: "text", Text: "普通正文继续按配置分块"}, 4, 1)) < 2 {
		t.Fatal("text no longer split")
	}
}
