package store_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// VerifyChain finds a removed, reordered or relinked event; a removed tail and a chain rewritten from the edit onwards
// pass, which is why the books contract asks for the last hash to be kept outside the database.
func TestVerifyChainTampering(t *testing.T) {
	tests := []struct {
		name       string
		tamper     []string
		wantOK     bool
		wantBroken int64
	}{
		{"middle event deleted", []string{`DELETE FROM financial_events WHERE workspace_id = 'wsp_a' AND seq = 2`}, false, 2},
		{"first event deleted", []string{`DELETE FROM financial_events WHERE workspace_id = 'wsp_a' AND seq = 1`}, false, 1},
		{"two events swapped", []string{
			`UPDATE financial_events SET seq = 100 WHERE workspace_id = 'wsp_a' AND seq = 2`,
			`UPDATE financial_events SET seq = 2 WHERE workspace_id = 'wsp_a' AND seq = 3`,
			`UPDATE financial_events SET seq = 3 WHERE workspace_id = 'wsp_a' AND seq = 100`,
		}, false, 2},
		{"prev_hash relinked", []string{`UPDATE financial_events SET prev_hash = '\x00' WHERE workspace_id = 'wsp_a' AND seq = 3`}, false, 3},
		{"hash replaced", []string{`UPDATE financial_events SET hash = '\x00' WHERE workspace_id = 'wsp_a' AND seq = 4`}, false, 4},
		{"event moved to another workspace's chain", []string{`UPDATE financial_events SET workspace_id = 'wsp_b', seq = 2 WHERE workspace_id = 'wsp_a' AND seq = 4`}, true, 0},
		{"tail removed (undetectable without an anchor)", []string{`DELETE FROM financial_events WHERE workspace_id = 'wsp_a' AND seq >= 3`}, true, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, exec := booksStore(t)
			ctx := context.Background()
			for range 4 {
				if err := s.LogEvent(ctx, event("wsp_a", "payment.added")); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.LogEvent(ctx, event("wsp_b", "payment.added")); err != nil {
				t.Fatal(err)
			}
			if err := exec(`ALTER TABLE financial_events DISABLE TRIGGER financial_events_append_only`); err != nil {
				t.Fatal(err)
			}
			for _, sql := range tt.tamper {
				if err := exec(sql); err != nil {
					t.Fatal(err)
				}
			}
			ok, brokenAt, err := s.VerifyChain(ctx, "wsp_a")
			if err != nil || ok != tt.wantOK || brokenAt != tt.wantBroken {
				t.Fatalf("VerifyChain = %v, %d, %v; want %v, %d", ok, brokenAt, err, tt.wantOK, tt.wantBroken)
			}
			if tt.name == "event moved to another workspace's chain" {
				// the hash covers the workspace, so the receiving chain breaks where the event landed
				if ok, brokenAt, _ := s.VerifyChain(ctx, "wsp_b"); ok || brokenAt != 2 {
					t.Fatalf("receiving chain VerifyChain = %v, %d; want false, 2", ok, brokenAt)
				}
			}
		})
	}
}

// Writers into a month race its close, each on its own connection: every writer that commits is in the books before
// the close (its event precedes period.closed in the chain and the closing transaction sees it), every later one is
// refused with ErrPeriodClosed.
func TestCloseRacesWritersIntoTheMonth(t *testing.T) {
	_, raw := storetest.New(t)
	ctx := context.Background()
	const writers = 5
	s, err := store.Open(ctx, strings.Replace(raw.Config().ConnString(), "pool_max_conns=2", fmt.Sprintf("pool_max_conns=%d", writers+1), 1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	for m := 1; m <= 12; m++ {
		month := fmt.Sprintf("2025-%02d", m)
		start := make(chan struct{})
		var wg sync.WaitGroup
		writes := make(chan error, writers)
		var seenAtClose int
		for range writers {
			wg.Go(func() {
				<-start
				writes <- s.Tx(ctx, func(q store.Q) error {
					if err := q.CheckOpen(ctx, "wsp_a", month+"-15"); err != nil {
						return err
					}
					e := event("wsp_a", "payment.added")
					e.SubjectID = month
					return q.LogEvent(ctx, e)
				})
			})
		}
		closeErr := make(chan error, 1)
		wg.Go(func() {
			<-start
			closeErr <- s.Tx(ctx, func(q store.Q) error {
				if _, err := q.ClosePeriod(ctx, "wsp_a", month, nil, t0); err != nil {
					return err
				}
				events, err := q.Events(ctx, "wsp_a", 0, 10000)
				if err != nil {
					return err
				}
				for _, e := range events {
					if e.Kind == "payment.added" && e.SubjectID == month {
						seenAtClose++
					}
				}
				e := event("wsp_a", "period.closed")
				e.SubjectType, e.SubjectID = "period", month
				return q.LogEvent(ctx, e)
			})
		})
		close(start)
		wg.Wait()
		close(writes)
		if err := <-closeErr; err != nil {
			t.Fatal(err)
		}
		committed := 0
		for err := range writes {
			switch {
			case err == nil:
				committed++
			case !errors.Is(err, store.ErrPeriodClosed):
				t.Fatalf("%s: writer: %v", month, err)
			}
		}
		if committed != seenAtClose {
			t.Fatalf("%s: %d writers committed, the close saw %d: a write landed in the closed month", month, committed, seenAtClose)
		}
		events, err := s.Events(ctx, "wsp_a", 0, 10000)
		if err != nil {
			t.Fatal(err)
		}
		closedAt := false
		for _, e := range events {
			if e.SubjectID != month {
				continue
			}
			if e.Kind == "period.closed" {
				closedAt = true
			} else if closedAt {
				t.Fatalf("%s: payment event seq %d after period.closed", month, e.Seq)
			}
		}
	}
	if ok, brokenAt, err := s.VerifyChain(ctx, "wsp_a"); err != nil || !ok {
		t.Fatalf("VerifyChain = %v, %d, %v", ok, brokenAt, err)
	}
}
