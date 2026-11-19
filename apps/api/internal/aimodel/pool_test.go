package aimodel

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func poolUsage(t *testing.T, db *store.Store, ws store.Workspace, pool string) store.HeidiUsage {
	t.Helper()
	u, err := db.HeidiUsage(context.Background(), ws.ID, pool, "2026-11")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func poolBudget(db *store.Store, pool string) (Budget, Call) {
	b := Budget{DB: db, Pool: pool, Now: func() time.Time { return nov }, Allowance: fixed(10_000), CostAllowance: fixed(1_000_000)}
	if pool == PoolHeidi {
		return b, Call{Kind: "heidi", Operation: "turn", Step: "answer", MaxOutput: 100, Caps: HeidiCaps}
	}
	return b, Call{Kind: "filing", Operation: "doc", Step: "0", MaxOutput: 100, Caps: FilingCaps}
}

// TestPoolsAreSeparate: Heidi's calls never spend the automation pool (AI import, filing) and the other way round; a
// pool used up stops its own calls only.
func TestPoolsAreSeparate(t *testing.T) {
	for _, tc := range []struct {
		name string
		pool string // the pool used up before the calls ("" none)
		want map[string]error
	}{
		{"both open", "", map[string]error{PoolHeidi: nil, PoolAutomation: nil}},
		{"Heidi's allowance used", PoolHeidi, map[string]error{PoolHeidi: ErrQuota, PoolAutomation: nil}},
		{"the automation allowance used", PoolAutomation, map[string]error{PoolHeidi: nil, PoolAutomation: ErrQuota}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, _, ws := reserveDB(t)
			ctx := context.Background()
			if tc.pool != "" {
				preset := store.HeidiUsage{TokensUsed: 10_000}
				if err := db.Tx(ctx, func(q store.Q) error {
					if _, err := q.LockHeidiUsage(ctx, ws.ID, tc.pool, "2026-11", nov); err != nil {
						return err
					}
					return q.SaveHeidiUsage(ctx, ws.ID, tc.pool, "2026-11", preset, nov)
				}); err != nil {
					t.Fatal(err)
				}
			}
			for _, pool := range []string{PoolHeidi, PoolAutomation} {
				other := PoolAutomation
				if pool == PoolAutomation {
					other = PoolHeidi
				}
				mine, theirs := poolUsage(t, db, ws, pool), poolUsage(t, db, ws, other)
				b, call := poolBudget(db, pool)
				_, err := b.Generate(ctx, &scripted{input: 100, reply: used(100, 0, 20, 0)}, ws, Request{Message: "hi"}, call)
				if want := tc.want[pool]; (want == nil && err != nil) || (want != nil && !errors.Is(err, want)) {
					t.Fatalf("%s: err = %v, want %v", pool, err, want)
				}
				if got := poolUsage(t, db, ws, other); got != theirs {
					t.Fatalf("a %s call changed the %s pool: %+v -> %+v", pool, other, theirs, got)
				}
				if got := poolUsage(t, db, ws, pool); (err == nil) != (got.TokensUsed == mine.TokensUsed+120) {
					t.Fatalf("%s: usage %+v after %v, want 120 tokens counted only when it answered", pool, got, err)
				}
			}
		})
	}
}

// TestOneCallInFlightPerPool: while a Heidi call is in flight an automation call goes ahead, a second Heidi call waits.
func TestOneCallInFlightPerPool(t *testing.T) {
	db, _, ws := reserveDB(t)
	ctx := context.Background()
	heidi, heidiCall := poolBudget(db, PoolHeidi)
	auto, autoCall := poolBudget(db, PoolAutomation)
	var autoErr, heidiErr error
	p := &scripted{input: 100, reply: used(100, 0, 20, 0)}
	p.during = func() {
		p.during = nil
		_, autoErr = auto.Generate(ctx, &scripted{input: 100, reply: used(100, 0, 20, 0)}, ws, Request{Message: "file"}, autoCall)
		second := heidiCall
		second.Operation = "turn-2"
		_, heidiErr = heidi.Generate(ctx, &scripted{input: 100, reply: used(100, 0, 20, 0)}, ws, Request{Message: "again"}, second)
	}
	if _, err := heidi.Generate(ctx, p, ws, Request{Message: "hi"}, heidiCall); err != nil {
		t.Fatal(err)
	}
	if autoErr != nil || !errors.Is(heidiErr, ErrUncertain) {
		t.Fatalf("automation during a Heidi call: %v (want nil); a second Heidi call: %v (want ErrUncertain)", autoErr, heidiErr)
	}
	if h, a := poolUsage(t, db, ws, PoolHeidi), poolUsage(t, db, ws, PoolAutomation); h.TokensUsed != 120 || a.TokensUsed != 120 ||
		h.TokensReserved != 0 || a.TokensReserved != 0 {
		t.Fatalf("heidi %+v, automation %+v: want 120 tokens each, nothing left reserved", h, a)
	}
}
