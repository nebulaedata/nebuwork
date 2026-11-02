package bootstrap

import (
	"context"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/config"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Runs only on the dedicated tests/compose.yaml network.
func TestInfrastructureIntegration(t *testing.T) {
	if os.Getenv("NEBULAEKNO_TEST_INTEGRATION") != "1" {
		t.Skip("isolated middleware required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	values := map[string]string{"DATABASE_URL": "postgres://nebulaekno:integration-only@postgres:5432/nebulaekno_test_bootstrap", "NEO4J_URL": "bolt://neo4j:integration-only@graph:7687", "REDIS_URL": "redis://default:integration-only@redis:6379/0", "DATA_DIR": t.TempDir()}
	cfg, e := config.Parse(func(k string) string { return values[strings.TrimPrefix(k, "NEBULAEKNO_")] })
	if e != nil {
		t.Fatal(e)
	}
	admin, e := pgx.Connect(ctx, "postgres://nebulaekno:integration-only@postgres:5432/postgres")
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close(context.Background())
	_, e = admin.Exec(ctx, "DROP DATABASE IF EXISTS nebulaekno_test_bootstrap WITH (FORCE)")
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(context.Background(), "DROP DATABASE IF EXISTS nebulaekno_test_bootstrap WITH (FORCE)")
	_, e = admin.Exec(ctx, "DROP ROLE IF EXISTS nebulaekno_test_limited; CREATE ROLE nebulaekno_test_limited LOGIN PASSWORD 'integration-limited' NOCREATEDB")
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(context.Background(), "DROP ROLE nebulaekno_test_limited")
	limited := cfg
	limited.DatabaseURL = "postgres://nebulaekno_test_limited:integration-limited@postgres:5432/nebulaekno_test_denied"
	if denied, er := openDatabase(ctx, limited); er == nil {
		denied.Close()
		t.Fatal("missing CREATEDB permission accepted")
	} else if !strings.Contains(er.Error(), "DATABASE_CREATE_DENIED") {
		t.Fatal(er)
	}
	id, e := LoadIdentity(cfg.DataDir)
	if e != nil {
		t.Fatal(e)
	}
	p, e := openDatabase(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	// Two starters must serialize migration, preserving defaults and checksums.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- migrate(ctx, p, cfg, id) }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var tables int
	p.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='nebulaekno'").Scan(&tables)
	if tables < 20 {
		t.Fatalf("missing tables: %d", tables)
	}
	_, e = p.Exec(ctx, `UPDATE settings SET value='{"mode":"keyword"}' WHERE key='retrieval-defaults'`)
	if e != nil {
		t.Fatal(e)
	}
	if e = migrate(ctx, p, cfg, id); e != nil {
		t.Fatal(e)
	}
	var mode string
	p.QueryRow(ctx, "SELECT value->>'mode' FROM settings WHERE key='retrieval-defaults'").Scan(&mode)
	if mode != "keyword" {
		t.Fatal("user settings overwritten")
	}
	var checksum, migrationVersion string
	p.QueryRow(ctx, "SELECT version,checksum FROM schema_migrations ORDER BY version LIMIT 1").Scan(&migrationVersion, &checksum)
	p.Exec(ctx, "UPDATE schema_migrations SET checksum='broken' WHERE version=$1", migrationVersion)
	if e = migrate(ctx, p, cfg, id); e == nil || !strings.Contains(e.Error(), "CHECKSUM") {
		t.Fatalf("checksum not rejected: %v", e)
	}
	p.Exec(ctx, "UPDATE schema_migrations SET checksum=$1 WHERE version=$2", checksum, migrationVersion)
	p.Exec(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES('sql/999_future.sql','unknown')")
	if e = migrate(ctx, p, cfg, id); e == nil || !strings.Contains(e.Error(), "TOO_NEW") {
		t.Fatalf("future version accepted: %v", e)
	}
	p.Exec(ctx, "DELETE FROM schema_migrations WHERE version='sql/999_future.sql'")
	other := id
	other.ID = "00000000-0000-0000-0000-000000000001"
	if e = migrate(ctx, p, cfg, other); e == nil || !strings.Contains(e.Error(), "MISMATCH") {
		t.Fatal("foreign identity accepted", e)
	}
	p.Exec(ctx, "DROP INDEX chunks_search_idx")
	if e = migrate(ctx, p, cfg, id); e == nil || !strings.Contains(e.Error(), "SCHEMA_CONFLICT") {
		t.Fatal("schema drift accepted", e)
	}
	p.Exec(ctx, "CREATE INDEX chunks_search_idx ON chunks USING gin(search_vector)")
	if e = migrate(ctx, p, cfg, id); e != nil {
		t.Fatal(e)
	}
	// PostgreSQL transactional DDL must leave neither data nor a migration marker after interruption.
	interrupted, e := p.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	tx, e := interrupted.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	tx.Exec(ctx, "CREATE TABLE interrupted_step(id integer)")
	tx.Exec(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES('interrupted','incomplete')")
	if _, e = admin.Exec(ctx, "SELECT pg_terminate_backend($1)", interrupted.Conn().PgConn().PID()); e != nil {
		t.Fatal(e)
	}
	_ = tx.Rollback(ctx)
	interrupted.Release()
	var exists bool
	p.QueryRow(ctx, "SELECT to_regclass('nebulaekno.interrupted_step') IS NOT NULL").Scan(&exists)
	if exists {
		t.Fatal("DDL rollback failed")
	}
	if e = migrate(ctx, p, cfg, id); e != nil {
		t.Fatal("restart after interrupted transaction failed", e)
	}
	graph, e := connectGraph(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer graph.Close(context.Background())
	if e = checkGraph(ctx, graph); e != nil {
		t.Fatal(e)
	}
	r, e := connectRedis(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	if e = checkRedis(ctx, r, "nebulaekno:test:"); e != nil {
		t.Fatal(e)
	}
}
