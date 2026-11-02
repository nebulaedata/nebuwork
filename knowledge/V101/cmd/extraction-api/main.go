package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"nebulaekno/internal/api"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/extraction"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		port := os.Getenv("NEBULAEKNO_PORT")
		if port == "" {
			port = "8082"
		}
		client := http.Client{Timeout: 3 * time.Second}
		response, err := client.Get("http://127.0.0.1:" + port + "/health/ready")
		if err != nil {
			os.Exit(1)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("提取服务退出", "error", err.Error())
		os.Exit(1)
	}
}
func run() error {
	c, err := config.LoadExtraction()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	state := bootstrap.NewState()
	app := api.NewExtraction(c, state)
	server := &http.Server{Addr: net.JoinHostPort(c.Host, strconv.Itoa(c.Port)), Handler: app, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return config.Fail("HTTP_SERVER_FAILED", "extraction", "提取端口无法监听")
	}
	serverError := make(chan error, 1)
	go func() { serverError <- server.Serve(listener) }()
	var services *bootstrap.Services
	var worker *extraction.Worker
	defer func() {
		state.Set("stopping", false, nil)
		cancel()
		if worker != nil {
			worker.Stop()
		}
		shutdown, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		if server.Shutdown(shutdown) != nil {
			server.Close()
		}
		if services != nil {
			services.Close()
		}
	}()
	services, err = bootstrap.InitializeExtraction(ctx, c, state)
	if err != nil {
		return err
	}
	if err = extraction.CheckRuntime(ctx); err != nil {
		return err
	}
	app.Services = services
	state.Component("extractor", "ready")
	state.Set("ready", true, nil)
	worker = extraction.Start(ctx, services, c, state)
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-serverError:
			if err == http.ErrServerClosed {
				return nil
			}
			return err
		case <-tick.C:
			probe, stop := context.WithTimeout(ctx, c.ConnectTimeout)
			err := services.CheckExtraction(probe, c.MainAPIURL)
			stop()
			if err != nil {
				if state.Get().Ready {
					state.Set("dependency_unavailable", false, err)
				}
			} else if !state.Get().Ready {
				state.Set("ready", true, nil)
			}
		}
	}
}
