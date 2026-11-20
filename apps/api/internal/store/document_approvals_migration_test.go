package store

import (
	"context"
	"testing"
)

// TestDocumentApprovalsMigration: 00039 adds the approval tables, gives every published offer document_approvals
// (Business only), publishes helvetly-v1.4 with its record last, and Down takes it all back.
func TestDocumentApprovalsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 39); err != nil {
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
	if n := count(`SELECT count(*) FROM limit_plans WHERE limit_key = 'document_approvals'
		AND state = CASE plan_id WHEN 'business' THEN 'enabled' ELSE 'disabled' END`); n != 5*3 {
		t.Fatalf("%d document_approvals values, want 3 plans in 5 offers", n)
	}
	if n := count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.4' AND document->>'offer_id' = id
		AND document->'records'->-1->>'key' = 'document_approvals' AND jsonb_array_length(document->'records') = 70`); n != 1 {
		t.Fatal("helvetly-v1.4 is not published with the record last")
	}
	if n := count(`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'approval_%'`); n != 5 {
		t.Fatalf("%d approval tables", n)
	}
	if _, err := p.DownTo(ctx, 38); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM limits WHERE key = 'document_approvals'`) + count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.4'`) +
		count(`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'approval_%'`); n != 0 {
		t.Fatal("left after Down")
	}
	if _, err := p.UpTo(ctx, 39); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}
