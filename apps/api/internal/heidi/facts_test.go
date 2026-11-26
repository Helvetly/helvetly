package heidi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/openapi"
)

// An API response field added or renamed must be reviewed before it can enter Heidi's model context.
func TestPublicReadResponseFieldsHaveBeenReviewed(t *testing.T) {
	mux := http.NewServeMux()
	openapi.Register(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/openapi.json", nil))
	type schema map[string]any
	var spec struct {
		Components struct{ Schemas map[string]schema }
		Paths      map[string]struct {
			Get struct {
				OperationID string
				Responses   map[string]struct {
					Content map[string]struct{ Schema schema }
				}
			}
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	skipped := strings.Fields("ai_filing avatar_url bcc cc iban revolut_url sha256 snapshot url website")
	seen := map[string]bool{}
	var visit func(string, map[string]any)
	visit = func(operation string, s map[string]any) {
		if ref, ok := s["$ref"].(string); ok {
			if !seen[ref] {
				seen[ref] = true
				visit(operation, spec.Components.Schemas[strings.TrimPrefix(ref, "#/components/schemas/")])
			}
		}
		if props, ok := s["properties"].(map[string]any); ok {
			for key, child := range props {
				if !slices.Contains(factFields, key) && !slices.Contains(skipped, key) {
					t.Errorf("review %s response field %q", operation, key)
				}
				if nested, ok := child.(map[string]any); ok {
					visit(operation, nested)
				}
			}
		}
		for _, key := range []string{"items", "additionalProperties"} {
			if nested, ok := s[key].(map[string]any); ok {
				visit(operation, nested)
			}
		}
		for _, key := range []string{"anyOf", "oneOf", "allOf"} {
			if list, ok := s[key].([]any); ok {
				for _, v := range list {
					if nested, ok := v.(map[string]any); ok {
						visit(operation, nested)
					}
				}
			}
		}
	}
	for _, path := range spec.Paths {
		op := path.Get
		if _, ok := workspaceOps[op.OperationID]; !ok {
			continue
		}
		for status, response := range op.Responses {
			if strings.HasPrefix(status, "2") {
				visit(op.OperationID, response.Content["application/json"].Schema)
			}
		}
	}
	for _, private := range skipped {
		if slices.Contains(factFields, private) {
			t.Errorf("unconditionally exposing %s", private)
		}
	}
}
