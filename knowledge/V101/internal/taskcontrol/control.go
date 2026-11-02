package taskcontrol

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// All expressions use the tasks alias t, including historical deletion tasks
// whose library scope survives in config after the document is removed.
const ScopeSQL = `coalesce(t.knowledge_base_id::text,(SELECT k.knowledge_base_id::text FROM knowledge k WHERE k.id=t.knowledge_id),t.config->>'knowledge_base_id')`
const ReadySQL = `NOT EXISTS(SELECT 1 FROM knowledge_bases b WHERE b.id::text=` + ScopeSQL + ` AND b.tasks_paused)`
const UninterruptedSQL = `NOT EXISTS(SELECT 1 FROM knowledge_bases b WHERE b.id::text=` + ScopeSQL + ` AND (b.tasks_paused OR b.tasks_pause_generation<>t.pause_generation))`
const StateSQL = `CASE WHEN t.cancel_requested THEN t.state WHEN t.state='queued' AND NOT (` + ReadySQL + `) THEN 'paused' WHEN t.state='running' AND NOT (` + UninterruptedSQL + `) THEN 'pausing' ELSE t.state END`
const ProjectionSQL = `to_jsonb(t)||jsonb_build_object('state',` + StateSQL + `,'stored_state',t.state)`

var ErrPaused = errors.New("knowledge library tasks paused")

// Claims and pause/resume serialize on the library row. A pause generation
// survives a fast resume so an old running lease still exits before restarting.
func Claim(ctx context.Context, tx pgx.Tx, taskID string) (int64, error) {
	var paused bool
	var generation int64
	err := tx.QueryRow(ctx, `SELECT b.tasks_paused,b.tasks_pause_generation FROM knowledge_bases b WHERE b.id::text=(SELECT `+ScopeSQL+` FROM tasks t WHERE t.id=$1) FOR SHARE`, taskID).Scan(&paused, &generation)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil // Unscoped maintenance or already deleted library.
	}
	if err != nil {
		return 0, err
	}
	if paused {
		return generation, ErrPaused
	}
	return generation, nil
}
