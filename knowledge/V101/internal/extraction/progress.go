package extraction

import (
	"strings"
	"time"

	"nebulaekno/internal/jobs"
)

// Extraction uses the same timing contract as data processing. Only observed
// work is timed; a new lease starts a fresh trace and reuses saved block data.
type BlockProgress struct {
	RootID       string     `json:"root_id"`
	BlockID      string     `json:"block_id"`
	Phase        string     `json:"phase"`
	Status       string     `json:"status"`
	Attempt      int        `json:"attempt,omitempty"`
	ModelAttempt int        `json:"model_attempt,omitempty"`
	MaxRetries   int        `json:"max_retries,omitempty"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	Error        string     `json:"error,omitempty"`
	Reused       bool       `json:"reused,omitempty"`
}

type ExtractionProgress struct {
	Stage           string          `json:"stage"`
	UpdatedAt       time.Time       `json:"updated_at"`
	TotalBlocks     int             `json:"total_blocks"`
	CompletedBlocks int             `json:"completed_blocks"`
	FailedBlocks    int             `json:"failed_blocks"`
	SkippedBlocks   int             `json:"skipped_blocks"`
	ReusedBlocks    int             `json:"reused_blocks"`
	Records         int             `json:"records"`
	NeedsReview     int             `json:"needs_review"`
	ActiveBlocks    []BlockProgress `json:"active_blocks"`
	RecentBlocks    []BlockProgress `json:"recent_blocks"`
}

type extractionTrace struct {
	Pipeline *jobs.Pipeline
	Progress ExtractionProgress
	reused   map[string]bool
	skipped  map[string]bool
}

func newExtractionTrace(owner string, attempt int) *extractionTrace {
	return &extractionTrace{
		Pipeline: &jobs.Pipeline{RunID: owner, Attempt: attempt, StartedAt: time.Now().UTC(), Status: "running", Stages: []*jobs.WorkSpan{}},
		Progress: ExtractionProgress{ActiveBlocks: []BlockProgress{}, RecentBlocks: []BlockProgress{}},
		reused:   map[string]bool{}, skipped: map[string]bool{},
	}
}

func (t *extractionTrace) stage(name, status string, now time.Time) {
	t.Progress.Stage = name
	var span *jobs.WorkSpan
	for _, s := range t.Pipeline.Stages {
		if s.Name == name {
			span = s
			break
		}
	}
	if span == nil {
		span = &jobs.WorkSpan{Name: name, StartedAt: now}
		t.Pipeline.Stages = append(t.Pipeline.Stages, span)
	}
	span.Status = status
	if status != "running" {
		span.FinishedAt = &now
	}
}

func (t *extractionTrace) apply(event map[string]any, now time.Time) {
	t.Progress.UpdatedAt = now
	kind, _ := event["event"].(string)
	if kind == "phase" {
		name, _ := event["stage"].(string)
		status, _ := event["status"].(string)
		t.stage(name, status, now)
	}
	if kind != "block_progress" && kind != "block_done" {
		return
	}
	root, _ := event["root_id"].(string)
	if root == "" || strings.Contains(root, ":") {
		return
	}
	i := -1
	for n := range t.Progress.ActiveBlocks {
		if t.Progress.ActiveBlocks[n].RootID == root {
			i = n
			break
		}
	}
	b := BlockProgress{RootID: root, BlockID: root, Status: "running"}
	if kind == "block_progress" {
		b.StartedAt = &now
	}
	if i >= 0 {
		b = t.Progress.ActiveBlocks[i]
	}
	if id, ok := event["block_id"].(string); ok {
		b.BlockID = id
	}
	if phase, ok := event["phase"].(string); ok {
		b.Phase = phase
		if phase == "block_attempt" {
			b.ModelAttempt = 0
			b.Error = ""
		}
	}
	if attempt, ok := event["attempt"].(float64); ok {
		b.Attempt = int(attempt)
	}
	if retries, ok := event["max_retries"].(float64); ok {
		b.MaxRetries = int(retries)
	}
	if attempt, ok := event["model_attempt"].(float64); ok {
		b.ModelAttempt = int(attempt)
	}
	if message, ok := event["error"].(string); ok {
		b.Error = message
	}
	if kind == "block_progress" {
		if i < 0 {
			t.Progress.ActiveBlocks = append(t.Progress.ActiveBlocks, b)
		} else {
			t.Progress.ActiveBlocks[i] = b
		}
		return
	}
	b.Status, _ = event["status"].(string)
	b.Reused, _ = event["reused"].(bool)
	if b.Reused {
		b.StartedAt = nil
		t.reused[root] = true
	} else {
		b.FinishedAt = &now
	}
	if skipped, _ := event["skipped"].(bool); skipped {
		t.skipped[root] = true
	}
	if i >= 0 {
		t.Progress.ActiveBlocks = append(t.Progress.ActiveBlocks[:i], t.Progress.ActiveBlocks[i+1:]...)
	}
	for n := range t.Progress.RecentBlocks {
		if t.Progress.RecentBlocks[n].RootID == root {
			t.Progress.RecentBlocks = append(t.Progress.RecentBlocks[:n], t.Progress.RecentBlocks[n+1:]...)
			break
		}
	}
	t.Progress.RecentBlocks = append(t.Progress.RecentBlocks, b)
	if len(t.Progress.RecentBlocks) > 20 {
		t.Progress.RecentBlocks = t.Progress.RecentBlocks[len(t.Progress.RecentBlocks)-20:]
	}
	t.Progress.ReusedBlocks, t.Progress.SkippedBlocks = len(t.reused), len(t.skipped)
}

func (t *extractionTrace) counts() {
	for _, span := range t.Pipeline.Stages {
		if span.Name == "extraction_blocks" {
			span.Progress = &jobs.WorkProgress{Unit: "block", Completed: t.Progress.CompletedBlocks, Total: t.Progress.TotalBlocks, FailedBatches: t.Progress.FailedBlocks}
		}
	}
}

func (t *extractionTrace) finish(status string, now time.Time) {
	t.Pipeline.Status, t.Pipeline.FinishedAt = status, &now
	for _, span := range t.Pipeline.Stages {
		if span.Status == "running" {
			span.Status, span.FinishedAt = status, &now
			// Review flags affect the run, not successful final persistence.
			if span.Name == "extraction_save" && (status == "succeeded" || status == "partially_failed") {
				span.Status = "succeeded"
			}
		}
	}
	for i := range t.Progress.ActiveBlocks {
		t.Progress.ActiveBlocks[i].Status = status
		t.Progress.ActiveBlocks[i].FinishedAt = &now
	}
	t.Progress.RecentBlocks = append(t.Progress.RecentBlocks, t.Progress.ActiveBlocks...)
	if len(t.Progress.RecentBlocks) > 20 {
		t.Progress.RecentBlocks = t.Progress.RecentBlocks[len(t.Progress.RecentBlocks)-20:]
	}
	t.Progress.ActiveBlocks = []BlockProgress{}
	t.Progress.UpdatedAt = now
}
