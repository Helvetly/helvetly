package quotes

import (
	"net/http"
	"slices"
	"testing"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

func schedule(count int, first string, items ...map[string]any) map[string]any {
	s := map[string]any{"count": count, "interval": "monthly", "first_due_date": first}
	if items != nil {
		s["items"] = items
	}
	return s
}

func item(due, amount string) map[string]any {
	return map[string]any{"due_date": due, "amount": amount}
}

// rows: "due amount" per instalment, for comparing schedules.
func rows(s *store.InstalmentSchedule) []string {
	if s == nil {
		return nil
	}
	out := []string{}
	for _, it := range s.Items {
		out = append(out, it.DueDate+" "+it.Amount.String())
	}
	return out
}

// A quote's payment schedule follows the invoice's rules: an even split of the payable total, which follows the
// totals while generated, typed rows kept, and it is checked when the quote is sent.
func TestQuoteSchedule(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	q := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "lines": []any{line("2", "100.00")},
		"instalments": schedule(3, "2026-12-01")}, http.StatusCreated)
	if want := []string{"2026-12-01 72.05", "2027-01-01 72.05", "2027-02-01 72.10"}; !slices.Equal(rows(q.Instalments), want) {
		t.Fatalf("schedule %v, want %v", rows(q.Instalments), want)
	}
	if q.ValidUntil != "2026-12-16" || q.Instalments.Interval != "monthly" {
		t.Fatalf("valid until %s, interval %s", q.ValidUntil, q.Instalments.Interval)
	}
	q = e.quote(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"lines": []any{line("3", "100.00")}}, http.StatusOK)
	if want := []string{"2026-12-01 108.10", "2027-01-01 108.10", "2027-02-01 108.10"}; !slices.Equal(rows(q.Instalments), want) {
		t.Fatalf("after a new total %v, want %v", rows(q.Instalments), want)
	}

	for _, tc := range []struct {
		name  string
		sched any
		field string
	}{
		{"one instalment", schedule(1, "2026-12-01"), "instalments.count"},
		{"no first date", map[string]any{"count": 2, "interval": "monthly"}, "instalments.first_due_date"},
		{"bad interval", map[string]any{"count": 2, "interval": "daily", "first_due_date": "2026-12-01"}, "instalments.interval"},
		{"rows not count", schedule(3, "2026-12-01", item("2026-12-01", "100.00")), "instalments.items"},
		{"dates not rising", schedule(2, "2026-12-01", item("2026-12-01", "100.00"), item("2026-12-01", "224.30")),
			"instalments.items.1.due_date"},
		{"zero amount", schedule(2, "2026-12-01", item("2026-12-01", "0"), item("2027-01-01", "324.30")),
			"instalments.items.0.amount"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e.fails(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"instalments": tc.sched}, 422, "validation_failed", tc.field)
		})
	}

	// typed rows that miss the total or start before the quote's date are saved, but not sent
	for _, sched := range []any{
		schedule(2, "2026-12-01", item("2026-12-01", "100.00"), item("2027-01-01", "200.00")),
		schedule(2, "2026-11-01", item("2026-11-01", "124.30"), item("2027-01-01", "200.00")),
	} {
		e.quote(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"instalments": sched}, http.StatusOK)
		e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, 422, "cannot_send", "")
	}
	q = e.quote(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"instalments": schedule(2, "2026-12-01",
		item("2026-12-01", "124.30"), item("2027-03-01", "200.00"))}, http.StatusOK)
	accepted := []string{"2026-12-01 124.30", "2027-03-01 200.00"}
	if !slices.Equal(rows(q.Instalments), accepted) {
		t.Fatalf("typed rows %v", rows(q.Instalments))
	}

	// another workspace neither reads nor changes it
	other := e.workspace()
	e.fails(other, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"instalments": nil}, 404, "not_found", "")

	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	e.fails(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"instalments": nil}, 409, "quote_locked", "")
	e.fails(other, "POST", "/api/v1/quotes/"+q.ID+"/accept", map[string]any{}, 404, "not_found", "")
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/accept", map[string]any{}, http.StatusOK)
	e.fails(other, "POST", "/api/v1/quotes/"+q.ID+"/invoice", map[string]any{}, 404, "not_found", "")
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/invoice", map[string]any{}, http.StatusCreated)

	// the invoice draft takes the schedule over and falls due with its last instalment; the quote keeps its own
	var inv struct {
		Data struct {
			Status      string
			DueDate     string `json:"due_date"`
			Instalments *store.InstalmentSchedule
		}
	}
	e.do(b, "GET", "/api/v1/invoices/"+q.Invoice.ID, nil, http.StatusOK, &inv)
	if inv.Data.Status != "draft" || inv.Data.DueDate != "2027-03-01" || !slices.Equal(rows(inv.Data.Instalments), accepted) {
		t.Fatalf("invoice draft: %+v %v", inv.Data, rows(inv.Data.Instalments))
	}
	if q = e.quote(b, "GET", "/api/v1/quotes/"+q.ID, nil, http.StatusOK); !slices.Equal(rows(q.Instalments), accepted) {
		t.Fatalf("quote's own schedule %v", rows(q.Instalments))
	}

	// null removes a draft's schedule
	d := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "instalments": schedule(2, "2026-12-01")}, http.StatusCreated)
	if d = e.quote(b, "PATCH", "/api/v1/quotes/"+d.ID, map[string]any{"instalments": nil}, http.StatusOK); d.Instalments != nil {
		t.Fatalf("schedule kept: %v", rows(d.Instalments))
	}
}

// A schedule needs the plan feature an invoice's schedule needs: the invoice made from the quote would.
func TestQuoteScheduleNeedsFeature(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	c := e.client(b)
	e.fails(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "lines": []any{line("1", "100.00")},
		"instalments": schedule(2, "2026-12-01")}, http.StatusForbidden, "feature_not_in_plan", "")
	e.draft(b, c) // without one, as before
}

func TestCarrySchedule(t *testing.T) {
	sched := &store.InstalmentSchedule{Interval: "monthly", Items: []store.InstalmentItem{
		{Seq: 1, DueDate: "2026-12-01", Amount: 10000, Paid: 5}, {Seq: 2, DueDate: "2027-01-01", Amount: 5000}}}
	for _, tc := range []struct {
		name, issue string
		want        []string
	}{
		{"in time", "2026-11-20", []string{"2026-12-01 100.00", "2027-01-01 50.00"}},
		{"on the first day", "2026-12-01", []string{"2026-12-01 100.00", "2027-01-01 50.00"}},
		{"late: all move", "2026-12-11", []string{"2026-12-11 100.00", "2027-01-11 50.00"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := carrySchedule(sched, tc.issue)
			if !slices.Equal(rows(got), tc.want) || got.Interval != "monthly" || got.Items[0].Paid != 0 {
				t.Fatalf("%v, want %v", rows(got), tc.want)
			}
		})
	}
	if sched.Items[0].DueDate != "2026-12-01" {
		t.Error("the quote's schedule changed")
	}
	if carrySchedule(nil, "2026-12-01") != nil || carrySchedule(&store.InstalmentSchedule{Interval: "monthly"}, "2026-12-01") != nil {
		t.Error("an empty schedule carried")
	}
}
