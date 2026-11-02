package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Error deliberately excludes connection strings and underlying driver messages.
type Error struct {
	Code      string `json:"code"`
	Component string `json:"component"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Component + ": " + e.Message }
func Fail(code, component, message string) error {
	return &Error{Code: code, Component: component, Message: message}
}

type Config struct {
	ExtractionURL, MainAPIURL                                                                                   string
	DatabaseURL, Neo4jURL, RedisURL                                                                             string
	Host, DataDir, PublicURL, LogLevel                                                                          string
	Port                                                                                                        int
	ConnectTimeout, ConnectWindow, InitTimeout, LockTimeout, Recovery                                           time.Duration
	MaxUpload, MediaMaxUpload, ArchiveMaxUpload, ArchiveMaxExpanded                                             int64
	ArchiveMaxDepth, ArchiveMaxFiles                                                                            int
	MediaMaxDuration, DocumentWorkers, ImageWorkers, MediaWorkers, ModelConcurrency                             int
	PreprocessWorkers, PreprocessThreads, PreprocessTimeout, PreprocessMemory, PreprocessPixels, PreprocessEdge int
}

func Load() (Config, error) { return Parse(os.Getenv) }
func Parse(get func(string) string) (c Config, err error) {
	return parseRole(get, false)
}
func LoadExtraction() (Config, error)                         { return ParseExtraction(os.Getenv) }
func ParseExtraction(get func(string) string) (Config, error) { return parseRole(get, true) }
func parseRole(get func(string) string, extraction bool) (c Config, err error) {
	getv := func(k, fallback string) string {
		if v := get("NEBULAEKNO_" + k); v != "" {
			return v
		}
		return fallback
	}
	for _, item := range []struct {
		key     string
		dst     *string
		schemes []string
	}{
		{"DATABASE_URL", &c.DatabaseURL, []string{"postgresql", "postgres"}},
		{"NEO4J_URL", &c.Neo4jURL, []string{"neo4j", "bolt", "neo4j+s", "bolt+s"}},
		{"REDIS_URL", &c.RedisURL, []string{"redis", "rediss"}},
	} {
		if extraction && item.key == "NEO4J_URL" {
			continue
		}
		v := getv(item.key, "")
		if v == "" {
			return c, Fail("CONFIG_MISSING", item.key, "缺少必填连接 URL")
		}
		u, e := url.Parse(v)
		valid := false
		if e == nil && u.Hostname() != "" && u.Fragment == "" && u.Opaque == "" {
			for _, s := range item.schemes {
				if u.Scheme == s {
					valid = true
				}
			}
		}
		if !valid {
			return c, Fail("INVALID_CONNECTION_URL", item.key, "连接协议、主机或 URL 格式不正确")
		}
		if p := u.Port(); p != "" {
			n, e := strconv.Atoi(p)
			if e != nil || n < 1 || n > 65535 {
				return c, Fail("INVALID_CONNECTION_URL", item.key, "端口不正确")
			}
		}
		q, e := url.ParseQuery(u.RawQuery)
		if e != nil {
			return c, Fail("INVALID_CONNECTION_URL", item.key, "查询参数编码不正确")
		}
		switch item.key {
		case "DATABASE_URL":
			name := strings.TrimPrefix(u.Path, "/")
			if name == "" {
				name = "nebulaekno"
				u.Path = "/" + name
			}
			if strings.ContainsAny(name, "/\x00") || len(name) > 63 || name == "postgres" || name == "template0" || name == "template1" {
				return c, Fail("INVALID_CONNECTION_URL", item.key, "业务数据库名称无效或为系统保留库")
			}
			for _, k := range []string{"dbname", "database", "host", "port", "user", "password", "service", "options"} {
				if q.Has(k) {
					return c, Fail("INVALID_CONNECTION_URL", item.key, "不允许覆盖 URL 身份或启动参数")
				}
			}
		case "NEO4J_URL":
			if u.User == nil || u.User.Username() == "" || u.Path != "" || u.RawQuery != "" {
				return c, Fail("INVALID_CONNECTION_URL", item.key, "需提供账号；固定使用 neo4j 库，不能指定路径或查询参数")
			}
		case "REDIS_URL":
			if (u.Path != "" && u.Path != "/0") || u.RawQuery != "" {
				return c, Fail("INVALID_CONNECTION_URL", item.key, "仅支持数据库 0，不支持查询参数覆盖")
			}
		}
		*item.dst = u.String()
	}
	integer := func(k string, def, min, max int) int {
		s := getv(k, strconv.Itoa(def))
		n, e := strconv.Atoi(s)
		if e != nil || n < min || n > max {
			if err == nil {
				err = Fail("INVALID_CONFIG", k, fmt.Sprintf("必须为 %d–%d 的整数", min, max))
			}
			return def
		}
		return n
	}
	c.Host = getv("HOST", "0.0.0.0")
	if net.ParseIP(c.Host) == nil && c.Host != "localhost" {
		return c, Fail("INVALID_CONFIG", "HOST", "监听地址必须为 IP 或 localhost")
	}
	defaultPort := 8080
	if extraction {
		defaultPort = 8082
	}
	c.Port = integer("PORT", defaultPort, 1, 65535)
	c.ExtractionURL = getv("EXTRACTION_URL", "http://extraction:8082")
	c.MainAPIURL = getv("MAIN_API_URL", "http://app:8080")
	for name, raw := range map[string]string{"EXTRACTION_URL": c.ExtractionURL, "MAIN_API_URL": c.MainAPIURL} {
		u, e := url.Parse(raw)
		if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, Fail("INVALID_CONFIG", name, "服务地址必须为 HTTP(S) 基础 URL")
		}
	}
	c.DataDir = getv("DATA_DIR", "/data")
	if !filepath.IsAbs(c.DataDir) {
		return c, Fail("INVALID_CONFIG", "DATA_DIR", "数据目录必须为绝对路径")
	}
	c.PublicURL = getv("PUBLIC_URL", "")
	if c.PublicURL != "" {
		u, e := url.Parse(c.PublicURL)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return c, Fail("INVALID_CONFIG", "PUBLIC_URL", "对外地址必须为有效 HTTP(S) URL")
		}
		c.PublicURL = strings.TrimRight(c.PublicURL, "/")
	}
	if getv("LANGUAGE", "zh-CN") != "zh-CN" {
		return c, Fail("INVALID_CONFIG", "LANGUAGE", "当前使用 zh-CN")
	}
	c.LogLevel = getv("LOG_LEVEL", "info")
	if c.LogLevel != "debug" && c.LogLevel != "info" && c.LogLevel != "warn" && c.LogLevel != "error" {
		return c, Fail("INVALID_CONFIG", "LOG_LEVEL", "日志级别无效")
	}
	c.ConnectTimeout = time.Duration(integer("CONNECT_TIMEOUT_SECONDS", 10, 1, 300)) * time.Second
	c.ConnectWindow = time.Duration(integer("CONNECT_RETRY_WINDOW_SECONDS", 60, 1, 3600)) * time.Second
	c.InitTimeout = time.Duration(integer("INITIALIZATION_TIMEOUT_SECONDS", 600, 10, 86400)) * time.Second
	c.LockTimeout = time.Duration(integer("INITIALIZATION_LOCK_TIMEOUT_SECONDS", 60, 1, 3600)) * time.Second
	c.Recovery = time.Duration(integer("DEPENDENCY_RECOVERY_SECONDS", 60, 1, 3600)) * time.Second
	// Prefer binary MiB limits; honor explicitly configured legacy decimal MB values.
	c.MaxUpload = 2048 * 1024 * 1024
	if getv("MAX_UPLOAD_MIB", "") != "" {
		c.MaxUpload = int64(integer("MAX_UPLOAD_MIB", 2048, 1, 102400)) * 1024 * 1024
	} else if getv("MAX_UPLOAD_MB", "") != "" {
		c.MaxUpload = int64(integer("MAX_UPLOAD_MB", 2147, 1, 10240)) * 1000000
	}
	c.MediaMaxUpload = int64(integer("MEDIA_MAX_UPLOAD_MIB", 2048, 1, 102400)) * 1024 * 1024
	c.ArchiveMaxUpload = int64(integer("ARCHIVE_MAX_UPLOAD_MIB", 2048, 1, 102400)) * 1024 * 1024
	c.ArchiveMaxExpanded = int64(integer("ARCHIVE_MAX_EXPANDED_MIB", 4096, 1, 102400)) * 1024 * 1024
	c.ArchiveMaxDepth = integer("ARCHIVE_MAX_DEPTH", 8, 1, 32)
	c.ArchiveMaxFiles = integer("ARCHIVE_MAX_FILES", 10000, 1, 100000)
	c.MediaMaxDuration = integer("MEDIA_MAX_DURATION_SECONDS", 14400, 1, 86400)
	c.DocumentWorkers = integer("DOCUMENT_WORKERS", 2, 1, 32)
	c.ImageWorkers = integer("IMAGE_WORKERS", 2, 1, 32)
	c.MediaWorkers = integer("MEDIA_WORKERS", 1, 1, 8)
	c.ModelConcurrency = integer("MODEL_MAX_CONCURRENCY", 4, 1, 128)
	c.PreprocessWorkers = integer("PREPROCESS_MAX_WORKERS", 1, 1, 8)
	c.PreprocessThreads = integer("PREPROCESS_THREADS", 2, 1, 16)
	c.PreprocessTimeout = integer("PREPROCESS_TIMEOUT_SECONDS", 30, 1, 600)
	c.PreprocessMemory = integer("PREPROCESS_MEMORY_MB", 2048, 128, 32768)
	c.PreprocessPixels = integer("PREPROCESS_MAX_PIXELS", 16000000, 1000, 100000000)
	c.PreprocessEdge = integer("PREPROCESS_MAX_EDGE", 2000, 100, 10000)
	return c, err
}

func Redacted(raw string) string {
	u, e := url.Parse(raw)
	if e != nil {
		return "invalid"
	}
	u.User = nil
	u.RawQuery = ""
	return u.String()
}
