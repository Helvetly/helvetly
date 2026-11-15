package billing

import (
	"context"
	"net/http"
	"net/url"
)

// The currencies plans and packs are sold in, with the same figures in each: CHF (Currency, the prices' own) in
// Switzerland and Liechtenstein, EUR in the EU, USD everywhere else. A price carries EUR and USD as Stripe
// currency_options (the catalogue tool sets them).
const (
	EUR = "eur"
	USD = "usd"
)

// regionCurrency is the currency of the time zones of Switzerland, Liechtenstein and the EU-27 (their outermost
// regions included); any other zone pays in USD.
var regionCurrency = map[string]string{
	"Europe/Zurich": Currency, "Europe/Vaduz": Currency,
	"Europe/Vienna": EUR, "Europe/Brussels": EUR, "Europe/Sofia": EUR, "Europe/Zagreb": EUR, "Asia/Nicosia": EUR,
	"Asia/Famagusta": EUR, "Europe/Nicosia": EUR, "Europe/Prague": EUR, "Europe/Copenhagen": EUR, "Europe/Tallinn": EUR,
	"Europe/Helsinki": EUR, "Europe/Mariehamn": EUR, "Europe/Paris": EUR, "Europe/Berlin": EUR, "Europe/Busingen": EUR,
	"Europe/Athens": EUR, "Europe/Budapest": EUR, "Europe/Dublin": EUR, "Europe/Rome": EUR, "Europe/Riga": EUR,
	"Europe/Vilnius": EUR, "Europe/Luxembourg": EUR, "Europe/Malta": EUR, "Europe/Amsterdam": EUR, "Europe/Warsaw": EUR,
	"Europe/Lisbon": EUR, "Atlantic/Madeira": EUR, "Atlantic/Azores": EUR, "Europe/Bucharest": EUR,
	"Europe/Bratislava": EUR, "Europe/Ljubljana": EUR, "Europe/Madrid": EUR, "Africa/Ceuta": EUR, "Atlantic/Canary": EUR,
	"Europe/Stockholm": EUR, "America/Cayenne": EUR, "America/Guadeloupe": EUR, "America/Martinique": EUR,
	"Indian/Reunion": EUR, "Indian/Mayotte": EUR,
}

// CurrencyOf is the currency a workspace in the IANA time zone tz pays in. The time zone is the workspace's own
// (set from the browser at sign-up), not the request's: the platform host is not behind Cloudflare, so a
// CF-IPCountry header there would be the client's to set.
func CurrencyOf(tz string) string {
	if c, ok := regionCurrency[tz]; ok {
		return c
	}
	return USD
}

// amountIn is what the price costs in cur, and whether it is sold in cur at all.
func (p price) amountIn(cur string) (int64, bool) {
	if cur == p.Currency {
		return p.UnitAmount, true
	}
	o, ok := p.CurrencyOptions[cur]
	return o.UnitAmount, ok
}

// offered is cur when every price is sold in it, else the prices' own currency: until the catalogue has the
// currency options everyone pays in CHF.
func offered(cur string, prices []price) string {
	for _, p := range prices {
		if _, ok := p.amountIn(cur); !ok {
			return Currency
		}
	}
	return cur
}

// currencyFor is the currency the workspace pays in: its Stripe customer's, once Stripe has fixed one (a customer is
// charged in one currency), else its region's.
func (s *Service) currencyFor(ctx context.Context, customerID, tz string) (string, error) {
	if customerID == "" || !s.enabled {
		return CurrencyOf(tz), nil
	}
	if cur, ok := s.customerCurrency.Load(customerID); ok {
		return cur.(string), nil
	}
	var c struct {
		Currency string `json:"currency"`
	}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/customers/"+url.PathEscape(customerID), nil, "", &c); err != nil {
		return "", err
	}
	if c.Currency == "" {
		return CurrencyOf(tz), nil // not fixed yet: read again next time
	}
	s.customerCurrency.Store(customerID, c.Currency) // Stripe never changes it once set
	return c.Currency, nil
}
