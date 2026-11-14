package invoices

import (
	"context"
	"math"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// refundState is what the tests read of an invoice's balance.
type refundState struct {
	Data struct {
		Status         string `json:"status"`
		AmountDue      string `json:"amount_due"`
		AmountRefunded string `json:"amount_refunded"`
		RefundDue      string `json:"refund_due"`
		Payments       []struct {
			ID string `json:"id"`
		} `json:"payments"`
		Refunds []struct {
			ID        string `json:"id"`
			Amount    string `json:"amount"`
			CreatedBy *struct {
				ID string `json:"id"`
			} `json:"created_by"`
		} `json:"refunds"`
	} `json:"data"`
}

func TestCreditBalance(t *testing.T) {
	tests := []struct {
		name              string
		paid              string
		creditLines       []any // nil: credit the whole invoice
		status, due, owed string
	}{
		{"part-paid, small credit: still owed", "100", []any{line("1", "100")}, "open", "8.10", "0.00"},
		{"part-paid, credit beyond what is left", "150", []any{line("1", "100")}, "paid", "0.00", "41.90"},
		{"fully paid, fully credited", "216.20", nil, "void", "0.00", "216.20"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t)
			b, clientID := e.ready()
			inv := e.issued(b, clientID, nil) // 216.20
			path := "/api/v1/invoices/" + inv.ID
			e.do(b, "POST", path+"/payments", map[string]any{"amount": tt.paid, "method": "bank_transfer"}, http.StatusCreated, nil)
			body := map[string]any{}
			if tt.creditLines != nil {
				body["lines"] = tt.creditLines
			}
			cn := e.invoice(b, "POST", path+"/credit-note", body, http.StatusCreated)
			e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
			var got refundState
			e.do(b, "GET", path, nil, http.StatusOK, &got)
			if got.Data.Status != tt.status || got.Data.AmountDue != tt.due || got.Data.RefundDue != tt.owed {
				t.Fatalf("status %s, amount_due %s, refund_due %s; want %s %s %s", got.Data.Status, got.Data.AmountDue,
					got.Data.RefundDue, tt.status, tt.due, tt.owed)
			}
			if tt.owed == "0.00" {
				e.fails(b, "POST", path+"/refunds", map[string]any{"amount": "1", "method": "cash"}, http.StatusConflict, "invalid_state")
			}
		})
	}
}

func TestRefunds(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	member := e.join(b.workspace, "member")
	inv := e.issued(b, clientID, nil)
	path := "/api/v1/invoices/" + inv.ID
	e.do(b, "POST", path+"/mark-paid", map[string]any{}, http.StatusOK, nil)
	cn := e.invoice(b, "POST", path+"/credit-note", map[string]any{}, http.StatusCreated)
	e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
	yesterday := time.Now().In(zone).AddDate(0, 0, -1).Format(time.DateOnly)

	for _, tt := range []struct {
		name   string
		body   map[string]any
		fields []string
	}{
		{"more than is due", map[string]any{"amount": "216.25", "method": "bank_transfer"}, []string{"amount"}},
		{"before the credit note", map[string]any{"amount": "10", "method": "cash", "refunded_on": yesterday}, []string{"refunded_on"}},
		{"in the future", map[string]any{"amount": "10", "method": "cash", "refunded_on": "2999-01-01"}, []string{"refunded_on"}},
		{"no amount, unknown method", map[string]any{"method": "gold"}, []string{"amount", "method"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e.fails(member, "POST", path+"/refunds", tt.body, http.StatusUnprocessableEntity, "validation_failed", tt.fields...)
		})
	}

	var got refundState
	e.do(member, "POST", path+"/refunds", map[string]any{"amount": "100", "method": "bank_transfer", "note": "Teil"}, http.StatusCreated, &got)
	if got.Data.RefundDue != "116.20" || got.Data.AmountRefunded != "100.00" || len(got.Data.Refunds) != 1 ||
		got.Data.Refunds[0].CreatedBy == nil || got.Data.Status != "void" {
		t.Fatalf("after a refund: %+v", got.Data)
	}
	refundID, paymentID := got.Data.Refunds[0].ID, got.Data.Payments[0].ID

	var list struct{ Meta struct{ Total int } }
	e.do(b, "GET", "/api/v1/invoices?status=refund_due", nil, http.StatusOK, &list)
	if list.Meta.Total != 1 {
		t.Fatalf("status=refund_due lists %d", list.Meta.Total)
	}
	var sum struct {
		Data struct {
			RefundDue struct {
				Amount string `json:"amount"`
				Count  int    `json:"count"`
			} `json:"refund_due"`
		} `json:"data"`
	}
	e.do(b, "GET", "/api/v1/invoices/summary", nil, http.StatusOK, &sum)
	if sum.Data.RefundDue.Amount != "116.20" || sum.Data.RefundDue.Count != 1 {
		t.Fatalf("summary refund_due: %+v", sum.Data.RefundDue)
	}

	// the payment funded the refund: it cannot go while the refund stands
	e.fails(b, "DELETE", path+"/payments/"+paymentID, nil, http.StatusConflict, "invalid_state")
	e.fails(member, "DELETE", path+"/refunds/"+refundID, nil, http.StatusForbidden, "forbidden")
	e.do(b, "DELETE", path+"/refunds/"+refundID, nil, http.StatusNoContent, nil)
	e.do(b, "GET", path, nil, http.StatusOK, &got)
	if got.Data.RefundDue != "216.20" || len(got.Data.Refunds) != 0 {
		t.Fatalf("after deleting the refund: %+v", got.Data)
	}
	e.fails(b, "DELETE", path+"/refunds/"+refundID, nil, http.StatusNotFound, "not_found")
	events, err := e.st.Events(context.Background(), b.workspace, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if k := slices.IndexFunc(events, func(ev store.FinancialEvent) bool { return ev.Kind == "refund.deleted" }); k < 0 ||
		events[k].ActorID == nil || !strings.Contains(string(events[k].Payload), refundID) {
		t.Fatalf("no refund.deleted event with the refund: %+v", events)
	}
	e.do(b, "DELETE", path+"/payments/"+paymentID, nil, http.StatusNoContent, nil)
	e.do(b, "GET", path, nil, http.StatusOK, &got)
	if got.Data.RefundDue != "0.00" || got.Data.Status != "void" || got.Data.AmountDue != "0.00" {
		t.Fatalf("after deleting the payment: %+v", got.Data)
	}
}

func TestSummaryWithCreditsAndRefunds(t *testing.T) {
	type invoice struct {
		paid, credit, refund string // "" for none; credit "all" credits the whole invoice
	}
	rate := func(v float64) *float64 { return &v }
	tests := []struct {
		name      string
		invoices  []invoice
		rate      *float64 // collection_rate, nil for null
		paidMonth string   // paid_this_month.amount = payments − refunds
		avgDays   *float64
	}{
		{"paid, fully credited and refunded", []invoice{{"216.20", "all", "216.20"}}, nil, "0.00", nil},
		{"paid and fully credited, refund still due", []invoice{{"216.20", "all", ""}}, nil, "216.20", nil},
		{"part-paid with a partial credit", []invoice{{"100", "100", ""}}, rate(100 / 108.10), "100.00", nil},
		{"credit beyond what was left counts as collected", []invoice{{"150", "100", ""}}, rate(1), "150.00", rate(0)},
		{"a credited paid invoice does not inflate an unpaid one", []invoice{{"216.20", "all", ""}, {"", "", ""}}, rate(0), "216.20", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t)
			b, clientID := e.ready()
			for _, in := range tt.invoices {
				path := "/api/v1/invoices/" + e.issued(b, clientID, nil).ID // 216.20
				if in.paid != "" {
					e.do(b, "POST", path+"/payments", map[string]any{"amount": in.paid, "method": "bank_transfer"}, http.StatusCreated, nil)
				}
				if in.credit != "" {
					body := map[string]any{}
					if in.credit != "all" {
						body["lines"] = []any{line("1", in.credit)}
					}
					cn := e.invoice(b, "POST", path+"/credit-note", body, http.StatusCreated)
					e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
				}
				if in.refund != "" {
					e.do(b, "POST", path+"/refunds", map[string]any{"amount": in.refund, "method": "bank_transfer"}, http.StatusCreated, nil)
				}
			}
			var sum struct {
				Data struct {
					CollectionRate *float64 `json:"collection_rate"`
					AvgDaysToPay   *float64 `json:"avg_days_to_pay"`
					PaidThisMonth  struct {
						Amount string `json:"amount"`
					} `json:"paid_this_month"`
					Monthly []struct {
						Paid string `json:"paid"`
					} `json:"monthly"`
				} `json:"data"`
			}
			e.do(b, "GET", "/api/v1/invoices/summary", nil, http.StatusOK, &sum)
			d := sum.Data
			if (d.CollectionRate == nil) != (tt.rate == nil) || (tt.rate != nil && math.Abs(*d.CollectionRate-*tt.rate) > 1e-9) {
				t.Errorf("collection_rate = %v, want %v", deref64(d.CollectionRate), deref64(tt.rate))
			}
			if d.CollectionRate != nil && (*d.CollectionRate < 0 || *d.CollectionRate > 1) {
				t.Errorf("collection_rate %v outside 0–1", *d.CollectionRate)
			}
			if d.PaidThisMonth.Amount != tt.paidMonth || d.Monthly[11].Paid != tt.paidMonth {
				t.Errorf("paid this month %s, monthly %s, want %s", d.PaidThisMonth.Amount, d.Monthly[11].Paid, tt.paidMonth)
			}
			if (d.AvgDaysToPay == nil) != (tt.avgDays == nil) || (tt.avgDays != nil && *d.AvgDaysToPay != *tt.avgDays) {
				t.Errorf("avg_days_to_pay = %v, want %v", deref64(d.AvgDaysToPay), deref64(tt.avgDays))
			}
		})
	}
}

func deref64(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
