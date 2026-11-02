package ai

import (
	"context"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/bootstrap"
)

type Connection struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	APIKey      string `json:"api_key,omitempty"`
	ClearAPIKey bool   `json:"clear_api_key,omitempty"`
}

type ConnectionQuery interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func LoadConnection(ctx context.Context, services *bootstrap.Services, query ConnectionQuery, id string) (Connection, error) {
	var c Connection
	var secret []byte
	err := query.QueryRow(ctx, "SELECT id::text,name,base_url,secret FROM model_connections WHERE id::text=$1", id).Scan(&c.ID, &c.Name, &c.BaseURL, &secret)
	if err != nil {
		return c, &Error{Code: "CONNECTION_NOT_FOUND", Message: "服务连接不存在"}
	}
	c.APIKey, err = services.Identity.Decrypt(secret)
	if err != nil {
		return c, &Error{Code: "CREDENTIAL_DECRYPT_FAILED", Message: "无法解密服务连接凭证"}
	}
	return c, nil
}

func ApplyConnection(ctx context.Context, services *bootstrap.Services, query ConnectionQuery, m *Model) error {
	if m.ConnectionID == "" {
		return nil
	}
	if m.APIKey != "" || m.ClearAPIKey {
		return &Error{Code: "CONNECTION_CREDENTIAL_CONFLICT", Message: "选择服务连接后，请到连接管理中修改 Key，或切换为手动填写"}
	}
	connection, err := LoadConnection(ctx, services, query, m.ConnectionID)
	if err != nil {
		return err
	}
	// Client-supplied URLs never redirect a saved connection's credentials.
	m.BaseURL, m.APIKey = connection.BaseURL, connection.APIKey
	return nil
}

func SupportsPurpose(modelPurpose, purpose string) bool {
	return modelPurpose == purpose ||
		(modelPurpose == "text" || modelPurpose == "outline") && (purpose == "text" || purpose == "outline")
}
