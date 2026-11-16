package billing

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/quotes"
)

// TestQuotesCountWhenFirstSent: a quote counts in quotes_per_month when it is first sent (numbered). Basic sends 5 a
// month; the 6th answers 402 and stays an unnumbered draft; sending a sent quote again, or a revision of it, counts
// nothing; Business counts without a cap.
func TestQuotesCountWhenFirstSent(t *testing.T) {
	e := usageEnv(t)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	files := invoiceFiles{&admissionFiles{objects: map[string][]byte{}}}
	mux := http.NewServeMux()
	inv := invoices.New(e.st, e.svc.auth, files, nil, quiet)
	inv.Register(mux)
	quotes.New(e.st, e.svc.auth, inv, files, nil, quiet).Register(mux)
	billingSrv := e.srv
	e.srv = httptest.NewServer(e.svc.Guard(mux))
	t.Cleanup(e.srv.Close)
	if code, body := e.do(b, http.MethodPut, "/api/v1/invoice-settings", issueSettings); code != http.StatusOK {
		t.Fatalf("settings: %d %v", code, body)
	}
	client := e.buyer(b.workspace)
	ids := make([]string, 7)
	for i := range ids {
		code, body := e.do(b, http.MethodPost, "/api/v1/quotes", map[string]any{"client_id": client,
			"lines": []any{map[string]any{"description": "Beratung", "quantity": "1", "unit": "hour", "unit_price": "100.00"}}})
		if code != http.StatusCreated {
			t.Fatalf("quote %d: %d %v", i, code, body)
		}
		ids[i] = dataOf(body)["id"].(string)
	}
	send := func(id string) (int, map[string]any) {
		return e.do(b, http.MethodPost, "/api/v1/quotes/"+id+"/send", map[string]any{"email": false})
	}
	counted := func(want int64) {
		t.Helper()
		if n := e.usedIn(b.workspace, Quotes, time.Now()); n != want {
			t.Fatalf("the month counts %d quotes, want %d", n, want)
		}
	}
	for i := range 5 {
		if code, body := send(ids[i]); code != http.StatusOK {
			t.Fatalf("send %d: %d %v", i+1, code, body)
		}
	}
	counted(5)
	code, body := send(ids[5])
	if code != http.StatusPaymentRequired || errorCode(body) != "limit_reached" {
		t.Fatalf("the 6th send: %d %v", code, body)
	}
	if code, body := e.do(b, http.MethodGet, "/api/v1/quotes/"+ids[5], nil); code != http.StatusOK || dataOf(body)["status"] != "draft" || dataOf(body)["number"] != nil {
		t.Fatalf("the refused quote changed: %d %v", code, body)
	}
	if code, body := send(ids[0]); code != http.StatusOK {
		t.Fatalf("sending a sent quote again at the cap: %d %v", code, body)
	}
	if code, body := e.do(b, http.MethodPost, "/api/v1/quotes/"+ids[0]+"/revise", nil); code != http.StatusOK {
		t.Fatalf("revise: %d %v", code, body)
	}
	if code, body := send(ids[0]); code != http.StatusOK {
		t.Fatalf("sending a revision at the cap: %d %v", code, body)
	}
	counted(5)
	quotesSrv := e.srv
	e.srv = billingSrv
	e.subscribe(b.workspace, "price_xm")
	e.srv = quotesSrv
	for _, id := range ids[5:] {
		if code, body := send(id); code != http.StatusOK {
			t.Fatalf("send on Business: %d %v", code, body)
		}
	}
	counted(7)
	if got := e.cap(b.workspace, Quotes); got != Unlimited {
		t.Fatalf("Business quotes: %d", got)
	}
}
