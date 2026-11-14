package invoices

import (
	"net/http"
	"testing"
)

// An invoice imported as issued elsewhere keeps its own number. When that number is one the workspace's own series
// will reach, the next issue must skip it, never fail on the duplicate (which would block the series for the year).
func TestIssueSkipsNumberTakenByImportedInvoice(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess, docID := e.importSession(b)
	year := e.today()[:4]
	for _, n := range []string{year + "-001", year + "-002"} {
		if _, err := importOnce(e, sess, clientID, importData(t, map[string]any{"number": n, "issue_date": e.today(),
			"due_date": e.today()}), &docID); err != nil {
			t.Fatal(err)
		}
	}
	first := e.issued(b, clientID, nil)
	second := e.issued(b, clientID, map[string]any{"kind": "partial"}) // shares the invoice series
	if *first.Number != year+"-003" || *second.Number != year+"-004" {
		t.Fatalf("numbers %s, %s: want %s-003, %s-004", *first.Number, *second.Number, year, year)
	}
	if got := e.invoice(b, "GET", path(first.ID), nil, http.StatusOK); got.Status != "open" {
		t.Fatalf("status %s", got.Status)
	}
}
