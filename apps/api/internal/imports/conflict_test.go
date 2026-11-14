package imports

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// issuedRecord: a model record of an invoice issued elsewhere for Kunde AG, 8 hours at the price.
func issuedRecord(number, price string) string {
	return `{"client_name":"Kunde AG","number":"` + number + `","issue_date":"2025-10-01","currency":"CHF","issued_elsewhere":true,
		"lines":[{"description":"Beratung","quantity":"8","unit_price":"` + price + `","vat_category":"S","vat_rate":"8.1"}]}`
}

func TestCommitResolvesNumberConflicts(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	ctx := context.Background()
	if err := e.db.CreateClient(ctx, "ws_a", "cli_k", map[string]any{"name": "Kunde AG"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	commit := func(batch string, ids []string, resolutions map[string]string) []commitResult {
		t.Helper()
		w := e.do("POST", "/api/v1/imports/"+batch+"/commit", map[string]any{"record_ids": ids, "resolutions": resolutions})
		if w.Code != 200 {
			t.Fatalf("commit: %d %s", w.Code, w.Body)
		}
		return decode[commitOut](t, w).Results
	}

	// First import: two invoices issued elsewhere, one with a payment recorded later.
	e.model.replies = append(e.model.replies, answer(`{"records":[`+issuedRecord("ALT-1", "125.00")+`,`+issuedRecord("ALT-2", "125.00")+`]}`))
	first := e.extracted(decode[store.ImportBatch](t, e.upload("invoices", map[string][]byte{"old.pdf": []byte("%PDF-1.7 old")})).ID)
	res := commit(first.ID, []string{first.Records[0].ID, first.Records[1].ID}, nil)
	if res[0].Status != "created" || res[1].Status != "created" {
		t.Fatalf("first import: %+v", res)
	}
	paidID, freeID := *res[0].EntityID, *res[1].EntityID
	if err := e.db.CreatePayment(ctx, paidID, "usr_a", store.Payment{ID: "pay_1", Amount: 100, PaidOn: "2025-10-02", Method: "other", CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}

	// Second import: the same numbers again, at another price, plus a number that does not exist.
	e.model.replies = append(e.model.replies, answer(`{"records":[`+issuedRecord("ALT-1", "150.00")+`,`+issuedRecord("ALT-2", "150.00")+`,`+
		issuedRecord("ALT-3", "150.00")+`]}`))
	second := e.extracted(decode[store.ImportBatch](t, e.upload("invoices", map[string][]byte{"again.pdf": []byte("%PDF-1.7 again")})).ID)
	r := second.Records
	for i, want := range []string{paidID, freeID} {
		if r[i].Duplicate == nil || r[i].Duplicate.ID != want || r[i].Duplicate.Reason != "number already used" {
			t.Fatalf("review hint %d: %+v", i, r[i].Duplicate)
		}
	}
	ids := []string{r[0].ID, r[1].ID, r[2].ID}

	res = commit(second.ID, ids, nil)
	if res[0].Status != "conflict" || res[0].Conflict.ID != paidID || res[0].Conflict.CanOverwrite || *res[0].Conflict.Why != "It already has payments recorded." ||
		res[1].Status != "conflict" || res[1].Conflict.ID != freeID || !res[1].Conflict.CanOverwrite || res[1].EntityID != nil ||
		res[2].Status != "created" {
		t.Fatalf("conflicts: %+v", res)
	}
	if b := e.extracted(second.ID); b.Records[0].Status != "pending" || b.Records[1].Status != "pending" {
		t.Fatalf("a conflict changed the record: %+v", b.Records)
	}

	// The person's choices: skip the paid one, overwrite the untouched one. A refused overwrite fails the record only.
	if w := e.do("POST", "/api/v1/imports/"+second.ID+"/commit", map[string]any{"record_ids": ids, "resolutions": map[string]string{r[0].ID: "replace"}}); w.Code != 400 {
		t.Fatalf("unknown resolution: %d", w.Code)
	}
	res = commit(second.ID, ids, map[string]string{r[0].ID: "overwrite", r[1].ID: "overwrite"})
	if res[0].Status != "failed" || res[0].Error.Code != "cannot_overwrite" || res[1].Status != "created" || *res[1].EntityID != freeID || res[2].Status != "created" {
		t.Fatalf("overwrite: %+v", res)
	}
	inv, err := e.db.Invoice(ctx, "ws_a", freeID, "2026-01-01", false)
	if err != nil || inv.Total != 129720 || inv.Status != "open" || *inv.Number != "ALT-2" {
		t.Fatalf("overwritten invoice: total %d status %s err %v", inv.Total, inv.Status, err)
	}
	res = commit(second.ID, ids, map[string]string{r[0].ID: "skip"})
	if res[0].Status != "skipped" || res[0].Error != nil || res[1].Status != "created" {
		t.Fatalf("skip: %+v", res)
	}

	// Committing again is idempotent: skipped stays skipped, created stays created, nothing is written twice.
	res = commit(second.ID, ids, nil)
	if res[0].Status != "skipped" || res[1].Status != "created" || *res[1].EntityID != freeID || res[2].Status != "created" {
		t.Fatalf("re-commit: %+v", res)
	}
	events, err := e.db.Events(ctx, "ws_a", 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	overwrites := 0
	for _, ev := range events {
		if ev.Kind == "invoice.import_overwritten" {
			overwrites++
		}
	}
	if overwrites != 1 {
		t.Fatalf("overwrites logged: %d", overwrites)
	}
	if b := e.extracted(second.ID); b.Records[0].Status != "skipped" {
		t.Fatalf("skipped record: %+v", b.Records[0])
	}
	for _, sum := range decode[[]store.ImportBatchSummary](t, e.do("GET", "/api/v1/imports?kind=invoices", nil)) {
		if sum.Pending != 0 { // created and skipped records wait for nothing
			t.Fatalf("summary %+v", sum)
		}
	}
	// An edit takes a skipped record up again.
	edited := decode[store.ImportRecord](t, e.do("PATCH", "/api/v1/imports/"+second.ID+"/records/"+r[0].ID, map[string]any{"data": map[string]any{"number": "ALT-4"}}))
	if edited.Status != "pending" || edited.Duplicate == nil || edited.Duplicate.Reason != "same date and total" { // ALT-3's date and total
		t.Fatalf("edited: %+v", edited)
	}
}
