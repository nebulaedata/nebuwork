package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/extraction"
)

func TestExtractionProxyPreservesResponseAndFailureIsolation(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/extractions/documents" || r.URL.Query().Get("q") != "中文" {
			t.Error("proxy changed path/query")
		}
		w.Header().Set("X-Extraction-Test", "preserved")
		w.WriteHeader(202)
		_, _ = w.Write([]byte(`{"success":true,"data":{"task_id":"example"}}`))
	}))
	defer upstream.Close()
	s := &Server{Config: config.Config{ExtractionURL: upstream.URL}}
	response := httptest.NewRecorder()
	s.proxyExtraction(response, httptest.NewRequest("GET", "/api/v1/extractions/documents?q=%E4%B8%AD%E6%96%87", nil))
	if response.Code != 202 || response.Header().Get("X-Extraction-Test") != "preserved" || !strings.Contains(response.Body.String(), "task_id") {
		t.Fatalf("bad proxy response: %v %s", response.Code, response.Body)
	}
	upstream.Close()
	response = httptest.NewRecorder()
	s.proxyExtraction(response, httptest.NewRequest("GET", "/api/v1/extractions/documents", nil))
	if response.Code != 503 || !strings.Contains(response.Body.String(), "EXTRACTION_UNAVAILABLE") {
		t.Fatal("missing isolated unavailable response")
	}
}
func TestExtractionModelGatewayRequiresScopedInternalToken(t *testing.T) {
	s := &Server{Services: &bootstrap.Services{Identity: bootstrap.Identity{ID: "test-install", Key: []byte("01234567890123456789012345678901")}}, mux: http.NewServeMux()}
	s.extractionModelGateway()
	for _, token := range []string{"", s.Services.Identity.InternalToken("other-purpose")} {
		request := httptest.NewRequest("POST", extraction.ModelGatewayPath, strings.NewReader("{}"))
		request.Header.Set(extraction.InternalTokenHeader, token)
		response := httptest.NewRecorder()
		s.mux.ServeHTTP(response, request)
		if response.Code != 403 {
			t.Fatal("untrusted internal request accepted")
		}
	}
	request := httptest.NewRequest("POST", extraction.ModelGatewayPath, strings.NewReader(`{"task_id":"00000000-0000-0000-0000-000000000001","run_id":"00000000-0000-0000-0000-000000000002","owner":"test","body":{"base_url":"http://untrusted"}}`))
	request.Header.Set(extraction.InternalTokenHeader, s.Services.Identity.InternalToken(extraction.InternalPurpose))
	response := httptest.NewRecorder()
	s.mux.ServeHTTP(response, request)
	if response.Code != 400 {
		t.Fatal("caller supplied provider address accepted")
	}
}
func TestExtractionServerExposesOnlyOwnedRoutes(t *testing.T) {
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	s := NewExtraction(config.Config{}, state)
	for _, path := range []string{"/", "/api/v1/models", "/api/v1/knowledge-bases", "/api/v1/search", "/api/v1/system/infrastructure"} {
		response := httptest.NewRecorder()
		s.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 404 {
			t.Fatalf("unrelated route exposed: %s", path)
		}
	}
	response := httptest.NewRecorder()
	s.ServeHTTP(response, httptest.NewRequest("GET", "/api/openapi.json", nil))
	body, _ := io.ReadAll(response.Body)
	if response.Code != 200 || !strings.Contains(string(body), "/api/v1/extractions/") {
		t.Fatal("extraction docs unavailable")
	}
}
