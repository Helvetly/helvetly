package store

import (
	"context"
	"errors"
	"testing"
)

// SaveDraft must never touch an issued document or another workspace's draft: its header upsert is guarded, and
// the lines must follow that guard instead of being deleted and reinserted regardless.
func TestSaveDraftRefusesIssuedOrForeignInvoice(t *testing.T) {
	ctx := context.Background()
	q, pool := typesDB(t, 0)
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_b', 'B', 'UTC', now())`); err != nil {
		t.Fatal(err)
	}
	seedInvoice(t, pool, "inv_issued", "invoice", "open", 10000, "2026-10-31", 0)
	seedInvoice(t, pool, "inv_draft", "invoice", "draft", 10000, "2026-10-31", 0)
	for _, id := range []string{"inv_issued", "inv_draft"} {
		if _, err := pool.Exec(ctx, `INSERT INTO invoice_lines (id, invoice_id, position, description, quantity, unit_price, vat_category,
			vat_rate, amount, discount_percent) VALUES ($1, $2, 1, 'Original', 1, 100, 'S', 8.1, 100, 0)`, "lin_"+id, id); err != nil {
			t.Fatal(err)
		}
	}
	tests := []struct{ name, workspace, id string }{
		{"issued invoice", "wsp_a", "inv_issued"},
		{"draft of another workspace", "wsp_b", "inv_draft"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inv := Invoice{ID: tt.id, Kind: "invoice", ClientID: "cli_1", IssueDate: "2026-10-01", DueDate: "2026-10-31",
				Currency: "CHF", Language: "de", VATMode: "exclusive", Total: 1,
				Lines: []InvoiceLine{{ID: "lin_new_" + tt.id, Position: 1, Description: "Tampered", Quantity: 1000, UnitPrice: 1,
					VATCategory: "S", VATRate: 810, Amount: 1}}}
			if err := q.SaveDraft(ctx, tt.workspace, inv, typesNow); !errors.Is(err, ErrNotDraft) {
				t.Fatalf("save: %v, want ErrNotDraft", err)
			}
			var desc string
			if err := pool.QueryRow(ctx, `SELECT string_agg(description, ',') FROM invoice_lines WHERE invoice_id = $1`, tt.id).Scan(&desc); err != nil {
				t.Fatal(err)
			}
			if desc != "Original" {
				t.Fatalf("lines changed to %q", desc)
			}
		})
	}
}
