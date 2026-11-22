package expenses

import (
	"context"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

type itemised struct {
	ID        string `json:"id"`
	EntryMode string `json:"entry_mode"`
	Total     string `json:"total"`
	Lines     []struct {
		Amount   string  `json:"amount"`
		Quantity *string `json:"quantity"`
		Price    *string `json:"unit_price"`
		Category *struct {
			ID          string `json:"id"`
			AccountCode string `json:"account_code"`
		} `json:"category"`
	} `json:"lines"`
}

// itemisedInput: CHF 324.30 gross, a third materials (4000) and two thirds the expense's own office category.
func itemisedInput(header, item string) map[string]any {
	return map[string]any{"supplier_name": "Brack AG", "document_date": "2026-11-03", "category_id": header,
		"receipt_missing_reason": "Substitute voucher", "entry_mode": "itemised", "lines": []map[string]any{
			{"description": "Cable", "amount": "108.10", "vat_rate": "8.1", "category_id": item, "quantity": "2", "unit_price": "54.05"},
			{"description": "Paper", "amount": "216.20", "vat_rate": "8.1"},
		}}
}

func TestItemisedExpenseSplitsLedgerAndVATReturn(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cats := e.categories(b)
	var out struct{ Data itemised }
	e.do(b, "POST", "/api/v1/expenses", itemisedInput(cats["6500"].ID, cats["4000"].ID), 201, &out)
	x := out.Data
	if x.EntryMode != "itemised" || x.Total != "324.30" || len(x.Lines) != 2 || x.Lines[0].Category == nil ||
		x.Lines[0].Category.AccountCode != "4000" || *x.Lines[0].Quantity != "2" || *x.Lines[0].Price != "54.05" || x.Lines[1].Category != nil {
		t.Fatalf("itemised expense: %+v", x)
	}
	e.do(b, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, 200, nil)

	ctx := context.Background()
	src, unposted, err := e.st.LedgerSources(ctx, b.workspace, "2026-12-31")
	if err != nil || len(unposted) != 0 || len(src.Expenses) != 1 {
		t.Fatalf("sources: %+v %v %v", src, unposted, err)
	}
	// 324.30 holds 24.30 VAT; a third of each goes to materials (Ziffer 400), two thirds to office costs (405).
	got := src.Expenses[0].Splits
	if len(got) != 2 || got[0].Account != "4000" || !got[0].Material || got[0].Net != 10000 || got[0].Deductible != 810 ||
		got[1].Account != "6500" || got[1].Material || got[1].Net != 20000 || got[1].Deductible != 1620 {
		t.Fatalf("splits: %+v", got)
	}
	purchases, err := e.st.VATPurchases(ctx, b.workspace, "2026-11-01", "2026-12-01", false)
	if err != nil || len(purchases) != 2 || purchases[0].Box != "400" || purchases[0].DeductibleVAT != 810 ||
		purchases[1].Box != "405" || purchases[1].DeductibleVAT != 1620 {
		t.Fatalf("purchases: %+v %v", purchases, err)
	}

	// The item's category is booked too: it keeps its name and account.
	e.fails(b, "PATCH", "/api/v1/expense-categories/"+cats["4000"].ID, map[string]any{"account_code": "4200"}, 409, "category_locked")
}

// A booked single-amount expense posts exactly as before items existed: one split carrying the whole expense.
func TestSingleExpenseLedgerUnchanged(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	input := complete(e.categories(b)["6510"].ID)
	input["receipt_missing_reason"] = "Substitute voucher"
	x := e.create(b, input)
	if x.Total != "108.10" {
		t.Fatalf("total %s", x.Total)
	}
	e.do(b, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, 200, nil)
	src, _, err := e.st.LedgerSources(context.Background(), b.workspace, "2026-12-31")
	if err != nil || len(src.Expenses) != 1 {
		t.Fatalf("sources: %+v %v", src, err)
	}
	s := src.Expenses[0]
	want := []invoicecalc.Money{10000, 810}
	if len(s.Splits) != 1 || s.Splits[0].Account != "6510" || s.Splits[0].Net != want[0] || s.Splits[0].Deductible != want[1] ||
		s.Account != "6510" || s.MaterialVAT {
		t.Fatalf("single expense: %+v", s)
	}
}

func TestItemInput(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	cats, foreign := e.categories(b), e.categories(other)
	archived := cats["6700"]
	e.do(b, "PATCH", "/api/v1/expense-categories/"+archived.ID, map[string]any{"is_archived": true}, 200, nil)
	line := func(extra map[string]any) map[string]any {
		l := map[string]any{"amount": "10.00", "vat_rate": "8.1"}
		for k, v := range extra {
			l[k] = v
		}
		return map[string]any{"entry_mode": "itemised", "lines": []map[string]any{l}}
	}
	for _, tt := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"another workspace's category", line(map[string]any{"category_id": foreign["4000"].ID}), "lines.0.category_id"},
		{"an unknown category", line(map[string]any{"category_id": "cat_missing"}), "lines.0.category_id"},
		{"an archived category", line(map[string]any{"category_id": archived.ID}), "lines.0.category_id"},
		{"a category on a single amount", map[string]any{"entry_mode": "single",
			"lines": []map[string]any{{"amount": "10.00", "category_id": cats["4000"].ID}}}, "lines.0.category_id"},
		{"a zero quantity", line(map[string]any{"quantity": "0"}), "lines.0.quantity"},
		{"a negative price", line(map[string]any{"unit_price": "-1.00"}), "lines.0.unit_price"},
		{"an unknown mode", map[string]any{"entry_mode": "both"}, "entry_mode"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e.fails(b, "POST", "/api/v1/expenses", tt.body, 422, "validation_failed", tt.field)
		})
	}
}

// An archived category the draft already had stays; switching back to one amount needs the items' categories gone.
func TestKeepsArchivedItemCategoryAndSwitchesMode(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.categories(b)["6510"]
	var out struct{ Data itemised }
	body := map[string]any{"entry_mode": "itemised", "lines": []map[string]any{{"amount": "10.00", "category_id": c.ID}}}
	e.do(b, "POST", "/api/v1/expenses", body, 201, &out)
	path := "/api/v1/expenses/" + out.Data.ID
	e.do(b, "PATCH", "/api/v1/expense-categories/"+c.ID, map[string]any{"is_archived": true}, 200, nil)
	e.do(b, "PATCH", path, map[string]any{"lines": body["lines"]}, 200, nil)
	e.fails(b, "PATCH", path, map[string]any{"entry_mode": "single"}, 422, "validation_failed", "lines.0.category_id")
	e.do(b, "PATCH", path, map[string]any{"entry_mode": "single", "lines": []map[string]any{{"amount": "10.00"}}}, 200, &out)
	if out.Data.EntryMode != "single" || out.Data.Lines[0].Category != nil {
		t.Fatalf("switched: %+v", out.Data)
	}
}

// Booking takes the locks of the items' categories too, so a rename cannot slip in between check and booking.
func TestBookingWaitsForItemCategoryEdit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cats := e.categories(b)
	var out struct{ Data itemised }
	e.do(b, "POST", "/api/v1/expenses", itemisedInput(cats["6500"].ID, cats["4000"].ID), 201, &out)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var blocker int
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid() FROM expense_categories WHERE id = $1 FOR UPDATE`, cats["4000"].ID).Scan(&blocker); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		result <- e.st.Tx(ctx, func(q store.Q) error { return q.BookExpense(ctx, out.Data.ID, b.user, e.svc.now()) })
	}()
	for waiting := false; !waiting; {
		select {
		case err := <-result:
			t.Fatalf("booking bypassed the item category lock: %v", err)
		case <-ctx.Done():
			t.Fatal("booking did not reach the item category lock")
		case <-time.After(5 * time.Millisecond):
		}
		if err := e.raw.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))`, blocker).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

type missingRow struct {
	ID            string   `json:"id"`
	MissingFields []string `json:"missing_fields"`
}

// Booking needs a name on every item, and on each of several one-amount lines; one amount on one line is described
// by the expense itself. A draft saves either way.
func TestBookingNeedsNamedItems(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cat := e.categories(b)["6500"].ID
	for _, tt := range []struct {
		name    string
		mode    string
		lines   []map[string]any
		missing bool
	}{
		{"an item without a name", "itemised", []map[string]any{{"description": "Paper", "amount": "10.00"}, {"amount": "5.00"}}, true},
		{"an item named with spaces", "itemised", []map[string]any{{"description": "  ", "amount": "10.00"}}, true},
		{"named items", "itemised", []map[string]any{{"description": "Paper", "amount": "10.00"}, {"description": "Ink", "amount": "5.00"}}, false},
		{"one amount without a name", "single", []map[string]any{{"amount": "10.00"}}, false},
		{"two rates, one unnamed", "single", []map[string]any{{"description": "Room", "amount": "100.00", "vat_rate": "3.8"}, {"amount": "20.00", "vat_rate": "8.1"}}, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var out struct{ Data missingRow }
			e.do(b, "POST", "/api/v1/expenses", map[string]any{"supplier_name": "Brack AG", "document_date": "2026-11-03",
				"category_id": cat, "receipt_missing_reason": "Substitute voucher", "entry_mode": tt.mode, "lines": tt.lines}, 201, &out)
			if got := slices.Contains(out.Data.MissingFields, "items"); got != tt.missing {
				t.Fatalf("missing items %v, want %v: %v", got, tt.missing, out.Data.MissingFields)
			}
			var list struct{ Data []missingRow }
			e.do(b, "GET", "/api/v1/expenses?incomplete=true", nil, 200, &list)
			listed := slices.ContainsFunc(list.Data, func(x missingRow) bool {
				return x.ID == out.Data.ID && slices.Contains(x.MissingFields, "items")
			})
			if listed != tt.missing {
				t.Fatalf("listed as incomplete for items %v, want %v: %+v", listed, tt.missing, list.Data)
			}
			if tt.missing {
				e.fails(b, "POST", "/api/v1/expenses/"+out.Data.ID+"/book", nil, 422, "cannot_book")
			} else {
				e.do(b, "POST", "/api/v1/expenses/"+out.Data.ID+"/book", nil, 200, nil)
			}
		})
	}
}
