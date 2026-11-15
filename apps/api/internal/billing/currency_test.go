package billing

import (
	"net/http"
	"testing"
)

func TestCurrencyOf(t *testing.T) {
	for _, tt := range []struct{ tz, want string }{
		{"Europe/Zurich", "chf"},
		{"Europe/Vaduz", "chf"},
		{"Europe/Berlin", "eur"},
		{"Europe/Busingen", "eur"}, // German, on Swiss time
		{"Europe/Paris", "eur"},
		{"Atlantic/Canary", "eur"},
		{"Asia/Nicosia", "eur"},
		{"Indian/Reunion", "eur"},
		{"Europe/London", "usd"},
		{"Europe/Oslo", "usd"},
		{"Europe/Monaco", "usd"}, // pays in euros, not in the EU
		{"America/New_York", "usd"},
		{"UTC", "usd"},
		{"", "usd"},
	} {
		if got := CurrencyOf(tt.tz); got != tt.want {
			t.Errorf("CurrencyOf(%q) = %q, want %q", tt.tz, got, tt.want)
		}
	}
}

func TestOffered(t *testing.T) {
	withOptions := price{Currency: "chf", UnitAmount: 1900, CurrencyOptions: map[string]struct {
		UnitAmount int64 `json:"unit_amount"`
	}{EUR: {1900}, USD: {1900}}}
	chfOnly := price{Currency: "chf", UnitAmount: 1900}
	for _, tt := range []struct {
		name   string
		cur    string
		prices []price
		want   string
	}{
		{"every price sold in it", EUR, []price{withOptions, withOptions}, EUR},
		{"the prices' own currency", Currency, []price{chfOnly}, Currency},
		{"one price without the option", USD, []price{withOptions, chfOnly}, Currency},
		{"a currency no price has", "gbp", []price{withOptions}, Currency},
	} {
		if got := offered(tt.cur, tt.prices); got != tt.want {
			t.Errorf("%s: offered = %q, want %q", tt.name, got, tt.want)
		}
	}
	if amount, ok := withOptions.amountIn(USD); !ok || amount != 1900 {
		t.Fatalf("amountIn(usd) = %d %v", amount, ok)
	}
}

// overviewCurrency is the overview's currency and Pro's monthly price in it.
func (e *env) overviewCurrency(b *browser) (cur string, pro map[string]any) {
	e.t.Helper()
	code, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	plans, _ := data["plans"].([]any)
	if code != http.StatusOK || len(plans) != 3 {
		e.t.Fatalf("overview: %d %v", code, body)
	}
	pro, _ = plans[1].(map[string]any)["prices"].(map[string]any)["month"].(map[string]any)
	cur, _ = data["currency"].(string)
	return cur, pro
}

func TestRegionalCurrency(t *testing.T) {
	e := newEnv(t, true)
	for _, tt := range []struct{ tz, want string }{{"Europe/Zurich", "chf"}, {"Europe/Berlin", "eur"}, {"America/New_York", "usd"}} {
		owner := e.workspaceIn(tt.tz)
		cur, pro := e.overviewCurrency(owner)
		if cur != tt.want || pro["currency"] != tt.want || pro["amount"] != 4900.0 {
			t.Fatalf("%s: overview currency %q, Pro %v", tt.tz, cur, pro)
		}
		if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
			t.Fatalf("%s: checkout %d", tt.tz, code)
		}
		if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("currency") != tt.want || f.Get("line_items[0][price]") != "price_pm" {
			t.Fatalf("%s: checkout form %v", tt.tz, f)
		}
	}
}

func TestExistingCustomerKeepsItsCurrency(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspaceIn("Europe/Berlin")
	e.subscribe(owner.workspace, "price_bm")
	e.stripe.mu.Lock()
	e.stripe.currency["cus_"+owner.workspace] = "chf" // Stripe fixed the customer to francs with its first subscription
	e.stripe.mu.Unlock()

	cur, pro := e.overviewCurrency(owner)
	if cur != "chf" || pro["currency"] != "chf" {
		t.Fatalf("a francs customer in Germany sees %q, Pro %v", cur, pro)
	}
	_, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	for _, p := range body["data"].(map[string]any)["ai_packs"].([]any) {
		if p.(map[string]any)["currency"] != "chf" {
			t.Fatalf("AI pack %v", p)
		}
	}
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/ai-tokens", map[string]any{"tokens": 1_000_000}); code != http.StatusOK {
		t.Fatalf("buy pack: %d", code)
	}
	if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("currency") != "chf" || f.Get("line_items[0][price]") != "price_ai_1000000" {
		t.Fatalf("pack checkout form %v", f)
	}
	// Stripe never changes a customer's currency, so it is read once.
	e.overviewCurrency(owner)
	if n := e.stripe.called("GET /v1/customers/cus_" + owner.workspace); n != 1 {
		t.Fatalf("customer read %d times", n)
	}

	// A customer without a fixed currency yet (an abandoned Checkout) pays in its region's.
	other := e.workspaceIn("Europe/Vienna")
	if code, _ := e.do(other, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "year"}); code != http.StatusOK {
		t.Fatalf("checkout: %d", code)
	}
	if cur, _ := e.overviewCurrency(other); cur != "eur" {
		t.Fatalf("customer without a currency: %q", cur)
	}
}

func TestCatalogueWithoutCurrencyOptionsSellsInFrancs(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.mu.Lock()
	e.stripe.noOptions = true
	e.stripe.mu.Unlock()
	owner := e.workspaceIn("Europe/Berlin")
	if cur, pro := e.overviewCurrency(owner); cur != "chf" || pro["currency"] != "chf" || pro["amount"] != 4900.0 {
		t.Fatalf("overview %q %v", cur, pro)
	}
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("checkout: %d", code)
	}
	if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("currency") != "chf" {
		t.Fatalf("checkout currency %q", f.Get("currency"))
	}
}
