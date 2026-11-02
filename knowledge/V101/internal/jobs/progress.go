package jobs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Timing data is separate from resumable stage checkpoints. A new lease starts a
// new trace; completed checkpoints remain visible without invented timestamps.
type WorkProgress struct {
	Sheet         string `json:"sheet,omitempty"`
	SheetIndex    int    `json:"sheet_index,omitempty"`
	Sheets        int    `json:"sheets,omitempty"`
	Retrying      bool   `json:"retrying,omitempty"`
	Batch         int    `json:"batch,omitempty"`
	Batches       int    `json:"batches,omitempty"`
	Attempt       int    `json:"attempt,omitempty"`
	MaxRetries    int    `json:"max_retries,omitempty"`
	FailedBatches int    `json:"failed_batches,omitempty"`
	Unit          string `json:"unit,omitempty"`
	Completed     int    `json:"completed"`
	Total         int    `json:"total,omitempty"`
	Current       int    `json:"current,omitempty"`
	Paragraphs    int    `json:"paragraphs,omitempty"`
	Tables        int    `json:"tables,omitempty"`
}
type WorkSpan struct {
	Name       string        `json:"name"`
	Status     string        `json:"status"`
	StartedAt  time.Time     `json:"started_at"`
	FinishedAt *time.Time    `json:"finished_at,omitempty"`
	Progress   *WorkProgress `json:"progress,omitempty"`
	Children   []*WorkSpan   `json:"children,omitempty"`
	Engine     string        `json:"engine,omitempty"`
}
type Pipeline struct {
	RunID      string      `json:"run_id"`
	Attempt    int         `json:"attempt"`
	StartedAt  time.Time   `json:"started_at"`
	FinishedAt *time.Time  `json:"finished_at,omitempty"`
	Status     string      `json:"status"`
	Stages     []*WorkSpan `json:"stages"`
}

func (t *Task) startPipeline() {
	t.Pipeline = &Pipeline{RunID: t.Owner, Attempt: t.Attempts, StartedAt: time.Now().UTC(), Status: "running", Stages: []*WorkSpan{}}
	t.Checkpoint["pipeline"] = t.Pipeline
}
func closeSpan(s *WorkSpan, status string, now time.Time) {
	if s.Status == "running" {
		s.Status = status
		s.FinishedAt = &now
	}
	for _, child := range s.Children {
		closeSpan(child, status, now)
	}
}
func (t *Task) traceStage(name, status string) *WorkSpan {
	if t.Pipeline == nil {
		t.startPipeline()
	}
	var span *WorkSpan
	for _, s := range t.Pipeline.Stages {
		if s.Name == name {
			span = s
			break
		}
	}
	now := time.Now().UTC()
	if span == nil {
		span = &WorkSpan{Name: name, Status: status, StartedAt: now}
		t.Pipeline.Stages = append(t.Pipeline.Stages, span)
	}
	if status == "running" {
		span.Status = status
		span.FinishedAt = nil
	} else {
		closeSpan(span, status, now)
		span.Status = status
		span.FinishedAt = &now
	}
	t.CurrentStage = name
	return span
}
func (t *Task) finishPipeline(status string) {
	if t.Pipeline == nil {
		return
	}
	now := time.Now().UTC()
	for _, s := range t.Pipeline.Stages {
		closeSpan(s, status, now)
	}
	t.Pipeline.Status = status
	t.Pipeline.FinishedAt = &now
}
func (w *Worker) saveProgress(ctx context.Context, t *Task, force bool) error {
	if !force && time.Since(t.ProgressSaved) < time.Second {
		return nil
	}
	b, _ := json.Marshal(t.Pipeline)
	tag, e := w.Services.DB.Exec(ctx, `UPDATE tasks SET checkpoint=jsonb_set(checkpoint,'{pipeline}',$3::jsonb),updated_at=now() WHERE id=$1 AND owner=$2 AND state='running' AND NOT cancel_requested`, t.ID, t.Owner, b)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return context.Canceled
	}
	t.ProgressSaved = time.Now()
	w.event(ctx, t.ID, map[string]any{"progress": true, "stage": t.CurrentStage})
	return nil
}
func (w *Worker) progress(ctx context.Context, t *Task, name, unit string, completed, total, current int) error {
	span := t.traceStage(t.CurrentStage, "running")
	now := time.Now().UTC()
	var child *WorkSpan
	if n := len(span.Children); n > 0 && span.Children[n-1].Name == name {
		child = span.Children[n-1]
	}
	changed := child == nil
	if changed {
		for _, c := range span.Children {
			closeSpan(c, "succeeded", now)
		}
		child = &WorkSpan{Name: name, Status: "running", StartedAt: now}
		span.Children = append(span.Children, child)
	}
	child.Progress = &WorkProgress{Unit: unit, Completed: completed, Total: total, Current: current}
	if total > 0 && completed == total {
		closeSpan(child, "succeeded", now)
	}
	return w.saveProgress(ctx, t, changed || total > 0 && completed == total)
}
func (w *Worker) readerProgress(ctx context.Context, t *Task, output string) error {
	b, e := os.ReadFile(filepath.Join(output, "progress.json"))
	if e != nil {
		return nil
	}
	if string(b) == t.ReaderSnapshot {
		return nil
	}
	var snapshot struct {
		Engine string      `json:"engine"`
		Phases []*WorkSpan `json:"phases"`
	}
	if json.Unmarshal(b, &snapshot) != nil || len(snapshot.Phases) > 64 {
		return nil
	}
	span := t.traceStage(t.CurrentStage, "running")
	span.Engine = snapshot.Engine
	span.Children = snapshot.Phases
	if e = w.saveProgress(ctx, t, true); e != nil {
		return e
	}
	t.ReaderSnapshot = string(b)
	return nil
}
