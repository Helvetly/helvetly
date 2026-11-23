package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestDocumentGroupsLookUpRecordsByIndex: grouping a workspace's files looks up each file's invoice through an index,
// never by scanning the invoices table once per file (audit A06: 4 000 files made 4 000 scans), and still
// classifies what each source says.
func TestDocumentGroupsLookUpRecordsByIndex(t *testing.T) {
	ctx := t.Context()
	provider, pool := migrationProvider(t)
	if _, err := provider.Up(ctx); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'Plan', now())`)
	exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('c', 'w', 1, 'Client', now(), now())`)
	const files = 4000
	exec(`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
		SELECT 'doc-'||i, 'w', 'File '||i||'.pdf', 2000, 'application/pdf', 'object-'||i, now(), now()
		FROM generate_series(1, $1::int) i`, files)
	exec(`INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date, currency, language,
			vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown,
			pdf_key, created_at, updated_at)
		SELECT 'inv-'||i, 'w', 'invoice', 'open', '2025-'||i, 'c', '2025-03-01', '2025-03-31', 'CHF', 'de', 'none',
			0, 0, 0, 0, 0, 0, 0, '[]'::jsonb, 'object-'||(i*2), now(), now()
		FROM generate_series(1, $1::int / 2) i`, files)
	exec(`ANALYZE`)

	from, args := groupedFrom("w", DocumentFilter{Zone: "Europe/Zurich"})
	query := strings.Replace(from, "%s", "SELECT g.type, count(*)", 1) + " GROUP BY 1 ORDER BY 1"
	var raw []byte
	start := time.Now()
	if err := pool.QueryRow(ctx, "EXPLAIN (ANALYZE, FORMAT JSON) "+query, args...).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	t.Logf("grouped %d files by type in %v", files, time.Since(start))
	var plan []struct{ Plan planNode }
	if err := json.Unmarshal(raw, &plan); err != nil || len(plan) != 1 {
		t.Fatalf("plan: %v", err)
	}
	var walk func(n planNode)
	walk = func(n planNode) {
		if n.Relation == "invoices" && n.Type == "Seq Scan" && n.Loops > 1 {
			t.Errorf("invoices scanned %d times", n.Loops)
		}
		for _, c := range n.Plans {
			walk(c)
		}
	}
	walk(plan[0].Plan)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for rows.Next() {
		var kind string
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			t.Fatal(err)
		}
		got[kind] = n
	}
	if rows.Err() != nil || got["invoices"] != files/2 || got["other"] != files/2 {
		t.Fatalf("groups = %v %v", got, rows.Err())
	}
}

type planNode struct {
	Type     string     `json:"Node Type"`
	Relation string     `json:"Relation Name"`
	Loops    int        `json:"Actual Loops"`
	Plans    []planNode `json:"Plans"`
}
