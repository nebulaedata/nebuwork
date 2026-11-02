package bootstrap

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"nebulaekno/internal/config"
)

// InternalToken is purpose-bound and never exposed by a public settings API.
func (id Identity) InternalToken(purpose string) string {
	h := hmac.New(sha256.New, id.Key)
	_, _ = h.Write([]byte("nebulaekno-internal/v1:" + purpose))
	return hex.EncodeToString(h.Sum(nil))
}

// InitializeExtraction consumes an existing installation; only the main app
// creates identities, databases, migrations, graph state and default settings.
func InitializeExtraction(ctx context.Context, c config.Config, state *State) (services *Services, err error) {
	ctx, cancel := context.WithTimeout(ctx, c.InitTimeout)
	defer cancel()
	s := &Services{}
	defer func() {
		if err != nil {
			s.Close()
			state.Set("failed", false, err)
		}
	}()
	raw, e := os.ReadFile(filepath.Join(c.DataDir, "config", "installation.json"))
	if e != nil {
		return nil, config.Fail("INSTALLATION_REQUIRED", "storage", "请先启动主系统初始化共享数据卷")
	}
	if json.Unmarshal(raw, &s.Identity) != nil || len(s.Identity.Key) != 32 || uuid.Validate(s.Identity.ID) != nil {
		return nil, config.Fail("VOLUME_IDENTITY_INVALID", "storage", "安装身份文件无效")
	}
	state.Identity(s.Identity.ID)
	s.Prefix = "nebulaekno:" + s.Identity.ID + ":"
	state.Set("checking_dependencies", false, nil)
	pg, e := pgxpool.ParseConfig(c.DatabaseURL)
	if e != nil {
		return nil, config.Fail("INVALID_CONNECTION_URL", "postgres", "数据库连接无效")
	}
	pg.ConnConfig.RuntimeParams["search_path"] = "nebulaekno,public"
	pg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pg.ConnConfig.ConnectTimeout = c.ConnectTimeout
	pg.MaxConns = 16
	if s.DB, e = pgxpool.NewWithConfig(ctx, pg); e != nil {
		return nil, pgError(e)
	}
	if e = retry(ctx, c, func(probe context.Context) error { return pgErrorIfAny(s.DB.Ping(probe)) }); e != nil {
		return nil, e
	}
	var installation, fingerprint string
	var complete bool
	if e = s.DB.QueryRow(ctx, "SELECT id::text,key_fingerprint,complete FROM installation WHERE singleton").Scan(&installation, &fingerprint, &complete); e != nil {
		return nil, config.Fail("INSTALLATION_REQUIRED", "postgres", "主系统尚未完成数据库初始化")
	}
	if installation != s.Identity.ID || fingerprint != s.Identity.Fingerprint() {
		return nil, config.Fail("INSTALLATION_IDENTITY_MISMATCH", "postgres", "数据库与共享文件卷不匹配")
	}
	if !complete {
		return nil, config.Fail("INSTALLATION_REQUIRED", "postgres", "请先等待主系统就绪")
	}
	// Read the exact columns needed by this service; do not run schema migration.
	if _, e = s.DB.Exec(ctx, "SELECT r.input,r.input_hash,r.config,b.data,u.data,e.data,c.data FROM extraction_runs r LEFT JOIN extraction_blocks b ON false LEFT JOIN extraction_units u ON false LEFT JOIN extraction_records e ON false LEFT JOIN extraction_coverage c ON false LIMIT 0"); e != nil {
		return nil, config.Fail("SCHEMA_NOT_READY", "postgres", "提取数据结构未就绪，请先升级主系统")
	}
	if e = retry(ctx, c, func(probe context.Context) error { var er error; s.Redis, er = connectRedis(probe, c); return er }); e != nil {
		return nil, e
	}
	if e = checkRedis(ctx, s.Redis, s.Prefix); e != nil {
		return nil, e
	}
	if e = os.MkdirAll(filepath.Join(c.DataDir, "extractions"), 0700); e != nil {
		return nil, config.Fail("DATA_DIR_UNWRITABLE", "storage", "提取目录不可写")
	}
	if e = s.CheckExtraction(ctx, c.MainAPIURL); e != nil {
		return nil, e
	}
	state.Component("postgres", "existing schema checked")
	state.Component("redis", "existing installation queue")
	state.Component("main", "ready")
	return s, nil
}
func pgErrorIfAny(err error) error {
	if err == nil {
		return nil
	}
	return pgError(err)
}

func (s *Services) CheckExtraction(ctx context.Context, mainURL string) error {
	if e := s.DB.Ping(ctx); e != nil {
		return pgError(e)
	}
	if e := s.Redis.Ping(ctx).Err(); e != nil {
		return redisError(e)
	}
	req, e := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(mainURL, "/")+"/health/ready", nil)
	if e != nil {
		return config.Fail("MAIN_UNAVAILABLE", "main", "主系统地址无效")
	}
	client := http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, e := client.Do(req)
	if e != nil {
		return config.Fail("MAIN_UNAVAILABLE", "main", "主系统暂不可用，提取任务将等待恢复")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return config.Fail("MAIN_UNAVAILABLE", "main", fmt.Sprintf("主系统未就绪（HTTP %d）", response.StatusCode))
	}
	return nil
}
