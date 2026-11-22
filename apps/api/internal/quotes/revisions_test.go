package quotes

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"helvetly.com/api/internal/store"
)

func (e *env) revisions(b *browser, id string, want int) []store.QuoteRevision {
	e.t.Helper()
	var out struct{ Data []store.QuoteRevision }
	e.do(b, "GET", "/api/v1/quotes/"+id+"/revisions", nil, want, &out)
	return out.Data
}

// pdfRedirect answers the status and Location of a revision PDF download, without following it.
func (e *env) pdfRedirect(b *browser, id, revision string) (int, string) {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/quotes/"+id+"/revisions/"+revision+"/pdf", nil)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	client := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, resp.Header.Get("Location")
}

func TestRevisionsKeptAsSent(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	if got := e.revisions(b, q.ID, 200); len(got) != 0 {
		t.Fatalf("a draft has revisions: %+v", got)
	}
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/decline", map[string]any{"note": "super bad!!!"}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/revise", map[string]any{}, http.StatusOK)
	e.quote(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"lines": []any{line("3", "90.00")}}, http.StatusOK)
	if got := e.revisions(b, q.ID, 200); len(got) != 1 || got[0].Current {
		t.Fatalf("while revision 2 is a draft: %+v", got)
	}
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"to": []string{"boss@kunde.ch"}}, http.StatusOK) // resend

	got := e.revisions(b, q.ID, 200)
	if len(got) != 2 {
		t.Fatalf("%d revisions", len(got))
	}
	r2, r1 := got[0], got[1]
	if r2.Revision != 2 || !r2.Current || len(r2.SentTo) != 0 || r2.Outcome != nil || !r2.HasPDF || r2.Snapshot == nil ||
		r2.Snapshot.Lines[0].Quantity.String() != "3" || r2.Snapshot.Revision != 2 || r2.SentAt == nil {
		t.Fatalf("revision 2: %+v", r2)
	}
	if r1.Revision != 1 || r1.Current || !slices.Equal(r1.SentTo, []string{"ap@kunde.ch"}) || r1.Outcome == nil ||
		*r1.Outcome != "declined" || *r1.Reason != "super bad!!!" || *r1.OutcomeBy != "staff" || r1.OutcomeAt == nil ||
		r1.Snapshot == nil || r1.Snapshot.Lines[0].Quantity.String() != "2" || r1.Snapshot.PayableTotal.String() != "216.20" {
		t.Fatalf("revision 1: %+v", r1)
	}

	status, location := e.pdfRedirect(b, q.ID, "1")
	if status != http.StatusFound || location != "https://s3.test/quotes/"+b.workspace+"/"+q.ID+"-r1.pdf" {
		t.Fatalf("revision 1 pdf: %d %s", status, location)
	}
	for _, rev := range []string{"3", "0", "x"} {
		if status, _ := e.pdfRedirect(b, q.ID, rev); status != http.StatusNotFound {
			t.Fatalf("revision %s pdf: %d", rev, status)
		}
	}

	// another workspace sees none of it
	other := e.workspace()
	e.fails(other, "GET", "/api/v1/quotes/"+q.ID+"/revisions", nil, 404, "not_found", "")
	if status, _ := e.pdfRedirect(other, q.ID, "1"); status != http.StatusNotFound {
		t.Fatalf("other workspace's pdf: %d", status)
	}

	// a sent revision is never rewritten
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `UPDATE quote_revisions SET snapshot = '{}' WHERE quote_id = $1`, q.ID); err == nil {
		t.Fatal("snapshot rewritten")
	}
	if _, err := e.pool.Exec(ctx, `UPDATE quote_revisions SET reason = 'other' WHERE quote_id = $1 AND revision = 1`, q.ID); err == nil {
		t.Fatal("answer rewritten")
	}

	// the accepted answer lands on the current revision only
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/accept", map[string]any{}, http.StatusOK)
	got = e.revisions(b, q.ID, 200)
	if *got[0].Outcome != "accepted" || *got[1].Outcome != "declined" {
		t.Fatalf("after accept: %v %v", *got[0].Outcome, *got[1].Outcome)
	}
}

func TestRevisionExpired(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": e.client(b), "issue_date": "2026-10-01",
		"valid_until": "2026-10-31", "lines": []any{line("1", "10.00")}}, http.StatusCreated)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if got := e.revisions(b, q.ID, 200); len(got) != 1 || got[0].Outcome == nil || *got[0].Outcome != "expired" || !got[0].Current {
		t.Fatalf("expired while current: %+v", got)
	}
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/revise", map[string]any{}, http.StatusOK)
	got := e.revisions(b, q.ID, 200)
	if len(got) != 1 || got[0].Current || got[0].Outcome == nil || *got[0].Outcome != "expired" || got[0].OutcomeAt != nil {
		t.Fatalf("expired once revised: %+v", got)
	}
}

// Revisions sent before they were kept are filled in once: earlier ones with their stored PDF and no snapshot, the
// current one from the quote as it stands; a second run adds nothing.
func TestBackfillRevisions(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/revise", map[string]any{}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/revise", map[string]any{}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/decline", map[string]any{"note": "no"}, http.StatusOK)
	ctx := context.Background()
	// revision 2's PDF is gone from storage; the table did not exist yet
	if _, err := e.pool.Exec(ctx, `DELETE FROM stored_objects WHERE object_key LIKE '%-r2.pdf'`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `DELETE FROM quote_revisions`); err != nil {
		t.Fatal(err)
	}
	draft := e.draft(b, e.client(b))

	for range 2 {
		if err := e.svc.backfillRevisions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	got := e.revisions(b, q.ID, 200)
	if len(got) != 3 {
		t.Fatalf("%d revisions: %+v", len(got), got)
	}
	r3, r2, r1 := got[0], got[1], got[2]
	if !r3.Current || r3.Snapshot == nil || r3.Snapshot.Status != "sent" || r3.Snapshot.DecisionNote != nil || !r3.HasPDF ||
		r3.Outcome == nil || *r3.Outcome != "declined" || *r3.Reason != "no" || r3.SentAt == nil {
		t.Fatalf("current revision: %+v", r3)
	}
	if r2.Snapshot != nil || r2.HasPDF || r2.SentAt != nil {
		t.Fatalf("revision without its PDF: %+v", r2)
	}
	if r1.Snapshot != nil || !r1.HasPDF || r1.SentAt == nil {
		t.Fatalf("revision with its PDF: %+v", r1)
	}
	if got := e.revisions(b, draft.ID, 200); len(got) != 0 {
		t.Fatalf("a draft got revisions: %+v", got)
	}
	var n int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM quote_revisions`).Scan(&n); err != nil || n != 3 {
		t.Fatalf("%d rows, %v", n, err)
	}
}

// An imported quote that was sent elsewhere has its one revision, with the answer it came with.
func TestImportedRevision(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	inv := asInvoice(e.draft(b, e.client(b)))
	number := "OF-17"
	id, err := CreateImport(context.Background(), e.st.Q, store.Session{Workspace: store.Workspace{ID: b.workspace}}, inv, &number, "declined", fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	got := e.revisions(b, id, 200)
	if len(got) != 1 || !got[0].Current || got[0].HasPDF || got[0].Snapshot == nil || *got[0].Outcome != "declined" {
		t.Fatalf("imported: %+v", got)
	}
}
