package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"nebulaekno/internal/config"
	"net/http"
	"os"
	"os/exec"
	"syscall"
	"time"
)

type Reader struct {
	cmd    *exec.Cmd
	done   chan struct{}
	err    error
	client *http.Client
}

func Start(ctx context.Context) (*Reader, error) {
	r := &Reader{done: make(chan struct{}), client: &http.Client{Timeout: 5 * time.Second}}
	r.cmd = exec.Command("python3", "/app/reader/server.py")
	r.cmd.Stdout = os.Stdout
	r.cmd.Stderr = os.Stderr
	r.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	if e := r.cmd.Start(); e != nil {
		return nil, config.Fail("RUNTIME_START_FAILED", "reader", "无法启动 Python 解析服务")
	}
	go func() { r.err = r.cmd.Wait(); close(r.done) }()
	deadline := time.NewTimer(30 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case <-r.done:
			return nil, config.Fail("RUNTIME_START_FAILED", "reader", "解析进程启动后退出")
		case <-ctx.Done():
			r.Stop()
			return nil, ctx.Err()
		case <-deadline.C:
			r.Stop()
			return nil, config.Fail("RUNTIME_START_FAILED", "reader", "解析进程就绪超时")
		case <-time.After(200 * time.Millisecond):
			if r.Check(ctx) == nil {
				return r, nil
			}
		}
	}
}
func (r *Reader) Check(ctx context.Context) error {
	select {
	case <-r.done:
		return config.Fail("RUNTIME_EXITED", "reader", "解析进程已退出")
	default:
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8091/health", nil)
	response, e := r.client.Do(req)
	if e != nil {
		return config.Fail("RUNTIME_UNAVAILABLE", "reader", "解析进程不可用")
	}
	defer response.Body.Close()
	var data struct {
		Ready bool `json:"ready"`
	}
	if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&data) != nil || !data.Ready {
		return config.Fail("RUNTIME_CAPABILITY_MISSING", "reader", "核心解析、转换或媒体依赖缺失")
	}
	return nil
}
func (r *Reader) Done() <-chan struct{} { return r.done }
func (r *Reader) Stop() {
	if r == nil || r.cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-r.cmd.Process.Pid, syscall.SIGTERM)
	select {
	case <-r.done:
	case <-time.After(10 * time.Second):
		_ = syscall.Kill(-r.cmd.Process.Pid, syscall.SIGKILL)
		<-r.done
	}
}
func IsCancelled(e error) bool { return errors.Is(e, context.Canceled) }
