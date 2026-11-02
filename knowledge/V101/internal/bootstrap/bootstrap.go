package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"nebulaekno/internal/config"
	"time"
)

type Services struct {
	DB       *pgxpool.Pool
	Graph    neo4j.Driver
	Redis    *redis.Client
	Identity Identity
	Prefix   string
}

func (s *Services) Close() {
	if s.Redis != nil {
		s.Redis.Close()
	}
	if s.Graph != nil {
		ctx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		s.Graph.Close(ctx)
	}
	if s.DB != nil {
		s.DB.Close()
	}
}
func retry(ctx context.Context, c config.Config, fn func(context.Context) error) error {
	deadline := time.Now().Add(c.ConnectWindow)
	attempt := 0
	for {
		attempt++
		probe, cancel := context.WithTimeout(ctx, c.ConnectTimeout)
		e := fn(probe)
		cancel()
		if e == nil {
			return nil
		}
		var ce *config.Error
		if !errors.As(e, &ce) || !ce.Retryable || time.Now().After(deadline) {
			return e
		}
		slog.Warn("依赖连接重试", "component", ce.Component, "attempt", attempt, "code", ce.Code)
		select {
		case <-ctx.Done():
			return e
		case <-time.After(time.Second):
		}
	}
}
func Initialize(ctx context.Context, c config.Config, state *State) (services *Services, err error) {
	ctx, cancel := context.WithTimeout(ctx, c.InitTimeout)
	defer cancel()
	s := &Services{}
	defer func() {
		if err != nil {
			state.Set("failed", false, err)
			s.record("failed", "failed", err)
			s.Close()
		}
	}()
	id, e := LoadIdentity(c.DataDir)
	if e != nil {
		return nil, e
	}
	s.Identity = id
	s.Prefix = "nebulaekno:" + id.ID + ":"
	state.Identity(id.ID)
	state.Set("checking_dependencies", false, nil)
	if e = retry(ctx, c, func(probe context.Context) error { var er error; s.Graph, er = connectGraph(probe, c); return er }); e != nil {
		return nil, e
	}
	if e = checkGraph(ctx, s.Graph); e != nil {
		return nil, e
	}
	state.Component("neo4j", "5.26 / APOC checked")
	if e = retry(ctx, c, func(probe context.Context) error { var er error; s.Redis, er = connectRedis(probe, c); return er }); e != nil {
		return nil, e
	}
	if e = checkRedis(ctx, s.Redis, s.Prefix); e != nil {
		return nil, e
	}
	state.Component("redis", "7.4 / AOF / noeviction")
	state.Set("initializing_database", false, nil)
	// Database creation and advisory-lock waits need the full initialization budget.
	if e = retry(ctx, c, func(probe context.Context) error { var er error; s.DB, er = openDatabase(ctx, c); return er }); e != nil {
		return nil, e
	}
	state.Set("migrating_schema", false, nil)
	if e = migrate(ctx, s.DB, c, id); e != nil {
		return nil, e
	}
	s.record("migrating_schema", "succeeded", nil)
	state.Component("postgres", "17 / pgvector 0.8 / schema checked")
	state.Set("initializing_graph", false, nil)
	if e = initGraph(ctx, s.Graph, id); e != nil {
		return nil, e
	}
	s.record("initializing_graph", "succeeded", nil)
	state.Set("initializing_queue", false, nil)
	if e = s.Redis.Set(ctx, s.Prefix+"installation", id.ID, 0).Err(); e != nil {
		return nil, redisError(e)
	}
	s.record("initializing_queue", "succeeded", nil)
	state.Set("checking_runtime", false, nil)
	return s, nil
}
func (s *Services) record(stage, status string, e error) {
	if s.DB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var raw []byte
	if e != nil {
		if ce, ok := e.(*config.Error); ok {
			raw, _ = json.Marshal(ce)
		} else {
			raw, _ = json.Marshal(map[string]string{"code": "INITIALIZATION_FAILED"})
		}
	}
	_, _ = s.DB.Exec(ctx, "INSERT INTO initialization_events(stage,status,error) VALUES($1,$2,$3)", stage, status, raw)
}
func (s *Services) Complete(ctx context.Context) error {
	_, e := s.DB.Exec(ctx, "UPDATE installation SET complete=true WHERE singleton")
	if e != nil {
		return pgError(e)
	}
	s.record("ready", "succeeded", nil)
	return nil
}
func (s *Services) Check(ctx context.Context) error {
	// A write probe detects read-only/failover states which PING alone misses.
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return pgError(e)
	}
	_, e = tx.Exec(ctx, "UPDATE installation SET complete=complete WHERE singleton")
	tx.Rollback(ctx)
	if e != nil {
		return pgError(e)
	}
	r, e := GraphQuery(ctx, s.Graph, "MATCH (n:NebulaeKnoInstallation {slot:'primary'}) SET n.last_probe=datetime() RETURN n.id AS id", nil)
	if e != nil {
		return graphError(e)
	}
	if len(r.Records) != 1 {
		return config.Fail("INSTALLATION_IDENTITY_MISMATCH", "neo4j", "图谱安装身份丢失")
	}
	id, _ := r.Records[0].Get("id")
	if id != s.Identity.ID {
		return config.Fail("INSTALLATION_IDENTITY_MISMATCH", "neo4j", "图谱安装身份不一致")
	}
	if e = checkRedis(ctx, s.Redis, s.Prefix); e != nil {
		return e
	}
	return nil
}
