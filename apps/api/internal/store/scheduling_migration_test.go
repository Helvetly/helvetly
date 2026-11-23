package store

import (
	"context"
	"testing"
)

// TestSchedulingMigrations: 00051 gives every published offer scheduling (Pro and Business) and
// scheduled_events_per_month (Basic 0, Pro 100, Business unlimited), publishes helvetly-v1.5 with both records last,
// and 00052 adds the calendar tables; Down takes all of it back and Up works again.
func TestSchedulingMigrations(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 52); err != nil {
		t.Fatal(err)
	}
	count := func(sql string) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	offers := count(`SELECT count(*) FROM offer_versions`)
	if n := count(`SELECT count(*) FROM limit_plans WHERE limit_key = 'scheduling'
		AND state = CASE plan_id WHEN 'basic' THEN 'disabled' ELSE 'enabled' END`); n != 3*offers {
		t.Fatalf("%d scheduling values, want 3 plans in %d offers", n, offers)
	}
	if n := count(`SELECT count(*) FROM limit_plans WHERE limit_key = 'scheduled_events_per_month' AND CASE plan_id
		WHEN 'basic' THEN state = 'limited' AND value = 0 WHEN 'pro' THEN state = 'limited' AND value = 100
		ELSE state = 'unlimited' AND value IS NULL END`); n != 3*offers {
		t.Fatalf("%d scheduled_events_per_month values, want 3 plans in %d offers", n, offers)
	}
	if n := count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.5' AND document->>'offer_id' = id
		AND document->'records'->-2->>'key' = 'scheduling' AND document->'records'->-1->>'key' = 'scheduled_events_per_month'
		AND (document->'records'->-1->'values'->'pro'->>'value')::int = 100 AND jsonb_array_length(document->'records') = 72`); n != 1 {
		t.Fatal("helvetly-v1.5 is not published with both records last")
	}
	if n := count(`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'calendar\_%'`); n != 7 {
		t.Fatalf("%d calendar tables", n)
	}
	if _, err := p.DownTo(ctx, 50); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM limits WHERE key IN ('scheduling', 'scheduled_events_per_month')`) +
		count(`SELECT count(*) FROM limit_plans WHERE limit_key IN ('scheduling', 'scheduled_events_per_month')`) +
		count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.5'`) +
		count(`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'scheduling\_%' OR table_name LIKE 'calendar\_%'`) +
		count(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'time_zone'`); n != 0 {
		t.Fatalf("%d left after Down", n)
	}
	if _, err := p.UpTo(ctx, 52); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}
