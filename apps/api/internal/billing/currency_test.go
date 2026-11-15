package billing

import (
	"net/http"
	"testing"
)

func TestCurrencyOf(t *testing.T) {
	for _, tt := range []struct {
		country string
		zones   []string
		want    string
	}{
		{"CH", nil, "chf"},
		{"LI", []string{"America/New_York"}, "chf"}, // the country wins over the time zone
		{"DE", []string{"Europe/Zurich"}, "eur"},
		{"FR", nil, "eur"},
		{"RE", nil, "eur"}, // Réunion, an outermost region
		{"GB", []string{"Europe/Berlin"}, "usd"},
		{"NO", nil, "usd"},
		{"MC", nil, "usd"}, // pays in euros, not in the EU
		{"US", nil, "usd"},
		// No country from Cloudflare: the workspace's time zone.
		{"", []string{"Europe/Zurich"}, "chf"},
		{"", []string{"Europe/Vaduz"}, "chf"},
		{"", []string{"Europe/Berlin"}, "eur"},
		{"", []string{"Europe/Busingen"}, "eur"}, // German, on Swiss time
		{"", []string{"Atlantic/Canary"}, "eur"},
		{"", []string{"Asia/Nicosia"}, "eur"},
		{"", []string{"America/Marigot"}, "eur"}, // Saint-Martin
		{"", []string{"Europe/London"}, "usd"},
		{"", []string{"Europe/Monaco"}, "usd"},
		{"", []string{"UTC"}, "usd"},
		{"", []string{""}, "usd"},
		{"", nil, "usd"},
		// A workspace zone that says nothing gives way to the page's; one that says something wins.
		{"", []string{"UTC", "Europe/Berlin"}, "eur"},
		{"", []string{"Etc/UTC", "Europe/Zurich"}, "chf"},
		{"", []string{"", "Europe/Vienna"}, "eur"},
		{"", []string{"America/New_York", "Europe/Berlin"}, "usd"},
		{"", []string{"Europe/Zurich", "Europe/Berlin"}, "chf"},
	} {
		if got := CurrencyOf(tt.country, tt.zones...); got != tt.want {
			t.Errorf("CurrencyOf(%q, %q) = %q, want %q", tt.country, tt.zones, got, tt.want)
		}
	}
}

func TestSoldOnlyInItsCurrencies(t *testing.T) {
	withOptions := price{Currency: "chf", UnitAmount: 1900, CurrencyOptions: map[string]struct {
		UnitAmount int64 `json:"unit_amount"`
	}{EUR: {1900}, USD: {1900}}}
	chfOnly := price{Currency: "chf", UnitAmount: 1900}
	for _, tt := range []struct {
		name string
		p    price
		cur  string
		ok   bool
	}{
		{"own currency", chfOnly, Currency, true},
		{"a currency option", withOptions, USD, true},
		{"no option: no francs fallback", chfOnly, EUR, false},
		{"a currency no price has", withOptions, "gbp", false},
	} {
		if amount, ok := tt.p.amountIn(tt.cur); ok != tt.ok || (ok && amount != 1900) {
			t.Errorf("%s: amountIn = %d %v", tt.name, amount, ok)
		}
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

func TestCountryFromCloudflare(t *testing.T) {
	e := newEnv(t, true)
	for _, tt := range []struct {
		name, tz, country string
		via               bool
		want              string
	}{
		{"Swiss visitor, US time zone", "America/New_York", "CH", true, "chf"},
		{"German visitor, Swiss time zone", "Europe/Zurich", "DE", true, "eur"},
		{"British visitor, German time zone", "Europe/Berlin", "GB", true, "usd"},
		{"Cloudflare does not know the country", "Europe/Berlin", "XX", true, "eur"},
		{"Tor through Cloudflare", "Europe/Zurich", "T1", true, "chf"},
		// The header straight from the client, not through Cloudflare's edge, is dropped: the time zone decides.
		{"forged header", "Europe/Berlin", "CH", false, "eur"},
	} {
		b := e.workspaceIn(tt.tz).viaCloudflare(tt.country)
		if !tt.via {
			b.header.Set("X-Forwarded-For", "203.0.113.9")
		}
		if cur, pro := e.overviewCurrency(b); cur != tt.want || pro["currency"] != tt.want {
			t.Fatalf("%s: overview %q, Pro %v", tt.name, cur, pro)
		}
		if code, _ := e.do(b, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
			t.Fatalf("%s: checkout %d", tt.name, code)
		}
		if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("currency") != tt.want {
			t.Fatalf("%s: checkout currency %q", tt.name, f.Get("currency"))
		}
	}
}

func TestExistingCustomerKeepsItsCurrency(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspaceIn("Europe/Berlin").viaCloudflare("DE")
	e.subscribe(owner.workspace, "price_bm")
	e.stripe.mu.Lock()
	e.stripe.currency["cus_"+owner.workspace] = "chf" // Stripe fixed the customer to francs with its first subscription
	e.stripe.mu.Unlock()

	cur, pro := e.overviewCurrency(owner)
	if cur != "chf" || pro["currency"] != "chf" {
		t.Fatalf("a francs customer in Germany sees %q, Pro %v", cur, pro)
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

func TestCatalogueWithoutCurrencyOptionsSellsOnlyInFrancs(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.mu.Lock()
	e.stripe.noOptions = true
	e.stripe.mu.Unlock()
	owner := e.workspaceIn("Europe/Berlin")
	e.subscribe(owner.workspace, "price_bm")
	code, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	pro, _ := data["plans"].([]any)[1].(map[string]any)["prices"].(map[string]any)
	if packs, _ := data["ai_packs"].([]any); code != http.StatusOK || data["currency"] != "eur" || pro["month"] != nil || len(packs) != 0 {
		t.Fatalf("overview: %d %v", code, body)
	}
	code, body = e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"})
	if errBody, _ := body["error"].(map[string]any); code != http.StatusConflict || errBody["code"] != "plan_unavailable" {
		t.Fatalf("checkout: %d %v", code, body)
	}
	if n := e.stripe.called("POST /v1/checkout/sessions"); n != 0 {
		t.Fatalf("Checkout sessions made: %d", n)
	}
	// In francs everything is on sale.
	swiss := e.workspaceIn("Europe/Zurich")
	if cur, pro := e.overviewCurrency(swiss); cur != "chf" || pro["amount"] != 4900.0 {
		t.Fatalf("overview in francs %q %v", cur, pro)
	}
}

func TestPageZoneWhenTheWorkspaceZoneSaysNothing(t *testing.T) {
	e := newEnv(t, true)
	for _, tt := range []struct{ tz, page, want string }{
		{"UTC", "Europe/Berlin", "eur"},
		{"UTC", "", "usd"},
		{"Europe/Zurich", "Europe/Berlin", "chf"},
	} {
		owner := e.workspaceIn(tt.tz)
		code, body := e.do(owner, http.MethodGet, "/api/v1/billing?tz="+tt.page, nil)
		if data, _ := body["data"].(map[string]any); code != http.StatusOK || data["currency"] != tt.want {
			t.Fatalf("%s + %s: %d %v", tt.tz, tt.page, code, body)
		}
		if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout?tz="+tt.page, map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
			t.Fatalf("checkout %d", code)
		}
		if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("currency") != tt.want {
			t.Fatalf("%s + %s: checkout currency %q", tt.tz, tt.page, f.Get("currency"))
		}
	}
}
