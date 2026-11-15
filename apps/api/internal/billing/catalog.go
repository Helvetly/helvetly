package billing

import (
	"fmt"

	"helvetly.com/api/internal/store"
)

// StripeCatalog is the part of a published offer the billing repository's catalogue tool puts into Stripe and checks
// Stripe against (`helvetly offer catalog`): each plan's price per person, its lookup keys, the currencies at the same
// figures, the tax behaviour and the per-seat mark. The offer is the one place the prices are kept.
type StripeCatalog struct {
	OfferID         string       `json:"offer_id"`
	Checksum        string       `json:"checksum"`
	Currency        string       `json:"currency"`
	CurrencyOptions []string     `json:"currency_options"`
	TaxBehavior     string       `json:"tax_behavior"`
	PricingKey      string       `json:"pricing_key"`
	PerSeat         string       `json:"per_seat"`
	Plans           []StripePlan `json:"plans"`
}

// StripePlan is one plan's prices per person in minor units (VAT included), by interval, with their lookup keys.
type StripePlan struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Amounts    map[string]int64  `json:"amounts"`     // month, year
	LookupKeys map[string]string `json:"lookup_keys"` // month, year
}

// ExportCatalog is the Stripe catalogue of a published offer, refused when the offer lacks a plan's price.
func ExportCatalog(v store.OfferVersion) (StripeCatalog, error) {
	o, err := LoadOffer(v)
	if err != nil {
		return StripeCatalog{}, err
	}
	c := StripeCatalog{OfferID: v.ID, Checksum: v.Checksum, Currency: Currency, CurrencyOptions: []string{EUR, USD},
		TaxBehavior: TaxBehavior, PricingKey: PricingKey, PerSeat: PerSeat}
	for _, id := range planOrder {
		p, ok := o.Billing.Plans[id]
		if !ok || p.MonthMinor <= 0 || p.YearMinor <= 0 {
			return StripeCatalog{}, fmt.Errorf("offer %s has no prices for %s", v.ID, id)
		}
		c.Plans = append(c.Plans, StripePlan{ID: id, Name: planNames[id],
			Amounts:    map[string]int64{"month": p.MonthMinor, "year": p.YearMinor},
			LookupKeys: map[string]string{"month": LookupKey(id, "month"), "year": LookupKey(id, "year")}})
	}
	return c, nil
}
