package store

import (
	"context"
	"testing"
)

// TestStoredObjectsBackfill: every object a record points at is counted once for its workspace, a ZIP's entries and
// a document they share a key with as one object, with the size the record holds and unverified, for the reconciler.
func TestStoredObjectsBackfill(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 9); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('usr_1', 'a@x.ch', 'A', now(), now())`,
		`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'A', now())`,
		`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('cli_1', 'ws_1', 1, 'K', now(), now())`,
		`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
			VALUES ('doc_1', 'ws_1', 'a.zip', 300, 'application/zip', 'ws_1/documents/doc_1', now(), now())`,
		`INSERT INTO import_batches (id, workspace_id, user_id, kind, created_at) VALUES ('imp_1', 'ws_1', 'usr_1', 'invoices', now())`,
		`INSERT INTO import_files (id, batch_id, workspace_id, position, name, size, content_type, object_key, entry_index, created_at, updated_at)
			VALUES ('if_1', 'imp_1', 'ws_1', 0, 'a.pdf', 100, 'application/pdf', 'ws_1/documents/doc_1', 0, now(), now()),
			       ('if_2', 'imp_1', 'ws_1', 1, 'b.pdf', 200, 'application/pdf', 'ws_1/documents/doc_1', 1, now(), now())`,
		`INSERT INTO invoices (id, workspace_id, kind, status, client_id, issue_date, due_date, currency, language, vat_mode,
				discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, pdf_key, created_at, updated_at)
			VALUES ('inv_1', 'ws_1', 'invoice', 'draft', 'cli_1', current_date, current_date, 'CHF', 'de', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]',
				'workspaces/ws_1/invoices/inv_1/R-1.pdf', now(), now())`,
		`INSERT INTO invoice_xml_exports (invoice_id, format, serializer_version, object_key, sha256, size, filename, created_at)
			VALUES ('inv_1', 'xrechnung-cii', '1', 'workspaces/ws_1/invoices/inv_1/xml/x.xml', repeat('a', 64), 40, 'R-1.xml', now())`,
		`INSERT INTO invoice_settings (workspace_id, settings, updated_at) VALUES ('ws_1', '{"logo_file_id": "lgo_1"}', now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	if _, err := p.UpTo(ctx, 10); err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{"ws_1/documents/doc_1": 300, "workspaces/ws_1/invoices/inv_1/R-1.pdf": 0,
		"workspaces/ws_1/invoices/inv_1/xml/x.xml": 40, "workspaces/ws_1/invoice-settings/lgo_1": 0}
	rows, err := pool.Query(ctx, `SELECT object_key, size FROM stored_objects WHERE workspace_id = 'ws_1' AND verified_at IS NULL`)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int64{}
	for rows.Next() {
		var key string
		var size int64
		if err := rows.Scan(&key, &size); err != nil {
			t.Fatal(err)
		}
		got[key] = size
	}
	if len(got) != len(want) {
		t.Fatalf("backfilled %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("backfilled %v, want %v", got, want)
		}
	}
}
