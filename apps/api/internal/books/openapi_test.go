package books

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/openapi"
)

// The public API documents closed periods, activity and the audit log; their response types are unexported, so the
// check lives here.
func TestDocumentedResponsesMatch(t *testing.T) {
	extra := map[string][]string{"AuditEvent": {"payload"}}
	for schema, typ := range map[string]reflect.Type{
		"PeriodClosing":        reflect.TypeFor[period](),
		"PeriodActivityTotal":  reflect.TypeFor[activityTotal](),
		"PeriodActivitySource": reflect.TypeFor[activitySource](),
		"PeriodActivityMonth":  reflect.TypeFor[monthActivity](),
		"AuditEvent":           reflect.TypeFor[event](),
		"AuditSubject":         reflect.TypeFor[subject](),
	} {
		// payload is raw JSON (an object): the drift check reads json.RawMessage as a string, so it is only checked by name.
		for _, d := range openapi.Drift(schema, typ, extra[schema]...) {
			t.Error(d)
		}
	}
}
