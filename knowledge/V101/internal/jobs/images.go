package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/defaults"
	"nebulaekno/internal/textutil"
	"strings"
)

type imageSource struct {
	SourceID, KnowledgeID, FileID, ParseID, Path, Precision string
	Locators                                                json.RawMessage
}

func (w *Worker) imageSources(ctx context.Context, t *Task) ([]imageSource, error) {
	rows, e := w.Services.DB.Query(ctx, `SELECT DISTINCT ON (s.metadata->>'image_path') s.id::text,s.knowledge_id::text,s.file_version_id::text,s.parse_version_id::text,s.metadata->>'image_path',s.precision,s.locators FROM source_refs s JOIN knowledge k ON k.current_parse_version_id=s.parse_version_id WHERE k.id=$1 AND s.parse_version_id::text=$2 AND coalesce(s.metadata->>'image_path','')<>'' AND s.origin NOT IN ('image_caption','frame_caption') AND `+ImageSourceSQL+` ORDER BY s.metadata->>'image_path',s.char_start`, t.KnowledgeID, t.Checkpoint["parse_version_id"])
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []imageSource{}
	for rows.Next() {
		var v imageSource
		if e = rows.Scan(&v.SourceID, &v.KnowledgeID, &v.FileID, &v.ParseID, &v.Path, &v.Precision, &v.Locators); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (w *Worker) captionImages(ctx context.Context, t *Task) error {
	images, e := w.imageSources(ctx, t)
	if e != nil || len(images) == 0 {
		return e
	}
	m, e := ai.Bound(ctx, w.Services, "vision", t.Config)
	if e != nil {
		return e
	}
	for index, v := range images {
		if e := w.progress(ctx, t, "describe_images", "image", index, len(images), index+1); e != nil {
			return e
		}
		if v.Precision == "frame" && !Bool(t.Config, "frame_caption", true) {
			continue
		}
		source := uuid.NewSHA1(uuid.NameSpaceOID, []byte(v.ParseID+":"+v.Path+":caption")).String()
		var exists bool
		if e = w.Services.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM source_refs WHERE id=$1)", source).Scan(&exists); e != nil {
			return e
		}
		if exists {
			continue
		}
		image, e := ai.ImageData(v.Path)
		if e != nil {
			return e
		}
		prompt, _ := t.Config["image_instructions"].(string)
		if strings.TrimSpace(prompt) == "" {
			prompt = defaults.ImageInstructions
		}
		text, e := ai.Chat(ctx, m, prompt, []string{image})
		if e != nil {
			return e
		}
		origin := "image_caption"
		if v.Precision == "frame" {
			origin = "frame_caption"
		}
		meta, _ := json.Marshal(map[string]any{"image_path": v.Path, "derived_from": v.SourceID, "model_id": m.ID, "generated_text": text, "block_type": "image"})
		tx, e := w.Services.DB.Begin(ctx)
		if e != nil {
			return e
		}
		if e = Owned(ctx, tx, t); e != nil {
			tx.Rollback(ctx)
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) VALUES($1,$2,$3,$4,$5,'',$6,0,0,$7,$8) ON CONFLICT DO NOTHING`, source, v.KnowledgeID, v.FileID, v.ParseID, v.Locators, v.Precision, origin, meta)
		if e == nil {
			_, e = tx.Exec(ctx, `INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) SELECT $1,$2,$3,$4,coalesce(max(ordinal),-1)+1,$5,to_tsvector('simple',$6) FROM chunks WHERE parse_version_id=$3 ON CONFLICT(id) DO NOTHING`, source, v.KnowledgeID, v.ParseID, source, text, textutil.Tokens(text))
		}
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
	}
	return w.progress(ctx, t, "describe_images", "image", len(images), len(images), 0)
}
func (w *Worker) embedImages(ctx context.Context, t *Task) error {
	images, e := w.imageSources(ctx, t)
	if e != nil || len(images) == 0 {
		return e
	}
	m, e := ai.Bound(ctx, w.Services, "multimodal_embedding", t.Config)
	if e != nil {
		return e
	}
	for index, v := range images {
		if e := w.progress(ctx, t, "embed_images", "image", index, len(images), index+1); e != nil {
			return e
		}
		image, e := ai.ImageData(v.Path)
		if e != nil {
			return e
		}
		vectors, e := ai.Embeddings(ctx, m, []any{map[string]string{"image": image}})
		if e != nil {
			return e
		}
		dim := len(vectors[0])
		hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d", m.BaseURL, m.ModelName, dim)))
		signature := hex.EncodeToString(hash[:])
		space := uuid.NewSHA1(uuid.NameSpaceOID, []byte(m.ID+signature+":image")).String()
		tx, e := w.Services.DB.Begin(ctx)
		if e != nil {
			return e
		}
		if e = Owned(ctx, tx, t); e != nil {
			tx.Rollback(ctx)
			return e
		}
		_, e = tx.Exec(ctx, "INSERT INTO embedding_spaces(id,model_id,dimension,kind,config_hash) VALUES($1,$2,$3,'image',$4) ON CONFLICT DO NOTHING", space, m.ID, dim, signature)
		if e == nil {
			_, e = tx.Exec(ctx, "INSERT INTO embeddings(id,space_id,source_ref_id,embedding) VALUES($1,$2,$3,$4::vector) ON CONFLICT(space_id,source_ref_id) DO UPDATE SET embedding=excluded.embedding", uuid.NewString(), space, v.SourceID, VectorLiteral(vectors[0]))
		}
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
		if e = w.ensureVectorIndex(ctx, space, dim); e != nil {
			return e
		}
	}
	return w.progress(ctx, t, "embed_images", "image", len(images), len(images), 0)
}
func graphPrompt(cfg map[string]any) string {
	b, _ := json.Marshal(cfg["extract_config"])
	return "请遵循抽取配置（示例不是事实）：" + string(b) + "\n"
}
func wikiPrompt(cfg map[string]any) string {
	b, _ := json.Marshal(cfg["wiki_config"])
	return "Wiki 配置：" + string(b) + "\n"
}
