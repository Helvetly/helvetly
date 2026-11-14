package invoices

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

// An issued invoice keeps its buyer snapshot after the client is deleted: it can still be voided, credited,
// debited or corrected, while a new primary document for that client stays refused.
func TestDeletedClientDerivedDocuments(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	toVoid := e.issued(b, clientID, nil)
	sources := map[string]Invoice{}
	for _, kind := range []string{"credit_note", "debit_note", "corrected"} {
		sources[kind] = e.issued(b, clientID, nil)
	}
	fresh := e.draft(b, clientID, nil)
	if _, err := e.st.BulkClients(context.Background(), b.workspace, []string{clientID}, "delete", time.Now()); err != nil {
		t.Fatal(err)
	}

	if got := e.invoice(b, "POST", path(toVoid.ID, "void"), map[string]any{}, http.StatusOK); got.Status != "void" {
		t.Fatalf("voided: %+v", got)
	}
	cns := e.creditNotes(b)
	if len(cns) != 1 || !strings.Contains(e.storedPDFText(cns[0].ID), pdfUnicode("Kunde AG")) {
		t.Fatalf("void credit note must carry the buyer snapshot: %+v", cns)
	}
	for kind, src := range sources {
		t.Run(kind, func(t *testing.T) {
			got := e.invoice(b, "POST", path(e.derived(b, src.ID, kind, nil), "issue"), nil, http.StatusOK)
			if got.Buyer == nil || got.Buyer.Name != "Kunde AG" || got.Buyer.City != "Lausanne" {
				t.Fatalf("%s buyer: %+v", kind, got.Buyer)
			}
		})
	}
	out := e.fails(b, "POST", path(fresh.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
	if codes := reasonCodes(out); len(codes) != 1 || codes[0] != "client_deleted" {
		t.Fatalf("primary document for a deleted client: %v", codes)
	}
}
