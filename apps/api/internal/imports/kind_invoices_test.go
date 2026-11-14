package imports

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func invoiceStore(t *testing.T) (*store.Store, store.Session, string) {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	ctx, now := context.Background(), time.Now().UTC()
	ws := store.Workspace{ID: "wsp_a", Name: "Acme", Timezone: "Europe/Zurich"}
	for _, w := range []store.Workspace{ws, {ID: "wsp_b", Name: "Beta"}} {
		if err := st.CreateWorkspace(ctx, w, "Europe/Zurich", now); err != nil {
			t.Fatal(err)
		}
	}
	client := map[string]any{"name": "Kunde AG", "email": "ap@kunde.ch", "vat_number": "CHE-116.281.710 MWST", "country": "CH"}
	if err := st.CreateClient(ctx, "wsp_a", "cli_a", client, now); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateClient(ctx, "wsp_b", "cli_b", map[string]any{"name": "Fremd AG"}, now); err != nil {
		t.Fatal(err)
	}
	return st, store.Session{Workspace: ws}, "cli_a"
}

// invoiceData: a record as the engine hands it over, from JSON; extra replaces (null removes) fields.
func invoiceData(t *testing.T, extra string) Data {
	t.Helper()
	d := Data{}
	base := `{"client_name": "kunde ag", "number": "RE-2025-017", "issue_date": "2025-10-01", "due_date": "2025-10-31",
		"currency": "CHF", "price_basis": "net", "total": "1081.00",
		"lines": [{"description": "Beratung", "quantity": "8", "unit": "hour", "unit_price": "125.00", "vat_category": "S",
			"vat_rate": "8.1", "invented": "x"}]}`
	for _, src := range []string{base, extra} {
		var m map[string]json.RawMessage
		if err := json.Unmarshal([]byte(src), &m); err != nil {
			t.Fatal(err)
		}
		for k, v := range m {
			if string(v) == "null" {
				delete(d, k)
			} else {
				d[k] = v
			}
		}
	}
	return d
}

func TestInvoicesKindCheck(t *testing.T) {
	st, _, _ := invoiceStore(t)
	ctx := context.Background()
	tests := []struct {
		name  string
		extra string
		want  []string // fields with an issue
	}{
		{"clean, client matched by name", `{}`, nil},
		{"matched by VAT number", `{"client_name": "Kunde", "client_vat_number": "CHE-116.281.710 MWST"}`, nil},
		{"matched by email", `{"client_name": null, "client_email": "AP@kunde.ch"}`, nil},
		{"picked client", `{"client_name": "Someone else", "client_id": "cli_a"}`, nil},
		{"no client matches", `{"client_name": "Unbekannt GmbH"}`, []string{"client_id"}},
		{"another workspace's client", `{"client_id": "cli_b"}`, []string{"client_id"}},
		{"stated total wrong", `{"total": "999.00"}`, []string{"total"}},
		{"stated total not a number", `{"total": "about 1000"}`, []string{"total"}},
		{"no total stated", `{"total": null}`, nil},
		{"gross prices", `{"price_basis": "gross", "total": "1000.00"}`, nil},
		{"unknown price basis", `{"price_basis": "both"}`, []string{"price_basis"}},
		{"unknown currency", `{"currency": "XYZ"}`, []string{"currency"}},
		{"three-decimal currency", `{"currency": "KWD"}`, []string{"currency"}},
		{"bad date", `{"issue_date": "01.10.2025"}`, []string{"issue_date"}},
		{"no lines", `{"lines": []}`, []string{"lines"}},
		{"lines not a list", `{"lines": "8 hours"}`, []string{"lines"}},
		{"negative quantity", `{"lines": [{"description": "x", "quantity": "-2", "unit_price": "10"}]}`, []string{"lines.0.quantity"}},
		{"negative price", `{"lines": [{"description": "x", "quantity": "1", "unit_price": "-10"}]}`, []string{"lines.0.unit_price"}},
		{"absurd quantity", `{"lines": [{"description": "x", "quantity": "1e9", "unit_price": "10"}]}`, []string{"lines.0.quantity"}},
		{"absurd rate", `{"lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_rate": "250"}]}`, []string{"lines.0.vat_rate"}},
		{"non-Swiss rate", `{"lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_rate": "19"}]}`, []string{"lines.0.vat_rate"}},
		{"amount as rate", `{"lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_rate": "0.81"}]}`, []string{"lines.0.vat_rate"}},
		{"S without rate", `{"lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_rate": "0"}]}`, []string{"lines.0.vat_rate"}},
		{"exempt line", `{"total": "10.00", "lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_category": "E"}]}`, nil},
		{"null line fields default", `{"total": null, "lines": [{"description": null, "quantity": null, "unit_price": "10", "vat_rate": null}]}`, nil},
		{"issued elsewhere", `{"issued_elsewhere": true}`, nil},
		{"issued elsewhere, partly paid", `{"issued_elsewhere": true, "paid_amount": "500", "paid_on": "2025-10-15"}`, nil},
		{"issued elsewhere, paid in full", `{"issued_elsewhere": true, "paid_amount": "1081.00", "paid_on": "2025-10-15"}`, nil},
		{"issued flag not a boolean", `{"issued_elsewhere": "yes"}`, []string{"issued_elsewhere"}},
		{"issued elsewhere without a number", `{"issued_elsewhere": true, "number": null}`, []string{"number"}},
		{"issued elsewhere without a date", `{"issued_elsewhere": true, "issue_date": null}`, []string{"issue_date"}},
		{"issued elsewhere in the future", `{"issued_elsewhere": true, "issue_date": "2999-01-01", "due_date": "2999-02-01"}`, []string{"issue_date"}},
		{"paid more than the total", `{"issued_elsewhere": true, "paid_amount": "1081.01", "paid_on": "2025-10-15"}`, []string{"paid_amount"}},
		{"paid nothing", `{"issued_elsewhere": true, "paid_amount": "0", "paid_on": "2025-10-15"}`, []string{"paid_amount"}},
		{"paid without a date", `{"issued_elsewhere": true, "paid_amount": "10"}`, []string{"paid_on"}},
		{"paid date without an amount", `{"issued_elsewhere": true, "paid_on": "2025-10-15"}`, []string{"paid_amount"}},
		{"paid in the future", `{"issued_elsewhere": true, "paid_amount": "10", "paid_on": "2999-01-01"}`, []string{"paid_on"}},
		{"a draft cannot be paid", `{"paid_amount": "10", "paid_on": "2025-10-15"}`, []string{"paid_amount"}},
		{"over the total limit", `{"total": null, "lines": [{"description": "x", "quantity": "1000000", "unit_price": "100000000"}]}`, []string{"lines"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := invoicesKind.Check(ctx, st.Q, "wsp_a", invoiceData(t, tt.extra))
			if err != nil {
				t.Fatal(err)
			}
			for _, f := range tt.want {
				if got[f] == "" {
					t.Errorf("want an issue on %s, got %v", f, got)
				}
			}
			if len(got) != len(tt.want) {
				t.Errorf("issues %v, want only %v", got, tt.want)
			}
		})
	}
}

func TestInvoicesKindCreate(t *testing.T) {
	st, sess, clientID := invoiceStore(t)
	ctx := context.Background()
	// The model's total is ignored for the draft: the totals come from the lines.
	id, err := invoicesKind.Create(ctx, st.Q, sess, invoiceData(t, `{}`), Source{})
	if err != nil {
		t.Fatal(err)
	}
	inv, err := st.Invoice(ctx, "wsp_a", id, "2026-01-01", false)
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != "draft" || inv.Number != nil || inv.ClientID != clientID || inv.Kind != "invoice" {
		t.Fatalf("want an unnumbered draft for the client, got status %s number %v client %s kind %s", inv.Status, inv.Number, inv.ClientID, inv.Kind)
	}
	if inv.Note == nil || *inv.Note != "Imported from document RE-2025-017" {
		t.Errorf("note %v", inv.Note)
	}
	if inv.IssueDate != "2025-10-01" || inv.DueDate != "2025-10-31" || inv.Currency != "CHF" || inv.VATMode != "exclusive" {
		t.Errorf("dates/currency/mode %s %s %s %s", inv.IssueDate, inv.DueDate, inv.Currency, inv.VATMode)
	}
	if len(inv.Lines) != 1 || inv.Lines[0].Quantity != 8000 || inv.Lines[0].UnitPrice != 12500 || inv.Lines[0].VATRate != 810 {
		t.Errorf("lines %+v", inv.Lines)
	}
	if inv.NetTotal != 100000 || inv.VATTotal != 8100 || inv.Total != 108100 {
		t.Errorf("totals net %d vat %d total %d", inv.NetTotal, inv.VATTotal, inv.Total)
	}

	// A record with issues never reaches the database.
	_, err = invoicesKind.Create(ctx, st.Q, sess, invoiceData(t, `{"client_name": "Unbekannt GmbH"}`), Source{})
	if err == nil || err.Error() != "validation_failed: Check the highlighted fields." {
		t.Fatalf("unmatched client: %v", err)
	}
	if _, err := st.Invoice(ctx, "wsp_b", id, "2026-01-01", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("another workspace reads the draft: %v", err)
	}
}

func TestInvoicesKindDuplicate(t *testing.T) {
	st, sess, _ := invoiceStore(t)
	ctx := context.Background()
	if d, err := invoicesKind.Duplicate(ctx, st.Q, "wsp_a", invoiceData(t, `{}`)); err != nil || d != nil {
		t.Fatalf("before any import: %v %v", d, err)
	}
	id, err := invoicesKind.Create(ctx, st.Q, sess, invoiceData(t, `{}`), Source{})
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, extra, reason string
	}{
		{"same document again", `{}`, "same document number"},
		{"same number, other date", `{"issue_date": "2025-11-01", "due_date": null}`, "same document number"},
		{"same date and total, other number", `{"number": "RE-2025-099"}`, "same date and total"},
		{"other number, date and total", `{"number": "RE-2025-099", "issue_date": "2025-11-01", "due_date": null, "total": null,
			"lines": [{"description": "x", "quantity": "1", "unit_price": "10"}]}`, ""},
		{"no client matched", `{"client_name": "Unbekannt GmbH"}`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, err := invoicesKind.Duplicate(ctx, st.Q, "wsp_a", invoiceData(t, tt.extra))
			if err != nil {
				t.Fatal(err)
			}
			if tt.reason == "" {
				if d != nil {
					t.Fatalf("want none, got %+v", d)
				}
				return
			}
			if d == nil || d.ID != id || d.Reason != tt.reason || d.Label != "Draft of 01.10.2025" {
				t.Fatalf("got %+v, want %s (%s)", d, id, tt.reason)
			}
		})
	}
	if d, err := invoicesKind.Duplicate(ctx, st.Q, "wsp_b", invoiceData(t, `{"client_id": "cli_b"}`)); err != nil || d != nil {
		t.Fatalf("another workspace: %v %v", d, err)
	}
}
