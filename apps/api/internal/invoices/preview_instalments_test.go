package invoices

import (
	"net/http"
	"reflect"
	"testing"
)

// The editor previews a schedule before saving: the preview's rows are the ones PATCH stores.
func TestPreviewInstalmentsMatchPatch(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	given := map[string]any{"count": 2, "interval": "quarterly", "first_due_date": "2099-01-31", "items": []any{
		map[string]any{"due_date": "2099-01-31", "amount": "1000.00"}, map[string]any{"due_date": "2099-04-30", "amount": "81.00"}}}
	for _, tc := range []struct {
		name  string
		sched map[string]any
		rows  int
	}{
		{"generated", monthly3, 3},
		{"given", given, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lines := []any{line("1", "1000.00")}
			saved := e.draft1081(b, clientID, nil)
			saved = e.sched(b, "PATCH", path(saved.ID), map[string]any{"instalments": tc.sched}, http.StatusOK)
			for _, body := range []map[string]any{
				{"client_id": clientID, "lines": lines, "instalments": tc.sched},
				{"lines": lines, "instalments": tc.sched}, // the editor previews before a client is chosen
			} {
				prev := e.sched(b, "POST", "/api/v1/invoices/preview", body, http.StatusOK)
				if prev.Instalments == nil || len(prev.Instalments.Items) != tc.rows {
					t.Fatalf("preview %+v", prev.Instalments)
				}
				if !reflect.DeepEqual(prev.Instalments, saved.Instalments) || prev.DueDate != saved.DueDate {
					t.Fatalf("preview %+v (due %s), saved %+v (due %s)", prev.Instalments, prev.DueDate, saved.Instalments, saved.DueDate)
				}
			}
		})
	}
	e.fails(b, "POST", "/api/v1/invoices/preview", map[string]any{"kind": "proforma", "lines": []any{line("1", "1000.00")},
		"instalments": monthly3}, http.StatusUnprocessableEntity, "validation_failed", "instalments")
}
