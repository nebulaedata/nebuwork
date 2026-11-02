package jobs

// Historical whole-page captions remain addressable by source ID, but are not
// document content or picture descriptions in the current retrieval pipeline.
const SemanticSourceSQL = `NOT (s.origin='image_caption' AND coalesce(s.metadata->>'visual_role','')='page_preview')`

// Both understanding and vector indexing must use an actual picture asset.
// A page number does not turn a screenshot into a figure.
const ImageSourceSQL = `EXISTS(SELECT 1 FROM assets a WHERE a.knowledge_id=s.knowledge_id
 AND a.file_version_id=s.file_version_id AND a.path=s.metadata->>'image_path'
 AND a.kind IN ('image','video_frame')
 AND (a.metadata->>'parse_version_id'=s.parse_version_id::text OR NOT a.metadata ? 'parse_version_id'))`

func registerVisualAssets(parsed *Parsed) {
	seen := map[string]bool{}
	for _, asset := range parsed.Assets {
		path, _ := asset["path"].(string)
		seen[path] = true
	}
	for _, block := range parsed.Blocks {
		path, kind, role := block.ImagePath, "image", block.VisualRole
		if block.PreviewImagePath != "" {
			path, kind, role = block.PreviewImagePath, "pdf_page", "page_preview"
		} else if block.Locator["page"] != nil && block.VisualRole != "image_region" {
			kind, role = "pdf_page", "page_preview"
		} else if block.Locator["type"] == "frame" {
			kind = "video_frame"
		}
		if path == "" || seen[path] {
			continue
		}
		parsed.Assets = append(parsed.Assets, map[string]any{
			"kind": kind, "path": path, "visual_role": role, "page": block.Locator["page"],
			"time_ms": block.Locator["time_ms"], "bbox": block.Locator["bbox"],
			"region_id": block.Locator["region_id"], "layout": block.Layout,
		})
		seen[path] = true
	}
}
