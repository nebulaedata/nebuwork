package ai

import (
	"context"
	"fmt"
	"sync"
)

var globalSlots = make(chan struct{}, 4)
var modelSlots sync.Map

// Configure once, before accepting requests or starting workers.
func ConfigureConcurrency(n int) {
	if n > 0 {
		globalSlots = make(chan struct{}, n)
	}
}
func acquire(ctx context.Context, m Model) (func(), error) {
	limit := 2
	if value, ok := m.Config["max_concurrency"].(float64); ok && value >= 1 && value <= 128 {
		limit = int(value)
	}
	key := m.ID
	if key == "" {
		key = m.BaseURL + ":" + m.ModelName
	}
	value, _ := modelSlots.LoadOrStore(fmt.Sprintf("%s:%d", key, limit), make(chan struct{}, limit))
	slots := value.(chan struct{})
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	select {
	case globalSlots <- struct{}{}:
	case <-ctx.Done():
		<-slots
		return nil, ctx.Err()
	}
	return func() { <-globalSlots; <-slots }, nil
}
