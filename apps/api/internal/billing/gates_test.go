package billing_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mcp"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// requiredPlan is offer v2's access matrix for the gated features: the cheapest plan with each.
var requiredPlan = map[string]string{
	store.FeatureHeidi: billing.Pro, store.FeatureDocumentTemplates: billing.Pro, store.FeatureSimpleSignatures: billing.Pro,
	store.FeatureVATReturns: billing.Pro, store.FeatureInvoiceCorrections: billing.Pro, store.FeatureExpenses: billing.Pro,
	store.FeatureLedgerExports: billing.Pro, store.FeatureDataExport: billing.Pro, store.FeatureAutomations: billing.Pro,
	store.FeatureInvoiceReminders: billing.Pro, store.FeatureInvoiceInstalments: billing.Pro,
	store.FeatureEngagementAutomation: billing.Pro, store.FeatureClientPortal: billing.Business,
	store.FeatureEInvoiceXML: billing.Business,
}

var rank = map[string]int{billing.Basic: 0, billing.Pro: 1, billing.Business: 2}

type caller struct{ workspace, cookie, csrf, token string }

// newGateEnv serves the guard as main does (MCP tool calls go back through it) in front of handlers that answer 2xx,
// so a 2xx means the request got past the plan.
func newGateEnv(t *testing.T) (*store.Store, *httptest.Server, func(plan string) caller) {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	cfg := config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32), SessionTTL: time.Hour,
		Stripe: config.Stripe{SecretKey: "sk_test_x"}}
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(cfg, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	a.BearerRoutes = openapi.BearerRoutes("POST /api/mcp")
	billingtest.Wire(t, st)
	svc, err := billing.New(context.Background(), st, a, cfg, discard) // the guard reads the session; the gate is the same
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	m := mcp.New(a, openapi.Operations)
	m.Register(mux)
	mux.HandleFunc("POST /api/v1/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	for _, method := range []string{"GET", "PATCH", "PUT", "DELETE"} {
		mux.HandleFunc(method+" /api/v1/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	}
	guarded := svc.Guard(mux)
	m.SetAPI(guarded)
	srv := httptest.NewServer(guarded)
	t.Cleanup(srv.Close)
	ctx := context.Background()
	return st, srv, func(plan string) caller {
		t.Helper()
		ws, now := auth.NewID("wsp"), time.Now()
		u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
		c := caller{workspace: ws, cookie: rand.Text(), csrf: rand.Text(), token: "hvt_" + rand.Text()}
		cookie, token := sha256.Sum256([]byte(c.cookie)), sha256.Sum256([]byte(c.token))
		for _, err := range []error{
			st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Acme"}, "UTC", now),
			st.CreateUser(ctx, u, now),
			st.AddMember(ctx, ws, u.ID, "owner", now),
			st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(cookie[:]), c.csrf, u.ID, ws, now, now.Add(time.Hour)),
		} {
			if err != nil {
				t.Fatal(err)
			}
		}
		if _, err := raw.Exec(ctx, `INSERT INTO api_tokens (id, user_id, workspace_id, name, scopes, token_hash, prefix, created_at)
			VALUES ($1, $2, $3, 'ci', '{read:*,write:*}', $4, $5, now())`, auth.NewID("tok"), u.ID, ws, hex.EncodeToString(token[:]), c.token[:8]); err != nil {
			t.Fatal(err)
		}
		if plan != "" {
			billingtest.On(t, st, ws, plan)
		}
		return c
	}
}

func call(t *testing.T, srv *httptest.Server, c caller, bearer bool, method, path string, body any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, srv.URL+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if bearer {
		req.Header.Set("Authorization", "Bearer "+c.token)
	} else {
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: c.cookie})
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

var pathParam = regexp.MustCompile(`\{[a-z_]+\}`)

// TestGatedRoutesByPlan: every gated route on Basic, Pro and Business, through a browser session and, where the public
// catalogue has the operation, an API token. A plan without the feature answers 403 feature_not_in_plan naming the
// cheapest plan with it (the offer's matrix); one with it gets past the guard. API tokens keep 402 plan_required.
func TestGatedRoutesByPlan(t *testing.T) {
	_, srv, workspace := newGateEnv(t)
	public := map[string]bool{}
	for _, op := range openapi.Operations {
		public[op.Method+" "+op.Path] = true
	}
	refused := map[bool]int{} // by bearer
	for _, plan := range []string{billing.Basic, billing.Pro, billing.Business} {
		c := workspace(plan)
		for pattern, feature := range billing.GatedRoutes() {
			if feature == billing.APIAccess {
				continue
			}
			need, ok := requiredPlan[string(feature)]
			if !ok {
				t.Fatalf("%s: gated by %s, which the matrix does not list", pattern, feature)
			}
			method, path, _ := strings.Cut(pattern, " ")
			path = pathParam.ReplaceAllString(path, "x1")
			for _, bearer := range []bool{false, true} {
				if bearer && !public[pattern] {
					continue
				}
				code, body := call(t, srv, c, bearer, method, path, map[string]any{})
				if rank[plan] >= rank[need] {
					if code >= 400 {
						t.Errorf("%s on %s (bearer %v): %d %v", pattern, plan, bearer, code, body)
					}
					continue
				}
				refused[bearer]++
				e, _ := body["error"].(map[string]any)
				d, _ := e["details"].(map[string]any)
				if code != http.StatusForbidden || e["code"] != "feature_not_in_plan" || d["feature"] != string(feature) ||
					d["plan"] != plan || d["required_plan"] != need {
					t.Errorf("%s on %s (bearer %v): %d %v", pattern, plan, bearer, code, body)
				}
			}
		}
	}
	// Basic and Pro together refuse every gated route once at least; the token reaches the public ones.
	if refused[false] < len(billing.GatedRoutes())-1 || refused[true] < 15 {
		t.Fatalf("refusals: session %d, token %d of %d routes", refused[false], refused[true], len(billing.GatedRoutes()))
	}
	// No plan: the workspace is read-only, the plan answer, not a module.
	none := workspace("")
	if code, body := call(t, srv, none, false, http.MethodGet, "/api/v1/ledger", nil); code != http.StatusPaymentRequired {
		t.Fatalf("no plan: %d %v", code, body)
	}
	// Token creation keeps the answer clients knew before the offer.
	basic := workspace(billing.Basic)
	if code, body := call(t, srv, basic, false, http.MethodPost, "/api/v1/account/tokens", map[string]any{}); code != http.StatusPaymentRequired ||
		body["error"].(map[string]any)["code"] != "plan_required" {
		t.Fatalf("token on Basic: %d %v", code, body)
	}
}

// TestGatesFollowTheWorkspace: one person in a Basic and a Business workspace gets each workspace's answer, through
// the session, the API token and an MCP tool call; the readers of what Basic already has are never gated.
func TestGatesFollowTheWorkspace(t *testing.T) {
	_, srv, workspace := newGateEnv(t)
	basic, business := workspace(billing.Basic), workspace(billing.Business)
	for _, c := range []caller{basic, business} {
		want := http.StatusCreated
		if c == basic {
			want = http.StatusForbidden
		}
		if code, _ := call(t, srv, c, true, http.MethodPost, "/api/v1/expenses", map[string]any{}); code != want {
			t.Errorf("expenses through a token: %d, want %d", code, want)
		}
		got := mcpCall(t, srv, c, http.MethodPost, "/api/v1/expenses")
		if isError, _ := got["isError"].(bool); isError != (c == basic) {
			t.Errorf("expenses through MCP: %v", got)
		}
		if c == basic && !strings.Contains(textOf(got), "feature_not_in_plan") {
			t.Errorf("MCP refusal: %v", got)
		}
	}
	for _, path := range []string{"/api/v1/expenses", "/api/v1/signatures", "/api/v1/templates", "/api/v1/heidi/conversations",
		"/api/v1/invoices/x1/transmissions", "/api/v1/expenses/x1/receipts/x2"} {
		if code, body := call(t, srv, basic, false, http.MethodGet, path, nil); code != http.StatusOK {
			t.Errorf("GET %s on Basic: %d %v", path, code, body)
		}
	}
	for _, path := range []string{"/api/v1/expenses/x1", "/api/v1/templates/x1", "/api/v1/documents/x1/shares"} {
		if code, body := call(t, srv, basic, false, http.MethodDelete, path, nil); code != http.StatusOK {
			t.Errorf("DELETE %s on Basic: %d %v", path, code, body)
		}
	}
}

func mcpCall(t *testing.T, srv *httptest.Server, c caller, method, path string) map[string]any {
	t.Helper()
	name := ""
	for _, op := range openapi.Operations {
		if op.Method == method && op.Path == path {
			name = op.ID
		}
	}
	if name == "" {
		t.Fatalf("no operation %s %s", method, path)
	}
	code, body := call(t, srv, c, true, http.MethodPost, "/api/mcp", map[string]any{"jsonrpc": "2.0", "id": 1,
		"method": "tools/call", "params": map[string]any{"name": name, "arguments": map[string]any{"body": map[string]any{}}}})
	result, _ := body["result"].(map[string]any)
	if code != http.StatusOK || result == nil {
		t.Fatalf("mcp %s: %d %v", name, code, body)
	}
	return result
}

func textOf(result map[string]any) string {
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		return ""
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	return text
}
