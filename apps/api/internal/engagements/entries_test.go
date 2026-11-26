package engagements

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

// realDrafts wires the real invoices service (the producer of Drafts).
func realDrafts(e *env) {
	e.t.Helper()
	inv := invoices.New(e.st, e.svc.auth, nil, nil, e.svc.log)
	e.svc.inv = inv
}

type entryOut struct {
	Data struct {
		Entry struct {
			ID                   string  `json:"id"`
			PeriodID             string  `json:"period_id"`
			Date                 string  `json:"date"`
			Quantity             string  `json:"quantity"`
			ClientPerformance    *string `json:"client_performance"`
			PerformanceOnInvoice bool    `json:"client_performance_on_invoice"`
			PerformedBy          *struct {
				Name string `json:"name"`
			} `json:"performed_by"`
			Invoice *struct {
				ID string `json:"id"`
			} `json:"invoice"`
		} `json:"entry"`
		Period struct {
			Used      string `json:"used"`
			Remaining string `json:"remaining"`
			Overage   string `json:"overage"`
		} `json:"period"`
	} `json:"data"`
}

type invoiceOut struct {
	Data struct {
		InvoiceID string `json:"invoice_id"`
		Period    struct {
			InvoicedQuantity string `json:"invoiced_quantity"`
			Invoices         []struct {
				ID, Kind string
			} `json:"invoices"`
		} `json:"period"`
	} `json:"data"`
}

func (e *env) lines(invoiceID string) []string {
	e.t.Helper()
	rows, err := e.pool.Query(context.Background(), `SELECT description || '|' || quantity || '|' || unit_price || '|' || vat_category
		FROM invoice_lines WHERE invoice_id = $1 ORDER BY position`, invoiceID)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func TestEntryCreateValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	eng := e.create(b, input(e.client(b), nil))
	path := "/api/v1/engagements/" + eng.ID + "/entries"
	var out entryOut
	e.do(b, "POST", path, map[string]any{"quantity": "2.5", "note": "Lesson", "client_performance": "Prepared well"}, http.StatusCreated, &out)
	if out.Data.Entry.ClientPerformance == nil || *out.Data.Entry.ClientPerformance != "Prepared well" {
		t.Fatalf("client_performance: %v", out.Data.Entry.ClientPerformance)
	}
	if out.Data.Entry.Date != "2026-11-16" || out.Data.Entry.Quantity != "2.5" || out.Data.Entry.PerformedBy == nil ||
		out.Data.Period.Used != "2.5" || out.Data.Period.Remaining != "27.5" {
		t.Fatalf("%+v", out.Data)
	}
	e.fails(b, "POST", path, map[string]any{"quantity": "1", "date": "2026-11-17"}, 422, "validation_failed", "date")
	e.fails(b, "POST", path, map[string]any{"quantity": "1", "date": "2026-10-31"}, 422, "validation_failed", "date")
	e.fails(b, "POST", path, map[string]any{"quantity": "0"}, 422, "validation_failed", "quantity")
	e.fails(b, "POST", path, map[string]any{}, 422, "validation_failed", "quantity")
	e.fails(b, "POST", path, map[string]any{"quantity": "1", "performed_by": "usr_nobody"}, 422, "validation_failed", "performed_by")
	e.fails(b, "POST", path, map[string]any{"quantity": "1", "client_performance": strings.Repeat("x", 501)}, 422, "validation_failed", "client_performance")
	e.fails(b, "POST", path, map[string]any{"quantity": "1", "x": 1}, 400, "invalid_request")
	e.fails(b, "POST", "/api/v1/engagements/eng_missing/entries", map[string]any{"quantity": "1"}, 404, "not_found")
}

// The date's refusal names the day to pick, so the form can show it under the field.
func TestEntryDateMessages(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	client := e.client(b)
	open := e.create(b, input(client, nil))
	ended := e.create(b, input(client, map[string]any{"end_date": "2026-11-10"}))
	for _, tc := range []struct {
		name, engagement, date, want string
	}{
		{"before the start", open.ID, "2026-10-31", "Pick a date from 1 Nov 2026 (the engagement's start)."},
		{"in the future", open.ID, "2026-11-17", "Pick a date up to today (16 Nov 2026)."},
		{"after the end", ended.ID, "2026-11-12", "Pick a date up to 10 Nov 2026 (the engagement's end)."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out struct {
				Error struct {
					Details struct {
						Fields map[string]string `json:"fields"`
					} `json:"details"`
				} `json:"error"`
			}
			e.do(b, "POST", "/api/v1/engagements/"+tc.engagement+"/entries",
				map[string]any{"quantity": "1", "date": tc.date}, http.StatusUnprocessableEntity, &out)
			if got := out.Error.Details.Fields["date"]; got != tc.want {
				t.Fatalf("date: %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEntryLogEditDelete(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	eng := e.create(b, input(e.client(b), nil))
	path := "/api/v1/engagements/" + eng.ID + "/entries"
	var a, c entryOut
	e.do(b, "POST", path, map[string]any{"quantity": "1", "date": "2026-11-02"}, http.StatusCreated, &a)
	e.do(b, "POST", path, map[string]any{"quantity": "2", "date": "2026-11-09"}, http.StatusCreated, &c)
	var list struct {
		Data []struct{ ID string } `json:"data"`
	}
	e.do(b, "GET", path, nil, 200, &list)
	if len(list.Data) != 2 || list.Data[0].ID != c.Data.Entry.ID {
		t.Fatalf("order %+v", list)
	}
	e.do(b, "PATCH", path+"/"+a.Data.Entry.ID, map[string]any{"quantity": "4"}, 200, &a)
	if a.Data.Period.Used != "6" {
		t.Fatalf("used %s", a.Data.Period.Used)
	}
	e.do(b, "DELETE", path+"/"+a.Data.Entry.ID, nil, http.StatusNoContent, nil)
	e.fails(b, "DELETE", path+"/"+a.Data.Entry.ID, nil, 404, "not_found")
}

func TestUsageInvoiceOverageSplitAndRelease(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	eng := e.create(b, input(e.client(b), map[string]any{"overage_unit_price": "150", "reference": "PO-1"}))
	path := "/api/v1/engagements/" + eng.ID
	var old, newest entryOut
	e.do(b, "POST", path+"/entries", map[string]any{"quantity": "20", "date": "2026-11-02"}, 201, &old)
	e.do(b, "POST", path+"/entries", map[string]any{"quantity": "15", "date": "2026-11-05"}, 201, &newest)
	period := eng.CurrentPeriod.ID

	e.fails(b, "POST", path+"/periods/"+period+"/invoice", map[string]any{"kind": "other"}, 422, "validation_failed", "kind")

	var inv invoiceOut
	e.do(b, "POST", path+"/periods/"+period+"/invoice", map[string]any{"kind": "usage"}, 201, &inv)
	lines := e.lines(inv.Data.InvoiceID)
	if len(lines) != 1 || lines[0] != "German · 01.11.2026 – 30.11.2026|5000|15000|Z" {
		t.Fatalf("lines %v", lines)
	}
	if inv.Data.Period.InvoicedQuantity != "5" || len(inv.Data.Period.Invoices) != 1 {
		t.Fatalf("%+v", inv.Data.Period)
	}
	e.fails(b, "PATCH", path+"/entries/"+newest.Data.Entry.ID, map[string]any{"quantity": "1"}, 409, "entry_invoiced")
	e.fails(b, "DELETE", path+"/entries/"+newest.Data.Entry.ID, nil, 409, "entry_invoiced")
	e.fails(b, "POST", path+"/periods/"+period+"/invoice", map[string]any{"kind": "usage"}, 409, "nothing_to_invoice")

	// a voided invoice releases its entries
	if _, err := e.pool.Exec(context.Background(), `UPDATE invoices SET status = 'void', number = 'T-1' WHERE id = $1`, inv.Data.InvoiceID); err != nil {
		t.Fatal(err)
	}
	e.do(b, "PATCH", path+"/entries/"+newest.Data.Entry.ID, map[string]any{"note": "again"}, 200, nil)
	e.do(b, "POST", path+"/periods/"+period+"/invoice", map[string]any{"kind": "usage", "detail": "per_entry"}, 201, &inv)
	lines = e.lines(inv.Data.InvoiceID)
	if len(lines) != 1 || lines[0] != "German · 05.11.2026 · again|5000|15000|Z" {
		t.Fatalf("per entry %v", lines)
	}
}

func TestArrearsPerEntryAndAdvanceInvoice(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	cli := e.client(b)
	arrears := e.create(b, input(cli, map[string]any{"billing": "arrears"}))
	e.entry(arrears.ID, "2026-11-03", 1500)
	e.entry(arrears.ID, "2026-11-04", 2000)
	var inv invoiceOut
	e.do(b, "POST", "/api/v1/engagements/"+arrears.ID+"/periods/"+arrears.CurrentPeriod.ID+"/invoice",
		map[string]any{"kind": "usage", "detail": "per_entry"}, 201, &inv)
	if got := e.lines(inv.Data.InvoiceID); fmt.Sprint(got) != "[German · 03.11.2026|1500|10000|Z 04.11.2026|2000|10000|Z]" {
		t.Fatalf("lines %v", got)
	}
	e.fails(b, "POST", "/api/v1/engagements/"+arrears.ID+"/periods/"+arrears.CurrentPeriod.ID+"/invoice",
		map[string]any{"kind": "advance"}, 422, "validation_failed", "kind")

	adv := e.create(b, input(cli, nil))
	url := "/api/v1/engagements/" + adv.ID + "/periods/" + adv.CurrentPeriod.ID + "/invoice"
	e.do(b, "POST", url, map[string]any{"kind": "advance"}, 201, &inv)
	if got := e.lines(inv.Data.InvoiceID); fmt.Sprint(got) != "[German · 01.11.2026 – 30.11.2026|30000|10000|Z]" {
		t.Fatalf("lines %v", got)
	}
	e.fails(b, "POST", url, map[string]any{"kind": "advance"}, 409, "already_invoiced")
	e.fails(b, "POST", "/api/v1/engagements/"+adv.ID+"/periods/epr_missing/invoice", map[string]any{"kind": "advance"}, 404, "not_found")
}

func TestPerEntryLineClientPerformance(t *testing.T) {
	for _, tc := range []struct {
		name string
		body map[string]any
		want string
	}{
		{"off by default", map[string]any{"note": "Lesson", "client_performance": "Well prepared"}, "[German · 03.11.2026 · Lesson|1500|10000|Z]"},
		{"on", map[string]any{"note": "Lesson", "client_performance": "Well prepared", "client_performance_on_invoice": true},
			"[German · 03.11.2026 · Lesson · Well prepared|1500|10000|Z]"},
		{"on without text", map[string]any{"client_performance_on_invoice": true}, "[German · 03.11.2026|1500|10000|Z]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			realDrafts(e)
			b := e.workspace()
			eng := e.create(b, input(e.client(b), map[string]any{"billing": "arrears"}))
			path := "/api/v1/engagements/" + eng.ID
			body := map[string]any{"quantity": "1.5", "date": "2026-11-03"}
			for k, v := range tc.body {
				body[k] = v
			}
			var out entryOut
			e.do(b, "POST", path+"/entries", body, 201, &out)
			if out.Data.Entry.PerformanceOnInvoice != (tc.body["client_performance_on_invoice"] == true) {
				t.Fatalf("client_performance_on_invoice: %v", out.Data.Entry.PerformanceOnInvoice)
			}
			var inv invoiceOut
			e.do(b, "POST", path+"/periods/"+eng.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "usage", "detail": "per_entry"}, 201, &inv)
			if got := fmt.Sprint(e.lines(inv.Data.InvoiceID)); got != tc.want {
				t.Fatalf("lines %v", got)
			}
		})
	}
	e := newEnv(t)
	b := e.workspace()
	eng := e.create(b, input(e.client(b), nil))
	e.fails(b, "POST", "/api/v1/engagements/"+eng.ID+"/entries", map[string]any{"quantity": "1", "client_performance_on_invoice": "yes"},
		422, "validation_failed", "client_performance_on_invoice")
}

func TestConcurrentInvoicingInvoicesOnce(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	eng := e.create(b, input(e.client(b), nil))
	url := "/api/v1/engagements/" + eng.ID + "/periods/" + eng.CurrentPeriod.ID + "/invoice"
	codes := make([]int, 4)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, _ := e.send(b, "POST", url, map[string]any{"kind": "advance"})
			codes[i] = resp.StatusCode
		}()
	}
	wg.Wait()
	created := 0
	for _, c := range codes {
		if c == 201 {
			created++
		} else if c != 409 {
			t.Fatalf("codes %v", codes)
		}
	}
	if created != 1 {
		t.Fatalf("codes %v", codes)
	}
}

func TestDraftPriceByVATMode(t *testing.T) {
	net := store.Engagement{PriceBasis: "net", VATCategory: "S", VATRate: 810}
	gross := store.Engagement{PriceBasis: "gross", VATCategory: "S", VATRate: 810}
	for _, c := range []struct {
		e              store.Engagement
		price          invoicecalc.Money
		mode, wantMode string
		want           invoicecalc.Money
	}{
		{net, 10000, invoicecalc.Exclusive, invoicecalc.Exclusive, 10000},
		{net, 10000, invoicecalc.Inclusive, invoicecalc.Inclusive, 10810},
		{net, 10000, invoicecalc.None, invoicecalc.None, 10000},
		{gross, 10810, invoicecalc.Exclusive, invoicecalc.Exclusive, 10000},
		{gross, 7, invoicecalc.Exclusive, invoicecalc.Inclusive, 7},
		{gross, 10000, invoicecalc.Inclusive, invoicecalc.Inclusive, 10000},
		{gross, 10000, invoicecalc.None, invoicecalc.None, 9251},
	} {
		if mode, price := draftPrice(c.e, c.price, c.mode); mode != c.wantMode || price != c.want {
			t.Errorf("%s %s, %s: got %s %s", c.e.PriceBasis, c.price, c.mode, mode, price)
		}
	}
}

func TestGrossEngagementDraftRetainsAgreedTotal(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"quantity": "1000", "unit_price": "0.07", "currency": "EUR", "price_basis": "gross", "vat_category": "S", "vat_rate": "8.1"}))
	var result invoiceOut
	e.do(b, "POST", "/api/v1/engagements/"+v.ID+"/periods/"+v.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "advance"}, 201, &result)
	inv, err := e.st.Invoice(context.Background(), b.workspace, result.Data.InvoiceID, "2026-11-26", false)
	if err != nil || inv.VATMode != invoicecalc.Inclusive || inv.Total != 7000 || inv.VATTotal != 525 {
		t.Fatalf("mode %s, total %s, VAT %s, error %v", inv.VATMode, inv.Total, inv.VATTotal, err)
	}
}

// TestAddEntryForScheduling: a counted session's entry lands in its period; a date outside every open period is
// refused (engagement_period); removing an entry already gone is fine.
func TestAddEntryForScheduling(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var created one
	e.do(b, "POST", "/api/v1/engagements", input(e.client(b), nil), http.StatusCreated, &created)
	ws := store.Workspace{ID: b.workspace, Timezone: "Europe/Zurich"}
	ctx := context.Background()
	add := func(date string) error {
		return e.st.Tx(ctx, func(q store.Q) error {
			return AddEntry(ctx, q, ws, created.Data.ID, store.EngagementEntry{ID: auth.NewID("ent"), Date: date, Quantity: 1500}, fixedNow)
		})
	}
	if err := add("2026-11-16"); err != nil {
		t.Fatal(err)
	}
	for _, date := range []string{"2026-10-31", "2027-01-05"} {
		if err := add(date); err == nil || !strings.Contains(err.Error(), "engagement_period") {
			t.Fatalf("%s: %v", date, err)
		}
	}
	err := e.st.Tx(ctx, func(q store.Q) error { return RemoveEntry(ctx, q, created.Data.ID, "ent_gone") })
	if err != nil {
		t.Fatal(err)
	}
}
