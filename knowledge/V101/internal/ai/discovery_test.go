package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestDiscoverModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Errorf("unexpected discovery request")
		}
		fmt.Fprint(w, `{"data":[{"id":"z"},{"id":"a"},{"id":"a"},{"id":""}]}`)
	}))
	defer srv.Close()
	for _, base := range []string{srv.URL, srv.URL + "/v1/"} {
		ids, err := DiscoverModels(context.Background(), base, "test-secret")
		if err != nil || !reflect.DeepEqual(ids, []string{"a", "z"}) {
			t.Fatalf("%v %v", ids, err)
		}
	}
}
func TestDiscoveryRejectsInvalidResponses(t *testing.T) {
	for _, body := range []string{`{}`, `{"data":null}`, `not-json`} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		_, err := DiscoverModels(context.Background(), srv.URL, "")
		srv.Close()
		if err == nil {
			t.Fatal("invalid response accepted")
		}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401); fmt.Fprint(w, "test-secret") }))
	defer srv.Close()
	_, err := DiscoverModels(context.Background(), srv.URL, "test-secret")
	if err == nil || err.(*Error).Message != "模型列表返回 HTTP 401，请检查地址、凭证或服务是否支持 /models" {
		t.Fatal(err)
	}
}
