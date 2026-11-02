package api

import (
	"nebulaekno/internal/jobs"
	"net/http"
)

// Visuals are bound to both the file and parse version. Legacy assets without a
// parse ID are usable only when that parse has a matching source reference.
const visualVersionJoin = `a.knowledge_id=p.knowledge_id AND a.file_version_id=p.file_version_id AND
 (a.metadata->>'parse_version_id'=p.id::text OR (NOT a.metadata ? 'parse_version_id' AND EXISTS(
 SELECT 1 FROM source_refs s WHERE s.parse_version_id=p.id AND s.metadata->>'image_path'=a.path)))`
const visualKinds = `a.kind IN ('image','video_frame')`

// Preserve Unicode offsets and the immutable parse text. Only version-bound,
// registered local assets are exposed; captions are not original content.
const contentImageOccurrences = `coalesce((SELECT jsonb_agg(item ORDER BY start_pos) FROM (
 SELECT DISTINCT ON (a.id,s.locators) s.char_start AS start_pos,
 jsonb_build_object('char_start',s.char_start,'char_end',s.char_end,
 'reference_only',coalesce((s.metadata->'layout'->>'reference_only')::boolean,false),
 'unplaced',coalesce((s.metadata->'layout'->>'unplaced')::boolean,
   s.locators->0->>'type'='document' AND NOT (s.locators->0 ? 'parsed_block') AND NOT (coalesce(s.metadata->'layout','{}'::jsonb) ? 'asset_id')),
 'images',jsonb_build_array(jsonb_build_object('id',a.id,'kind',a.kind,'metadata',a.metadata-'path',
 'content_url','/api/v1/images/'||a.id||'/content','source_ref_id',s.id,'locators',s.locators,
 'file_version_id',a.file_version_id,'parse_version_id',p.id))) AS item
 FROM assets a JOIN source_refs s ON s.metadata->>'image_path'=a.path
 AND s.knowledge_id=a.knowledge_id AND s.file_version_id=a.file_version_id AND s.parse_version_id=p.id
 WHERE ` + visualVersionJoin + ` AND ` + visualKinds + ` AND s.origin NOT IN ('image_caption','frame_caption')
 ORDER BY a.id,s.locators,s.char_start,s.id
 ) occurrences),'[]'::jsonb)`
const visualSourceMatch = `s.knowledge_id=a.knowledge_id AND s.file_version_id=a.file_version_id AND s.parse_version_id=p.id AND s.metadata->>'image_path'=a.path`
const visualJSON = `jsonb_build_object(
 'id',a.id,'knowledge_id',a.knowledge_id,'file_version_id',a.file_version_id,'parse_version_id',p.id,
 'name',k.name,'kind',a.kind,'metadata',a.metadata-'path','content_url','/api/v1/images/'||a.id||'/content',
 'source_ref_id',(SELECT s.id FROM source_refs s WHERE ` + visualSourceMatch + ` ORDER BY (s.origin IN ('image_caption','frame_caption')),s.char_start,s.id LIMIT 1),
 'locators',coalesce((SELECT s.locators FROM source_refs s WHERE ` + visualSourceMatch + ` ORDER BY (s.origin IN ('image_caption','frame_caption')),s.char_start,s.id LIMIT 1),'[]'),
 'caption_ready',EXISTS(SELECT 1 FROM source_refs s WHERE ` + visualSourceMatch + ` AND s.origin IN ('image_caption','frame_caption')))`
const visualFrom = ` FROM assets a JOIN parse_versions p ON ` + visualVersionJoin + ` JOIN knowledge k ON k.id=a.knowledge_id `
const visualDetailJSON = visualJSON + ` || jsonb_build_object(
 '_ocr_blocks',coalesce((SELECT jsonb_agg(b ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.metadata->'blocks')='array' THEN p.metadata->'blocks' ELSE '[]'::jsonb END) WITH ORDINALITY AS blocks(b,n)
 WHERE b->>'image_path'=a.path AND coalesce(b->>'text','')<>''),'[]'),
 'recognized_text',coalesce((SELECT string_agg(b->>'text',E'\n' ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.metadata->'blocks')='array' THEN p.metadata->'blocks' ELSE '[]'::jsonb END) WITH ORDINALITY AS blocks(b,n)
 WHERE b->>'image_path'=a.path AND coalesce(b->>'text','')<>''),''),
 'source_refs',coalesce((SELECT jsonb_agg(jsonb_build_object('source_ref_id',s.id,'origin',s.origin,'quote',s.quote,
 'locators',s.locators,'char_start',s.char_start,'char_end',s.char_end,'generated_text',s.metadata->>'generated_text','model_id',s.metadata->>'model_id')
 ORDER BY s.char_start,s.id) FROM source_refs s WHERE ` + visualSourceMatch + `),'[]'))`

// Keep the existing chunk fields; append version-safe image references without
// returning parser paths or guessing image associations from neighboring chunks.
const chunkVisualQuery = `SELECT to_jsonb(c)||jsonb_build_object('char_start',s.char_start,'char_end',s.char_end,'content_origin',s.origin,'block_type',s.metadata->>'block_type','context_source_ref_ids',coalesce(s.metadata->'context_source_ref_ids','[]'::jsonb),'layout',s.metadata->'layout','locators',s.locators,'images',coalesce((
 SELECT jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'metadata',a.metadata-'path','content_url','/api/v1/images/'||a.id||'/content','locators',image_source.locators,'source_ref_id',image_source.id,
 'file_version_id',a.file_version_id,'parse_version_id',c.parse_version_id) ORDER BY a.id)
 FROM assets a JOIN LATERAL(SELECT pic.id,pic.locators FROM source_refs pic WHERE pic.parse_version_id=c.parse_version_id AND pic.metadata->>'image_path'=a.path AND pic.origin NOT IN ('image_caption','frame_caption') ORDER BY (pic.id=s.id) DESC,((pic.locators->0->>'sheet_id'=s.locators->0->>'sheet_id' AND (pic.locators->0->>'row_start')::int BETWEEN (s.locators->0->>'row_start')::int AND (s.locators->0->>'row_end')::int) IS TRUE) DESC,pic.char_start,pic.id LIMIT 1) image_source ON true WHERE a.knowledge_id=c.knowledge_id AND a.file_version_id=s.file_version_id
 AND (a.path=s.metadata->>'image_path' OR (s.metadata->>'block_type'='spreadsheet' AND s.locators->0->>'mapping'='exact' AND EXISTS(SELECT 1 FROM source_refs pic WHERE pic.parse_version_id=c.parse_version_id AND pic.metadata->>'image_path'=a.path AND pic.locators->0->>'mapping'='exact' AND pic.locators->0->>'sheet_id'=s.locators->0->>'sheet_id' AND (pic.locators->0->>'row_start')::int BETWEEN (s.locators->0->>'row_start')::int AND (s.locators->0->>'row_end')::int))) AND ` + visualKinds + `
 AND (a.metadata->>'parse_version_id'=c.parse_version_id::text OR NOT a.metadata ? 'parse_version_id')),'[]'))
 FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id WHERE c.parse_version_id=$1 AND ` + jobs.SemanticSourceSQL + ` ORDER BY c.ordinal LIMIT $2 OFFSET $3`

func (s *Server) visualRoutes() {
	s.handle("GET /api/v1/knowledge-bases/{id}/images", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		where := ` WHERE k.knowledge_base_id=$1 AND p.id=k.current_parse_version_id AND a.file_version_id=k.current_file_version_id AND ` + visualKinds
		s.page(w, r, `SELECT `+visualJSON+visualFrom+where+` ORDER BY k.created_at DESC,k.id,coalesce((a.metadata->>'page')::int,0),coalesce((a.metadata->>'time_ms')::bigint,0),coalesce((a.metadata->'layout'->>'index')::int,0),a.id LIMIT $2 OFFSET $3`, `SELECT count(*)`+visualFrom+where, id)
	})
	s.handle("GET /api/v1/knowledge/{id}/images", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version, ok := s.selectedParse(w, r, id)
		if !ok {
			return
		}
		where := ` WHERE p.id=$1 AND ` + visualKinds
		s.page(w, r, `SELECT `+visualJSON+visualFrom+where+` ORDER BY coalesce((a.metadata->>'page')::int,0),coalesce((a.metadata->>'time_ms')::bigint,0),coalesce((a.metadata->'layout'->>'index')::int,0),a.id LIMIT $2 OFFSET $3`, `SELECT count(*)`+visualFrom+where, version)
	})
	s.handle("GET /api/v1/images/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.oneView(w, r, imageOCRView, `SELECT `+visualDetailJSON+visualFrom+` WHERE a.id=$1 AND `+visualKinds+` ORDER BY p.created_at DESC LIMIT 1`, id)
	})
}
