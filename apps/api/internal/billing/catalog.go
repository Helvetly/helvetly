package billing

import (
	"fmt"
	"strconv"

	"helvetly.com/api/internal/store"
)

// StripeCatalog is the part of a published offer the billing repository's catalogue tool puts into Stripe and checks
// Stripe against (`helvetly offer catalog`): each plan's graduated tiered price by interval (a flat amount for the
// included people, then each further person), its lookup keys (versioned with the offer id, so an earlier offer's
// prices stay as they are), the currencies at the same figures, the tax behaviour and the per-seat mark (the
// subscription's quantity is the workspace's people). The offer is the one place the prices are kept.
type StripeCatalog struct {
	OfferID         string       `json:"offer_id"`
	Checksum        string       `json:"checksum"`
	Currency        string       `json:"currency"`
	CurrencyOptions []string     `json:"currency_options"`
	TaxBehavior     string       `json:"tax_behavior"`
	PricingKey      string       `json:"pricing_key"`
	PerSeat         string       `json:"per_seat"`
	BillingScheme   string       `json:"billing_scheme"` // tiered
	TiersMode       string       `json:"tiers_mode"`     // graduated
	Plans           []StripePlan `json:"plans"`
}

// StripePlan is one plan's prices in minor units (VAT included), by interval, with their lookup keys.
type StripePlan struct {
	ID             string                  `json:"id"`
	Name           string                  `json:"name"`
	IncludedPeople int64                   `json:"included_people"`
	Amounts        map[string]int64        `json:"amounts"`      // month, year: the price for the included people
	ExtraPerson    map[string]int64        `json:"extra_person"` // month, year: each further person
	Tiers          map[string][]StripeTier `json:"tiers"`        // month, year: as Stripe's tiers[] of the price
	LookupKeys     map[string]string       `json:"lookup_keys"`  // month, year
}

// StripeTier is one tier of a graduated price: UpTo people ("inf" for the last), each tier's flat amount plus its
// unit amount for every person in it.
type StripeTier struct {
	UpTo       string `json:"up_to"`
	FlatAmount int64  `json:"flat_amount"`
	UnitAmount int64  `json:"unit_amount"`
}

// ExportCatalog is the Stripe catalogue of a published offer, refused when the offer lacks a plan's price.
func ExportCatalog(v store.OfferVersion) (StripeCatalog, error) {
	o, err := LoadOffer(v)
	if err != nil {
		return StripeCatalog{}, err
	}
	c := StripeCatalog{OfferID: v.ID, Checksum: v.Checksum, Currency: Currency, CurrencyOptions: []string{EUR, USD},
		TaxBehavior: TaxBehavior, PricingKey: PricingKey, PerSeat: PerSeat, BillingScheme: "tiered", TiersMode: "graduated"}
	for _, id := range planOrder {
		p, ok := o.Billing.Plans[id]
		if !ok || p.MonthMinor <= 0 || p.YearMinor <= 0 || p.IncludedPeople < 1 || p.ExtraPersonMonthMinor <= 0 || p.ExtraPersonYearMinor <= 0 {
			return StripeCatalog{}, fmt.Errorf("offer %s has no tiered prices for %s", v.ID, id)
		}
		tiers := func(flat, extra int64) []StripeTier {
			return []StripeTier{{UpTo: strconv.FormatInt(p.IncludedPeople, 10), FlatAmount: flat}, {UpTo: "inf", UnitAmount: extra}}
		}
		c.Plans = append(c.Plans, StripePlan{ID: id, Name: planNames[id], IncludedPeople: p.IncludedPeople,
			Amounts:     map[string]int64{"month": p.MonthMinor, "year": p.YearMinor},
			ExtraPerson: map[string]int64{"month": p.ExtraPersonMonthMinor, "year": p.ExtraPersonYearMinor},
			Tiers: map[string][]StripeTier{"month": tiers(p.MonthMinor, p.ExtraPersonMonthMinor),
				"year": tiers(p.YearMinor, p.ExtraPersonYearMinor)},
			LookupKeys: map[string]string{"month": LookupKey(v.ID, id, "month"), "year": LookupKey(v.ID, id, "year")}})
	}
	return c, nil
}
