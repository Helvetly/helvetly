package engagements

import (
	"slices"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

func TestAttentionToInvoiceNeedsAPrice(t *testing.T) {
	v := EngagementView{periods: []PeriodSummary{{State: "current"}}}
	for _, tc := range []struct {
		price invoicecalc.Money
		want  bool
	}{{9000, true}, {0, false}} {
		e := store.Engagement{Billing: "advance", UnitPrice: tc.price}
		if got := slices.Contains(attention(e, v), "to_invoice"); got != tc.want {
			t.Errorf("price %d: to_invoice = %v, want %v", tc.price, got, tc.want)
		}
	}
}
