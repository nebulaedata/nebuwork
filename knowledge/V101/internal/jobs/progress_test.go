package jobs

import (
	"encoding/json"
	"testing"
	"time"
)

func TestPipelineLeaseAndTerminalStates(t *testing.T) {
	for _, status := range []string{"failed", "cancelled", "queued", "waiting_configuration", "succeeded"} {
		t.Run(status, func(t *testing.T) {
			task := &Task{Owner: "lease-1", Attempts: 1, Checkpoint: map[string]any{"outline": "succeeded"}}
			task.startPipeline()
			parse := task.traceStage("parse", "running")
			start := parse.StartedAt
			parse.Children = []*WorkSpan{{Name: "paddle_pages", Status: "running", StartedAt: start, Progress: &WorkProgress{Unit: "page", Completed: 2, Total: 9, Current: 3}}}
			task.traceStage("parse", "running")
			if !parse.StartedAt.Equal(start) {
				t.Fatal("progress must not reset start time")
			}
			task.finishPipeline(status)
			if parse.Status != status || parse.Children[0].Status != status || parse.Children[0].FinishedAt == nil {
				t.Fatal("active spans must stop with the task")
			}
			if parse.Children[0].Progress.Completed != 2 {
				t.Fatal("terminal state must not fabricate completion counts")
			}
			previousEnd := *parse.FinishedAt
			task.finishPipeline(status)
			if !parse.FinishedAt.Equal(previousEnd) {
				t.Fatal("finished stage time changed")
			}
			if _, e := json.Marshal(task.Checkpoint); e != nil {
				t.Fatal(e)
			}
			task.Owner = "lease-2"
			task.Attempts = 2
			task.startPipeline()
			if task.Pipeline.RunID != "lease-2" || len(task.Pipeline.Stages) != 0 || task.Checkpoint["outline"] != "succeeded" {
				t.Fatal("retry must get fresh timings while preserving resumable work")
			}
		})
	}
}
func TestPipelineDoesNotOverwriteFinishedChildren(t *testing.T) {
	task := &Task{Checkpoint: map[string]any{}}
	task.startPipeline()
	span := task.traceStage("parse", "running")
	now := time.Now().UTC()
	span.Children = []*WorkSpan{{Name: "extract", Status: "succeeded", StartedAt: now, FinishedAt: &now}, {Name: "preview", Status: "failed", StartedAt: now, FinishedAt: &now}}
	task.traceStage("parse", "succeeded")
	if span.Children[1].Status != "failed" {
		t.Fatal("optional phase failure was hidden")
	}
}
