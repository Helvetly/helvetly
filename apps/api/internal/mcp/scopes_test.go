package mcp_test

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/openapi"
)

// do sends one REST request with the token and returns the status and the error code, if any.
func (e *env) do(token, method, path string) (int, string, map[string]any) {
	e.t.Helper()
	var body io.Reader
	if method != http.MethodGet {
		body = strings.NewReader("{}")
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out.Error.Code, out.Error.Details
}

var pathParam = regexp.MustCompile(`\{[A-Za-z_]+\}`)

// TestReadScopePerResource: a token with only read:<resource> calls that resource's GET operations, and every
// write of it and every operation of another resource answers 403 token_scope naming the missing scope.
func TestReadScopePerResource(t *testing.T) {
	e := newEnv(t)
	ws, _ := e.person("", "owner", nil, "read:clients")
	for _, res := range openapi.Resources() {
		t.Run(res.Name, func(t *testing.T) {
			_, token := e.person(ws, "admin", nil, "read:"+res.Name) // one token per resource
			for _, op := range openapi.Operations {
				status, code, details := e.do(token, op.Method, pathParam.ReplaceAllString(op.Path, "x1"))
				action := "read"
				if op.Write {
					action = "write"
				}
				want := action + ":" + op.Resource
				if op.Resource == res.Name && !op.Write {
					if code == "token_scope" || code == "token_not_allowed" {
						t.Errorf("%s: %d %s, want the read allowed", op.ID, status, code)
					}
					continue
				}
				if status != http.StatusForbidden || code != "token_scope" || details["scope"] != want {
					t.Errorf("%s: %d %s %v, want 403 token_scope %s", op.ID, status, code, details, want)
				}
			}
		})
	}
}

// TestExcludedRoutesRefuseTokens: what the catalogue leaves out (people, billing, tokens, the account, workspace
// deletion and export, Heidi, feedback, notification preferences, imports, signatures, templates, settings)
// answers 403 token_not_allowed even to a full-access token.
func TestExcludedRoutesRefuseTokens(t *testing.T) {
	e := newEnv(t)
	_, token := e.person("", "owner", nil, "read:*", "write:*")
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/v1/members"},
		{"PATCH", "/api/v1/members/usr_1"},
		{"DELETE", "/api/v1/members/usr_1"},
		{"GET", "/api/v1/members/invitations"},
		{"POST", "/api/v1/members/invitations"},
		{"GET", "/api/v1/billing"},
		{"POST", "/api/v1/billing/checkout"},
		{"POST", "/api/v1/billing/portal"},
		{"GET", "/api/v1/account/tokens"},
		{"POST", "/api/v1/account/tokens"},
		{"DELETE", "/api/v1/account/tokens/tok_1"},
		{"GET", "/api/v1/account"},
		{"DELETE", "/api/v1/account"},
		{"GET", "/api/v1/account/export"},
		{"GET", "/api/v1/session"},
		{"POST", "/api/v1/session/workspace"},
		{"DELETE", "/api/v1/workspace"},
		{"PATCH", "/api/v1/workspace"},
		{"GET", "/api/v1/workspace/export"},
		{"POST", "/api/v1/heidi/chat"},
		{"GET", "/api/v1/heidi/consent"},
		{"PUT", "/api/v1/heidi/consent"},
		{"POST", "/api/v1/feedback"},
		{"GET", "/api/v1/account/notifications"},
		{"PUT", "/api/v1/account/notifications"},
		{"GET", "/api/v1/notifications"},
		{"POST", "/api/v1/imports"},
		{"GET", "/api/v1/signatures"},
		{"POST", "/api/v1/signatures"},
		{"GET", "/api/v1/templates"},
		{"PUT", "/api/v1/invoice-settings"},
		{"PUT", "/api/v1/ledger/settings"},
		{"PUT", "/api/v1/vat-return/settings"},
		{"PUT", "/api/v1/engagement-settings"},
		// Employees and payroll: never a public operation, whatever the token's scopes.
		{"GET", "/api/v1/employees"},
		{"POST", "/api/v1/employees"},
		{"GET", "/api/v1/employees/emp_1"},
		{"GET", "/api/v1/employees/emp_1/protected"},
		{"GET", "/api/v1/employees/emp_1/pay-terms"},
		{"GET", "/api/v1/employees/emp_1/documents"},
		{"GET", "/api/v1/employees/emp_1/documents/doc_1/download"},
		{"GET", "/api/v1/employment/settings"},
		{"GET", "/api/v1/payroll/entries"},
		{"POST", "/api/v1/payroll/entries/pay_1/approve"},
		{"GET", "/api/v1/payroll/summary"},
		{"GET", "/api/v1/payroll/export"},
		{"GET", "/api/v1/payroll/bookings"},
	} {
		if status, code, _ := e.do(token, c.method, c.path); status != http.StatusForbidden || code != "token_not_allowed" {
			t.Errorf("%s %s: %d %s, want 403 token_not_allowed", c.method, c.path, status, code)
		}
	}
}

// TestToolsListForScopedToken: tools/list offers exactly the operations a token's scopes cover.
func TestToolsListForScopedToken(t *testing.T) {
	e := newEnv(t)
	ws, _ := e.person("", "owner", nil, "read:clients")
	for _, scopes := range [][]string{{"read:products"}, {"write:products"}, {"read:invoices", "write:quotes"}, {"read:*"}} {
		_, token := e.person(ws, "admin", nil, scopes...)
		var want []string
		for _, op := range openapi.Operations {
			for _, s := range scopes {
				action, res, _ := strings.Cut(s, ":")
				if (res == "*" || res == op.Resource) && (action == "write" || !op.Write) {
					want = append(want, op.ID)
					break
				}
			}
		}
		var got []string
		for name := range e.tools(token) {
			got = append(got, name)
		}
		slices.Sort(want)
		slices.Sort(got)
		if len(want) == 0 || !slices.Equal(got, want) {
			t.Errorf("%v: tools %v, want %v", scopes, got, want)
		}
	}
}

// TestWriteToolsWithoutBody: a tool called with only its path arguments never fails for want of a body: an
// operation whose handler decodes JSON documents a body (the server then sends {}), so no 415 or empty-body 400.
func TestWriteToolsWithoutBody(t *testing.T) {
	e := newEnv(t)
	_, token := e.person("", "owner", nil, "read:*", "write:*")
	for _, op := range openapi.Operations {
		if !op.Write || op.Upload {
			continue
		}
		args := map[string]any{}
		for _, p := range op.Params {
			if p.In == "path" {
				args[p.Name] = "x1"
			}
		}
		got := e.call(token, op.ID, args).Content[0].Text
		if strings.Contains(got, "unsupported_media_type") || strings.Contains(got, "EOF") {
			t.Errorf("%s: %s", op.ID, got)
		}
	}
}

// TestNoHRTool: MCP offers no tool over employee or payroll data, not even to an owner's full-access token.
func TestNoHRTool(t *testing.T) {
	for _, op := range openapi.Operations {
		for _, word := range []string{"employ", "payroll", "pay-terms", "salary"} {
			if strings.Contains(strings.ToLower(op.Path+" "+op.ID+" "+op.Tag), word) {
				t.Errorf("public operation %s %s reaches HR data", op.Method, op.Path)
			}
		}
	}
}
