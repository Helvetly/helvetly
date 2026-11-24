package vatreturn

import (
	"net/http"
	"testing"
)

// A fully settled invoice gives the same figures on the received basis as on the agreed one, also when a credit note
// on one of its rates came before the payment (it is priced against what is left) or a refund paid one out after it
// (the refund is priced against the credit note).
func TestReceivedEqualsAgreedOnceSettled(t *testing.T) {
	tests := []struct {
		name  string
		moves func(e *env, ws, inv string)
	}{
		{"credit note, then the rest paid", func(e *env, ws, inv string) {
			e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES ($1||'-p',$2,147290,'2026-09-15','cash',now())`, ws, inv)
		}},
		{"part paid, credit to one rate, then settled", func(e *env, ws, inv string) {
			e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES
				($1||'-p1',$2,79050,'2026-08-15','bank_transfer',now()), ($1||'-p2',$2,68240,'2026-09-15','bank_transfer',now())`, ws, inv)
		}},
		{"paid in full, credit note, refund", func(e *env, ws, inv string) {
			e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES ($1||'-p',$2,158100,'2026-08-15','cash',now())`, ws, inv)
			e.exec(`INSERT INTO invoice_refunds (id,invoice_id,amount,refunded_on,method,created_at) VALUES ($1||'-r',$2,10810,'2026-09-10','cash',now())`, ws, inv)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			ws := b.workspace
			inv := ws + "-inv"
			e.invoice(ws, inv, "invoice", "paid", "CHF", "2026-08-10", sale1, 158100, nil)
			e.invoice(ws, ws+"-cn", "credit_note", "paid", "CHF", "2026-08-20", credit1, 10810, &inv)
			tt.moves(e, ws, inv)
			figures := map[string][2]vatLine{}
			for _, basis := range []string{"agreed", "received"} {
				if resp, raw := e.send(b, "PUT", "/api/v1/vat-return/settings", map[string]any{"method": "effective", "period": "quarterly",
					"basis": basis, "net_rates": []any{}}); resp.StatusCode != http.StatusOK {
					t.Fatalf("settings: %d %s", resp.StatusCode, raw)
				}
				r := e.report(b, "2026-Q3")
				for _, z := range []string{"200", "220", "303"} {
					f := figures[z]
					l := line(r, z)
					f[map[string]int{"agreed": 0, "received": 1}[basis]] = vatLine{l.Base.String(), l.Tax.String(), l.Amount.String()}
					figures[z] = f
				}
			}
			for z, f := range figures {
				if f[0] != f[1] {
					t.Errorf("Ziffer %s: agreed %+v, received %+v", z, f[0], f[1])
				}
			}
			if f := figures["303"][0]; f.base != "900.00" || f.tax != "72.90" {
				t.Errorf("agreed 303 = %+v, want 900.00 / 72.90", f)
			}
		})
	}
}

type vatLine struct{ base, tax, amount string }

func TestReceivedRoundingAcrossPeriods(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ws := b.workspace
	inv := ws + "-round"
	const groups = `[{"category":"S","rate":"8.1","taxable_amount":"1.01","vat_amount":"0.08"}]`
	e.invoice(ws, inv, "invoice", "paid", "CHF", "2026-06-01", groups, 109, nil)
	e.exec(`UPDATE invoices SET rounding_amount=1 WHERE id=$1`, inv)
	e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES
		($1||'-p1',$1,55,'2026-06-30','bank_transfer',now()), ($1||'-p2',$1,55,'2026-07-01','bank_transfer',now())`, inv)
	if resp, raw := e.send(b, "PUT", "/api/v1/vat-return/settings", map[string]any{"method": "effective", "period": "quarterly",
		"basis": "received", "net_rates": []any{}}); resp.StatusCode != http.StatusOK {
		t.Fatalf("settings: %d %s", resp.StatusCode, raw)
	}
	q2 := line(e.report(b, "2026-Q2"), "303")
	q3 := line(e.report(b, "2026-Q3"), "303")
	if q2.Base != 51 || q3.Base != 50 {
		t.Fatalf("taxable receipts Q2=%s Q3=%s, want 0.51 and 0.50 for a taxable base of 1.01", q2.Base, q3.Base)
	}
}

func TestReceivedRoundingOfRefundsIsIndependentOfPayments(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ws := b.workspace
	inv := ws + "-refund"
	const groups = `[{"category":"S","rate":"8.1","taxable_amount":"1.01","vat_amount":"0.08"}]`
	e.invoice(ws, inv, "invoice", "paid", "CHF", "2026-03-01", groups, 109, nil)
	e.invoice(ws, ws+"-credit", "credit_note", "paid", "CHF", "2026-03-01", groups, 109, &inv)
	e.exec(`UPDATE invoices SET rounding_amount=1 WHERE workspace_id=$1`, ws)
	e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES
		($1||'-p',$1,110,'2026-03-01','bank_transfer',now())`, inv)
	e.exec(`INSERT INTO invoice_refunds (id,invoice_id,amount,refunded_on,method,created_at) VALUES
		($1||'-r1',$1,55,'2026-06-30','bank_transfer',now()), ($1||'-r2',$1,55,'2026-07-01','bank_transfer',now())`, inv)
	if resp, raw := e.send(b, "PUT", "/api/v1/vat-return/settings", map[string]any{"method": "effective", "period": "quarterly",
		"basis": "received", "net_rates": []any{}}); resp.StatusCode != http.StatusOK {
		t.Fatalf("settings: %d %s", resp.StatusCode, raw)
	}
	for period, want := range map[string]int64{"2026-Q1": 101, "2026-Q2": -51, "2026-Q3": -50} {
		if got := line(e.report(b, period), "303").Base; int64(got) != want {
			t.Errorf("%s taxable base = %s, want %d cents", period, got, want)
		}
	}
}
