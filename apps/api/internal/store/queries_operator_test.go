package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// operatorFixture: users of every age, three live workspaces with subscriptions and one deleted, usage in w1 and w2.
func operatorFixture(t *testing.T) (*store.Store, time.Time) {
	t.Helper()
	db, raw := storetest.New(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ago := func(d time.Duration) time.Time { return now.Add(-d) }
	const h = time.Hour
	users := []struct {
		id      string
		created time.Time
	}{{"u1", now}, {"u2", ago(3 * 24 * h)}, {"u3", ago(20 * 24 * h)}, {"u4", ago(60 * 24 * h)}, {"u5", now}}
	for _, u := range users {
		if err := db.CreateUser(ctx, store.User{ID: u.id, Email: u.id + "@example.com", Name: u.id}, u.created); err != nil {
			t.Fatal(err)
		}
	}
	workspaces := []struct {
		id      string
		created time.Time
	}{{"w1", ago(2 * 24 * h)}, {"w2", ago(20 * 24 * h)}, {"w3", ago(60 * 24 * h)}, {"w4", ago(5 * 24 * h)}, {"w5", ago(90 * 24 * h)}}
	for _, w := range workspaces {
		if err := db.CreateWorkspace(ctx, store.Workspace{ID: w.id, Name: "Name " + w.id}, "UTC", w.created); err != nil {
			t.Fatal(err)
		}
	}
	for _, m := range [][3]string{{"w1", "u1", "owner"}, {"w2", "u2", "owner"}, {"w1", "u3", "member"}, {"w3", "u3", "owner"}, {"w5", "u4", "owner"}} {
		if err := db.AddMember(ctx, m[0], m[1], m[2], now); err != nil {
			t.Fatal(err)
		}
	}
	exec(t, raw, `UPDATE users SET deleted_at = now() WHERE id = 'u5'`)
	exec(t, raw, `UPDATE workspaces SET deleted_at = now() WHERE id = 'w4'`)
	exec(t, raw, `INSERT INTO sessions (id, token_hash, csrf_token, user_id, workspace_id, created_at, expires_at, last_active_at) VALUES
		('s1', 'h1', 'c', 'u1', 'w1', now(), now() + interval '1 day', now() - interval '1 day'),
		('s2', 'h2', 'c', 'u3', 'w1', now(), now() + interval '1 day', now() - interval '10 days'),
		('s3', 'h3', 'c', 'u3', 'w3', now(), now() + interval '1 day', now() - interval '12 days')`)
	exec(t, raw, `INSERT INTO portal_slugs (slug, workspace_id, created_at) VALUES ('acme', 'w1', now())`)
	exec(t, raw, `INSERT INTO workspace_billing (workspace_id, stripe_subscription_id, status, plan, billing_interval, per_seat,
			seats, paid_seats, plan_expires_at, trial_end, cancel_at_period_end, updated_at) VALUES
		('w1', 'sub1', 'active', 'pro', 'month', true, 3, 3, now() + interval '20 days', NULL, true, now()),
		('w2', 'sub2', 'trialing', 'basic', 'year', true, 1, 1, now() + interval '6 days', now() + interval '3 days', false, now()),
		('w3', 'sub3', 'past_due', 'business', 'year', true, 5, 5, now() + interval '2 days', NULL, false, now()),
		('w5', 'sub5', 'canceled', 'pro', 'month', true, 2, 2, now() - interval '5 days', NULL, false, now() - interval '5 days')`)
	exec(t, raw, `INSERT INTO stored_objects (object_key, workspace_id, size, created_at) VALUES
		('a', 'w1', 1000, now()), ('b', 'w1', 500, now()), ('c', 'w2', 200, now())`)
	period := store.UsagePeriod(now)
	exec(t, raw, `INSERT INTO heidi_usage (workspace_id, period, pool, tokens_used, cost_micros, updated_at) VALUES
		('w1', $1, 'heidi', 100, 20000, now()), ('w1', $1, 'automation', 50, 10000, now()),
		('w2', $1, 'automation', 300, 30000, now()), ('w2', '2000-01', 'heidi', 9999, 0, now())`, period)
	exec(t, raw, `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at) VALUES
		('w1', $2, 'e1', '', $1, 0, 4, now()), ('w2', $2, 'e2', '', $1, 3, 0, now()), ('w2', $2, 'e3', '', '2000-01', 0, 50, now())`,
		period, store.EmailRecipients)
	exec(t, raw, `INSERT INTO clients (id, workspace_id, number, name, is_company, country, created_at, updated_at) VALUES
		('c1', 'w1', 1, 'A', true, 'CH', now(), now()), ('c2', 'w1', 2, 'B', true, 'CH', now(), now())`)
	exec(t, raw, `UPDATE clients SET deleted_at = now() WHERE id = 'c2'`)
	exec(t, raw, `INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at) VALUES
		('d1', 'w1', 'a.pdf', 1, 'application/pdf', 'a', now(), now()), ('d2', 'w1', 'b.pdf', 1, 'application/pdf', 'b', now(), now())`)
	exec(t, raw, `UPDATE documents SET deleted_at = now() WHERE id = 'd2'`)
	return db, now
}

func exec(t *testing.T, raw *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := raw.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func TestOperatorAggregates(t *testing.T) {
	db, now := operatorFixture(t)
	ctx := context.Background()
	users, err := db.OperatorUsers(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := db.OperatorWorkspaces(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	usage, err := db.OperatorUsage(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name      string
		got, want int64
	}{
		{"users total, deleted aside", users.Total, 4},
		{"sign-ups today", users.Today, 2},
		{"sign-ups 7 days", users.Week, 3},
		{"sign-ups 30 days", users.Month, 4},
		{"active 7 days", users.Active7, 1},
		{"active 30 days", users.Active30, 2},
		{"workspaces total", workspaces.Total, 4},
		{"workspaces 7 days", workspaces.Week, 1},
		{"workspaces 30 days", workspaces.Month, 2},
		{"workspaces deleted", workspaces.Deleted, 1},
		{"storage", usage.StorageBytes, 1700},
		{"emails this month", usage.Emails, 7},
		{"pools", int64(len(usage.Pools)), 2},
		{"heidi tokens", usage.Pools[0].Tokens, 100},
		{"automation tokens", usage.Pools[1].Tokens, 350},
		{"automation cost", usage.Pools[1].CostMicros, 40000},
		{"top storage first", usage.TopStorage[0].Amount, 1500},
		{"top AI first", usage.TopAI[0].Amount, 300},
	} {
		if tc.got != tc.want {
			t.Errorf("%s = %d, want %d", tc.name, tc.got, tc.want)
		}
	}
	if usage.Pools[0].Pool != "heidi" || usage.TopStorage[0].Workspace != "Name w1" || usage.TopAI[0].Workspace != "Name w2" {
		t.Errorf("usage = %+v", usage)
	}
}

func TestOperatorSubscriptionsAndSignups(t *testing.T) {
	db, now := operatorFixture(t)
	ctx := context.Background()
	subs, cancelled, err := db.OperatorSubscriptions(ctx, now.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 4 || cancelled != 1 {
		t.Fatalf("subscriptions = %d, cancelled = %d", len(subs), cancelled)
	}
	for _, s := range subs {
		if s.Currency != "chf" || s.PaidSeats == nil {
			t.Errorf("subscription %+v", s)
		}
	}
	signups, err := db.OperatorSignups(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ email, workspace, plan string }{{"u1@example.com", "Name w1", "pro"}, {"u2@example.com", "Name w2", "basic"}, {"u3@example.com", "Name w3", "business"}}
	if len(signups) != len(want) {
		t.Fatalf("signups = %+v", signups)
	}
	for i, w := range want {
		if s := signups[i]; s.Email != w.email || s.Workspace != w.workspace || s.Billing.Plan != w.plan {
			t.Errorf("signup %d = %+v, want %+v", i, s, w)
		}
	}
}

func TestOperatorFindWorkspace(t *testing.T) {
	db, now := operatorFixture(t)
	ctx := context.Background()
	for _, tc := range []struct {
		key, want string
		others    int64
	}{
		{"w1", "w1", 0},
		{"ACME", "w1", 0},
		{"u1@example.com", "w1", 0},
		{"U3@Example.com", "w3", 1}, // owned first, one more membership
		{"nobody@example.com", "", 0},
	} {
		w, err := db.OperatorFindWorkspace(ctx, tc.key, now)
		if tc.want == "" {
			if !errors.Is(err, store.ErrNotFound) {
				t.Errorf("%s: err = %v", tc.key, err)
			}
			continue
		}
		if err != nil || w.ID != tc.want || w.OtherWorkspacesOfEmail != tc.others {
			t.Errorf("%s: %+v, %v", tc.key, w, err)
		}
	}
	w, err := db.OperatorFindWorkspace(ctx, "w1", now)
	if err != nil {
		t.Fatal(err)
	}
	if w.Slug != "acme" || w.Members != 2 || w.Clients != 1 || w.Documents != 1 || w.StorageBytes != 1500 ||
		w.HeidiTokens != 100 || w.AutomationTokens != 50 || w.OwnerEmail != "u1@example.com" || w.LastActive == nil ||
		w.Billing.Plan != "pro" || !w.Billing.CancelAtPeriodEnd {
		t.Errorf("summary = %+v", w)
	}
}

func TestOperatorHealth(t *testing.T) {
	db, now := operatorFixture(t)
	h, err := db.OperatorHealth(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if h.Connections < 1 || h.MaxConnections < h.Connections || h.PoolMax < 1 {
		t.Errorf("health = %+v", h)
	}
}

func TestAdminBotLeaseHasOneHolder(t *testing.T) {
	db, _ := storetest.New(t)
	ctx := context.Background()
	if _, ok, err := db.ClaimAdminBot(ctx, "blue", time.Minute); err != nil || !ok {
		t.Fatalf("blue: %v %v", ok, err)
	}
	if _, ok, err := db.ClaimAdminBot(ctx, "green", time.Minute); err != nil || ok {
		t.Fatalf("green took a held lease: %v %v", ok, err)
	}
	if err := db.SaveAdminBotOffset(ctx, "blue", 42); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveAdminBotOffset(ctx, "green", 7); err != nil { // not the holder: ignored
		t.Fatal(err)
	}
	if offset, ok, err := db.ClaimAdminBot(ctx, "blue", time.Minute); err != nil || !ok || offset != 42 {
		t.Fatalf("blue renews: %d %v %v", offset, ok, err)
	}
	if err := db.ReleaseAdminBot(ctx, "blue"); err != nil {
		t.Fatal(err)
	}
	if offset, ok, err := db.ClaimAdminBot(ctx, "green", time.Minute); err != nil || !ok || offset != 42 {
		t.Fatalf("green after release: %d %v %v", offset, ok, err)
	}
}

func TestOperatorAIDailyCap(t *testing.T) {
	db, _ := storetest.New(t)
	ctx := context.Background()
	now := time.Now()
	for _, tc := range []struct {
		tokens int64
		ok     bool
	}{{600, true}, {300, true}, {200, false}, {2000, false}, {100, true}} {
		if ok, err := db.ReserveOperatorAI(ctx, now, tc.tokens, 1000); err != nil || ok != tc.ok {
			t.Errorf("reserve %d: %v %v", tc.tokens, ok, err)
		}
	}
	if err := db.SettleOperatorAI(ctx, now, 600, 100, 5); err != nil {
		t.Fatal(err)
	}
	if ok, _ := db.ReserveOperatorAI(ctx, now, 500, 1000); !ok {
		t.Error("settled tokens were not given back")
	}
}
