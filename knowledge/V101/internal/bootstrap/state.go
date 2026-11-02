package bootstrap

import (
	"encoding/json"
	"log/slog"
	"nebulaekno/internal/config"
	"sync"
	"time"
)

type Snapshot struct {
	Stage          string            `json:"stage"`
	Ready          bool              `json:"ready"`
	InstallationID string            `json:"installation_id,omitempty"`
	Error          *config.Error     `json:"error,omitempty"`
	UpdatedAt      time.Time         `json:"updated_at"`
	Components     map[string]string `json:"components"`
}
type State struct {
	mu      sync.RWMutex
	current Snapshot
}

func NewState() *State {
	return &State{current: Snapshot{Stage: "validating_config", UpdatedAt: time.Now(), Components: map[string]string{}}}
}
func (s *State) Get() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, _ := json.Marshal(s.current)
	var v Snapshot
	_ = json.Unmarshal(b, &v)
	return v
}
func (s *State) Set(stage string, ready bool, e error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.current.Stage = stage
	s.current.Ready = ready
	s.current.UpdatedAt = time.Now().UTC()
	s.current.Error = nil
	if e != nil {
		if x, ok := e.(*config.Error); ok {
			s.current.Error = x
		} else {
			s.current.Error = &config.Error{Code: "INITIALIZATION_FAILED", Component: stage, Message: "操作失败，请检查组件配置和权限"}
		}
	}
	slog.Info("运行状态", "stage", stage, "ready", ready, "error", s.current.Error)
}
func (s *State) Component(k, v string) { s.mu.Lock(); defer s.mu.Unlock(); s.current.Components[k] = v }
func (s *State) Identity(id string)    { s.mu.Lock(); defer s.mu.Unlock(); s.current.InstallationID = id }
