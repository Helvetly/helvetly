package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/store/storetest"
)

func TestOfferCommand(t *testing.T) {
	ctx := context.Background()
	db, raw := storetest.New(t)
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	run := func(args ...string) (string, error) {
		var out bytes.Buffer
		err := runOffer(ctx, db, args, &out, now)
		return out.String(), err
	}
	cur, err := db.CurrentOffer(ctx)
	if err != nil {
		t.Fatal(err)
	}
	o, err := billing.LoadOffer(cur)
	if err != nil {
		t.Fatal(err)
	}
	write := func(o billing.Offer) string {
		b, _ := json.Marshal(o)
		path := filepath.Join(t.TempDir(), "offer.json")
		if err := os.WriteFile(path, b, 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	o.ID = "helvetly-v3"
	for i, r := range o.Records {
		if r.Key == "clients" {
			v := int64(40)
			o.Records[i].Values[billing.Basic] = billing.OfferValue{State: billing.StateLimited, Value: &v}
		}
	}
	file := write(o)

	out, err := run("catalog")
	var c billing.StripeCatalog
	if err != nil || json.Unmarshal([]byte(out), &c) != nil || c.OfferID != "helvetly-v2-pro-trial" || len(c.Plans) != 3 ||
		c.Plans[1].Amounts["month"] != 4900 || c.Plans[1].Amounts["year"] != 47100 || c.Plans[2].LookupKeys["year"] != "helvetly_business_year" ||
		c.TaxBehavior != "inclusive" || strings.Join(c.CurrencyOptions, ",") != "eur,usd" {
		t.Fatalf("catalog: %q %v", out, err)
	}
	if _, err := run("catalog", "-offer", "nope"); err == nil {
		t.Fatal("catalog of an unknown offer")
	}
	if out, err := run("validate", file); err != nil || !strings.HasPrefix(out, "valid: helvetly-v3, 68 records") {
		t.Fatalf("validate: %q %v", out, err)
	}
	broken := o
	broken.Records = broken.Records[1:]
	if _, err := run("validate", write(broken)); err == nil || !strings.Contains(err.Error(), "identity_security: missing") {
		t.Fatalf("validate an incomplete offer: %v", err)
	}
	out, err = run("diff", file)
	if err != nil || !strings.Contains(out, "current helvetly-v2-pro-trial") || !strings.Contains(out, "clients.basic: limited 30 -> limited 40\n") {
		t.Fatalf("diff: %q %v", out, err)
	}
	if _, err := run("publish", file); err == nil {
		t.Fatal("published without an actor and a reason")
	}
	if out, err := run("publish", "-actor", "ops", "-reason", "more clients on Basic", file); err != nil || !strings.HasPrefix(out, "published helvetly-v3") {
		t.Fatalf("publish: %q %v", out, err)
	}
	if _, err := run("publish", "-actor", "ops", "-reason", "again", file); err == nil {
		t.Fatal("published the same offer twice")
	}

	if _, err := raw.Exec(ctx, `INSERT INTO workspaces (id, name, created_at) VALUES ('wsp_1', 'One', now())`); err != nil {
		t.Fatal(err)
	}
	set := []string{"override", "set", "-workspace", "wsp_1", "-key", "clients", "-limit", "55", "-expires", "2026-12-31T00:00:00Z", "-actor", "ops", "-reason", "pilot"}
	if out, err := run(set...); err != nil || out != "set clients for wsp_1: limited\n" {
		t.Fatalf("override set: %q %v", out, err)
	}
	if _, err := run("override", "set", "-workspace", "wsp_1", "-key", "clients", "-limit", "5", "-unlimited", "-actor", "ops", "-reason", "x"); err == nil {
		t.Fatal("two values at once")
	}
	if _, err := run("override", "set", "-workspace", "wsp_1", "-key", "clients", "-limit", "5", "-expires", "2026-11-01T00:00:00Z", "-actor", "ops", "-reason", "x"); err == nil {
		t.Fatal("an override that already expired")
	}
	if out, err := run("override", "clear", "-workspace", "wsp_1", "-key", "clients", "-actor", "ops", "-reason", "pilot over"); err != nil || !strings.HasPrefix(out, "cleared clients") {
		t.Fatalf("override clear: %q %v", out, err)
	}
	// Each write and its audit: the publication, then the override set and cleared, with before and after.
	rows, err := raw.Query(ctx, `SELECT action, target, coalesce(before::text, ''), coalesce(after::text, ''), reason FROM offer_audit
		WHERE actor = 'ops' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var action, target, before, after, reason string
		if err := rows.Scan(&action, &target, &before, &after, &reason); err != nil {
			t.Fatal(err)
		}
		got = append(got, action+" "+target+" "+reason+" before:"+before+" after:"+after)
	}
	if len(got) != 3 || !strings.HasPrefix(got[0], "offer.publish helvetly-v3 more clients on Basic before:{") ||
		!strings.HasPrefix(got[1], "limit.override.set wsp_1/helvetly-v3/clients pilot before: after:{") || !strings.Contains(got[1], `"value": 55`) ||
		!strings.HasPrefix(got[2], "limit.override.clear wsp_1/helvetly-v3/clients pilot over before:{") || !strings.HasSuffix(got[2], "after:") {
		t.Fatalf("audit:\n%s", strings.Join(got, "\n"))
	}
	if _, err := run("frobnicate"); err == nil || !strings.Contains(err.Error(), "usage:") {
		t.Fatalf("unknown command: %v", err)
	}
}
