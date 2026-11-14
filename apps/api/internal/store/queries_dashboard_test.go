package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func dashboardFixture(t *testing.T) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	db, raw := storetest.New(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	for _, id := range []string{"dash-own", "dash-foreign"} {
		if err := db.CreateWorkspace(ctx, store.Workspace{ID: id, Name: id}, "Europe/Zurich", now); err != nil {
			t.Fatal(err)
		}
		_, err := raw.Exec(ctx, `INSERT INTO clients (id,workspace_id,number,name,is_company,country,created_at,updated_at)
			VALUES ($1,$2,1,'Buyer',true,'CH',$3,$3)`, id+"-client", id, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	return db, raw
}

func dashboardInvoice(t *testing.T, raw *pgxpool.Pool, id, workspace, currency, status string, total, paid, credited int64) {
	t.Helper()
	_, err := raw.Exec(context.Background(), `INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,
		issue_date,due_date,currency,language,vat_mode,discount_percent,subtotal,discount_amount,net_total,
		vat_total,total,rounding_amount,vat_breakdown,amount_paid,amount_credited,created_at,updated_at)
		VALUES ($1,$2,'invoice',$4,$1,$2||'-client','2026-10-01','2026-10-31',$3,'en','none',0,$5,0,$5,
		0,$5,0,'[]',$6,$7,now(),now())`, id, workspace, currency, status, total, paid, credited)
	if err != nil {
		t.Fatal(err)
	}
}

func dashboardExpense(t *testing.T, raw *pgxpool.Pool, id, workspace, currency, status, paymentStatus string, total int64) {
	t.Helper()
	_, err := raw.Exec(context.Background(), `INSERT INTO expenses (id,workspace_id,number,status,currency,amount_mode,
		input_tax,deductible_percent,net_total,vat_total,total,deductible_vat,vat_breakdown,exchange_rate,
		base_currency,base_net_total,base_vat_total,base_total,base_deductible_vat,payment_status,document_date,
		paid_on,booked_at,created_at,updated_at)
		VALUES ($1,$2,(SELECT count(*)+1 FROM expenses WHERE workspace_id=$2),$4,$3,'gross','none',0,$6,0,$6,0,
		'[]',1000000,'CHF',$6,0,$6,0,$5,'2026-10-30','2026-11-01',CASE WHEN $4='draft' THEN NULL ELSE now() END,now(),now())`,
		id, workspace, currency, status, paymentStatus, total)
	if err != nil {
		t.Fatal(err)
	}
}

func TestDashboardCashFlowUsesCashDatesAndKeepsCurrenciesAndTenantsSeparate(t *testing.T) {
	db, raw := dashboardFixture(t)
	ctx := context.Background()
	dashboardInvoice(t, raw, "cash-chf", "dash-own", "CHF", "paid", 20000, 15000, 10000)
	dashboardInvoice(t, raw, "cash-eur", "dash-own", "EUR", "paid", 7000, 7000, 0)
	dashboardInvoice(t, raw, "cash-other", "dash-foreign", "CHF", "paid", 90000, 90000, 0)
	_, err := raw.Exec(ctx, `INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES
		('p-last','cash-chf',10000,'2026-10-31','cash',now()),('p-now','cash-chf',5000,'2026-11-01','cash',now()),
		('p-future','cash-chf',9900,'2026-11-02','cash',now()),('p-eur','cash-eur',7000,'2026-11-01','cash',now()),
		('p-other','cash-other',90000,'2026-11-01','cash',now());
		INSERT INTO invoice_refunds (id,invoice_id,amount,refunded_on,method,created_at)
		VALUES ('r-now','cash-chf',1500,'2026-11-01','cash',now())`)
	if err != nil {
		t.Fatal(err)
	}
	dashboardExpense(t, raw, "cash-exp", "dash-own", "CHF", "booked", "paid", 2500)
	dashboardExpense(t, raw, "unpaid-exp", "dash-own", "CHF", "booked", "unpaid", 900)
	dashboardExpense(t, raw, "draft-exp", "dash-own", "CHF", "draft", "paid", 1000)
	dashboardExpense(t, raw, "eur-exp", "dash-own", "EUR", "booked", "paid", 4000)
	dashboardExpense(t, raw, "other-exp", "dash-foreign", "CHF", "booked", "paid", 50000)
	points, err := db.DashboardMovements(ctx, "dash-own", "CHF", "2025-12-01", "2026-11-01", true, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 2 || points[0].Date != "2026-10-31" || points[0].Income != 10000 ||
		points[1].Date != "2026-11-01" || points[1].Income != 3500 || points[1].Expenses != 2500 {
		t.Fatalf("cash movements = %+v; want 100.00 on Oct 31, 35.00 income / 25.00 expense on Nov 1", points)
	}
	for _, tc := range []struct {
		name               string
		invoices, expenses bool
		income, expense    int64
	}{{"invoices only", true, false, 3500, 0}, {"expenses only", false, true, 0, 2500}, {"no finance", false, false, 0, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			rows, err := db.DashboardMovements(ctx, "dash-own", "CHF", "2026-11-01", "2026-11-01", tc.invoices, tc.expenses)
			if err != nil {
				t.Fatal(err)
			}
			var income, expenses int64
			for _, row := range rows {
				income += int64(row.Income)
				expenses += int64(row.Expenses)
			}
			if income != tc.income || expenses != tc.expense {
				t.Fatalf("movements=%v/%v want %v/%v", income, expenses, tc.income, tc.expense)
			}
		})
	}
}
