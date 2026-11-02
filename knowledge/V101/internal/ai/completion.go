package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// Completion preserves the structured-output envelope for the extraction engine,
// while reusing credential loading, timeouts and global/per-model concurrency.
func Completion(ctx context.Context, model Model, body map[string]any) (json.RawMessage, error) {
	body["model"] = model.ModelName
	body["stream"] = false
	var output json.RawMessage
	if err := request(ctx, model, "/chat/completions", body, &output); err != nil {
		var upstream *Error
		if errors.As(err, &upstream) && strings.Contains(upstream.Message, "HTTP 400") && body["response_format"] != nil {
			delete(body, "response_format")
			if retryErr := request(ctx, model, "/chat/completions", body, &output); retryErr != nil {
				return nil, retryErr
			}
		} else {
			return nil, err
		}
	}
	return output, nil
}
