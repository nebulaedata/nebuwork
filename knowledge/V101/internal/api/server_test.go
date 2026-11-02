package api

import (
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"net/http/httptest"
	"testing"
)

func TestStartupBarrier(t *testing.T) {
	state := bootstrap.NewState()
	s := New(config.Config{}, state)
	for _, tc := range []struct {
		path string
		want int
	}{{"/health/live", 200}, {"/health/ready", 503}, {"/", 503}, {"/api/v1/system/version", 503}} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.want {
			t.Fatalf("%s: got %d", tc.path, w.Code)
		}
	}
	state.Set("ready", true, nil)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/system/version", nil))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	state.Set("dependency_unavailable", false, nil)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/system/version", nil))
	if w.Code != 503 {
		t.Fatal("business remained available")
	}
}
