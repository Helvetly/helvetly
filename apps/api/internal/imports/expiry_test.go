package imports

import (
	"context"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// idle sets the service's clock to d after the batch's last activity.
func (e *env) idle(b store.ImportBatch, d time.Duration) {
	last := b.ExpiresAt.Add(-store.ImportExpiry)
	e.s.now = func() time.Time { return last.Add(d) }
}

func (e *env) expiredEvents() int {
	e.t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE kind = 'imports.expired'`).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestUnfinishedImportsExpireAfter48Hours(t *testing.T) {
	for _, tc := range []struct {
		name     string
		idle     time.Duration
		finished bool
		expired  bool
	}{
		{"a minute before", store.ImportExpiry - time.Minute, false, false},
		{"at 48 hours", store.ImportExpiry, false, true},
		{"days later", 5 * 24 * time.Hour, false, true},
		{"finished imports stay", 5 * 24 * time.Hour, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			e.consent("ws_a", "usr_a")
			b := e.extracted(decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"c.csv": []byte(clientsCSV)})).ID)
			if tc.finished {
				ids := []string{b.Records[0].ID, b.Records[1].ID}
				e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids, "resolutions": map[string]string{ids[1]: Skip}})
				b = decode[store.ImportBatch](t, e.do("GET", "/api/v1/imports/"+b.ID, nil))
			}
			e.idle(b, tc.idle)
			if err := e.s.ExpireTick(context.Background()); err != nil {
				t.Fatal(err)
			}
			gone := e.do("GET", "/api/v1/imports/"+b.ID, nil).Code == 404
			if gone != tc.expired || e.expiredEvents() != map[bool]int{true: 1}[tc.expired] {
				t.Fatalf("gone=%v events=%d, want expired=%v", gone, e.expiredEvents(), tc.expired)
			}
			if _, total, _ := e.db.ListClients(context.Background(), "ws_a", store.ClientFilter{}, 10, 0); tc.finished && total != 1 {
				t.Fatalf("expiry touched created records: %d clients", total)
			}
		})
	}
}

func TestAnExpiredImportCannotBeContinued(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	b := e.extracted(decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"c.csv": []byte(clientsCSV)})).ID)
	if want := b.CreatedAt.Add(store.ImportExpiry); b.ExpiresAt.Before(want) {
		t.Fatalf("expires_at %v before %v", b.ExpiresAt, want)
	}
	e.idle(b, store.ImportExpiry)
	rec := b.Records[1].ID
	for _, w := range []struct {
		method, path string
		body         map[string]any
	}{
		{"PATCH", "/api/v1/imports/" + b.ID + "/records/" + rec, map[string]any{"data": map[string]any{"email": "beta@example.ch"}}},
		{"POST", "/api/v1/imports/" + b.ID + "/commit", map[string]any{"record_ids": []string{rec}}},
	} {
		if got := e.do(w.method, w.path, w.body); got.Code != 410 || code(got) != "import_expired" {
			t.Fatalf("%s %s: %d %s", w.method, w.path, got.Code, got.Body)
		}
	}
	// Discarding it by hand still works before the job gets to it.
	if w := e.do("DELETE", "/api/v1/imports/"+b.ID, nil); w.Code != 204 {
		t.Fatalf("discard: %d", w.Code)
	}
}

func TestImportExpiryIsIdempotentAcrossInstances(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	b := e.extracted(decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"c.csv": []byte(clientsCSV)})).ID)
	e.idle(b, store.ImportExpiry+time.Hour)
	var wg sync.WaitGroup
	for range 3 {
		wg.Go(func() {
			if err := e.s.ExpireTick(context.Background()); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if err := e.s.ExpireTick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := e.expiredEvents(); n != 1 {
		t.Fatalf("imports.expired logged %d times", n)
	}
}

func TestExpiringAPayrollImportDeletesItsFile(t *testing.T) {
	e := newEnv(t)
	e.staff("E-1")
	w := e.upload("payroll", map[string][]byte{"p.csv": []byte(payrollCSV)})
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	before := len(e.files.objects)
	e.idle(b, store.ImportExpiry)
	if err := e.s.ExpireTick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(e.files.objects) != before-1 {
		t.Fatalf("the payroll file stayed after its batch expired: %d -> %d objects", before, len(e.files.objects))
	}
	var docs int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM documents WHERE hr_private`).Scan(&docs); err != nil || docs != 0 {
		t.Fatalf("HR documents left: %d %v", docs, err)
	}
}
