package expenses

import (
	"context"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

type duplicateExpense struct {
	ID          string `json:"id"`
	DuplicateOf *struct {
		ID     string  `json:"id"`
		Number int64   `json:"number"`
		Date   *string `json:"date"`
	} `json:"duplicate_of"`
}

func TestDuplicateSupplierReceiptWarns(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	receipt := func(supplier, ref string) duplicateExpense {
		var out struct{ Data duplicateExpense }
		e.do(owner, "POST", "/api/v1/expenses", map[string]any{"supplier_name": supplier, "reference": ref, "document_date": "2026-11-02"}, 201, &out)
		return out.Data
	}
	first := receipt("ACME", "R-17")
	if first.DuplicateOf != nil {
		t.Fatalf("first: %+v", first.DuplicateOf)
	}
	second := receipt("acme", "r-17")
	if d := second.DuplicateOf; d == nil || d.ID != first.ID || d.Number != 1 || d.Date == nil || *d.Date != "2026-11-02" {
		t.Fatalf("second: %+v", d)
	}
	if other := receipt("ACME", "R-18"); other.DuplicateOf != nil {
		t.Fatalf("another receipt number: %+v", other.DuplicateOf)
	}
	var got struct{ Data duplicateExpense }
	e.do(owner, "GET", "/api/v1/expenses/"+second.ID, nil, 200, &got)
	if got.Data.DuplicateOf == nil || got.Data.DuplicateOf.ID != first.ID {
		t.Fatalf("get: %+v", got.Data.DuplicateOf)
	}
	// A warning only: the second one still saves.
	e.do(owner, "PATCH", "/api/v1/expenses/"+second.ID, map[string]any{"description": "Same?"}, 200, nil)
}

// booked creates a complete expense dated date with a receipt and books it.
func (e *env) booked(b *browser, date string) expense {
	e.t.Helper()
	body := complete(e.categories(b)["6640"].ID)
	body["document_date"] = date
	x := e.create(b, body)
	if resp := e.upload(b, x.ID, "ticket.pdf", append(append([]byte{}, pdf...), []byte(x.ID)...)); resp.StatusCode != 201 {
		e.t.Fatalf("upload: %d", resp.StatusCode)
	}
	e.do(b, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, 200, nil)
	return x
}

func TestExpensePeriodClosed(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	ctx := context.Background()
	open := e.booked(owner, "2026-10-20")
	e.do(owner, "PATCH", "/api/v1/expenses/"+open.ID, map[string]any{"payment_status": "paid", "paid_on": "2026-10-21"}, 200, nil)

	body := complete(e.categories(owner)["6640"].ID)
	body["document_date"] = "2026-10-15"
	draft := e.create(owner, body)
	if resp := e.upload(owner, draft.ID, "ticket.pdf", pdf); resp.StatusCode != 201 {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	if _, err := e.st.ClosePeriod(ctx, owner.workspace, "2026-10", &owner.user, time.Now()); err != nil {
		t.Fatal(err)
	}

	e.fails(owner, "POST", "/api/v1/expenses/"+draft.ID+"/book", nil, 409, "period_closed")
	e.fails(owner, "POST", "/api/v1/expenses/"+open.ID+"/void", map[string]any{"reason": "Wrong"}, 409, "period_closed")
	var bulk struct {
		Data struct {
			Updated int       `json:"updated"`
			Skipped []skipped `json:"skipped"`
		}
	}
	e.do(owner, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{draft.ID}, "action": "book"}, 200, &bulk)
	if bulk.Data.Updated != 0 || len(bulk.Data.Skipped) != 1 || bulk.Data.Skipped[0].Reason != "period_closed" {
		t.Fatalf("bulk: %+v", bulk.Data)
	}

	// payment dates of a booked expense are part of the books: neither the old nor the new one may sit in a closed month
	november := e.booked(owner, "2026-11-03")
	for _, tc := range []struct {
		id   string
		body map[string]any
	}{
		{open.ID, map[string]any{"payment_status": "unpaid"}},                            // paid in the closed month
		{november.ID, map[string]any{"payment_status": "paid", "paid_on": "2026-10-25"}}, // paid into the closed month
	} {
		e.fails(owner, "PATCH", "/api/v1/expenses/"+tc.id, tc.body, 409, "period_closed")
	}
	for _, action := range []string{"mark_paid", "mark_unpaid"} {
		id := map[string]string{"mark_paid": november.ID, "mark_unpaid": open.ID}[action]
		e.do(owner, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{id}, "action": action, "paid_on": "2026-10-25"}, 200, &bulk)
		if bulk.Data.Updated != 0 || len(bulk.Data.Skipped) != 1 || bulk.Data.Skipped[0].Reason != "period_closed" {
			t.Fatalf("bulk %s: %+v", action, bulk.Data)
		}
	}
	e.do(owner, "PATCH", "/api/v1/expenses/"+november.ID, map[string]any{"payment_status": "paid", "paid_on": "2026-11-04"}, 200, nil)

	if _, err := e.st.ReopenPeriod(ctx, owner.workspace, "2026-10"); err != nil {
		t.Fatal(err)
	}
	e.do(owner, "POST", "/api/v1/expenses/"+draft.ID+"/book", nil, 200, nil)
}

func TestExpenseEventsLogged(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	draft := e.create(owner, map[string]any{"supplier_name": "SBB"})
	e.do(owner, "PATCH", "/api/v1/expenses/"+draft.ID, map[string]any{"payment_status": "paid"}, 200, nil) // a draft: no event

	x := e.booked(owner, "2026-11-03")
	e.do(owner, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"note": "Zurich trip"}, 200, nil) // payment unchanged
	e.do(owner, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"payment_status": "paid", "paid_on": "2026-11-04"}, 200, nil)
	e.do(owner, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{x.ID}, "action": "mark_unpaid"}, 200, nil)
	e.do(owner, "POST", "/api/v1/expenses/"+x.ID+"/void", map[string]any{"reason": "Duplicate"}, 200, nil)

	ctx := context.Background()
	events, err := e.st.Events(ctx, owner.workspace, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	kinds := []string{}
	for _, ev := range events {
		if ev.SubjectID != x.ID || ev.SubjectType != "expense" || ev.ActorID == nil || *ev.ActorID != owner.user {
			t.Fatalf("event: %+v", ev)
		}
		kinds = append(kinds, ev.Kind)
	}
	want := []string{"expense.booked", "expense.payment_changed", "expense.payment_changed", "expense.voided"}
	if !slices.Equal(kinds, want) {
		t.Fatalf("kinds %v, want %v", kinds, want)
	}
	if ok, at, err := e.st.VerifyChain(ctx, owner.workspace); err != nil || !ok {
		t.Fatalf("chain: %v broken at %d: %v", ok, at, err)
	}
}

func TestCurrencyTwoDecimalsOnly(t *testing.T) {
	for code, want := range map[string]bool{"CHF": true, "EUR": true, "USD": true, "JPY": false, "KRW": false, "KWD": false,
		"BHD": false, "XAF": false, "XXX": false, "chf": false, "": false} {
		if got := store.TwoDecimalCurrency(code); got != want {
			t.Errorf("TwoDecimalCurrency(%q) = %v, want %v", code, got, want)
		}
	}

	e := newEnv(t)
	owner := e.workspace()
	for _, code := range []string{"JPY", "kwd"} {
		e.fails(owner, "POST", "/api/v1/expenses", map[string]any{"currency": code}, 422, "validation_failed", "currency")
	}
	if x := e.create(owner, map[string]any{"currency": "eur"}); x.Base.Currency != "CHF" {
		t.Fatalf("EUR expense: %+v", x)
	}

	// A row stored before the rule keeps its currency through edits of other fields.
	old := e.create(owner, map[string]any{})
	if _, err := e.raw.Exec(context.Background(), `UPDATE expenses SET currency = 'JPY' WHERE id = $1`, old.ID); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Data struct {
			Currency string `json:"currency"`
		}
	}
	e.do(owner, "PATCH", "/api/v1/expenses/"+old.ID, map[string]any{"description": "Tokyo"}, 200, &got)
	if got.Data.Currency != "JPY" {
		t.Fatalf("stored currency: %q", got.Data.Currency)
	}
}

func TestBaseCurrencyLocked(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	ctx := context.Background()
	locked := func() bool {
		t.Helper()
		ok, err := e.st.CurrencyLocked(ctx, owner.workspace)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}
	if locked() {
		t.Fatal("a new workspace is locked")
	}
	e.create(owner, map[string]any{"supplier_name": "SBB"})
	if locked() {
		t.Fatal("a draft expense locks the currency")
	}
	e.booked(owner, "2026-11-03")
	if !locked() {
		t.Fatal("a booked expense leaves the currency unlocked")
	}
	other := e.workspace()
	if ok, err := e.st.CurrencyLocked(ctx, other.workspace); err != nil || ok {
		t.Fatalf("another workspace: %v %v", ok, err)
	}

	invoice := func(status, number string) {
		t.Helper()
		if _, err := e.raw.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date,
				currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
				vat_breakdown, created_at, updated_at)
			VALUES ($1, $2, 'invoice', $3, NULLIF($4, ''), 'cli_'||$2, '2026-11-01', '2026-11-30', 'CHF', 'de', 'none', 0, 0, 0, 0, 0, 0, 0,
				'[]', now(), now())`, "inv_"+status+other.workspace, other.workspace, status, number); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.raw.Exec(ctx, `INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		VALUES ('cli_'||$1, $1, 1, 'Acme AG', now(), now())`, other.workspace); err != nil {
		t.Fatal(err)
	}
	invoice("draft", "")
	if ok, err := e.st.CurrencyLocked(ctx, other.workspace); err != nil || ok {
		t.Fatalf("a draft invoice locks the currency: %v %v", ok, err)
	}
	invoice("open", "2026-001")
	if ok, err := e.st.CurrencyLocked(ctx, other.workspace); err != nil || !ok {
		t.Fatalf("an issued invoice leaves the currency unlocked: %v %v", ok, err)
	}
}
