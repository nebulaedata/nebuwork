package api

import (
	"nebulaekno/internal/jobs"
	"reflect"
	"testing"
)

func TestGenerationCheckpointSchemas(t *testing.T) {
	graph := schemaOf(reflect.TypeOf(jobs.GraphChunk{}))["properties"].(map[string]any)
	if graph["status"] == nil || graph["attempts"] == nil || graph["WikiBatch"] != nil {
		t.Fatal("embedded fields must match JSON", graph)
	}
	wiki := schemaOf(reflect.TypeOf(jobs.WikiBatch{}))["properties"].(map[string]any)
	pending := wiki["pending_pages"].(map[string]any)
	if len(pending["items"].(map[string]any)) != 0 {
		t.Fatal("raw JSON must not become a byte array")
	}
	attempt := schemaOf(reflect.TypeOf(jobs.WikiAttempt{}))["properties"].(map[string]any)
	if attempt["started_at"].(map[string]any)["format"] != "date-time" {
		t.Fatal(attempt)
	}
}
