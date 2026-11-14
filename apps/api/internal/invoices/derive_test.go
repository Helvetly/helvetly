package invoices

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestCorrectOnlyOpenOrPaidUncredited(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	draft := e.draft(b, client, nil)
	open := e.issued(b, client, nil)
	paid := e.issued(b, client, nil)
	e.invoice(b, "POST", "/api/v1/invoices/"+paid.ID+"/mark-paid", map[string]any{}, http.StatusOK)
	credited := e.issued(b, client, nil)
	cn := e.invoice(b, "POST", "/api/v1/invoices/"+credited.ID+"/credit-note", map[string]any{"lines": []any{line("1", "10")}}, http.StatusCreated)
	e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
	proforma := e.issued(b, client, map[string]any{"kind": "proforma"})

	for _, id := range []string{draft.ID, credited.ID, cn.ID, proforma.ID} {
		e.fails(b, "POST", "/api/v1/invoices/"+id+"/correct", nil, http.StatusConflict, "invalid_state")
	}
	for _, src := range []Invoice{open, paid} {
		got := e.invoice(b, "POST", "/api/v1/invoices/"+src.ID+"/correct", nil, http.StatusCreated)
		if got.Kind != "corrected" || got.Status != "draft" || got.TypeCode != "384" || got.CreditedInvoice == nil ||
			got.CreditedInvoice.ID != src.ID || len(got.Lines) != 1 || got.Total != src.Total {
			t.Fatalf("correct %s: %+v", src.Status, got)
		}
	}
}

func TestDebitNoteEmptyLinesReferencesSource(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	draft := e.draft(b, client, nil)
	proforma := e.issued(b, client, map[string]any{"kind": "proforma"})
	for _, id := range []string{draft.ID, proforma.ID} {
		e.fails(b, "POST", "/api/v1/invoices/"+id+"/debit-note", nil, http.StatusConflict, "invalid_state")
	}
	src := e.issued(b, client, nil)
	got := e.invoice(b, "POST", "/api/v1/invoices/"+src.ID+"/debit-note", nil, http.StatusCreated)
	if got.Kind != "debit_note" || got.Status != "draft" || got.TypeCode != "383" || len(got.Lines) != 0 ||
		got.CreditedInvoice == nil || got.CreditedInvoice.ID != src.ID || got.CreditedInvoice.Number != *src.Number {
		t.Fatalf("debit note: %+v", got)
	}
}

func TestConvertOnlyFromIssuedProforma(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	draftPF := e.draft(b, client, map[string]any{"kind": "proforma"})
	invoice := e.issued(b, client, nil)
	proforma := e.issued(b, client, map[string]any{"kind": "proforma"})
	path := "/api/v1/invoices/" + proforma.ID + "/convert"

	for _, kind := range []string{"credit_note", "proforma", ""} {
		e.fails(b, "POST", path, map[string]any{"kind": kind}, http.StatusUnprocessableEntity, "validation_failed", "kind")
	}
	e.fails(b, "POST", path, map[string]any{"kind": 7}, http.StatusBadRequest, "invalid_request")
	for _, id := range []string{draftPF.ID, invoice.ID} {
		e.fails(b, "POST", "/api/v1/invoices/"+id+"/convert", map[string]any{"kind": "invoice"}, http.StatusConflict, "invalid_state")
	}
	for _, tt := range []struct{ kind, code string }{{"invoice", "380"}, {"prepayment", "386"}} {
		got := e.invoice(b, "POST", path, map[string]any{"kind": tt.kind}, http.StatusCreated)
		if got.Kind != tt.kind || got.Status != "draft" || got.TypeCode != tt.code || got.CreditedInvoice != nil ||
			len(got.Lines) != 1 || got.Total != proforma.Total {
			t.Fatalf("convert to %s: %+v", tt.kind, got)
		}
	}
	if after := e.invoice(b, "GET", "/api/v1/invoices/"+proforma.ID, nil, http.StatusOK); after.Status != "open" {
		t.Fatalf("proforma after convert: %s", after.Status)
	}
}

// Members may derive drafts, as they may credit an invoice (only void is owner/admin).
func TestDerivedMemberAllowed(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	member := e.join(b.workspace, "member")
	src := e.issued(b, client, nil)
	proforma := e.issued(b, client, map[string]any{"kind": "proforma"})
	e.invoice(member, "POST", "/api/v1/invoices/"+src.ID+"/correct", nil, http.StatusCreated)
	e.invoice(member, "POST", "/api/v1/invoices/"+src.ID+"/debit-note", nil, http.StatusCreated)
	e.invoice(member, "POST", "/api/v1/invoices/"+proforma.ID+"/convert", map[string]any{"kind": "invoice"}, http.StatusCreated)
}

func TestDerivedOtherWorkspace404(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	other, _ := e.ready()
	src := e.issued(b, client, nil)
	proforma := e.issued(b, client, map[string]any{"kind": "proforma"})
	for _, tt := range []struct {
		path string
		body any
	}{
		{"/api/v1/invoices/" + src.ID + "/correct", nil},
		{"/api/v1/invoices/" + src.ID + "/debit-note", nil},
		{"/api/v1/invoices/" + proforma.ID + "/convert", map[string]any{"kind": "invoice"}},
	} {
		e.fails(other, "POST", tt.path, tt.body, http.StatusNotFound, "not_found")
	}
}

func TestCorrectFinalTakesOverPrepayments(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.paidPrepayment(b, client, nil)
	final := e.invoice(b, "POST", path(e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")},
		"prepayment_ids": []string{pre.ID}}).ID, "issue"), nil, http.StatusOK)
	draft := e.invoice(b, "POST", path(final.ID, "correct"), nil, http.StatusCreated)
	if draft.PrepaidTotal != final.PrepaidTotal || draft.PayableTotal != final.PayableTotal {
		t.Fatalf("corrected draft: prepaid %s payable %s, original %s %s", draft.PrepaidTotal, draft.PayableTotal,
			final.PrepaidTotal, final.PayableTotal)
	}
	corrected := e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
	if corrected.Status != "open" || corrected.PrepaidTotal != final.PrepaidTotal || corrected.PayableTotal != final.PayableTotal {
		t.Fatalf("corrected: %+v", corrected)
	}
	if got := e.invoice(b, "GET", path(pre.ID), nil, http.StatusOK); got.DeductedOn == nil || got.DeductedOn.ID != corrected.ID {
		t.Fatalf("prepayment deducted_on %+v, want the correction", got.DeductedOn)
	}
	if got := e.invoice(b, "GET", path(final.ID), nil, http.StatusOK); got.Status != "replaced" {
		t.Fatalf("original %s", got.Status)
	}
}

func TestPaymentsNotifyManagers(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.join(b.workspace, "admin")
	e.join(b.workspace, "member")
	e.join(b.workspace, "admin")
	other, otherClient := e.ready() // another workspace: its owner hears nothing of b's payments
	ctx := context.Background()
	members, err := e.st.ListMembers(ctx, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	// One of the two admins turned both events off.
	var quietID string
	for _, m := range members {
		if m.Role == "admin" {
			quietID = m.UserID
		}
	}
	off := store.NotificationChoice{}
	if err := e.st.SetUserNotificationPrefs(ctx, quietID, store.NotificationPrefs{"invoice.paid": off, "invoice.partly_paid": off}, time.Now()); err != nil {
		t.Fatal(err)
	}

	part := e.issued(b, client, nil)
	e.invoice(b, "POST", "/api/v1/invoices/"+part.ID+"/payments", map[string]any{"amount": "1", "method": "cash"}, http.StatusCreated)
	full := e.issued(b, client, nil)
	e.invoice(b, "POST", "/api/v1/invoices/"+full.ID+"/mark-paid", map[string]any{}, http.StatusOK)
	e.issued(other, otherClient, nil)

	for _, m := range members {
		got, err := e.st.Notifications(ctx, b.workspace, m.UserID, store.NotificationFilter{Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		var events []string
		for _, n := range got {
			events = append(events, n.Event)
		}
		// Only the first admin: the owner recorded it, a member does not look after the workspace, the second turned it off.
		want := []string(nil)
		if m.Role == "admin" && m.UserID != quietID {
			want = []string{"invoice.paid", "invoice.partly_paid"}
			if !strings.Contains(string(got[0].Data), full.ID) || !strings.Contains(string(got[1].Data), `"open"`) ||
				!strings.Contains(string(got[1].Data), `"amount": "1.00"`) {
				t.Fatalf("data %s / %s", got[0].Data, got[1].Data)
			}
		}
		if !slices.Equal(events, want) {
			t.Fatalf("%s: %v, want %v", m.Role, events, want)
		}
	}
	others, err := e.st.ListMembers(ctx, other.workspace)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range others {
		if got, _ := e.st.Notifications(ctx, other.workspace, m.UserID, store.NotificationFilter{Limit: 10}); len(got) != 0 {
			t.Fatalf("other workspace: %+v", got)
		}
	}
}
