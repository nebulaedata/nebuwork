package main

import (
	"context"
	"log/slog"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/api"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/jobs"
	localruntime "nebulaekno/internal/runtime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		port := os.Getenv("NEBULAEKNO_PORT")
		if port == "" {
			port = "8080"
		}
		client := http.Client{Timeout: 3 * time.Second}
		r, e := client.Get("http://127.0.0.1:" + port + "/health/ready")
		if e != nil {
			os.Exit(1)
		}
		r.Body.Close()
		if r.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if e := run(); e != nil {
		slog.Error("服务退出", "error", e.Error())
		os.Exit(1)
	}
}
func run() error {
	c, e := config.Load()
	if e != nil {
		return e
	}
	level := slog.LevelInfo
	switch c.LogLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	ai.ConfigureConcurrency(c.ModelConcurrency)
	state := bootstrap.NewState()
	app := api.New(c, state)
	server := &http.Server{Addr: net.JoinHostPort(c.Host, strconv.Itoa(c.Port)), Handler: app, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	listener, e := net.Listen("tcp", server.Addr)
	if e != nil {
		return config.Fail("HTTP_SERVER_FAILED", "http", "监听地址或端口不可用")
	}
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.Serve(listener) }()
	var services *bootstrap.Services
	var reader *localruntime.Reader
	var worker *jobs.Worker
	defer func() {
		if state.Get().Stage != "failed" {
			state.Set("stopping", false, nil)
		}
		cancel()
		if worker != nil {
			worker.Stop()
		}
		shutdown, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		if server.Shutdown(shutdown) != nil {
			server.Close()
		}
		if reader != nil {
			reader.Stop()
		}
		if services != nil {
			services.Close()
		}
	}()
	services, e = bootstrap.Initialize(ctx, c, state)
	if e != nil {
		return e
	}
	app.Services = services
	reader, e = localruntime.Start(ctx)
	if e != nil {
		state.Set("failed", false, e)
		return e
	}
	if e = services.Complete(ctx); e != nil {
		return e
	}
	state.Component("reader", "ready")
	state.Set("ready", true, nil)
	worker = jobs.Start(ctx, services, c, state)
	stopQA := app.StartQA(ctx)
	defer stopQA()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	var unhealthySince time.Time
	for {
		select {
		case <-ctx.Done():
			state.Set("stopping", false, nil)
			return nil
		case e = <-serverErr:
			if e == http.ErrServerClosed {
				return nil
			}
			return config.Fail("HTTP_SERVER_FAILED", "http", "HTTP 服务启动或运行失败")
		case <-reader.Done():
			e = config.Fail("RUNTIME_EXITED", "reader", "关键解析进程退出")
			state.Set("failed", false, e)
			return e
		case <-ticker.C:
			probe, stop := context.WithTimeout(ctx, c.ConnectTimeout)
			e = services.Check(probe)
			if e == nil {
				e = reader.Check(probe)
			}
			stop()
			if e != nil {
				if unhealthySince.IsZero() {
					unhealthySince = time.Now()
					state.Set("dependency_unavailable", false, e)
				}
				if time.Since(unhealthySince) >= c.Recovery {
					return e
				}
			} else if !unhealthySince.IsZero() {
				unhealthySince = time.Time{}
				state.Set("ready", true, nil)
			}
		}
	}
}
