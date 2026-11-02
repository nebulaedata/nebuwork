package api

import (
	"nebulaekno/internal/ai"
	"net/http"
	"strings"
)

func (s *Server) discoverModels(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID           string `json:"id"`
		ConnectionID string `json:"connection_id"`
		BaseURL      string `json:"base_url"`
		APIKey       string `json:"api_key"`
		ClearAPIKey  bool   `json:"clear_api_key"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.ConnectionID != "" {
		model := ai.Model{ConnectionID: in.ConnectionID, APIKey: in.APIKey, ClearAPIKey: in.ClearAPIKey}
		if err := ai.ApplyConnection(r.Context(), s.Services, s.Services.DB, &model); err != nil {
			a := err.(*ai.Error)
			Failure(w, 400, a.Code, a.Message)
			return
		}
		in.BaseURL, in.APIKey = model.BaseURL, model.APIKey
	} else if in.ID != "" {
		stored, err := ai.Load(r.Context(), s.Services, in.ID)
		if err != nil {
			Failure(w, 404, "NOT_FOUND", "模型不存在或凭证不可用")
			return
		}
		if in.BaseURL == "" {
			in.BaseURL = stored.BaseURL
		}
		if in.APIKey == "" && !in.ClearAPIKey && stored.APIKey != "" {
			if strings.TrimRight(in.BaseURL, "/") != strings.TrimRight(stored.BaseURL, "/") {
				Failure(w, 400, "CREDENTIAL_REQUIRED", "地址已变更，请重新填写 API Key 后查询")
				return
			}
			in.APIKey = stored.APIKey
		}
	}
	base, err := ai.DiscoveryBase(in.BaseURL)
	if err != nil {
		Failure(w, 400, "INVALID_ARGUMENT", err.(*ai.Error).Message)
		return
	}
	ids, err := ai.DiscoverModels(r.Context(), base, in.APIKey)
	if err != nil {
		a := err.(*ai.Error)
		Failure(w, 502, a.Code, a.Message)
		return
	}
	JSON(w, 200, map[string]any{"base_url": base, "models": ids, "count": len(ids)})
}
