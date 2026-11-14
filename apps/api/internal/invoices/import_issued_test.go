package invoices

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// importSession: a session of the browser's workspace for calling the import functions directly, with a document
// holding the uploaded original.
func (e *env) importSession(b *browser) (store.Session, string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: auth.NewID("u") + "@example.com", Name: "Importer"}
	if err := e.st.CreateUser(ctx, u, now); err != nil {
		e.t.Fatal(err)
	}
	doc := store.Document{ID: auth.NewID("doc"), Name: "Rechnung ALT-7 (alt).pdf", Size: 9, ContentType: "application/pdf",
		ObjectKey: "workspaces/" + b.workspace + "/documents/original.pdf"}
	if err := e.st.CreateDocument(ctx, b.workspace, u.ID, doc); err != nil {
		e.t.Fatal(err)
	}
	e.files.objects[doc.ObjectKey] = []byte("%PDF-orig")
	return store.Session{User: u, Workspace: store.Workspace{ID: b.workspace, Timezone: "Europe/Zurich"}, Role: "owner"}, doc.ID
}

func importData(t *testing.T, extra map[string]any) map[string]json.RawMessage {
	t.Helper()
	body := map[string]any{"number": "ALT-7", "issue_date": "2025-10-01", "due_date": "2025-10-31", "currency": "CHF",
		"issued_elsewhere": true, "lines": []any{map[string]any{"description": "Beratung", "quantity": "8", "unit_price": "125.00",
			"vat_category": "S", "vat_rate": "8.1"}}}
	for k, v := range extra {
		if v == nil {
			delete(body, k)
		} else {
			body[k] = v
		}
	}
	out := map[string]json.RawMessage{}
	for k, v := range body {
		out[k], _ = json.Marshal(v)
	}
	return out
}

func importOnce(e *env, sess store.Session, clientID string, data map[string]json.RawMessage, documentID *string) (string, error) {
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = CreateImport(context.Background(), q, sess, clientID, data, documentID)
		return err
	})
	return id, err
}

func errCode(err error) string {
	_, code, _, _ := auth.Describe(err)
	return code
}

func TestImportIssuedElsewhere(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess, docID := e.importSession(b)
	ctx := context.Background()

	id, err := importOnce(e, sess, clientID, importData(t, map[string]any{"paid_amount": "500.00", "paid_on": "2025-10-15"}), &docID)
	if err != nil {
		t.Fatal(err)
	}
	inv := e.invoice(b, "GET", "/api/v1/invoices/"+id, nil, http.StatusOK)
	if inv.Status != "open" || deref(inv.Number) != "ALT-7" || inv.AmountPaid != "500.00" || inv.AmountDue != "581.00" {
		t.Fatalf("imported: status %s number %v paid %s due %s", inv.Status, inv.Number, inv.AmountPaid, inv.AmountDue)
	}
	stored, err := e.st.Invoice(ctx, b.workspace, id, "2026-01-01", false)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.IssuedElsewhere() || deref(stored.SourceDocumentID) != docID || stored.PDFKey != nil || stored.Payment.Reference != nil {
		t.Fatalf("origin %s document %v pdf %v reference %v", stored.Origin, stored.SourceDocumentID, stored.PDFKey, stored.Payment.Reference)
	}
	if seq, err := e.st.PeekInvoiceSeq(ctx, b.workspace, "invoice", 2025); err != nil || seq != 1 {
		t.Fatalf("the Helvetly series moved: next %d %v", seq, err)
	}
	events, err := e.st.Events(ctx, b.workspace, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	kinds := []string{}
	for _, ev := range events {
		kinds = append(kinds, ev.Kind)
	}
	if !slices.Equal(kinds, []string{"invoice.issued", "payment.added"}) {
		t.Fatalf("events %v", kinds)
	}
	if trashed, err := e.st.TrashDocument(ctx, b.workspace, docID, sess.User.ID, "2026-01-01", time.Now()); err != nil || trashed {
		t.Fatalf("the original could be trashed: %v %v", trashed, err)
	}

	// The download is the original as uploaded; sending and a Helvetly PDF are refused.
	res, body := e.send(b, "GET", "/api/v1/invoices/"+id+"/pdf?download=1", nil)
	if res.StatusCode != http.StatusOK || string(body) != "%PDF-orig" || res.Header.Get("Content-Type") != "application/pdf" ||
		res.Header.Get("Content-Disposition") != `attachment; filename="Rechnung ALT-7 (alt).pdf"` {
		t.Fatalf("pdf: %d %q %v", res.StatusCode, body, res.Header)
	}
	e.fails(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{"to": []string{"ap@kunde.ch"}}, http.StatusConflict, "issued_elsewhere")
	// It is an ordinary receivable otherwise: the rest can be paid in Helvetly.
	e.do(b, "POST", "/api/v1/invoices/"+id+"/mark-paid", map[string]any{"paid_on": "2025-11-01"}, http.StatusOK, nil)

	tests := []struct {
		name     string
		extra    map[string]any
		doc      *string
		close    string
		wantCode string
	}{
		{"number already used", map[string]any{}, &docID, "", "number_taken"},
		{"read from a ZIP entry, no original", map[string]any{"number": "ALT-8"}, nil, "", "validation_failed"},
		{"issue date in a closed month", map[string]any{"number": "ALT-9", "issue_date": "2025-09-15", "due_date": "2025-09-30"}, &docID, "2025-09", "period_closed"},
		{"payment in a closed month", map[string]any{"number": "ALT-10", "paid_amount": "10.00", "paid_on": "2025-09-20"}, &docID, "2025-09", "period_closed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.close != "" {
				if _, err := e.st.ClosePeriod(ctx, b.workspace, tt.close, nil, time.Now()); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := importOnce(e, sess, clientID, importData(t, tt.extra), tt.doc); errCode(err) != tt.wantCode {
				t.Fatalf("got %v, want %s", err, tt.wantCode)
			}
		})
	}
	if events, _ := e.st.Events(ctx, b.workspace, 0, 100); len(events) != 3 {
		t.Fatalf("a refused import logged events: %d", len(events))
	}
}

func TestOverwriteImport(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess, docID := e.importSession(b)
	ctx := context.Background()
	overwrite := func(id string, data map[string]json.RawMessage) error {
		return e.st.Tx(ctx, func(q store.Q) error {
			_, err := OverwriteImport(ctx, q, sess, id, clientID, data, &docID)
			return err
		})
	}
	conflict := func(data map[string]json.RawMessage) *store.ImportConflict {
		t.Helper()
		c, err := NumberConflict(ctx, e.st.Q, b.workspace, data)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}

	id, err := importOnce(e, sess, clientID, importData(t, nil), &docID)
	if err != nil {
		t.Fatal(err)
	}
	if c := conflict(importData(t, map[string]any{"issued_elsewhere": false})); c != nil {
		t.Fatalf("a draft import never conflicts: %+v", c)
	}
	newer := importData(t, map[string]any{"issue_date": "2025-10-02", "lines": []any{map[string]any{"description": "Workshop",
		"quantity": "1", "unit_price": "200.00", "vat_category": "S", "vat_rate": "8.1"}}})
	if c := conflict(newer); c == nil || c.ID != id || !c.CanOverwrite || c.Why != nil || c.Reason != "number already used" {
		t.Fatalf("untouched import: %+v", c)
	}
	if err := overwrite(id, newer); err != nil {
		t.Fatal(err)
	}
	inv, err := e.st.Invoice(ctx, b.workspace, id, "2026-01-01", false)
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != "open" || deref(inv.Number) != "ALT-7" || inv.Total != 21620 || inv.IssueDate != "2025-10-02" || len(inv.Lines) != 1 {
		t.Fatalf("overwritten: %s %v %d %s %d", inv.Status, inv.Number, inv.Total, inv.IssueDate, len(inv.Lines))
	}
	if events, _ := e.st.Events(ctx, b.workspace, 0, 100); events[len(events)-1].Kind != "invoice.import_overwritten" {
		t.Fatalf("not logged: %+v", events[len(events)-1])
	}

	helvetly := e.issued(b, clientID, nil)
	paid, err := importOnce(e, sess, clientID, importData(t, map[string]any{"number": "ALT-PAID", "paid_amount": "1.00", "paid_on": "2025-10-05"}), &docID)
	if err != nil {
		t.Fatal(err)
	}
	reminded, err := importOnce(e, sess, clientID, importData(t, map[string]any{"number": "ALT-DUN"}), &docID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.st.LogDunningNotice(ctx, b.workspace, store.DunningNotice{InvoiceID: reminded, Level: 1, Levels: 1,
		SentAt: time.Now(), SentOn: "2025-11-15", Open: 1, Total: 1, Email: "a@b.ch"}, nil); err != nil {
		t.Fatal(err)
	}
	credited, err := importOnce(e, sess, clientID, importData(t, map[string]any{"number": "ALT-CN"}), &docID)
	if err != nil {
		t.Fatal(err)
	}
	e.invoice(b, "POST", "/api/v1/invoices/"+credited+"/credit-note", map[string]any{}, http.StatusCreated)
	closed, err := importOnce(e, sess, clientID, importData(t, map[string]any{"number": "ALT-OLD", "issue_date": "2025-08-01",
		"due_date": "2025-08-31"}), &docID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.st.ClosePeriod(ctx, b.workspace, "2025-08", nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	refused := []struct {
		name, id, number, why string
	}{
		{"issued in Helvetly", helvetly.ID, deref(helvetly.Number), "It was issued in Helvetly and cannot be changed. Skip this row; to correct that invoice, issue a credit note."},
		{"with a payment", paid, "ALT-PAID", "It already has payments recorded."},
		{"with a dunning letter", reminded, "ALT-DUN", "A payment reminder was already sent for it."},
		{"with a credit note", credited, "ALT-CN", "It already has a credit note or correction."},
		{"in a closed month", closed, "ALT-OLD", "Its month is closed in the books."},
	}
	for _, tt := range refused {
		t.Run(tt.name, func(t *testing.T) {
			data := importData(t, map[string]any{"number": tt.number})
			c := conflict(data)
			if c == nil || c.ID != tt.id || c.CanOverwrite || c.Why == nil || *c.Why != tt.why {
				t.Fatalf("conflict %+v", c)
			}
			if err := overwrite(tt.id, data); errCode(err) != "cannot_overwrite" {
				t.Fatalf("overwrite: %v", err)
			}
		})
	}
	if err := overwrite(id, importData(t, map[string]any{"number": "ALT-OTHER"})); errCode(err) != "invalid_state" {
		t.Fatalf("overwrite with another number: %v", err)
	}
}
