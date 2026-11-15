package billing

import (
	"context"
	"encoding/json"
	"flag"
	"os"
	"reflect"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the website's public offer golden file")

// The website builds its pricing pages from apps/web/src/lib/plans.ts and only shows prices when the API's public
// offer has the same values; its offer.test.ts compares plans.ts with this file, so a change on either side fails.
const publicOfferGolden = "../../../web/src/lib/public-offer.golden.json"

func TestPublicOfferGolden(t *testing.T) {
	e := newEnv(t, false)
	v, err := e.st.CurrentOffer(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	d := publicOffer(e.currentOffer(), v)
	for _, k := range []string{"offer_id", "schema_version", "checksum", "published_at"} { // identity, not values
		delete(d, k)
	}
	got, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if *update {
		if err := os.WriteFile(publicOfferGolden, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(publicOfferGolden)
	if err != nil {
		t.Fatalf("%v (run with -update to create it)", err)
	}
	// Compared as JSON values: oxfmt formats the checked-in file.
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatalf("%s: %v", publicOfferGolden, err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("the public offer differs from %s; run with -update (then oxfmt it) after checking the diff, and align apps/web/src/lib/plans.ts:\n%s", publicOfferGolden, got)
	}
}
