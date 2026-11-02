package api

import (
	"strings"
	"testing"
)

func TestGraphSearchAvailability(t *testing.T) {
	for _, tc := range []struct {
		name     string
		coverage GraphSearchCoverage
		ready    bool
		pending  bool
	}{
		{"partial evidence", GraphSearchCoverage{Documents: 1, SyncedRecords: 2, Partial: true}, true, false},
		{"empty completed graph", GraphSearchCoverage{Documents: 1, CompletedDocuments: 1}, true, false},
		{"all chunks failed", GraphSearchCoverage{Documents: 1, Partial: true}, false, false},
		{"only pending sync", GraphSearchCoverage{Documents: 1, PendingSyncRecords: 2, Partial: true}, false, true},
		{"no index", GraphSearchCoverage{}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.coverage.ready()
			if (err == nil) != tc.ready {
				t.Fatalf("ready=%v, error=%v", tc.ready, err)
			}
			if tc.pending && !strings.Contains(err.Error(), "同步") {
				t.Fatal(err)
			}
			warning := tc.coverage.warning()
			if (warning != nil) != tc.coverage.Partial {
				t.Fatal(warning)
			}
			if warning != nil && warning["code"] != "GRAPH_PARTIAL_COVERAGE" {
				t.Fatal(warning)
			}
		})
	}
}
