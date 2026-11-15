package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestUsagePeriodIsTheUTCCalendarMonth(t *testing.T) {
	zone := func(name string) *time.Location {
		l, err := time.LoadLocation(name)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	for _, tc := range []struct {
		name string
		at   time.Time
		want string
	}{
		{"already November in Zurich", time.Date(2026, 11, 1, 0, 30, 0, 0, zone("Europe/Zurich")), "2026-10"},
		{"last instant of November", time.Date(2026, 11, 30, 23, 59, 59, 999_999_999, time.UTC), "2026-11"},
		{"first instant of December", time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC), "2026-12"},
		{"New Year's Eve in New York is January in UTC", time.Date(2026, 12, 31, 20, 0, 0, 0, zone("America/New_York")), "2027-01"},
		{"the spring DST change in Zurich", time.Date(2026, 3, 29, 2, 30, 0, 0, zone("Europe/Zurich")), "2026-03"},
		{"April in Auckland during its DST", time.Date(2026, 4, 1, 1, 0, 0, 0, zone("Pacific/Auckland")), "2026-03"},
	} {
		if got := store.UsagePeriod(tc.at); got != tc.want {
			t.Errorf("%s: UsagePeriod(%s) = %s, want %s", tc.name, tc.at.UTC().Format(time.RFC3339), got, tc.want)
		}
		if start := store.UsagePeriodStart(tc.at); store.UsagePeriod(start) != tc.want || start.Day() != 1 || start.Hour() != 0 {
			t.Errorf("%s: UsagePeriodStart = %s", tc.name, start)
		}
	}
}

// capOf admits a monthly resource up to max in the month being admitted, as billing's AllowResource does.
func capOf(max int64, now func() time.Time) store.Admission {
	return func(ctx context.Context, q store.Q, workspaceID, resource string, add int64) error {
		u, err := q.UsageInPeriods(ctx, workspaceID, resource, q.AdmissionPeriod(now()), q.AdmissionPeriod(now()))
		if err != nil {
			return err
		}
		if u.Total()+add > max {
			return store.ErrAdmissionDenied
		}
		return nil
	}
}

func usageOf(t *testing.T, s *store.Store, period string) store.PeriodUsage {
	t.Helper()
	u, err := s.UsageInPeriods(context.Background(), "wsp_a", "things_per_month", period, period)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestUsageRetriesReservationsAndSettlement(t *testing.T) {
	s, _ := seedWorkspace(t, nil)
	s.SetAdmission(capOf(3, func() time.Time { return t0 }))
	ctx, month := context.Background(), store.UsagePeriod(t0)
	op := func(id, params string, n int64) store.UsageOp {
		return store.UsageOp{Resource: "things_per_month", ID: id, Params: params, Amount: n}
	}

	if replay, err := s.ConsumeUsage(ctx, "wsp_a", op("a", "one", 1), t0); err != nil || replay {
		t.Fatalf("first consume: replay=%v err=%v", replay, err)
	}
	if replay, err := s.ConsumeUsage(ctx, "wsp_a", op("a", "one", 1), t0); err != nil || !replay {
		t.Fatalf("retry: replay=%v err=%v", replay, err)
	}
	if _, err := s.ConsumeUsage(ctx, "wsp_a", op("a", "two", 1), t0); !errors.Is(err, store.ErrUsageConflict) {
		t.Fatalf("same id, other parameters: %v", err)
	}
	if u := usageOf(t, s, month); u != (store.PeriodUsage{Consumed: 1}) {
		t.Fatalf("after retries: %+v", u)
	}

	// A pending external effect holds its upper bound until settled; an unknown outcome is simply never settled.
	if _, err := s.ReserveUsage(ctx, "wsp_a", op("b", "", 2), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConsumeUsage(ctx, "wsp_a", op("c", "", 1), t0); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("reservation must count against the cap: %v", err)
	}
	if replay, err := s.ReserveUsage(ctx, "wsp_a", op("b", "", 2), t0); err != nil || !replay {
		t.Fatalf("a retried reservation reserves nothing more: replay=%v err=%v", replay, err)
	}
	if err := s.SettleUsage(ctx, "wsp_a", "things_per_month", "b", 1, t0); err != nil {
		t.Fatal(err)
	}
	if u := usageOf(t, s, month); u != (store.PeriodUsage{Consumed: 2}) {
		t.Fatalf("settled used 1 of 2, the rest released: %+v", u)
	}
	if err := s.SettleUsage(ctx, "wsp_a", "things_per_month", "b", 2, t0); err != nil {
		t.Fatal(err)
	}
	if u := usageOf(t, s, month); u.Consumed != 2 {
		t.Fatalf("a second settlement changed the first outcome: %+v", u)
	}
	if err := s.SettleUsage(ctx, "wsp_a", "things_per_month", "never", 1, t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("settling an unknown operation: %v", err)
	}

	// Releasing a reservation whose effect did not happen frees its room.
	if _, err := s.ReserveUsage(ctx, "wsp_a", op("d", "", 1), t0); err != nil {
		t.Fatal(err)
	}
	if err := s.SettleUsage(ctx, "wsp_a", "things_per_month", "d", 0, t0); err != nil {
		t.Fatal(err)
	}

	// A rolled-back write consumes nothing, and its operation can run again.
	rollback := errors.New("rollback")
	if err := s.Tx(ctx, func(q store.Q) error {
		if _, err := q.ConsumeUsage(ctx, "wsp_a", op("e", "", 1), t0); err != nil {
			return err
		}
		return rollback
	}); !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if replay, err := s.ConsumeUsage(ctx, "wsp_a", op("e", "", 1), t0); err != nil || replay {
		t.Fatalf("after rollback: replay=%v err=%v", replay, err)
	}
	if u := usageOf(t, s, month); u != (store.PeriodUsage{Consumed: 3}) {
		t.Fatalf("final: %+v", u)
	}
	if _, err := s.ConsumeUsage(ctx, "wsp_a", op("f", "", 1), t0); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("cap+1: %v", err)
	}
}

func TestUsageStaysInTheMonthItWasAdmittedIn(t *testing.T) {
	s, _ := seedWorkspace(t, nil)
	ctx := context.Background()
	october := time.Date(2026, 10, 31, 23, 59, 59, 0, time.UTC)
	november := october.Add(2 * time.Second)
	clock := october
	s.SetAdmission(capOf(1, func() time.Time { return clock }))
	op := store.UsageOp{Resource: "things_per_month", ID: "call", Amount: 1}
	if _, err := s.ReserveUsage(ctx, "wsp_a", op, october); err != nil {
		t.Fatal(err)
	}
	clock = november
	// Settled after midnight, it still counts in October; a retry in November is the same operation.
	if err := s.SettleUsage(ctx, "wsp_a", op.Resource, op.ID, 1, november); err != nil {
		t.Fatal(err)
	}
	if replay, err := s.ConsumeUsage(ctx, "wsp_a", op, november); err != nil || !replay {
		t.Fatalf("retry across the month: replay=%v err=%v", replay, err)
	}
	if oct, nov := usageOf(t, s, "2026-10"), usageOf(t, s, "2026-11"); oct.Consumed != 1 || nov.Total() != 0 {
		t.Fatalf("october=%+v november=%+v", oct, nov)
	}
	if _, err := s.ConsumeUsage(ctx, "wsp_a", store.UsageOp{Resource: op.Resource, ID: "next", Amount: 1}, november); err != nil {
		t.Fatalf("November's allowance is its own: %v", err)
	}
	if _, err := s.ConsumeUsage(ctx, "wsp_a", store.UsageOp{Resource: op.Resource, ID: "late", Amount: 1}, october); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("an operation admitted in October counts against October: %v", err)
	}
}
