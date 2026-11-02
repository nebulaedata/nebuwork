package jobs

import (
	"context"
	"fmt"
	"strings"
)

func (w *Worker) ensureVectorIndex(ctx context.Context, space string, dimension int) error {
	if dimension > 2000 {
		return nil
	}
	tx, err := w.Services.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	// IF NOT EXISTS alone can race in PostgreSQL's catalog when multiple documents
	// first use the same model. Serialize creation across workers and containers.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "vector-index:"+space); err != nil {
		return err
	}
	index := "model_vector_" + strings.ReplaceAll(space, "-", "")
	query := fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON embeddings USING hnsw ((embedding::vector(%d)) vector_cosine_ops) WHERE space_id='%s'", index, dimension, space)
	if _, err = tx.Exec(ctx, query); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
