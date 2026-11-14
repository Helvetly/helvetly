package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func booksStore(t *testing.T) (*store.Store, func(sql string, args ...any) error) {
	t.Helper()
	s, pool := storetest.New(t)
	ctx := context.Background()
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_b", Name: "Beta"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	return s, func(sql string, args ...any) error { _, err := pool.Exec(ctx, sql, args...); return err }
}

func event(ws, kind string) store.FinancialEvent {
	return store.FinancialEvent{WorkspaceID: ws, Kind: kind, SubjectType: "invoice", SubjectID: "inv_1",
		At: t0, Payload: json.RawMessage(`{"total": 1250, "currency": "CHF", "b": [1, 2]}`)}
}

func TestEventChainVerifies(t *testing.T) {
	s, exec := booksStore(t)
	ctx := context.Background()
	actor := "usr_1"
	for i, kind := range []string{"invoice.issued", "payment.added", "invoice.voided"} {
		e := event("wsp_a", kind)
		if i == 1 {
			e.ActorID = &actor
		}
		if err := s.LogEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.LogEvent(ctx, event("wsp_b", "invoice.issued")); err != nil {
		t.Fatal(err)
	}
	ok, brokenAt, err := s.VerifyChain(ctx, "wsp_a")
	if err != nil || !ok || brokenAt != 0 {
		t.Fatalf("VerifyChain = %v, %d, %v; want true, 0", ok, brokenAt, err)
	}
	events, err := s.Events(ctx, "wsp_a", 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Seq != 2 || events[1].Seq != 3 || events[0].PrevHash == "" ||
		events[1].PrevHash != events[0].Hash || *events[0].ActorID != actor {
		t.Fatalf("Events after 1 = %+v", events)
	}
	if b, _ := s.Events(ctx, "wsp_b", 0, 10); len(b) != 1 || b[0].Seq != 1 || b[0].PrevHash != "" {
		t.Fatalf("wsp_b events = %+v", b)
	}

	// Tampering (as a superuser would, around the trigger) is found at the row changed.
	if err := exec(`ALTER TABLE financial_events DISABLE TRIGGER financial_events_append_only`); err != nil {
		t.Fatal(err)
	}
	if err := exec(`UPDATE financial_events SET payload = '{"total": 1}' WHERE workspace_id = 'wsp_a' AND seq = 2`); err != nil {
		t.Fatal(err)
	}
	if ok, brokenAt, err := s.VerifyChain(ctx, "wsp_a"); err != nil || ok || brokenAt != 2 {
		t.Fatalf("tampered VerifyChain = %v, %d, %v; want false, 2", ok, brokenAt, err)
	}
	if err := exec(`DELETE FROM financial_events WHERE workspace_id = 'wsp_b'`); err != nil {
		t.Fatal(err)
	}
	if ok, brokenAt, _ := s.VerifyChain(ctx, "wsp_b"); !ok || brokenAt != 0 {
		t.Fatalf("empty chain VerifyChain = %v, %d", ok, brokenAt)
	}
}

func TestEventsAppendOnly(t *testing.T) {
	s, exec := booksStore(t)
	ctx := context.Background()
	if err := s.LogEvent(ctx, event("wsp_a", "invoice.issued")); err != nil {
		t.Fatal(err)
	}
	if err := exec(`UPDATE financial_events SET kind = 'x'`); err == nil {
		t.Fatal("UPDATE succeeded")
	}
	if err := exec(`DELETE FROM financial_events`); err == nil {
		t.Fatal("DELETE succeeded")
	}
}

func TestLogEventInCallerTx(t *testing.T) {
	s, _ := booksStore(t)
	ctx := context.Background()
	rollback := errors.New("rollback")
	err := s.Tx(ctx, func(q store.Q) error {
		if err := q.LogEvent(ctx, event("wsp_a", "invoice.issued")); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if events, _ := s.Events(ctx, "wsp_a", 0, 10); len(events) != 0 {
		t.Fatalf("rolled-back event kept: %+v", events)
	}
}

func TestConcurrentLogEventKeepsChain(t *testing.T) {
	s, _ := booksStore(t)
	ctx := context.Background()
	const n = 10
	var wg sync.WaitGroup
	errs := make(chan error, 2*n)
	for range 2 {
		wg.Go(func() {
			for range n {
				errs <- s.Tx(ctx, func(q store.Q) error { return q.LogEvent(ctx, event("wsp_a", "payment.added")) })
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	events, err := s.Events(ctx, "wsp_a", 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	for i, e := range events {
		if e.Seq != int64(i+1) {
			t.Fatalf("seq %d at %d", e.Seq, i)
		}
	}
	if len(events) != 2*n {
		t.Fatalf("%d events, want %d", len(events), 2*n)
	}
	if ok, brokenAt, err := s.VerifyChain(ctx, "wsp_a"); err != nil || !ok {
		t.Fatalf("VerifyChain = %v, %d, %v", ok, brokenAt, err)
	}
}

func TestCheckOpen(t *testing.T) {
	s, _ := booksStore(t)
	ctx := context.Background()
	if closed, err := s.ClosePeriod(ctx, "wsp_a", "2026-10", nil, t0); err != nil || !closed {
		t.Fatalf("ClosePeriod = %v, %v", closed, err)
	}
	if closed, err := s.ClosePeriod(ctx, "wsp_a", "2026-10", nil, t0); err != nil || closed {
		t.Fatalf("second ClosePeriod = %v, %v; want false", closed, err)
	}
	if _, err := s.ClosePeriod(ctx, "wsp_a", "2026-13", nil, t0); err == nil {
		t.Fatal("month 13 accepted")
	}
	tests := []struct {
		ws, date string
		want     error
	}{
		{"wsp_a", "2026-10-31", store.ErrPeriodClosed},
		{"wsp_a", "2026-10-01", store.ErrPeriodClosed},
		{"wsp_a", "2026-11-01", nil},
		{"wsp_a", "2026-09-30", nil},
		{"wsp_b", "2026-10-15", nil},
	}
	for _, tt := range tests {
		if err := s.CheckOpen(ctx, tt.ws, tt.date); !errors.Is(err, tt.want) {
			t.Errorf("CheckOpen(%s, %s) = %v, want %v", tt.ws, tt.date, err, tt.want)
		}
	}
	if err := s.CheckOpen(ctx, "wsp_a", "2026-10"); err == nil || errors.Is(err, store.ErrPeriodClosed) {
		t.Errorf("bad date: %v", err)
	}
	periods, err := s.Periods(ctx, "wsp_a")
	if err != nil || len(periods) != 1 || periods[0].Month != "2026-10" || !periods[0].ClosedAt.Equal(t0) {
		t.Fatalf("Periods = %+v, %v", periods, err)
	}
	if reopened, err := s.ReopenPeriod(ctx, "wsp_a", "2026-10"); err != nil || !reopened {
		t.Fatalf("ReopenPeriod = %v, %v", reopened, err)
	}
	if reopened, _ := s.ReopenPeriod(ctx, "wsp_a", "2026-10"); reopened {
		t.Fatal("reopened twice")
	}
	if err := s.CheckOpen(ctx, "wsp_a", "2026-10-31"); err != nil {
		t.Fatalf("after reopen: %v", err)
	}
}

func seedClient(t *testing.T, exec func(string, ...any) error) {
	t.Helper()
	if err := exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		VALUES ('cli_1', 'wsp_a', 1, 'Client', $1, $1)`, t0); err != nil {
		t.Fatal(err)
	}
}

func agreement(id, starts string, ends *string) store.SelfBillingAgreement {
	accepted, by := t0, "Client AG"
	return store.SelfBillingAgreement{ID: id, WorkspaceID: "wsp_a", ClientID: "cli_1", StartsOn: starts, EndsOn: ends,
		AcceptedAt: &accepted, AcceptedBy: &by, CreatedAt: t0}
}

func TestAgreementCovering(t *testing.T) {
	s, exec := booksStore(t)
	seedClient(t, exec)
	ctx := context.Background()
	end := "2026-06-30"
	note := "signed on paper"
	a1 := agreement("sba_1", "2026-01-01", &end)
	a1.Note = &note
	unaccepted := agreement("sba_3", "2025-01-01", nil)
	unaccepted.AcceptedAt = nil
	for _, a := range []store.SelfBillingAgreement{a1, agreement("sba_2", "2026-08-01", nil), unaccepted} {
		if err := s.CreateAgreement(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	tests := []struct {
		ws, date, want string
	}{
		{"wsp_a", "2025-12-31", ""},
		{"wsp_a", "2026-01-01", "sba_1"},
		{"wsp_a", "2026-06-30", "sba_1"},
		{"wsp_a", "2026-07-15", ""},
		{"wsp_a", "2026-08-01", "sba_2"},
		{"wsp_a", "2030-01-01", "sba_2"},
		{"wsp_b", "2026-03-01", ""},
	}
	for _, tt := range tests {
		a, err := s.AgreementCovering(ctx, tt.ws, "cli_1", tt.date, time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
		got := ""
		if a != nil {
			got = a.ID
		}
		if got != tt.want {
			t.Errorf("AgreementCovering(%s, %s) = %q, want %q", tt.ws, tt.date, got, tt.want)
		}
	}
	list, err := s.Agreements(ctx, "wsp_a", "cli_1")
	if err != nil || len(list) != 3 || list[0].ID != "sba_2" || *list[1].EndsOn != end || *list[1].Note != note ||
		list[2].AcceptedAt != nil {
		t.Fatalf("Agreements = %+v, %v", list, err)
	}
}

func TestDeleteUsedAgreementRefused(t *testing.T) {
	s, exec := booksStore(t)
	seedClient(t, exec)
	ctx := context.Background()
	for _, id := range []string{"sba_1", "sba_2"} {
		if err := s.CreateAgreement(ctx, agreement(id, "2026-01-01", nil)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.MarkAgreementUsed(ctx, "wsp_a", "sba_1", t0); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkAgreementUsed(ctx, "wsp_a", "sba_1", t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAgreement(ctx, "wsp_a", "sba_1"); !errors.Is(err, store.ErrAgreementUsed) {
		t.Fatalf("delete used = %v", err)
	}
	if err := s.DeleteAgreement(ctx, "wsp_b", "sba_2"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete other workspace = %v", err)
	}
	if err := s.DeleteAgreement(ctx, "wsp_a", "sba_2"); err != nil {
		t.Fatal(err)
	}
	list, _ := s.Agreements(ctx, "wsp_a", "cli_1")
	if len(list) != 1 || list[0].FirstUsedAt == nil || !list[0].FirstUsedAt.Equal(t0) {
		t.Fatalf("Agreements = %+v", list)
	}
}

// A close waits for a transaction that passed CheckOpen, so nothing lands in a month after it closed.
func TestCloseWaitsForOpenCheck(t *testing.T) {
	s, _ := booksStore(t)
	ctx := context.Background()
	checked, release, issued := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		issued <- s.Tx(ctx, func(q store.Q) error {
			if err := q.CheckOpen(ctx, "wsp_a", "2026-10-15"); err != nil {
				return err
			}
			close(checked)
			<-release
			return nil
		})
	}()
	<-checked
	closed := make(chan error, 1)
	go func() { _, err := s.ClosePeriod(ctx, "wsp_a", "2026-10", nil, t0); closed <- err }()
	select {
	case err := <-closed:
		t.Fatalf("close did not wait for the open check: %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	if err := <-issued; err != nil {
		t.Fatal(err)
	}
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	if err := s.CheckOpen(ctx, "wsp_a", "2026-10-15"); !errors.Is(err, store.ErrPeriodClosed) {
		t.Fatalf("after close: %v", err)
	}
}

func TestCheckOpenTakesSharedPeriodsLock(t *testing.T) {
	s, pool := storetest.New(t)
	ctx := context.Background()
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	tryLock := func() bool {
		var got bool
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended('closed_periods:' || 'wsp_a', 0))`).
				Scan(&got)
		})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	err := s.Tx(ctx, func(q store.Q) error {
		if err := q.CheckOpen(ctx, "wsp_a", "2026-10-15"); err != nil {
			return err
		}
		if tryLock() {
			t.Error("exclusive periods lock granted while CheckOpen's transaction is open")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !tryLock() {
		t.Error("periods lock still held after commit")
	}
}

func TestAppendOnlyRefusesTruncate(t *testing.T) {
	s, exec := booksStore(t)
	if err := s.LogEvent(context.Background(), event("wsp_a", "invoice.issued")); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"financial_events", "signature_events"} {
		if err := exec(`TRUNCATE ` + table + ` CASCADE`); err == nil {
			t.Errorf("TRUNCATE %s succeeded", table)
		}
	}
}

// AgreementCovering locks the agreement for the issuing transaction: it cannot be deleted under it.
func TestAgreementCoveringLocksRow(t *testing.T) {
	s, pool := storetest.New(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) error { _, err := pool.Exec(ctx, sql, args...); return err }
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	seedClient(t, exec)
	if err := s.CreateAgreement(ctx, agreement("sba_1", "2026-01-01", nil)); err != nil {
		t.Fatal(err)
	}
	err := s.Tx(ctx, func(q store.Q) error {
		if a, err := q.AgreementCovering(ctx, "wsp_a", "cli_1", "2026-03-01", time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)); err != nil || a == nil {
			t.Fatalf("covering = %v, %v", a, err)
		}
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout = '100ms'`); err != nil {
				t.Fatal(err)
			}
			_, err := tx.Exec(ctx, `DELETE FROM self_billing_agreements WHERE id = 'sba_1'`)
			return err
		})
		if err == nil || !strings.Contains(err.Error(), "lock timeout") {
			t.Errorf("delete under the issuing transaction = %v, want a lock timeout", err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestMarkAgreementUsedMissing(t *testing.T) {
	s, _ := booksStore(t)
	if err := s.MarkAgreementUsed(context.Background(), "wsp_a", "sba_gone", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("mark missing = %v, want ErrNotFound", err)
	}
}
