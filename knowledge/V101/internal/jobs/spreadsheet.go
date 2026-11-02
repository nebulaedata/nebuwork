package jobs

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type TableContext struct {
	Text    string         `json:"text"`
	Locator map[string]any `json:"locator"`
}

// Supplemental header/merge evidence has structural positions, not fabricated
// offsets into the body's serialization. Its own source remains resolvable.
func saveTableContext(ctx context.Context, tx pgx.Tx, knowledge, file, version string, b Block) ([]string, error) {
	ids := []string{}
	for _, item := range b.ContextSources {
		id := uuid.NewString()
		loc, _ := json.Marshal([]any{item.Locator})
		_, err := tx.Exec(ctx, `INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) VALUES($1,$2,$3,$4,$5,$6,'range',0,0,$7,'{"supplemental_context":true}')`, id, knowledge, file, version, loc, item.Text, b.Method)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
