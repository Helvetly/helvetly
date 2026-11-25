package billing

import (
	"context"
	"testing"
)

// TestOfferResetMigration: 00065 publishes helvetly-v1 with its checksum, a trial and limit rows for all plans.
func TestOfferResetMigration(t *testing.T) {
	e := newEnv(t, false)
	ctx := context.Background()
	v, err := e.st.Offer(ctx, "helvetly-v1")
	if err != nil {
		t.Fatal(err)
	}
	o, err := LoadOffer(v)
	if err != nil {
		t.Fatal(err)
	}
	if v.ID != "helvetly-v1" || v.Checksum != o.Checksum() {
		t.Fatalf("offer %s checksum %s, want helvetly-v1 with %s", v.ID, v.Checksum, o.Checksum())
	}
	var rows int
	e.scan(`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v1'`, &rows)
	if rows != len(o.Records)*len(offerPlans) {
		t.Fatalf("%d limit_plans rows, want %d", rows, len(o.Records)*len(offerPlans))
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
