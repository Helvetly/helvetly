package mcp_test

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
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/books"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/dashboard"
	"helvetly.com/api/internal/dataexport"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/dunning"
	"helvetly.com/api/internal/einvoice"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/feedback"
	"helvetly.com/api/internal/heidi"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/instalments"
	"helvetly.com/api/internal/invitations"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/ledger"
	"helvetly.com/api/internal/mcp"
	"helvetly.com/api/internal/members"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/products"
	"helvetly.com/api/internal/quotes"
	"helvetly.com/api/internal/server"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
	"helvetly.com/api/internal/templates"
	"helvetly.com/api/internal/vatreturn"
	"helvetly.com/api/internal/workspaces"
)

type env struct {
	t   *testing.T
	st  *store.Store
	srv *httptest.Server
}

// newEnv serves the real auth, scope guard, every catalogued service, the spec and the MCP handlers, wired as in
// main (without storage or mail).
func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, log)
	if err != nil {
		t.Fatal(err)
	}
	a.BearerRoutes = openapi.BearerRoutes("POST /api/mcp")
	m := mcp.New(a, openapi.Operations)
	billingSvc, err := billing.New(context.Background(), st, a, config.Config{}, log)
	if err != nil {
		t.Fatal(err)
	}
	h := permissions.Guard(a, server.New(http.NotFoundHandler(), func(mux *http.ServeMux) {
		a.Register(mux)
		clients.New(st, a, &memStorage{objects: map[string][]byte{}}, log).Register(mux)
		inv := invoices.New(st, a, nil, nil, log)
		inv.Register(mux)
		dashboard.New(st, a).Register(mux)
		quotes.New(st, a, inv, nil, nil, log).Register(mux)
		products.New(st, a, log).Register(mux)
		expenses.New(st, a, nil, log).Register(mux)
		documents.New(st, a, nil, 10<<20, log).Register(mux)
		engagements.New(st, a, inv, log).Register(mux)
		instalments.New(st, a, inv, nil, log).Register(mux)
		dunning.New(st, a, inv, nil, log).Register(mux)
		books.New(st, a).Register(mux)
		ledger.New(st, a).Register(mux)
		vatreturn.New(st, a).Register(mux)
		einvoice.New(st, a, nil).Register(mux)
		// left out of the catalogue: served so the scope tests reach their real patterns
		members.New(st, a, log).Register(mux)
		invitations.New(st, a, nil, "", log).Register(mux)
		notifications.New(st, a, nil, "", bytes.Repeat([]byte{7}, 32), log).Register(mux)
		dataexport.New(st, a, nil, log).Register(mux)
		workspaces.New(st, a, nil, nil, log).Register(mux)
		feedback.New(st, a, nil, nil, "", log).Register(mux)
		signatures.New(st, a, nil, nil, "", log).Register(mux)
		templates.New(st, a, nil, nil, nil, log).Register(mux)
		heidi.New(st, a, nil, nil, heidi.Options{}).Register(mux)
		imports.New(st, a, nil, log, imports.Options{}).Register(mux)
		billingSvc.Register(mux)
		openapi.Register(mux)
		m.Register(mux)
	}))
	m.SetAPI(h)
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, srv: srv}
}

// person joins a new or given workspace with a role and returns an API token of the scope.
func (e *env) person(ws, role string, scopes []string, tokenScopes ...string) (workspace, token string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now().UTC()
	if ws == "" {
		ws = auth.NewID("wsp")
		if err := e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "WS " + ws}, "Europe/Zurich", now); err != nil {
			e.t.Fatal(err)
		}
	}
	user := auth.NewID("usr")
	token = "hvt_" + rand.Text()
	sum := sha256.Sum256([]byte(token))
	if err := e.st.CreateUser(ctx, store.User{ID: user, Email: strings.ToLower(rand.Text()) + "@example.com"}, now); err != nil {
		e.t.Fatal(err)
	}
	if err := e.st.JoinMember(ctx, ws, user, role, scopes, now); err != nil {
		e.t.Fatal(err)
	}
	ok, err := e.st.CreateAPIToken(ctx, store.APIToken{ID: auth.NewID("tok"), Name: "test", Scopes: tokenScopes, Prefix: token[:8],
		Workspace: store.TokenSpace{ID: ws}, CreatedAt: now}, user, hex.EncodeToString(sum[:]))
	if err != nil || !ok {
		e.t.Fatal(ok, err)
	}
	return ws, token
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// rpc posts one JSON-RPC message with the token and returns the HTTP status and the decoded answer.
func (e *env) rpc(token string, msg map[string]any) (int, rpcResponse) {
	e.t.Helper()
	raw, _ := json.Marshal(msg)
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/mcp", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out rpcResponse
	body, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(body, &out)
	return res.StatusCode, out
}

type toolResult struct {
	Content []struct{ Text string } `json:"content"`
	IsError bool                    `json:"isError"`
}

func (e *env) call(token, name string, args map[string]any) toolResult {
	e.t.Helper()
	status, res := e.rpc(token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": name, "arguments": args}})
	if status != 200 || res.Error != nil {
		e.t.Fatalf("%s: %d %+v", name, status, res.Error)
	}
	var out toolResult
	if err := json.Unmarshal(res.Result, &out); err != nil || len(out.Content) != 1 {
		e.t.Fatalf("%s: %s", name, res.Result)
	}
	return out
}

func (e *env) tools(token string) map[string]map[string]any {
	e.t.Helper()
	_, res := e.rpc(token, map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
	var out struct{ Tools []map[string]any }
	if err := json.Unmarshal(res.Result, &out); err != nil {
		e.t.Fatal(err)
	}
	byName := map[string]map[string]any{}
	for _, tl := range out.Tools {
		byName[tl["name"].(string)] = tl
	}
	return byName
}

func TestProtocol(t *testing.T) {
	e := newEnv(t)
	_, token := e.person("", "owner", nil, "read:*")

	status, res := e.rpc(token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize",
		"params": map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "t", "version": "1"}}})
	var init struct {
		ProtocolVersion string         `json:"protocolVersion"`
		Capabilities    map[string]any `json:"capabilities"`
		ServerInfo      struct{ Name string }
	}
	if status != 200 || json.Unmarshal(res.Result, &init) != nil || init.ProtocolVersion != "2025-06-18" ||
		init.ServerInfo.Name != "helvetly" || init.Capabilities["tools"] == nil {
		t.Fatalf("initialize: %d %s", status, res.Result)
	}
	_, res = e.rpc(token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{"protocolVersion": "1999-01-01"}})
	if !strings.Contains(string(res.Result), `"protocolVersion":"2025-11-25"`) {
		t.Fatalf("unknown version: %s", res.Result)
	}

	for _, c := range []struct {
		name   string
		token  string
		msg    map[string]any
		status int
		code   int
	}{
		{"no token", "", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping"}, 401, 0},
		{"unknown token", "hvt_NOPE", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping"}, 401, 0},
		{"notification", token, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"}, 202, 0},
		{"ping", token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping"}, 200, 0},
		{"unknown method", token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "resources/list"}, 200, -32601},
		{"not 2.0", token, map[string]any{"jsonrpc": "1.0", "id": 1, "method": "ping"}, 200, -32600},
		{"unknown tool", token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "drop_tables"}}, 200, -32602},
	} {
		t.Run(c.name, func(t *testing.T) {
			status, res := e.rpc(c.token, c.msg)
			code := 0
			if res.Error != nil {
				code = res.Error.Code
			}
			if status != c.status || code != c.code {
				t.Fatalf("%d %d, want %d %d", status, code, c.status, c.code)
			}
		})
	}

	res2, err := http.Get(e.srv.URL + "/api/mcp")
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != 405 {
		t.Fatalf("GET: %d", res2.StatusCode)
	}
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/mcp", strings.NewReader("{nope"))
	req.Header.Set("Authorization", "Bearer "+token)
	res3, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res3.Body)
	res3.Body.Close()
	if !strings.Contains(string(raw), "-32700") {
		t.Fatalf("parse error: %s", raw)
	}
}

func TestToolsFollowTokenScopeAndPermissions(t *testing.T) {
	e := newEnv(t)
	ws, write := e.person("", "owner", nil, "read:*", "write:*")
	_, read := e.person(ws, "admin", nil, "read:*")
	_, member := e.person(ws, "member", []string{"read:*"}, "read:*", "write:*")

	all := e.tools(write)
	if len(all) != len(openapi.Operations) {
		t.Fatalf("owner with a write token: %d tools, want %d", len(all), len(openapi.Operations))
	}
	create := all["create_client"]
	ann, _ := create["annotations"].(map[string]any)
	if ann["readOnlyHint"] != false || !strings.HasPrefix(create["description"].(string), "[write]") {
		t.Fatalf("create_client: %+v", create)
	}
	if ann, _ := all["issue_invoice"]["annotations"].(map[string]any); ann["destructiveHint"] != true {
		t.Fatalf("issue_invoice must be destructive: %+v", ann)
	}
	if ann, _ := all["list_clients"]["annotations"].(map[string]any); ann["readOnlyHint"] != true {
		t.Fatalf("list_clients: %+v", ann)
	}
	for name, tokens := range map[string]string{"read token": read, "read-only member": member} {
		got := e.tools(tokens)
		if got["create_client"] != nil || got["record_payment"] != nil || got["list_clients"] == nil {
			t.Fatalf("%s sees write tools: %d", name, len(got))
		}
	}
	// A token scoped to some resources sees only their tools.
	_, clientsOnly := e.person(ws, "owner", nil, "read:clients", "write:clients", "read:invoices")
	got := e.tools(clientsOnly)
	if got["create_client"] == nil || got["list_clients"] == nil || got["list_invoices"] == nil ||
		got["issue_invoice"] != nil || got["list_expenses"] != nil || got["get_key_figures"] != nil {
		names := []string{}
		for name := range got {
			names = append(names, name)
		}
		t.Fatalf("clients-only token tools: %v", names)
	}
	// Hidden tools cannot be called either, and the REST route refuses the same request.
	if status, res := e.rpc(read, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": "create_client", "arguments": map[string]any{"body": map[string]any{"name": "X"}}}}); status != 200 || res.Error == nil {
		t.Fatalf("read token called create_client: %+v", res)
	}
	for _, c := range []struct {
		token, code string
	}{{read, "token_scope"}, {member, "forbidden"}} {
		req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/clients", strings.NewReader(`{"name":"X"}`))
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 403 || !strings.Contains(string(raw), c.code) {
			t.Fatalf("REST write: %d %s, want 403 %s", res.StatusCode, raw, c.code)
		}
	}
}

func TestToolCallsAreWorkspaceScoped(t *testing.T) {
	e := newEnv(t)
	_, a := e.person("", "owner", nil, "read:*", "write:*")
	_, b := e.person("", "owner", nil, "read:*", "write:*")

	created := e.call(a, "create_client", map[string]any{"body": map[string]any{"name": "Acme AG", "country": "CH"}})
	var client struct{ Data struct{ ID, Name string } }
	if created.IsError || json.Unmarshal([]byte(created.Content[0].Text), &client) != nil || client.Data.Name != "Acme AG" {
		t.Fatalf("create_client: %+v", created)
	}
	if got := e.call(a, "list_clients", map[string]any{"search": "Acme", "page_size": 10}); got.IsError || !strings.Contains(got.Content[0].Text, client.Data.ID) {
		t.Fatalf("list_clients: %+v", got)
	}
	if got := e.call(a, "get_client", map[string]any{"id": client.Data.ID}); got.IsError {
		t.Fatalf("get_client: %+v", got)
	}
	if got := e.call(b, "list_clients", nil); got.IsError || strings.Contains(got.Content[0].Text, client.Data.ID) {
		t.Fatalf("other workspace sees the client: %+v", got)
	}
	if got := e.call(b, "get_client", map[string]any{"id": client.Data.ID}); !got.IsError || !strings.Contains(got.Content[0].Text, "not_found") {
		t.Fatalf("other workspace reads the client: %+v", got)
	}
	if got := e.call(b, "update_client", map[string]any{"id": client.Data.ID, "body": map[string]any{"name": "Stolen"}}); !got.IsError {
		t.Fatalf("other workspace changes the client: %+v", got)
	}

	draft := e.call(a, "create_invoice", map[string]any{"body": map[string]any{"client_id": client.Data.ID,
		"lines": []map[string]any{{"description": "Consulting", "quantity": 2, "unit_price": "150.00", "vat_category": "S", "vat_rate": 8.1}}}})
	if draft.IsError || !strings.Contains(draft.Content[0].Text, `"status":"draft"`) {
		t.Fatalf("create_invoice: %+v", draft)
	}
	for _, c := range []struct {
		name string
		args map[string]any
	}{
		{"missing path argument", map[string]any{}},
		{"unknown argument", map[string]any{"id": client.Data.ID, "secret": 1}},
	} {
		if got := e.call(a, "get_client", c.args); !got.IsError {
			t.Fatalf("%s: %+v", c.name, got)
		}
	}
	if got := e.call(a, "get_key_figures", map[string]any{"currency": "CHF"}); got.IsError || !strings.Contains(got.Content[0].Text, `"currency":"CHF"`) {
		t.Fatalf("get_key_figures: %+v", got)
	}
}

// TestDocumentedBodyFieldsAccepted: each documented request property is one the handler knows (handlers refuse
// unknown fields with 400), so a field removed or renamed in Go fails here.
func TestDocumentedBodyFieldsAccepted(t *testing.T) {
	e := newEnv(t)
	_, token := e.person("", "owner", nil, "read:*", "write:*")
	created := e.call(token, "create_client", map[string]any{"body": map[string]any{"name": "Fixture"}})
	var client struct{ Data struct{ ID string } }
	_ = json.Unmarshal([]byte(created.Content[0].Text), &client)
	for _, op := range openapi.Operations {
		if op.Body == nil || op.Upload { // multipart forms have no unknown-field check
			continue
		}
		var schema struct {
			Properties map[string]map[string]any `json:"properties"`
		}
		if err := json.Unmarshal(op.Body, &schema); err != nil {
			t.Fatal(err)
		}
		path := strings.NewReplacer("{id}", client.Data.ID).Replace(op.Path)
		if op.ID == "record_payment" {
			path = strings.Replace(op.Path, "{id}", "inv_missing", 1) // the body is read before the invoice
		}
		for name, prop := range schema.Properties {
			body := map[string]any{name: sample(prop)}
			raw, _ := json.Marshal(body)
			req, _ := http.NewRequest(op.Method, e.srv.URL+path, bytes.NewReader(raw))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			got, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode == 400 && strings.Contains(strings.ToLower(string(got)), "unknown field") {
				t.Errorf("%s: documented field %q is refused: %s", op.ID, name, got)
			}
		}
	}
}

// sample is a value of the property's JSON type; validation may refuse it, an unknown-field check must not.
func sample(prop map[string]any) any {
	if enum, ok := prop["enum"].([]any); ok && len(enum) > 0 {
		return enum[0]
	}
	typ := prop["type"]
	if list, ok := typ.([]any); ok {
		typ = list[0]
	}
	switch typ {
	case "boolean":
		return true
	case "integer", "number":
		return 1
	case "array":
		return []any{}
	case "object":
		return map[string]any{}
	default:
		return "1"
	}
}
