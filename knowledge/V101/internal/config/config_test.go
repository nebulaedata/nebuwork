package config

import (
	"strings"
	"testing"
)

func base() map[string]string {
	return map[string]string{"DATABASE_URL": "postgresql://app:secret%40pass@db:5432/nebulaekno", "NEO4J_URL": "bolt://neo4j:secret@graph:7687", "REDIS_URL": "redis://default:secret@redis:6379/0"}
}
func TestConfig(t *testing.T) {
	for _, tt := range []struct {
		name, key, value string
		bad              bool
	}{
		{"valid", "", "", false}, {"archive depth", "ARCHIVE_MAX_DEPTH", "0", true}, {"archive entries", "ARCHIVE_MAX_FILES", "100001", true}, {"archive size", "ARCHIVE_MAX_EXPANDED_MIB", "-1", true}, {"archive upload", "ARCHIVE_MAX_UPLOAD_MIB", "many", true}, {"missing", "DATABASE_URL", "", true}, {"system db", "DATABASE_URL", "postgres://a:b@db/postgres", true}, {"db override", "DATABASE_URL", "postgres://a:b@db/app?dbname=postgres", true}, {"neo db", "NEO4J_URL", "neo4j://a:b@g/custom", true}, {"redis db", "REDIS_URL", "redis://r/2", true}, {"redis override", "REDIS_URL", "redis://r/0?db=1", true}, {"bad port", "PORT", "0", true}, {"bad workers", "DOCUMENT_WORKERS", "-1", true}, {"bad directory", "DATA_DIR", "relative", true}, {"password punctuation", "DATABASE_URL", "postgres://a:p%40ss%3A%2F%3F%23@db/app", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			m := base()
			if tt.key != "" {
				m[tt.key] = tt.value
			}
			c, e := Parse(func(k string) string { return m[strings.TrimPrefix(k, "NEBULAEKNO_")] })
			if (e != nil) != tt.bad {
				t.Fatalf("unexpected result: %v", e)
			}
			if e != nil && strings.Contains(e.Error(), "secret") {
				t.Fatal("secret leaked")
			}
			if e == nil && c.DocumentWorkers != 2 {
				t.Fatal("default missing")
			}
		})
	}
}
func TestRedaction(t *testing.T) {
	got := Redacted("postgres://name:secret@db/app?password=another")
	if got != "postgres://db/app" {
		t.Fatal(got)
	}
}

func TestUploadSizeUnitsAndCompatibility(t *testing.T) {
	for _, tt := range []struct {
		name, mib, mb string
		want          int64
		bad           bool
	}{
		{"default 2 GiB", "", "", 2 << 30, false},
		{"binary limit", "768", "", 768 << 20, false},
		{"legacy decimal limit", "", "100", 100000000, false},
		{"binary wins", "2048", "100", 2 << 30, false},
		{"invalid binary", "none", "", 0, true},
		{"zero binary", "0", "", 0, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			m := base()
			m["MAX_UPLOAD_MIB"] = tt.mib
			m["MAX_UPLOAD_MB"] = tt.mb
			c, err := Parse(func(k string) string { return m[strings.TrimPrefix(k, "NEBULAEKNO_")] })
			if tt.bad {
				if err == nil {
					t.Fatal("expected invalid limit")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if c.MaxUpload != tt.want {
				t.Fatalf("got %d want %d", c.MaxUpload, tt.want)
			}
		})
	}
}
