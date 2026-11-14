package imports

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// Partial, prepayment, debit note and corrected invoices share the invoice numbers with kind "invoice"; the unique
// constraint is per kind, so the import's number check must look across the whole series.
func TestImportedNumberConflictsAcrossTheInvoiceSeries(t *testing.T) {
	t.Parallel()
	st, raw := storetest.New(t)
	ctx, now := context.Background(), time.Now().UTC()
	ws := store.Workspace{ID: "wsp_a", Name: "Acme", Timezone: "Europe/Zurich"}
	if err := st.CreateWorkspace(ctx, ws, ws.Timezone, now); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateClient(ctx, "wsp_a", "cli_a", map[string]any{"name": "Kunde AG", "country": "CH"}, now); err != nil {
		t.Fatal(err)
	}
	sess := store.Session{Workspace: ws}
	for _, tc := range []struct{ kind, number string }{
		{"partial", "RE-1"}, {"prepayment", "RE-2"}, {"debit_note", "RE-3"}, {"corrected", "RE-4"}, {"proforma", "RE-5"},
	} {
		id, err := invoicesKind.Create(ctx, st.Q, sess, invoiceData(t, `{"client_name": "Kunde AG", "number": null}`), Source{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := raw.Exec(ctx, `UPDATE invoices SET kind=$2, status='open', number=$3 WHERE id=$1`, id, tc.kind, tc.number); err != nil {
			t.Fatalf("%s: %v", tc.kind, err)
		}
		use, err := st.InvoiceNumberUse(ctx, "wsp_a", "invoice", tc.number)
		if err != nil {
			t.Fatal(err)
		}
		if shared := tc.kind != "proforma"; (use != nil) != shared {
			t.Errorf("%s %s: in use = %v, want %v", tc.kind, tc.number, use != nil, shared)
		}
	}
}
