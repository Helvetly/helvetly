package billing

import (
	"context"
	"testing"
)

// TestOfferResetMigration: 00065 leaves one offer on sale, helvetly-v1, valid against the definitions, with its
// checksum, Free's values and the tiered prices of plans.go, and limit_plans rows for every plan of every record.
func TestOfferResetMigration(t *testing.T) {
	e := newEnv(t, false)
	ctx := context.Background()
	v, err := e.st.CurrentOffer(ctx)
	if err != nil {
		t.Fatal(err)
	}
	o := e.currentOffer()
	defs, err := e.st.LimitDefs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := o.Validate(defs); err != nil {
		t.Fatalf("helvetly-v1 is not valid: %v", err)
	}
	if v.ID != "helvetly-v1" || v.Checksum != o.Checksum() {
		t.Fatalf("offer %s checksum %s, want helvetly-v1 with %s", v.ID, v.Checksum, o.Checksum())
	}
	var offers, rows int
	e.scan(`SELECT count(*) FROM offer_versions`, &offers)
	e.scan(`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v1'`, &rows)
	if offers != 1 || rows != len(o.Records)*len(offerPlans) {
		t.Fatalf("%d offers and %d limit_plans rows, want 1 and %d", offers, rows, len(o.Records)*len(offerPlans))
	}
	if o.Trial.Days != 14 || o.Trial.AccessPlan != Pro {
		t.Fatalf("trial %+v, want 14 days of Pro", o.Trial)
	}
}

func (e *env) scan(sql string, dest ...any) {
	e.t.Helper()
	if err := e.raw.QueryRow(context.Background(), sql).Scan(dest...); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
}
