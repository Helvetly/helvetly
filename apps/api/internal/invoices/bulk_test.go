package invoices

import (
	"net/http"
	"testing"
)

func TestBulkIssueAndMarkPaid(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, _ := e.team()
	b := tm.author
	scheduled := e.issuedSchedule(b, clientID) // CHF 1'081.00 in three instalments
	plain := e.issued(b, clientID, nil)
	partial := e.issued(b, clientID, nil)
	e.do(b, "POST", path(partial.ID, "payments"), map[string]any{"amount": "16.00", "method": "cash"}, http.StatusCreated, nil)
	small := e.draft(b, clientID, nil) // CHF 216.20
	big := e.draft(b, clientID, map[string]any{"lines": []any{line("1", "5000.00")}})
	e.policy(b, "invoice", "1000.00", rule(acc, 1)) // only the big draft needs approval
	other, otherClient := e.ready()
	foreignIssued, foreignDraft := e.issued(other, otherClient, nil), e.draft(other, otherClient, nil)

	for _, tc := range []struct {
		name, action string
		want         map[string]string // id → error code, "" for done
	}{
		{"mark paid", "mark_paid", map[string]string{scheduled.ID: "", plain.ID: "", partial.ID: "", small.ID: "invalid_state",
			foreignIssued.ID: "not_found"}},
		{"paid twice", "mark_paid", map[string]string{plain.ID: "invalid_state"}},
		{"issue", "issue", map[string]string{small.ID: "", big.ID: "approval_required", plain.ID: "invalid_state",
			foreignDraft.ID: "not_found"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ids := []string{}
			for id := range tc.want {
				ids = append(ids, id, id) // a repeated id is done once
			}
			var out struct{ Data []bulkResult }
			e.do(b, "POST", "/api/v1/invoices/bulk", map[string]any{"action": tc.action, "ids": ids}, http.StatusOK, &out)
			if len(out.Data) != len(tc.want) {
				t.Fatalf("results %+v", out.Data)
			}
			for _, r := range out.Data {
				if want, ok := tc.want[r.ID]; !ok || r.Error != want || r.OK != (want == "") {
					t.Fatalf("%s: %+v, want error %q", r.ID, r, want)
				}
			}
		})
	}

	for _, id := range []string{plain.ID, partial.ID} {
		if got := e.invoice(b, "GET", path(id), nil, http.StatusOK); got.Status != "paid" || got.AmountDue != "0.00" {
			t.Fatalf("%s: status %s, due %s", id, got.Status, got.AmountDue)
		}
	}
	for _, it := range e.sched(b, "GET", path(scheduled.ID), nil, http.StatusOK).Instalments.Items {
		if it.Status != "paid" {
			t.Fatalf("instalment %d: %s", it.Seq, it.Status)
		}
	}
	if got := e.invoice(b, "GET", path(small.ID), nil, http.StatusOK); got.Status != "open" || got.Number == nil {
		t.Fatalf("small draft: %s", got.Status)
	}
	if got := e.invoice(b, "GET", path(big.ID), nil, http.StatusOK); got.Status != "draft" {
		t.Fatalf("draft needing approval: %s", got.Status)
	}
	if got := e.invoice(other, "GET", path(foreignIssued.ID), nil, http.StatusOK); got.Status != "open" {
		t.Fatalf("another workspace's invoice: %s", got.Status)
	}

	e.fails(b, "POST", "/api/v1/invoices/bulk", map[string]any{"action": "void", "ids": []string{}}, http.StatusUnprocessableEntity,
		"validation_failed", "action", "ids")
}
