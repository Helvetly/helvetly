package billing

import (
	"context"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestGuardCountsCopiedFileSize(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	e.exec(`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
		VALUES ('doc_copy', $1, 'big.pdf', $2, 'application/pdf', 'key', now(), now())`, b.workspace, int64(10*gb)-100)
	if code, body := e.do(b, http.MethodPost, "/api/v1/documents/doc_copy/copy", map[string]any{}); code != http.StatusPaymentRequired {
		t.Fatalf("copy beyond quota: %d %v", code, body)
	}
}

func TestGuardRefusesUnknownUploadSize(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	// Hiding the concrete reader makes net/http send a chunked request with no Content-Length.
	req, err := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/documents", struct{ io.Reader }{strings.NewReader("file")})
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusLengthRequired {
		t.Fatalf("unknown upload size: %d, want 411", res.StatusCode)
	}
}

func TestFitsCannotOverflow(t *testing.T) {
	if fits(1, math.MaxInt64, 100) {
		t.Fatal("an overflowing size bypassed the limit")
	}
}

func TestPersonalAccountDoesNotRequireWorkspacePlan(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodDelete} {
		if readOnlyWithoutPlan(httptest.NewRequest(method, "/api/v1/account", nil)) {
			t.Fatalf("%s personal account was trapped by workspace billing", method)
		}
	}
	if !readOnlyWithoutPlan(httptest.NewRequest(http.MethodPatch, "/api/v1/accounting", nil)) {
		t.Fatal("account prefix exempted an unrelated workspace route")
	}
}

func TestInvoiceAllowed(t *testing.T) {
	allowed := func(t *testing.T, e *env, ws store.Workspace) bool {
		ok, err := e.svc.InvoiceAllowed(context.Background(), ws)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}
	t.Run("billing disabled", func(t *testing.T) {
		e := newEnv(t, false)
		if !allowed(t, e, store.Workspace{ID: e.workspace().workspace, Timezone: "UTC"}) {
			t.Fatal("without billing a workspace may not invoice")
		}
	})
	e := newEnv(t, true)
	ws := store.Workspace{ID: e.workspace().workspace, Timezone: "UTC"}
	if allowed(t, e, ws) {
		t.Fatal("a workspace without a plan may invoice")
	}
	e.subscribe(ws.ID, "price_bm")
	if !allowed(t, e, ws) {
		t.Fatal("Basic under the cap may not invoice")
	}
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('cli_0', $1, 1, 'C', now(), now())`, ws.ID)
	e.exec(`INSERT INTO invoices (id, workspace_id, kind, status, client_id, issue_date, due_date, currency, language, vat_mode,
			discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, created_at, updated_at)
		SELECT 'inv_' || i, $1, 'invoice', 'draft', 'cli_0', current_date, current_date, 'CHF', 'de', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now()
		FROM generate_series(1, 100) AS i`, ws.ID)
	if allowed(t, e, ws) {
		t.Fatal("Basic at 100 invoices this month may invoice")
	}
}

func TestGuardNewLimits(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	for i := range 25 { // Basic's catalogue is full at 25 entries
		e.exec(`INSERT INTO products (id, workspace_id, type, name, price_basis, unit_price, currency, vat_category, vat_rate,
			created_at, updated_at) VALUES ($1, $2, 'service', 'S', 'net', 100, 'CHF', 'S', 810, now(), now())`,
			"prd_"+string(rune('a'+i)), b.workspace)
	}
	e.exec(`UPDATE plan_limits SET max_value = 0 WHERE plan = 'basic' AND limit_key IN ('engagements', 'signatures_per_month')`)
	plans, err := loadPlanLimits(context.Background(), e.st)
	if err != nil {
		t.Fatal(err)
	}
	e.svc.plans = plans
	for path, limit := range map[string]Limit{
		"/api/v1/products": Products, "/api/v1/products/prd_a/duplicate": Products,
		"/api/v1/engagements": Engagements, "/api/v1/engagements/eng_1/renew": Engagements, "/api/v1/engagements/eng_1/resume": Engagements,
		"/api/v1/signatures": Signatures,
	} {
		code, body := e.do(b, http.MethodPost, path, map[string]any{})
		errBody, _ := body["error"].(map[string]any)
		details, _ := errBody["details"].(map[string]any)
		if code != http.StatusPaymentRequired || details["limit"] != string(limit) {
			t.Fatalf("POST %s: %d %v", path, code, body)
		}
	}
	// Deleting an entry makes room again.
	e.exec(`UPDATE products SET deleted_at = now() WHERE id = 'prd_a'`)
	if code, body := e.do(b, http.MethodPost, "/api/v1/products", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("after a delete: %d %v", code, body)
	}
}

func TestLoadPlanLimitsRefusesAGap(t *testing.T) {
	e := newEnv(t, true)
	if p, err := loadPlanLimits(context.Background(), e.st); err != nil || p.of(Basic, Members) != 2 || p.of(Business, Clients) != Unlimited {
		t.Fatalf("seeded limits: %v %v", p, err)
	}
	e.exec(`DELETE FROM plan_limits WHERE plan = 'pro' AND limit_key = 'products'`)
	if _, err := loadPlanLimits(context.Background(), e.st); err == nil || !strings.Contains(err.Error(), "products limit for the pro plan") {
		t.Fatalf("missing row: %v", err)
	}
}
