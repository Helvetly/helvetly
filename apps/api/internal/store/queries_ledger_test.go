package store_test

import (
	"context"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/ledgercalc"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func ledgerStore(t *testing.T) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	db, raw := storetest.New(t)
	ctx := context.Background()
	for _, id := range []string{"lg-a", "lg-b"} {
		if err := db.CreateWorkspace(ctx, store.Workspace{ID: id, Name: id}, "UTC", t0); err != nil {
			t.Fatal(err)
		}
		mustExec(t, raw, `INSERT INTO clients (id,workspace_id,number,name,is_company,country,created_at,updated_at)
			VALUES ($1,$2,1,'Buyer '||$2,true,'CH',now(),now())`, id+"-c", id)
	}
	return db, raw
}

func mustExec(t *testing.T, raw *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := raw.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func ledgerInvoice(t *testing.T, raw *pgxpool.Pool, ws, id, kind, status, date string, credited, number any) {
	t.Helper()
	mustExec(t, raw, `INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,credited_invoice_id,issue_date,due_date,
		currency,language,vat_mode,discount_percent,subtotal,discount_amount,net_total,vat_total,total,rounding_amount,vat_breakdown,
		created_at,updated_at) VALUES ($1,$2,$3,$4,$7,$2||'-c',$5,$6,$6,'CHF','en','exclusive',0,10000,0,10000,810,10810,0,
		'[{"category":"S","rate":"8.1","taxable_amount":"100.00","vat_amount":"8.10"}]',now(),now())`,
		id, ws, kind, status, credited, date, number)
}

func TestLedgerSourcesSigns(t *testing.T) {
	db, raw := ledgerStore(t)
	ctx := context.Background()
	ledgerInvoice(t, raw, "lg-a", "i1", "invoice", "open", "2026-01-10", nil, "R-1")
	ledgerInvoice(t, raw, "lg-a", "cn1", "credit_note", "open", "2026-02-10", "i1", "CN-1")
	ledgerInvoice(t, raw, "lg-a", "i2", "invoice", "replaced", "2026-01-20", nil, "R-2")
	ledgerInvoice(t, raw, "lg-a", "c2", "corrected", "open", "2026-03-01", "i2", "R-2C")
	ledgerInvoice(t, raw, "lg-a", "pp", "prepayment", "paid", "2026-04-01", nil, "P-1")
	ledgerInvoice(t, raw, "lg-a", "fin", "invoice", "open", "2026-05-01", nil, "R-3")
	mustExec(t, raw, `INSERT INTO invoice_prepayments (invoice_id, prepayment_id, position) VALUES ('fin','pp',1)`)
	ledgerInvoice(t, raw, "lg-a", "dr", "invoice", "draft", "2026-05-02", nil, nil)
	ledgerInvoice(t, raw, "lg-a", "pf", "proforma", "open", "2026-05-03", nil, "PF-1")
	ledgerInvoice(t, raw, "lg-a", "sb", "self_billed", "open", "2026-05-04", nil, "SB-1")
	mustExec(t, raw, `INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES ('pay','i1',500,'2026-01-15','twint',now())`)
	mustExec(t, raw, `INSERT INTO invoice_refunds (id,invoice_id,amount,refunded_on,method,created_at) VALUES ('ref','i1',100,'2026-01-16','cash',now())`)

	src, unposted, err := db.LedgerSources(ctx, "lg-a", "2026-12-31")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, d := range src.Invoices {
		got[d.ID+"@"+d.Date+"/"+d.Ref] += d.Sign
		if d.Party != "Buyer lg-a" || d.Currency != "CHF" || len(d.Groups) != 1 {
			t.Fatalf("doc %+v", d)
		}
	}
	want := map[string]int{"i1@2026-01-10/R-1": 1, "cn1@2026-02-10/CN-1": -1, "i2@2026-01-20/R-2": 1,
		"c2@2026-03-01/R-2C": 1, "pp@2026-04-01/P-1": 1, "fin@2026-05-01/R-3": 1}
	want["i2@2026-03-01/R-2"] = -1
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("invoices = %v; want %v", got, want)
	}
	if len(src.Payments) != 2 || src.Payments[0].Refund || !src.Payments[1].Refund || src.Payments[0].Ref != "R-1" || src.Payments[0].Currency != "CHF" {
		t.Fatalf("payments = %+v", src.Payments)
	}
	if !reflect.DeepEqual(unposted, []store.LedgerUnposted{{Ref: "SB-1", Reason: "self_billed"}}) {
		t.Fatalf("unposted = %v", unposted)
	}
}

func ledgerExpense(t *testing.T, raw *pgxpool.Pool, ws, id, status, category, box string, paidBy any) {
	t.Helper()
	mustExec(t, raw, `INSERT INTO expenses (id,workspace_id,number,status,supplier_name,category_id,currency,amount_mode,input_tax,
		deductible_percent,net_total,vat_total,total,deductible_vat,vat_breakdown,exchange_rate,base_currency,base_net_total,base_vat_total,
		base_total,base_deductible_vat,payment_status,document_date,paid_on,payment_method,paid_by,input_tax_box,booked_at,created_at,updated_at)
		VALUES ($1,$2,(SELECT count(*)+1 FROM expenses WHERE workspace_id=$2),$3,'Sup',NULLIF($4,''),'EUR','gross','full',10000,0,0,0,0,'[]',
		1000000,'CHF',900,81,981,81,'paid','2026-02-01','2026-02-05','card',$6,NULLIF($5,''),CASE WHEN $3='draft' THEN NULL ELSE now() END,now(),now())`,
		id, ws, status, category, box, paidBy)
}

func TestLedgerSourcesExpenses(t *testing.T) {
	db, raw := ledgerStore(t)
	ctx := context.Background()
	for _, c := range [][2]string{{"cat4", "4000"}, {"cat6", "6500"}} {
		mustExec(t, raw, `INSERT INTO expense_categories (id,workspace_id,name,account_code,created_at,updated_at) VALUES ($1,'lg-a','N '||$1,$2,now(),now())`, c[0], c[1])
	}
	mustExec(t, raw, `INSERT INTO users (id,email,name,created_at,updated_at) VALUES ('u1','u@x.ch','U',now(),now())`)
	ledgerExpense(t, raw, "lg-a", "e1", "booked", "cat4", "", nil)
	ledgerExpense(t, raw, "lg-a", "e2", "booked", "cat6", "400", "u1")
	ledgerExpense(t, raw, "lg-a", "e3", "booked", "cat6", "405", nil)
	ledgerExpense(t, raw, "lg-a", "e4", "void", "cat6", "", nil)
	ledgerExpense(t, raw, "lg-a", "e5", "draft", "cat6", "", nil)
	ledgerExpense(t, raw, "lg-a", "e6", "booked", "", "", nil)
	ledgerExpense(t, raw, "lg-a", "e7", "booked", "cat4", "405", nil) // its own box wins over the account class

	src, unposted, err := db.LedgerSources(ctx, "lg-a", "2026-12-31")
	if err != nil {
		t.Fatal(err)
	}
	type k struct {
		Account         string
		Material, Payer bool
	}
	got := map[string]k{}
	for _, e := range src.Expenses {
		got[e.ID] = k{e.Account, e.MaterialVAT, e.PaidByMember}
		if e.Currency != "CHF" || e.Total != 981 || e.Deductible != 81 || e.Party != "Sup" || e.PaidOn != "2026-02-05" || e.Method != "card" || e.Date != "2026-02-01" {
			t.Fatalf("expense %+v", e)
		}
	}
	want := map[string]k{"e1": {"4000", true, false}, "e2": {"6500", true, true}, "e3": {"6500", false, false}, "e7": {"4000", false, false}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expenses = %v; want %v", got, want)
	}
	if !reflect.DeepEqual(unposted, []store.LedgerUnposted{{Ref: "6", Reason: "no_category"}}) {
		t.Fatalf("unposted = %v", unposted)
	}
	names, err := db.LedgerAccountNames(ctx, "lg-a")
	if err != nil || names["4000"] != "N cat4" || len(names) != 2 {
		t.Fatalf("names = %v, %v", names, err)
	}
}

func TestLedgerSourcesWorkspaceIsolation(t *testing.T) {
	db, raw := ledgerStore(t)
	ledgerInvoice(t, raw, "lg-a", "i1", "invoice", "open", "2026-01-10", nil, "R-1")
	ledgerExpense(t, raw, "lg-a", "e1", "booked", "", "", nil)
	src, un, err := db.LedgerSources(context.Background(), "lg-b", "2026-12-31")
	if err != nil || len(src.Invoices)+len(src.Expenses)+len(src.Payments)+len(un) != 0 {
		t.Fatalf("lg-b = %+v %v %v", src, un, err)
	}
}

func TestLedgerSourcesTo(t *testing.T) {
	db, raw := ledgerStore(t)
	ledgerInvoice(t, raw, "lg-a", "i1", "invoice", "open", "2026-01-10", nil, "R-1")
	ledgerInvoice(t, raw, "lg-a", "i2", "invoice", "open", "2026-03-10", nil, "R-2")
	mustExec(t, raw, `INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES ('p','i1',5,'2026-03-01','cash',now())`)
	ledgerExpense(t, raw, "lg-a", "e1", "booked", "", "", nil)
	src, un, err := db.LedgerSources(context.Background(), "lg-a", "2026-02-28")
	if err != nil || len(src.Invoices) != 1 || src.Invoices[0].ID != "i1" || len(src.Payments) != 0 || len(un) != 1 {
		t.Fatalf("to = %+v %v %v", src, un, err)
	}
	src, un, _ = db.LedgerSources(context.Background(), "lg-a", "2026-01-31")
	if len(un) != 0 || len(src.Invoices) != 1 {
		t.Fatalf("expense after to still present: %+v %v", src, un)
	}
}

func TestSaveLedgerAccountsRoundTrip(t *testing.T) {
	db, raw := ledgerStore(t)
	ctx := context.Background()
	if a, err := db.LedgerAccounts(ctx, "lg-a"); err != nil || !reflect.DeepEqual(a, ledgercalc.DefaultAccounts()) {
		t.Fatalf("default = %+v, %v", a, err)
	}
	mustExec(t, raw, `INSERT INTO users (id,email,name,created_at,updated_at) VALUES ('u1','u@x.ch','U',now(),now())`)
	a := ledgercalc.DefaultAccounts()
	a.Revenue = "3000"
	a.Bank["twint"] = "1021"
	for range 2 { // second save updates
		if err := db.SaveLedgerAccounts(ctx, "lg-a", "u1", a, t0); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := db.LedgerAccounts(ctx, "lg-a"); err != nil || !reflect.DeepEqual(got, a) {
		t.Fatalf("saved = %+v, %v", got, err)
	}
	if b, _ := db.LedgerAccounts(ctx, "lg-b"); !reflect.DeepEqual(b, ledgercalc.DefaultAccounts()) {
		t.Fatalf("other workspace = %+v", b)
	}
}

// A final invoice's breakdown already has its prepayments deducted, so nothing reverses them again.
func TestLedgerFinalAfterPrepaymentOwesItsAmountDue(t *testing.T) {
	db, raw := ledgerStore(t)
	ledgerInvoice(t, raw, "lg-a", "pp", "prepayment", "paid", "2026-04-01", nil, "P-1")
	ledgerInvoice(t, raw, "lg-a", "fin", "invoice", "open", "2026-05-01", nil, "R-3") // total 108.10 after the deduction
	mustExec(t, raw, `INSERT INTO invoice_prepayments (invoice_id, prepayment_id, position) VALUES ('fin','pp',1)`)
	mustExec(t, raw, `INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES ('pay','pp',10810,'2026-04-02','cash',now())`)
	src, _, err := db.LedgerSources(context.Background(), "lg-a", "2026-12-31")
	if err != nil {
		t.Fatal(err)
	}
	rows := ledgercalc.Post(ledgercalc.DefaultAccounts(), src)
	for _, b := range ledgercalc.Balances(rows, "2026-01-01", "2026-12-31", nil) {
		if b.Account == "1100" && b.Closing != 10810 {
			t.Fatalf("1100 = %v; want the final's amount due 108.10", b.Closing)
		}
	}
}

func TestLedgerSourcesExpensePaymentBeforeDocumentDate(t *testing.T) {
	db, raw := ledgerStore(t)
	ledgerExpense(t, raw, "lg-a", "e1", "booked", "", "", nil)
	mustExec(t, raw, `UPDATE expenses SET document_date = '2026-03-01' WHERE id = 'e1'`) // paid_on stays 2026-02-05
	src, _, err := db.LedgerSources(context.Background(), "lg-a", "2026-02-28")
	if err != nil || len(src.Expenses) != 0 {
		t.Fatalf("no category expense is unposted, not a source: %+v %v", src, err)
	}
	mustExec(t, raw, `INSERT INTO expense_categories (id,workspace_id,name,account_code,created_at,updated_at) VALUES ('c','lg-a','C','6500',now(),now())`)
	mustExec(t, raw, `UPDATE expenses SET category_id = 'c' WHERE id = 'e1'`)
	if src, _, err = db.LedgerSources(context.Background(), "lg-a", "2026-02-28"); err != nil || len(src.Expenses) != 1 {
		t.Fatalf("payment dated before to must be listed: %+v %v", src, err)
	}
	if src, _, err = db.LedgerSources(context.Background(), "lg-a", "2026-02-04"); err != nil || len(src.Expenses) != 0 {
		t.Fatalf("nothing dated up to to: %+v %v", src, err)
	}
}

func TestLedgerSourcesAcquisitionTax(t *testing.T) {
	db, raw := ledgerStore(t)
	mustExec(t, raw, `INSERT INTO expense_categories (id,workspace_id,name,account_code,created_at,updated_at) VALUES ('c','lg-a','C','6500',now(),now())`)
	ledgerExpense(t, raw, "lg-a", "e1", "booked", "c", "", nil)
	ledgerExpense(t, raw, "lg-a", "e2", "booked", "c", "", nil)
	ledgerExpense(t, raw, "lg-a", "e3", "booked", "c", "", nil)
	mustExec(t, raw, `UPDATE expenses SET reverse_charge = true, base_net_total = 100000, base_total = 100000, base_deductible_vat = 0 WHERE id IN ('e1','e2','e3')`)
	mustExec(t, raw, `UPDATE expenses SET deductible_percent = 5000 WHERE id = 'e2'`)
	mustExec(t, raw, `UPDATE expenses SET document_date = '2023-12-31' WHERE id = 'e3'`) // before the 2024 rates
	src, _, err := db.LedgerSources(context.Background(), "lg-a", "2026-12-31")
	if err != nil || len(src.Expenses) != 3 {
		t.Fatalf("expenses = %+v %v", src.Expenses, err)
	}
	type k struct {
		RC       bool
		Tax, Ded invoicecalc.Money
	}
	got := map[string]k{}
	for _, e := range src.Expenses {
		got[e.ID] = k{e.ReverseCharge, e.AcquisitionTax, e.AcquisitionDeductible}
	}
	want := map[string]k{"e1": {true, 8100, 8100}, "e2": {true, 8100, 4050}, "e3": {}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v; want %v", got, want)
	}
}
