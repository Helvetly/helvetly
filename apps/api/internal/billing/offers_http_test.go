package billing

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestPublicCurrentOffer(t *testing.T) {
	e := newEnv(t, true)
	get := func(etag string) (*http.Response, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, e.srv.URL+"/api/v1/public/offers/current", nil)
		if etag != "" {
			req.Header.Set("If-None-Match", etag)
		}
		res, err := http.DefaultClient.Do(req) // no session, no cookies
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var body struct {
			Data map[string]any `json:"data"`
		}
		_ = json.NewDecoder(res.Body).Decode(&body)
		return res, body.Data
	}
	res, d := get("")
	etag := res.Header.Get("ETag")
	if res.StatusCode != http.StatusOK || d["offer_id"] != "helvetly-2026-11-v2" || !strings.Contains(etag, "helvetly-2026-11-v2:") ||
		res.Header.Get("Cache-Control") != "public, max-age=60" || res.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("%d %v %v", res.StatusCode, res.Header, d["offer_id"])
	}
	if d["price_per"] != "person" || d["tax_inclusive"] != true {
		t.Fatalf("price basis: %v %v", d["price_per"], d["tax_inclusive"])
	}
	want := map[string][2]float64{Basic: {1900, 18300}, Pro: {4900, 47100}, Business: {9900, 95100}}
	plans, _ := d["plans"].([]any)
	for _, p := range plans {
		p, _ := p.(map[string]any)
		prices, _ := p["prices"].(map[string]any)
		for _, cur := range []string{"CHF", "EUR", "USD"} {
			pr, _ := prices[cur].(map[string]any)
			if w := want[p["id"].(string)]; pr["month"] != w[0] || pr["year"] != w[1] {
				t.Errorf("%v in %s: %v", p["id"], cur, pr)
			}
		}
	}
	if len(plans) != 3 {
		t.Fatalf("plans: %v", plans)
	}
	rows, _ := d["comparison"].([]any)
	details, _ := d["usage_details"].([]any)
	limits, _ := d["limits"].(map[string]any)
	if len(rows) != 12 || len(details) != 11 {
		t.Fatalf("%d rows, %d allowances", len(rows), len(details))
	}
	raw, _ := json.Marshal(d)
	for _, hidden := range []string{"identity_security", "workspace_roles", "api_access", "ai_cost_usd_micros", "max_upload_bytes", "period_closing_audit", "rationale"} {
		if strings.Contains(string(raw), hidden) {
			t.Errorf("the public offer shows %s", hidden)
		}
	}
	included := map[string]map[string]any{}
	for _, r := range rows {
		r, _ := r.(map[string]any)
		included[r["key"].(string)], _ = r["plans"].(map[string]any)
	}
	for _, c := range []struct {
		row, plan string
		want      bool
	}{
		{"invoicing", Basic, true}, {"swiss_qr", Basic, true}, {"revolut", Basic, true}, {"expenses", Basic, false},
		{"expenses", Pro, true}, {"heidi", Basic, false}, {"heidi", Pro, true}, {"client_portal", Pro, false},
		{"client_portal", Business, true}, {"einvoice_xml", Pro, false}, {"ledger_exports", Pro, true}, {"automations", Basic, false},
	} {
		if included[c.row][c.plan] != c.want {
			t.Errorf("%s on %s: %v", c.row, c.plan, included[c.row][c.plan])
		}
	}
	limit := func(key, plan string) (perPerson bool, v map[string]any) {
		l, _ := limits[key].(map[string]any)
		ps, _ := l["plans"].(map[string]any)
		v, _ = ps[plan].(map[string]any)
		return l["per_person"] == true, v
	}
	if pp, v := limit("clients", Basic); pp || v["value"] != 30.0 || v["included"] != true {
		t.Errorf("clients: %v %v", pp, v)
	}
	if pp, v := limit("storage_bytes", Pro); !pp || v["value"] != 5e9 {
		t.Errorf("storage: %v %v", pp, v)
	}
	if _, v := limit("expenses_per_month", Basic); v["included"] != false {
		t.Errorf("basic expenses: %v", v)
	}
	if _, ok := limits["engagements"]; !ok {
		t.Error("a row's limit is missing from limits")
	}

	if res, _ := get(etag); res.StatusCode != http.StatusNotModified {
		t.Fatalf("If-None-Match: %d", res.StatusCode)
	}
	id := e.setPlanValueID(Pro, Clients, 400)
	if res, d := get(etag); res.StatusCode != http.StatusOK || d["offer_id"] != id || res.Header.Get("ETag") == etag {
		t.Fatalf("after publishing: %d %v", res.StatusCode, d["offer_id"])
	}
}

// setPlanValueID is setPlanValue for a limited value, answering the new offer's id.
func (e *env) setPlanValueID(plan string, key Limit, v int64) string {
	e.t.Helper()
	return e.publishVariant(func(o *Offer) { recordOf(o, string(key)).Values[plan] = OfferValue{State: StateLimited, Value: &v} })
}

func TestOverviewEntitlements(t *testing.T) {
	entitlements := func(t *testing.T, e *env, b *browser) (map[string]any, map[string]map[string]any) {
		t.Helper()
		code, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
		data, _ := body["data"].(map[string]any)
		if code != http.StatusOK {
			t.Fatalf("%d %v", code, body)
		}
		list, _ := data["entitlements"].([]any)
		out := map[string]map[string]any{}
		for _, x := range list {
			x, _ := x.(map[string]any)
			out[x["key"].(string)] = x
		}
		return data, out
	}
	t.Run("self-hosted", func(t *testing.T) {
		e := newEnv(t, false)
		data, items := entitlements(t, e, e.workspace())
		if data["entitlements"] != nil || data["offer_id"] != nil || len(items) != 0 {
			t.Fatalf("self-hosted: %v", data)
		}
	})
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_pm")
	e.exec(`UPDATE workspace_billing SET per_seat = true, seats = 2 WHERE workspace_id = $1`, b.workspace)
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('cli_1', $1, 1, 'C', now(), now())`, b.workspace)
	expires := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Second)
	e.override(b.workspace, Products, StateLimited, n64(260), &expires)
	data, items := entitlements(t, e, b)
	if data["offer_id"] != "helvetly-2026-11-v2" || len(items) != 65 {
		t.Fatalf("offer %v, %d entitlements", data["offer_id"], len(items))
	}
	if _, ok := items["ai_cost_usd_micros"]; ok {
		t.Fatal("the internal AI cost budget is shown")
	}
	if c := items["clients"]; c["value"] != 300.0 || c["used"] != 1.0 || c["per_seat"] != false || c["reset_at"] != nil || c["source"] != "plan" {
		t.Fatalf("clients: %v", c)
	}
	if s := items["storage_bytes"]; s["value"] != 1e10 || s["per_seat"] != true {
		t.Fatalf("storage for 2 seats: %v", s)
	}
	if i := items["invoices_per_month"]; i["value"] != 300.0 || i["reset_at"] == nil || i["period"] != "calendar_month_utc" {
		t.Fatalf("invoices: %v", i)
	}
	if a := items["automation_actions_per_month"]; a["value"] != 3000.0 || a["used"] != 0.0 || a["reset_at"] == nil {
		t.Fatalf("automation actions %v", a)
	}
	if p := items["products"]; p["value"] != 260.0 || p["source"] != "workspace" || p["expires_at"] != expires.Format(time.RFC3339) {
		t.Fatalf("override: %v", p)
	}
	if h := items["heidi"]; h["state"] != "enabled" || h["value"] != nil || h["used"] != nil {
		t.Fatalf("heidi: %v", h)
	}
	if p := items["client_portal"]; p["state"] != "disabled" {
		t.Fatalf("portal on pro: %v", p)
	}
	// The earlier fields stay for the deployed platform.
	usage, _ := data["usage"].([]any)
	if len(usage) != 9 || data["features"] == nil || data["plans"] == nil {
		t.Fatalf("earlier fields: %v", data)
	}
}
