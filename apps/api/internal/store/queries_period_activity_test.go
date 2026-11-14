package store_test

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
)

func activityInvoice(t *testing.T, raw *pgxpool.Pool, id, ws, kind, status, date, currency string, total int64) {
	t.Helper()
	_, err := raw.Exec(context.Background(), `INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,
		issue_date,due_date,currency,language,vat_mode,discount_percent,subtotal,discount_amount,net_total,
		vat_total,total,rounding_amount,vat_breakdown,amount_paid,amount_credited,created_at,updated_at)
		VALUES ($1,$2,$3,$4,CASE WHEN $4='draft' THEN NULL ELSE $1 END,$2||'-client',$5::date,$5::date,$6,'en','none',0,$7,0,$7,
		0,$7,0,'[]',0,0,now(),now())`, id, ws, kind, status, date, currency, total)
	if err != nil {
		t.Fatal(err)
	}
}

func activityExpense(t *testing.T, raw *pgxpool.Pool, id, ws, status, date string, total int64, deleted bool) {
	t.Helper()
	dashboardExpense(t, raw, id, ws, "CHF", status, "unpaid", total)
	_, err := raw.Exec(context.Background(), `UPDATE expenses SET document_date=$2,
		deleted_at=CASE WHEN $3 THEN now() END WHERE id=$1`, id, date, deleted)
	if err != nil {
		t.Fatal(err)
	}
}

func TestPeriodActivity(t *testing.T) {
	db, raw := dashboardFixture(t)
	ctx := context.Background()
	activityInvoice(t, raw, "i-sep", "dash-own", "invoice", "open", "2026-09-30", "CHF", 10000)
	activityInvoice(t, raw, "i-oct", "dash-own", "invoice", "paid", "2026-10-01", "CHF", 2000)
	activityInvoice(t, raw, "i-oct-eur", "dash-own", "invoice", "open", "2026-10-15", "EUR", 500)
	activityInvoice(t, raw, "i-oct-void", "dash-own", "invoice", "void", "2026-10-20", "CHF", 7000)
	activityInvoice(t, raw, "i-oct-credit", "dash-own", "credit_note", "open", "2026-10-21", "CHF", 300)
	activityInvoice(t, raw, "i-oct-draft", "dash-own", "invoice", "draft", "2026-10-31", "CHF", 999)
	activityInvoice(t, raw, "i-before", "dash-own", "invoice", "open", "2026-08-31", "CHF", 1)
	activityInvoice(t, raw, "i-after", "dash-own", "invoice", "open", "2026-11-01", "CHF", 1)
	activityInvoice(t, raw, "i-foreign", "dash-foreign", "invoice", "open", "2026-10-01", "CHF", 1)
	activityExpense(t, raw, "e-oct", "dash-own", "booked", "2026-10-02", 400, false)
	activityExpense(t, raw, "e-oct-draft", "dash-own", "draft", "2026-10-03", 50, false)
	activityExpense(t, raw, "e-oct-deleted", "dash-own", "draft", "2026-10-04", 60, true)
	activityExpense(t, raw, "e-oct-void", "dash-own", "void", "2026-10-05", 70, false)

	tests := []struct {
		name               string
		invoices, expenses bool
		want               []store.PeriodActivityRow
	}{
		{"both", true, true, []store.PeriodActivityRow{
			{Month: "2026-09", Source: "invoices", Currency: "CHF", Recorded: 1, Total: 10000},
			{Month: "2026-10", Source: "expenses", Currency: "CHF", Recorded: 1, Drafts: 1, Total: 400},
			{Month: "2026-10", Source: "invoices", Currency: "CHF", Recorded: 3, Drafts: 1, Total: 2000},
			{Month: "2026-10", Source: "invoices", Currency: "EUR", Recorded: 1, Total: 500},
		}},
		{"invoices only", true, false, []store.PeriodActivityRow{
			{Month: "2026-09", Source: "invoices", Currency: "CHF", Recorded: 1, Total: 10000},
			{Month: "2026-10", Source: "invoices", Currency: "CHF", Recorded: 3, Drafts: 1, Total: 2000},
			{Month: "2026-10", Source: "invoices", Currency: "EUR", Recorded: 1, Total: 500},
		}},
		{"neither", false, false, []store.PeriodActivityRow{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := db.PeriodActivity(ctx, "dash-own", "2026-09", "2026-10", tt.invoices, tt.expenses)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(got, tt.want) && !(len(got) == 0 && len(tt.want) == 0) {
				t.Fatalf("got %+v\nwant %+v", got, tt.want)
			}
		})
	}
}
