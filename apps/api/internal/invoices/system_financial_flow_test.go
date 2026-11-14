package invoices

import (
	"bytes"
	"context"
	"encoding/csv"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/products"
	"helvetly.com/api/internal/store"
)

type financialStorage struct{ *fakeStorage }

type financialObject struct{ *bytes.Reader }

func (financialObject) Close() error { return nil }
func (f *fakeStorage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	b, err := f.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return financialObject{bytes.NewReader(b)}, nil
}

func TestCatalogueInvoicePaymentCreditExpenseReportingFlow(t *testing.T) {
	e := newEnv(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	mux := http.NewServeMux()
	e.svc.Register(mux)
	products.New(e.st, e.svc.auth, log).Register(mux)
	expenses.New(e.st, e.svc.auth, financialStorage{e.files}, log).Register(mux)
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	b, clientID := e.ready()
	today := time.Now().In(zone).Format(time.DateOnly)

	var item struct{ Data store.Product }
	e.do(b, "POST", "/api/v1/products", map[string]any{"name": "Consulting", "type": "service", "unit": "hour",
		"unit_price": "100", "price_basis": "net", "vat_category": "S", "vat_rate": "8.1", "currency": "CHF"}, 201, &item)
	if item.Data.UnitPriceNet.String() != "100.00" || item.Data.UnitPriceGross.String() != "108.10" {
		t.Fatalf("catalogue prices: %+v", item.Data)
	}
	// The picker copies the catalogue fields. Independently: 10 × 100 + 8.1% = CHF 1,081.
	inv := e.issued(b, clientID, map[string]any{"lines": []any{map[string]any{"description": item.Data.Name,
		"quantity": "10", "unit": item.Data.Unit, "unit_price": item.Data.UnitPriceNet.String(),
		"vat_category": item.Data.VATCategory, "vat_rate": item.Data.VATRate.String()}}})
	path := "/api/v1/invoices/" + inv.ID
	if inv.PayableTotal != "1081.00" || inv.Lines[0].VATRate != "8.1" {
		t.Fatalf("issued amount: %+v", inv)
	}
	pdfBefore, rawBefore := e.send(b, "GET", path+"/pdf", nil)
	if pdfBefore.StatusCode != 200 || !bytes.HasPrefix(rawBefore, []byte("%PDF-")) {
		t.Fatal("issued PDF unavailable")
	}
	e.do(b, "PATCH", "/api/v1/products/"+item.Data.ID, map[string]any{"name": "New catalogue version", "unit_price": "200", "vat_rate": "2.6"}, 200, nil)
	e.do(b, "POST", "/api/v1/products/"+item.Data.ID+"/archive", nil, 200, nil)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"name": "New seller name"}}, 200, nil)
	unchanged := e.invoice(b, "GET", path, nil, 200)
	_, rawAfter := e.send(b, "GET", path+"/pdf", nil)
	if unchanged.PayableTotal != "1081.00" || unchanged.Seller == nil || unchanged.Seller.Name != "Muster GmbH" || !bytes.Equal(rawBefore, rawAfter) {
		t.Fatal("catalogue/settings edits changed an issued financial record")
	}

	partial := e.invoice(b, "POST", path+"/payments", map[string]any{"amount": "400", "method": "bank_transfer", "paid_on": today}, 201)
	if partial.AmountDue != "681.00" {
		t.Fatalf("after partial payment: %+v", partial)
	}
	paid := e.invoice(b, "POST", path+"/mark-paid", map[string]any{}, 200)
	if paid.AmountPaid != "1081.00" || paid.AmountDue != "0.00" {
		t.Fatalf("settled invoice: %+v", paid)
	}
	credit := e.invoice(b, "POST", path+"/credit-note", map[string]any{"lines": []any{line("1", "100")}}, 201)
	credit = e.invoice(b, "POST", "/api/v1/invoices/"+credit.ID+"/issue", nil, 200)
	if credit.PayableTotal != "108.10" || credit.Payment.QRBill {
		t.Fatalf("credit amount: %+v", credit)
	}
	var refund refundState
	e.do(b, "POST", path+"/refunds", map[string]any{"amount": "108.10", "method": "bank_transfer", "refunded_on": today}, 201, &refund)
	if refund.Data.RefundDue != "0.00" || refund.Data.AmountRefunded != "108.10" {
		t.Fatalf("refund balance: %+v", refund)
	}
	var sales struct{ Data store.InvoiceSummary }
	e.do(b, "GET", "/api/v1/invoices/summary?currency=CHF", nil, 200, &sales)
	month := sales.Data.Monthly[len(sales.Data.Monthly)-1]
	if month.Invoiced.String() != "972.90" || month.Paid.String() != "972.90" || sales.Data.Outstanding.Amount.String() != "0.00" {
		t.Fatalf("sales report: %+v", sales.Data)
	}

	var categories struct{ Data []store.ExpenseCategory }
	e.do(b, "GET", "/api/v1/expense-categories", nil, 200, &categories)
	var cost struct {
		Data struct {
			ID            string `json:"id"`
			Total         string `json:"total"`
			NetTotal      string `json:"net_total"`
			DeductibleVAT string `json:"deductible_vat"`
		}
	}
	e.do(b, "POST", "/api/v1/expenses", map[string]any{"supplier_name": "Swiss supplier", "document_date": today,
		"category_id": categories.Data[0].ID, "supplier_country": "CH", "receipt_missing_reason": "Substitute voucher supplied by the test",
		"lines": []any{map[string]any{"amount": "108.10", "vat_rate": "8.1"}}, "input_tax": "full"}, 201, &cost)
	e.do(b, "POST", "/api/v1/expenses/"+cost.Data.ID+"/book", nil, 200, &cost)
	// Input-tax eligibility is explicitly declared by this fixture, not inferred from a VAT amount.
	if cost.Data.Total != "108.10" || cost.Data.NetTotal != "100.00" || cost.Data.DeductibleVAT != "8.10" {
		t.Fatalf("booked expense: %+v", cost.Data)
	}
	var costs struct{ Data store.ExpenseSummary }
	e.do(b, "GET", "/api/v1/expenses/summary", nil, 200, &costs)
	if costs.Data.ThisMonth.Amount.String() != "108.10" || costs.Data.InputVAT.Amount.String() != "8.10" {
		t.Fatalf("expense report: %+v", costs.Data)
	}
	for _, endpoint := range []string{"invoices/export", "expenses/export", "products/export?status=archived"} {
		response, raw := e.send(b, "GET", "/api/v1/"+endpoint, nil)
		if response.StatusCode != 200 {
			t.Fatalf("%s export: %d", endpoint, response.StatusCode)
		}
		rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(raw), "\ufeff"))).ReadAll()
		if err != nil || len(rows) < 2 {
			t.Fatalf("%s CSV: %v, %v", endpoint, rows, err)
		}
	}
	other := e.workspace()
	for _, resource := range []string{path, "/api/v1/products/" + item.Data.ID, "/api/v1/expenses/" + cost.Data.ID} {
		e.do(other, "GET", resource, nil, 404, nil)
	}
	financialReadLoad(t, e.srv.URL, b, []string{path, "/api/v1/invoices/summary?currency=CHF", "/api/v1/expenses/summary"})
}

func financialReadLoad(t *testing.T, baseURL string, b *browser, paths []string) {
	t.Helper()
	type result struct {
		elapsed time.Duration
		status  int
		err     error
	}
	results := make(chan result, 48)
	var workers sync.WaitGroup
	for worker := range 4 {
		workers.Go(func() {
			client := &http.Client{Timeout: 10 * time.Second}
			for i := range 12 {
				request, err := http.NewRequest(http.MethodGet, baseURL+paths[(worker+i)%len(paths)], nil)
				if err != nil {
					results <- result{err: err}
					continue
				}
				request.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
				start := time.Now()
				response, err := client.Do(request)
				status := 0
				if err == nil {
					status = response.StatusCode
					_, err = io.Copy(io.Discard, response.Body)
					_ = response.Body.Close()
				}
				results <- result{time.Since(start), status, err}
			}
		})
	}
	workers.Wait()
	close(results)
	var durations []time.Duration
	for response := range results {
		if response.err != nil || response.status != http.StatusOK {
			t.Errorf("concurrent financial read: %d %v", response.status, response.err)
		}
		durations = append(durations, response.elapsed)
	}
	slices.Sort(durations)
	t.Logf("local financial reads: requests=48 concurrency=4 p50=%s p95=%s p99=%s; one invoice, one credit, one expense; race detector enabled",
		durations[23], durations[45], durations[47])
}
