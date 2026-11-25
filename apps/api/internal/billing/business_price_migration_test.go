package billing

import (
	"context"
	"reflect"
	"testing"
)

func TestBusinessEntryPriceOffer(t *testing.T) {
	e := newEnv(t, false)
	ctx := context.Background()
	oldVersion, err := e.st.Offer(ctx, "helvetly-v1")
	if err != nil {
		t.Fatal(err)
	}
	newVersion, err := e.st.CurrentOffer(ctx)
	if err != nil {
		t.Fatal(err)
	}

	old, err := LoadOffer(oldVersion)
	if err != nil {
		t.Fatal(err)
	}
	next, err := LoadOffer(newVersion)
	if err != nil {
		t.Fatal(err)
	}
	defs, err := e.st.LimitDefs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := next.Validate(defs); err != nil {
		t.Fatal(err)
	}
	if next.ID != currentOffer || newVersion.Checksum != next.Checksum() {
		t.Fatalf("offer %s: stored checksum %s, computed %s", next.ID, newVersion.Checksum, next.Checksum())
	}

	p := old.Billing.Plans[Business]
	if p.MonthMinor != 14900 || p.YearMinor != 143100 {
		t.Fatalf("original Business terms changed: %+v", p)
	}
	p.MonthMinor, p.YearMinor = 9900, 95100
	old.ID = next.ID
	old.Billing.Plans[Business] = p
	if !reflect.DeepEqual(old, next) {
		t.Fatal("published terms differ beyond the Business base prices")
	}
	oldLimits, err := e.st.OfferPlanValues(ctx, oldVersion.ID)
	if err != nil {
		t.Fatal(err)
	}
	newLimits, err := e.st.OfferPlanValues(ctx, newVersion.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(oldLimits, newLimits) {
		t.Fatal("published offer changed plan limits")
	}
}
