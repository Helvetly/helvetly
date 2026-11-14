package dashboard

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/openapi"
)

// The public API documents the dashboard (get_key_figures); its response type is unexported, so the check lives here.
func TestDocumentedResponseMatches(t *testing.T) {
	for _, d := range openapi.Drift("KeyFigures", reflect.TypeFor[response]()) {
		t.Error(d)
	}
}
