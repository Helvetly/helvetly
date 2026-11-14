package invoices

import (
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestPeriod(t *testing.T) {
	for _, tc := range []struct {
		name, today string
		want        [4]string
	}{
		{"this_month", "2026-11-10", [4]string{"2026-11-01", "2026-11-10", "2026-10-01", "2026-10-31"}},
		{"this_month", "2026-03-31", [4]string{"2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"}},
		{"last_month", "2026-01-15", [4]string{"2025-12-01", "2025-12-31", "2025-11-01", "2025-11-30"}},
		{"last_month", "2026-03-31", [4]string{"2026-02-01", "2026-02-28", "2026-01-01", "2026-01-31"}},
		{"this_quarter", "2026-11-10", [4]string{"2026-10-01", "2026-11-10", "2026-07-01", "2026-09-30"}},
		{"this_quarter", "2026-02-28", [4]string{"2026-01-01", "2026-02-28", "2025-10-01", "2025-12-31"}},
		{"this_year", "2026-11-10", [4]string{"2026-01-01", "2026-11-10", "2025-01-01", "2025-12-31"}},
		{"last_12_months", "2026-11-10", [4]string{"2025-12-01", "2026-11-10", "2024-12-01", "2025-11-30"}},
	} {
		today, _ := time.Parse(time.DateOnly, tc.today)
		from, to, prevFrom, prevTo, ok := period(tc.name, today)
		got := [4]string{from.Format(time.DateOnly), to.Format(time.DateOnly), prevFrom.Format(time.DateOnly), prevTo.Format(time.DateOnly)}
		if !ok || got != tc.want {
			t.Errorf("%s on %s = %v %v, want %v", tc.name, tc.today, got, ok, tc.want)
		}
	}
	if _, _, _, _, ok := period("next_week", time.Now()); ok {
		t.Error("an unknown period resolved")
	}
}

func TestSummaryPeriod(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	paid := e.issued(b, client, nil) // 216.20, paid today
	e.invoice(b, "POST", path(paid.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	e.issued(b, client, nil) // 216.20, still open

	var plain struct{ Data store.InvoiceSummary }
	e.do(b, "GET", "/api/v1/invoices/summary", nil, http.StatusOK, &plain)
	if plain.Data.Period != nil {
		t.Fatalf("period without asking: %+v", plain.Data.Period)
	}
	for _, tc := range []struct {
		name       string
		paid       store.Money
		count      int
		collection float64
		avgDays    bool
	}{
		{"this_month", 21620, 1, 0.5, true},
		{"this_year", 21620, 1, 0.5, true},
		{"last_month", 0, 0, -1, false},
	} {
		var got struct{ Data store.InvoiceSummary }
		e.do(b, "GET", "/api/v1/invoices/summary?period="+tc.name, nil, http.StatusOK, &got)
		p := got.Data.Period
		if p == nil || p.Name != tc.name || p.Paid.Amount != tc.paid || p.Paid.Count != tc.count || p.PaidPrevious.Amount != 0 {
			t.Fatalf("%s: %+v", tc.name, p)
		}
		if (p.AvgDaysToPay != nil) != tc.avgDays || (tc.avgDays && *p.AvgDaysToPay != 0) {
			t.Errorf("%s: avg days %v", tc.name, p.AvgDaysToPay)
		}
		if tc.collection < 0 && p.CollectionRate != nil || tc.collection >= 0 && (p.CollectionRate == nil || *p.CollectionRate != tc.collection) {
			t.Errorf("%s: collection rate %v, want %v", tc.name, p.CollectionRate, tc.collection)
		}
	}
	e.fails(b, "GET", "/api/v1/invoices/summary?period=forever", nil, http.StatusBadRequest, "invalid_request")
}
