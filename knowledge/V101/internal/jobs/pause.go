package jobs

import "time"

// A pause is not a failed model attempt. Preserve prior validation failures,
// successful batches and accepted partial output, refunding only an unfinished
// in-flight request. Its interruption remains in the audit history.
func suspendBatch(b *WikiBatch, now time.Time) bool {
	if b.Status != "running" || len(b.History) == 0 {
		return false
	}
	last := &b.History[len(b.History)-1]
	if last.FinishedAt != nil {
		return false
	}
	last.FinishedAt = &now
	last.Error = &WikiFailure{Code: "TASK_PAUSED", Message: "用户暂停任务，已保留检查点；此次中断不消耗失败重试次数"}
	if b.Attempts > 0 {
		b.Attempts--
	}
	b.Status = "pending"
	return true
}

func suspendedLedgers(cp map[string]any) map[string]any {
	updates := map[string]any{}
	now := time.Now().UTC()
	if wiki, e := LoadWikiPlan(cp["wiki_batches"]); e == nil && wiki != nil {
		changed := false
		for i := range wiki.Batches {
			changed = suspendBatch(&wiki.Batches[i], now) || changed
		}
		if changed {
			updates["wiki_batches"] = wiki
		}
	}
	if graph, e := LoadGraphPlan(cp["graph_batches"]); e == nil && graph != nil {
		changed := false
		for i := range graph.Batches {
			changed = suspendBatch(&graph.Batches[i].WikiBatch, now) || changed
		}
		if changed {
			updates["graph_batches"] = graph
		}
	}
	return updates
}
