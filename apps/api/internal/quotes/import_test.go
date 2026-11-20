package quotes

import (
	"context"
	"net/http"
	"testing"

	"helvetly.com/api/internal/store"
)

// An imported quote holding the series' next number is skipped when a draft is sent: the draft takes the next free one.
func TestSendSkipsImportedNumber(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	imported := e.draft(b, c)
	inv := asInvoice(imported)
	taken := "Q-2026-001"
	id, err := CreateImport(context.Background(), e.st.Q, store.Session{Workspace: store.Workspace{ID: b.workspace}}, inv, &taken, "accepted", fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	got := e.quote(b, "GET", "/api/v1/quotes/"+id, nil, http.StatusOK)
	if got.Status != "accepted" || got.Number == nil || *got.Number != taken || got.SentAt == nil || got.DecidedBy == nil || *got.DecidedBy != "staff" {
		t.Fatalf("imported %+v", got)
	}
	sent := e.quote(b, "POST", "/api/v1/quotes/"+imported.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if sent.Number == nil || *sent.Number != "Q-2026-002" {
		t.Fatalf("sent as %v, want Q-2026-002", sent.Number)
	}
}
