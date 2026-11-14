package invoices

import (
	"net/http"
	"sync"
	"testing"
	"time"
)

// statuses runs the same request n times at once (each on its own connection and transaction) and counts the
// response codes.
func (e *env) statuses(b *browser, n int, method, p string, body func(i int) any) map[int]int {
	e.t.Helper()
	var mu sync.Mutex
	got := map[int]int{}
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			resp, _ := e.send(b, method, p, body(i))
			mu.Lock()
			got[resp.StatusCode]++
			mu.Unlock()
		})
	}
	wg.Wait()
	return got
}

func none(int) any { return nil }

// A double-click (or two tabs) issuing the same draft takes one number once; the loser gets 409.
func TestConcurrentIssueOfSameDraftTakesOneNumber(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	d := e.draft(b, clientID, nil)
	got := e.statuses(b, 8, "POST", path(d.ID, "issue"), none)
	if got[http.StatusOK] != 1 || got[http.StatusConflict] != 7 {
		t.Fatalf("statuses: %v", got)
	}
	year := time.Now().In(zone).Format("2006")
	if inv := e.issued(b, clientID, nil); *inv.Number != year+"-002" {
		t.Fatalf("next number %s, want %s-002: the double issue took a number", *inv.Number, year)
	}
}

// An issue that fails after taking its number (the PDF cannot be stored) rolls back and gives the number back.
func TestFailedIssueGivesNumberBack(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	d := e.draft(b, clientID, nil)
	e.files.mu.Lock()
	e.files.failPut = true
	e.files.mu.Unlock()
	if resp, body := e.send(b, "POST", path(d.ID, "issue"), nil); resp.StatusCode < 500 {
		t.Fatalf("issue with a broken bucket: %d %s", resp.StatusCode, body)
	}
	e.files.mu.Lock()
	e.files.failPut = false
	e.files.mu.Unlock()
	if got := e.invoice(b, "GET", path(d.ID), nil, http.StatusOK); got.Status != "draft" || got.Number != nil {
		t.Fatalf("after the failed issue: %+v", got)
	}
	year := time.Now().In(zone).Format("2006")
	if inv := e.invoice(b, "POST", path(d.ID, "issue"), nil, http.StatusOK); *inv.Number != year+"-001" {
		t.Fatalf("number %s, want %s-001: the rollback left a gap", *inv.Number, year)
	}
}

// Payments recorded at once never take more than the amount due, and mark-paid settles once.
func TestConcurrentPaymentsNeverOverpay(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.issued(b, clientID, nil) // 216.20 payable
	got := e.statuses(b, 6, "POST", path(inv.ID, "payments"), func(int) any {
		return map[string]any{"amount": "100.00", "method": "cash"}
	})
	if got[http.StatusCreated] != 2 || got[http.StatusUnprocessableEntity] != 4 {
		t.Fatalf("payments: %v", got)
	}
	got = e.statuses(b, 6, "POST", path(inv.ID, "mark-paid"), func(int) any { return map[string]any{} })
	if got[http.StatusOK] != 1 || got[http.StatusConflict] != 5 {
		t.Fatalf("mark-paid: %v", got)
	}
	after := e.invoice(b, "GET", path(inv.ID), nil, http.StatusOK)
	if after.Status != "paid" || after.AmountPaid != "216.20" || len(after.Payments) != 3 {
		t.Fatalf("after: status %s paid %s payments %d", after.Status, after.AmountPaid, len(after.Payments))
	}
}

// A payment and a void racing on one open invoice: exactly one wins, never a voided invoice with a payment.
func TestConcurrentPaymentAndVoidExcludeEachOther(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	for round := range 5 {
		inv := e.issued(b, clientID, nil)
		codes := make([]int, 2)
		var wg sync.WaitGroup
		wg.Go(func() {
			resp, _ := e.send(b, "POST", path(inv.ID, "payments"), map[string]any{"amount": "10.00", "method": "cash"})
			codes[0] = resp.StatusCode
		})
		wg.Go(func() {
			resp, _ := e.send(b, "POST", path(inv.ID, "void"), map[string]any{})
			codes[1] = resp.StatusCode
		})
		wg.Wait()
		after := e.invoice(b, "GET", path(inv.ID), nil, http.StatusOK)
		ok := (codes[0] == http.StatusCreated && codes[1] == http.StatusConflict && after.Status == "open" && after.AmountPaid == "10.00") ||
			(codes[0] == http.StatusConflict && codes[1] == http.StatusOK && after.Status == "void" && after.AmountPaid == "0.00")
		if !ok {
			t.Fatalf("round %d: payment %d void %d → %s paid %s", round, codes[0], codes[1], after.Status, after.AmountPaid)
		}
	}
}

// Two corrections of one original issued at once: one replaces it, the other is refused; payments move once.
func TestConcurrentCorrectionsReplaceOnce(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	orig := e.issued(b, clientID, nil)
	e.invoice(b, "POST", path(orig.ID, "payments"), map[string]any{"amount": "50.00", "method": "cash"}, http.StatusCreated)
	ids := []string{e.derived(b, orig.ID, "corrected", nil), e.derived(b, orig.ID, "corrected", nil)}
	codes := make([]int, len(ids))
	var wg sync.WaitGroup
	for i, id := range ids {
		wg.Go(func() {
			resp, _ := e.send(b, "POST", path(id, "issue"), nil)
			codes[i] = resp.StatusCode
		})
	}
	wg.Wait()
	want := map[int]string{http.StatusOK: "50.00", http.StatusUnprocessableEntity: "0.00"}
	seen := map[int]bool{}
	for i, c := range codes {
		paid := e.invoice(b, "GET", path(ids[i]), nil, http.StatusOK).AmountPaid
		if w, known := want[c]; !known || seen[c] || paid != w {
			t.Fatalf("codes %v: correction %d paid %s", codes, i, paid)
		}
		seen[c] = true
	}
	if got := e.invoice(b, "GET", path(orig.ID), nil, http.StatusOK); got.Status != "replaced" || got.AmountPaid != "0.00" {
		t.Fatalf("original: %s paid %s", got.Status, got.AmountPaid)
	}
}
