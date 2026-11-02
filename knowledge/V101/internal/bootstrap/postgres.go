package bootstrap

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"io/fs"
	"nebulaekno/internal/config"
	"nebulaekno/internal/defaults"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed sql/*.sql
var migrations embed.FS

func pgError(e error) error {
	var p *pgconn.PgError
	if errors.As(e, &p) {
		switch p.Code {
		case "28P01", "28000":
			return config.Fail("AUTH_FAILED", "postgres", "数据库认证失败")
		case "42501":
			return config.Fail("DATABASE_PERMISSION_DENIED", "postgres", "账号缺少建库、扩展或结构操作权限")
		case "58P01", "0A000":
			return config.Fail("EXTENSION_UNAVAILABLE", "postgres", "需要服务器安装 pgvector 0.8.x")
		default:
			return config.Fail("DATABASE_OPERATION_FAILED", "postgres", "数据库操作失败，SQLSTATE="+p.Code)
		}
	}
	return &config.Error{Code: "DEPENDENCY_UNREACHABLE", Component: "postgres", Message: "数据库连接或操作不可用", Retryable: true}
}
func lock(ctx context.Context, conn *pgx.Conn, key string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		if ctx.Err() != nil {
			return config.Fail("INITIALIZATION_LOCK_TIMEOUT", "postgres", "等待初始化锁超时")
		}
		var ok bool
		if e := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1,0))", key).Scan(&ok); e != nil {
			if ctx.Err() != nil {
				return config.Fail("INITIALIZATION_LOCK_TIMEOUT", "postgres", "等待初始化锁超时")
			}
			return pgError(e)
		}
		if ok {
			return nil
		}
		select {
		case <-ctx.Done():
			return config.Fail("INITIALIZATION_LOCK_TIMEOUT", "postgres", "等待初始化锁超时")
		case <-time.After(200 * time.Millisecond):
		}
	}
}
func unlock(conn *pgx.Conn, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = conn.Exec(ctx, "SELECT pg_advisory_unlock(hashtextextended($1,0))", key)
}

func openDatabase(ctx context.Context, c config.Config) (*pgxpool.Pool, error) {
	pc, e := pgx.ParseConfig(c.DatabaseURL)
	if e != nil {
		return nil, config.Fail("INVALID_CONNECTION_URL", "postgres", "PostgreSQL URL 参数无效")
	}
	pc.ConnectTimeout = c.ConnectTimeout
	conn, e := pgx.ConnectConfig(ctx, pc)
	if e != nil {
		var pe *pgconn.PgError
		if !errors.As(e, &pe) || pe.Code != "3D000" {
			return nil, pgError(e)
		}
		mc := pc.Copy()
		mc.Database = "postgres"
		maintenance, er := pgx.ConnectConfig(ctx, mc)
		if er != nil {
			return nil, pgError(er)
		}
		defer maintenance.Close(context.Background())
		if er = preflightPostgres(ctx, maintenance); er != nil {
			return nil, er
		}
		key := "nebulaekno:create:" + pc.Database
		if er = lock(ctx, maintenance, key, c.LockTimeout); er != nil {
			return nil, er
		}
		defer unlock(maintenance, key)
		var exists bool
		if er = maintenance.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1)", pc.Database).Scan(&exists); er != nil {
			return nil, pgError(er)
		}
		if !exists {
			_, er = maintenance.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{pc.Database}.Sanitize()+" TEMPLATE template0 ENCODING 'UTF8'")
			if er != nil {
				return nil, config.Fail("DATABASE_CREATE_DENIED", "postgres", "无法创建业务库，请确认 CREATEDB 权限和目标名称")
			}
		}
	} else {
		if er := preflightPostgres(ctx, conn); er != nil {
			conn.Close(ctx)
			return nil, er
		}
		conn.Close(ctx)
	}
	poolConfig, e := pgxpool.ParseConfig(c.DatabaseURL)
	if e != nil {
		return nil, config.Fail("INVALID_CONNECTION_URL", "postgres", "无法解析连接参数")
	}
	poolConfig.ConnConfig.ConnectTimeout = c.ConnectTimeout
	poolConfig.ConnConfig.RuntimeParams["search_path"] = "nebulaekno,public"
	poolConfig.ConnConfig.RuntimeParams["timezone"] = "UTC"
	poolConfig.MaxConns = 16
	p, e := pgxpool.NewWithConfig(ctx, poolConfig)
	if e != nil {
		return nil, pgError(e)
	}
	if e = p.Ping(ctx); e != nil {
		p.Close()
		return nil, pgError(e)
	}
	return p, nil
}

func preflightPostgres(ctx context.Context, conn *pgx.Conn) error {
	var version string
	var available bool
	if e := conn.QueryRow(ctx, "SELECT current_setting('server_version_num'), EXISTS(SELECT 1 FROM pg_available_extension_versions WHERE name='vector' AND version LIKE '0.8.%')").Scan(&version, &available); e != nil {
		return pgError(e)
	}
	v, _ := strconv.Atoi(version)
	if v/10000 != 17 {
		return config.Fail("UNSUPPORTED_DATABASE_VERSION", "postgres", "需要 PostgreSQL 17")
	}
	if !available {
		return config.Fail("EXTENSION_UNAVAILABLE", "postgres", "服务器未安装 pgvector 0.8.x")
	}
	return nil
}

func migrate(ctx context.Context, pool *pgxpool.Pool, c config.Config, id Identity) error {
	pc, e := pool.Acquire(ctx)
	if e != nil {
		return pgError(e)
	}
	defer pc.Release()
	conn := pc.Conn()
	key := "nebulaekno:migrate"
	if e = lock(ctx, conn, key, c.LockTimeout); e != nil {
		return e
	}
	defer unlock(conn, key)
	var version, encoding string
	if e = conn.QueryRow(ctx, "SELECT current_setting('server_version_num'),current_setting('server_encoding')").Scan(&version, &encoding); e != nil {
		return pgError(e)
	}
	v, _ := strconv.Atoi(version)
	if v/10000 != 17 || encoding != "UTF8" {
		return config.Fail("UNSUPPORTED_DATABASE_VERSION", "postgres", "需要 PostgreSQL 17、UTF8 编码")
	}
	var schemaExists, markerExists bool
	if e = conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='nebulaekno'), to_regclass('nebulaekno.installation') IS NOT NULL").Scan(&schemaExists, &markerExists); e != nil {
		return pgError(e)
	}
	if schemaExists && !markerExists {
		return config.Fail("SCHEMA_CONFLICT", "postgres", "已有同名 schema 缺少合法安装标记")
	}
	if !schemaExists {
		tx, er := conn.Begin(ctx)
		if er != nil {
			return pgError(er)
		}
		defer tx.Rollback(context.Background())
		_, er = tx.Exec(ctx, `CREATE SCHEMA nebulaekno;
CREATE TABLE nebulaekno.installation (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id uuid NOT NULL, key_fingerprint text NOT NULL, schema_fingerprint text NOT NULL DEFAULT '', complete boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE nebulaekno.schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE nebulaekno.initialization_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,stage text NOT NULL,status text NOT NULL,error jsonb,created_at timestamptz NOT NULL DEFAULT now());`)
		if er != nil {
			return pgError(er)
		}
		_, er = tx.Exec(ctx, "INSERT INTO nebulaekno.installation(id,key_fingerprint) VALUES($1,$2)", id.ID, id.Fingerprint())
		if er != nil {
			return pgError(er)
		}
		if er = tx.Commit(ctx); er != nil {
			return pgError(er)
		}
	}
	var existing, keyHash, fingerprint string
	if e = conn.QueryRow(ctx, "SELECT id::text,key_fingerprint,schema_fingerprint FROM installation WHERE singleton").Scan(&existing, &keyHash, &fingerprint); e != nil {
		return pgError(e)
	}
	if existing != id.ID || keyHash != id.Fingerprint() {
		return config.Fail("INSTALLATION_IDENTITY_MISMATCH", "postgres", "数据库与文件卷身份或密钥不匹配，请恢复配套数据卷")
	}
	if fingerprint != "" {
		actual, er := schemaFingerprint(ctx, conn)
		if er != nil {
			return er
		}
		if actual != fingerprint {
			return config.Fail("SCHEMA_CONFLICT", "postgres", "表、约束或索引与已迁移结构不一致")
		}
	}
	if _, e = conn.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public"); e != nil {
		return pgError(e)
	}
	var extension string
	if e = conn.QueryRow(ctx, "SELECT extversion FROM pg_extension WHERE extname='vector'").Scan(&extension); e != nil {
		return pgError(e)
	}
	if !strings.HasPrefix(extension, "0.8.") {
		return config.Fail("EXTENSION_UNAVAILABLE", "postgres", "需要 pgvector 0.8.x")
	}
	var distance float64
	if e = conn.QueryRow(ctx, "SELECT '[1,0]'::vector <=> '[1,0]'::vector").Scan(&distance); e != nil || distance != 0 {
		return config.Fail("EXTENSION_UNAVAILABLE", "postgres", "向量运算检查失败")
	}
	names, _ := fs.Glob(migrations, "sql/*.sql")
	sort.Strings(names)
	known := map[string]string{}
	for _, name := range names {
		body, _ := migrations.ReadFile(name)
		sum := sha256.Sum256(body)
		known[name] = hex.EncodeToString(sum[:])
	}
	rows, e := conn.Query(ctx, "SELECT version,checksum FROM schema_migrations")
	if e != nil {
		return pgError(e)
	}
	applied := map[string]bool{}
	for rows.Next() {
		var name, sum string
		if e = rows.Scan(&name, &sum); e != nil {
			rows.Close()
			return pgError(e)
		}
		expected, ok := known[name]
		if !ok {
			rows.Close()
			return config.Fail("SCHEMA_VERSION_TOO_NEW", "postgres", "数据库包含当前镜像未知的迁移")
		}
		if expected != sum {
			rows.Close()
			return config.Fail("MIGRATION_CHECKSUM_MISMATCH", "postgres", "迁移校验和不匹配")
		}
		applied[name] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return pgError(e)
	}
	for _, name := range names {
		if applied[name] {
			continue
		}
		body, _ := migrations.ReadFile(name)
		tx, er := conn.Begin(ctx)
		if er != nil {
			return pgError(er)
		}
		_, er = tx.Exec(ctx, string(body))
		if er == nil {
			_, er = tx.Exec(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", name, known[name])
		}
		if er == nil {
			var signature string
			signature, er = schemaFingerprint(ctx, tx)
			if er == nil {
				_, er = tx.Exec(ctx, "UPDATE installation SET schema_fingerprint=$1 WHERE singleton", signature)
			}
		}
		if er != nil {
			tx.Rollback(context.Background())
			return config.Fail("MIGRATION_FAILED", "postgres", "事务迁移失败: "+name)
		}
		if er = tx.Commit(ctx); er != nil {
			return pgError(er)
		}
	}
	for k, v := range defaults.Settings {
		b, _ := json.Marshal(v)
		if _, e = conn.Exec(ctx, "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING", k, b); e != nil {
			return pgError(e)
		}
	}
	fingerprint, e = schemaFingerprint(ctx, conn)
	if e != nil {
		return e
	}
	_, e = conn.Exec(ctx, "UPDATE installation SET schema_fingerprint=$1 WHERE singleton", fingerprint)
	if e != nil {
		return pgError(e)
	}
	return nil
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func schemaFingerprint(ctx context.Context, c queryer) (string, error) {
	// Dynamic model indexes have a separate namespace and are deliberately excluded.
	rows, e := c.Query(ctx, `SELECT line FROM (
 SELECT 'col:'||c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') line
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='nebulaekno' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint:'||c.relname||':'||con.conname||':'||pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nebulaekno'
 UNION ALL SELECT 'index:'||c.relname||':'||pg_get_indexdef(i.indexrelid)||':'||i.indisvalid::text FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nebulaekno' AND c.relname NOT LIKE 'model_vector_%'
) definitions ORDER BY line`)
	if e != nil {
		return "", pgError(e)
	}
	defer rows.Close()
	hash := sha256.New()
	for rows.Next() {
		var line string
		if e = rows.Scan(&line); e != nil {
			return "", pgError(e)
		}
		fmt.Fprintln(hash, line)
	}
	if e = rows.Err(); e != nil {
		return "", pgError(e)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
