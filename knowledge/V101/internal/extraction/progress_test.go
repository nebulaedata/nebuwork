package extraction

import (
	"fmt"
	"testing"
	"time"
)

func TestExtractionTraceParallelAndIdempotent(t *testing.T) {
	trace := newExtractionTrace("lease", 2)
	now := time.Now().UTC()
	trace.apply(map[string]any{"event": "phase", "stage": "extraction_blocks", "status": "running"}, now)
	for _, id := range []string{"b1", "b2"} {
		trace.apply(map[string]any{"event": "block_progress", "root_id": id, "block_id": id, "phase": "v3_extract", "attempt": float64(1)}, now)
	}
	trace.apply(map[string]any{"event": "block_progress", "root_id": "b1", "block_id": "b1:a", "phase": "validation", "attempt": float64(2)}, now.Add(time.Second))
	if len(trace.Progress.ActiveBlocks) != 2 || trace.Progress.ActiveBlocks[0].BlockID != "b1:a" {
		t.Fatal(trace.Progress)
	}
	for i := 0; i < 2; i++ {
		trace.apply(map[string]any{"event": "block_done", "root_id": "b1", "block_id": "b1", "phase": "reused", "status": "succeeded", "reused": true}, now.Add(2*time.Second))
	}
	if trace.Progress.ReusedBlocks != 1 || len(trace.Progress.RecentBlocks) != 1 || len(trace.Progress.ActiveBlocks) != 1 {
		t.Fatal(trace.Progress)
	}
	if trace.Progress.RecentBlocks[0].StartedAt != nil {
		t.Fatal("replayed blocks must not invent timing")
	}
	trace.Progress.TotalBlocks, trace.Progress.CompletedBlocks = 2, 1
	trace.counts()
	if trace.Pipeline.Stages[0].Progress.Total != 2 {
		t.Fatal(trace.Pipeline)
	}
	trace.finish("cancelled", now.Add(3*time.Second))
	if trace.Pipeline.Status != "cancelled" || len(trace.Progress.ActiveBlocks) != 0 || trace.Progress.RecentBlocks[1].Status != "cancelled" {
		t.Fatal(trace)
	}
}

func TestExtractionTraceReviewAndFreshAttempt(t *testing.T) {
	trace := newExtractionTrace("attempt1", 1)
	now := time.Now().UTC()
	trace.stage("extraction_save", "running", now)
	trace.finish("partially_failed", now.Add(time.Second))
	if trace.Pipeline.Status != "partially_failed" || trace.Pipeline.Stages[0].Status != "succeeded" {
		t.Fatal(trace)
	}
	fresh := newExtractionTrace("attempt2", 2)
	if len(fresh.Pipeline.Stages) != 0 || fresh.Pipeline.RunID == trace.Pipeline.RunID {
		t.Fatal("attempt timings must be independent")
	}
	for i := 0; i < 30; i++ {
		fresh.apply(map[string]any{"event": "block_done", "root_id": fmt.Sprint(i), "status": "succeeded"}, now)
	}
	if len(fresh.Progress.RecentBlocks) != 20 {
		t.Fatal("progress payload must stay bounded")
	}
}
