package dashboard

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type testAuth struct {
	*auth.Service
	session store.Session
}

func (a testAuth) SignedIn(next func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { next(w, r, a.session) }
}

func TestDashboardEndpointScopesCurrenciesAndWorkspaceCivilDate(t *testing.T) {
	db, raw := storetest.New(t)
	ctx := context.Background()
	for _, id := range []string{"dash", "foreign"} {
		if err := db.CreateWorkspace(ctx, store.Workspace{ID: id, Name: id}, "Europe/Zurich", time.Now()); err != nil {
			t.Fatal(err)
		}
		if err := db.CreateClient(ctx, id, id+"-client", map[string]any{"name": "Buyer"}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	_, err := raw.Exec(ctx, `INSERT INTO invoices(id,workspace_id,kind,status,number,client_id,issue_date,due_date,currency,
		language,vat_mode,discount_percent,subtotal,discount_amount,net_total,vat_total,total,rounding_amount,
		vat_breakdown,amount_paid,created_at,updated_at)
		SELECT id,workspace,'invoice','paid',id,workspace||'-client','2026-10-31','2026-11-30',currency,'en','none',
		0,amount,0,amount,0,amount,0,'[]',amount,now(),now()
		FROM (VALUES ('chf','dash','CHF',2500),('eur','dash','EUR',3500),('other','foreign','CHF',9900),('other-usd','foreign','USD',9900)) fixture(id,workspace,currency,amount);
		INSERT INTO invoice_payments(id,invoice_id,amount,paid_on,method,created_at) VALUES
		('chf-payment','chf',2500,'2026-11-02','cash',now()),('eur-payment','eur',3500,'2026-11-02','cash',now()),
		('other-payment','other',9900,'2026-11-02','cash',now())`)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, role, currency string
		scopes               []string
		paid                 float64
		currencies           int
	}{
		{"owner default", "owner", "", nil, 25, 2},
		{"owner euro", "owner", "EUR", nil, 35, 2},
		{"invoice reader", "member", "CHF", []string{"read:invoices"}, 25, 2},
		{"expense reader", "member", "CHF", []string{"read:expenses"}, 0, 1},
		{"no finance", "member", "CHF", []string{"read:clients"}, 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := testAuth{Service: &auth.Service{}, session: store.Session{Role: tc.role, Scopes: tc.scopes, Workspace: store.Workspace{ID: "dash", Timezone: "Europe/Zurich"}}}
			s := New(db, a)
			s.now = func() time.Time { return time.Date(2026, 11, 1, 23, 30, 0, 0, time.UTC) }
			mux := http.NewServeMux()
			s.Register(mux)
			r := httptest.NewRequest(http.MethodGet, "/api/v1/reports/key-figures?currency="+tc.currency, nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != http.StatusOK {
				t.Fatalf("status=%d: %s", w.Code, w.Body.String())
			}
			var got response
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.PaidThisMonth != tc.paid || len(got.Currencies) != tc.currencies {
				t.Fatalf("dashboard=%+v", got)
			}
			if (got.InvoiceCount > 0) != (tc.paid > 0) {
				t.Fatalf("invoice count=%d for scopes=%v", got.InvoiceCount, tc.scopes)
			}
			points := got.CashFlow["30d"]
			if len(points) != 30 || points[29].Date != "2026-11-02" || points[29].Income != tc.paid {
				t.Fatalf("cash=%+v", points)
			}
			if got.Unread.Notifications != 0 || got.Unread.Inbox != 0 {
				t.Fatal("dashboard must not fabricate unread messages")
			}
		})
	}
	s := New(db, testAuth{Service: &auth.Service{}})
	mux := http.NewServeMux()
	s.Register(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/reports/key-figures?currency=eur", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("malformed currency status=%d", w.Code)
	}
	if err := db.PutInvoiceSettings(ctx, "dash", map[string]any{"currency": "EUR"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	sess := store.Session{Role: "owner", Workspace: store.Workspace{ID: "dash", Timezone: "Europe/Zurich"}}
	s = New(db, testAuth{Service: &auth.Service{}, session: sess})
	s.now = func() time.Time { return time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC) }
	got, err := s.read(ctx, sess, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Currency != "EUR" || got.PaidThisMonth != 35 {
		t.Fatalf("default currency=%s cash=%v", got.Currency, got.PaidThisMonth)
	}
}

func TestSeriesAreZeroFilledAndPreviousMonthDoesNotOverflow(t *testing.T) {
	var got response
	got.fillSeries(time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC), []store.DashboardMovement{
		{Date: "2026-02-28", Income: 10000}, {Date: "2026-03-31", Income: 15000, Expenses: 2500},
	}, []store.DashboardMonth{{Month: "2026-02"}, {Month: "2026-03"}})
	if got.PaidChange != 0.5 || got.PaidThisMonth != 150 {
		t.Fatalf("paid change=%v/%v", got.PaidThisMonth, got.PaidChange)
	}
	if len(got.CashFlow["30d"]) != 30 || len(got.CashFlow["90d"]) != 90 || len(got.CashFlow["12m"]) != 2 {
		t.Fatalf("ranges=%v", got.CashFlow)
	}
	if got.CashFlow["30d"][0].Income != 0 || got.CashFlow["12m"][1].Expenses != 25 {
		t.Fatal("zero fill or monthly money is wrong")
	}
	got = response{}
	got.fillSeries(time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC), []store.DashboardMovement{
		{Date: "2026-02-28", Income: -10000}, {Date: "2026-03-31", Income: 15000},
	}, nil)
	if got.PaidChange != 0 {
		t.Fatal("a negative cash baseline must not fabricate a percentage growth")
	}
}
