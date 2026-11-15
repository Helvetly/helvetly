package permissions

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	many := make([]string, 31)
	for i := range many {
		many[i] = "read:clients"
	}
	for _, c := range []struct {
		scopes []string
		ok     bool
	}{
		{[]string{"*:*"}, true},
		{[]string{"read:*", "write:invoices", "write:expenses"}, true},
		{[]string{"*:invoices", "write:settings", "read:billing", "read:members"}, true},
		{nil, false},
		{[]string{}, false},
		{many, false},
		{[]string{"read:clients", "read:clients"}, false},
		{[]string{"delete:clients"}, false},
		{[]string{"read:people"}, false},
		{[]string{"read"}, false},
		{[]string{"read:clients:x"}, false},
		{[]string{""}, false},
		{[]string{"read:employees", "write:payroll", "read:employee-documents", "write:payroll-approval", "read:payroll-export"}, true},
	} {
		if err := Validate(c.scopes); (err == nil) != c.ok {
			t.Errorf("Validate(%q) = %v, want ok %v", c.scopes, err, c.ok)
		}
	}
}

func TestAllows(t *testing.T) {
	for _, c := range []struct {
		role   string
		scopes []string
		need   string
		want   bool
	}{
		{"owner", nil, "write:billing", true},
		{"admin", nil, "write:members", true},
		{"member", nil, "read:clients", false},
		{"member", []string{"*:*"}, "write:billing", true},
		{"member", []string{"read:*"}, "read:invoices", true},
		{"member", []string{"read:*"}, "write:invoices", false},
		{"member", []string{"write:invoices"}, "read:invoices", true},
		{"member", []string{"write:invoices"}, "write:invoices", true},
		{"member", []string{"write:invoices"}, "read:clients", false},
		{"member", []string{"read:invoices"}, "write:invoices", false},
		{"member", []string{"*:invoices"}, "write:invoices", true},
		{"member", []string{"*:invoices"}, "read:expenses", false},
		{"member", []string{"write:*"}, "read:documents", true},
		// HR resources: owners only, unless a member was named the scope; "*" resources and admins never reach them.
		{"owner", nil, "write:payroll-approval", true},
		{"owner", nil, "read:payroll-export", true},
		{"admin", nil, "read:employees", false},
		{"admin", nil, "read:payroll", false},
		{"member", []string{"*:*"}, "read:employees", false},
		{"member", []string{"*:*"}, "read:payroll", false},
		{"member", []string{"read:*"}, "read:employee-documents", false},
		{"member", []string{"write:*"}, "write:payroll-approval", false},
		{"member", []string{"read:employees"}, "read:employees", true},
		{"member", []string{"read:employees"}, "read:payroll", false},
		{"member", []string{"write:payroll"}, "read:payroll", true},
		{"member", []string{"write:payroll"}, "write:payroll-approval", false},
		{"member", []string{"*:payroll-approval"}, "write:payroll-approval", true},
		{"member", []string{"read:payroll-export"}, "read:payroll-export", true},
	} {
		if got := Allows(c.role, c.scopes, c.need); got != c.want {
			t.Errorf("Allows(%s, %q, %s) = %v, want %v", c.role, c.scopes, c.need, got, c.want)
		}
	}
}

func TestRequired(t *testing.T) {
	for _, c := range []struct {
		method, path string
		want         []string
	}{
		{"GET", "/api/v1/invoices", []string{"read:invoices"}},
		{"HEAD", "/api/v1/invoices/inv_1/pdf", []string{"read:invoices"}},
		{"POST", "/api/v1/invoices", []string{"write:invoices"}},
		{"GET", "/api/v1/quotes", []string{"read:invoices"}},
		{"POST", "/api/v1/quotes/quo_1/invoice", []string{"write:invoices"}},
		{"PUT", "/api/v1/invoice-settings", []string{"write:settings"}},
		{"GET", "/api/v1/engagement-settings", []string{"read:settings"}},
		{"PATCH", "/api/v1/workspace", []string{"write:settings"}},
		{"GET", "/api/v1/ledger/export", []string{"read:settings"}},
		{"PUT", "/api/v1/ledger/settings", []string{"write:settings"}},
		{"POST", "/api/v1/signatures", []string{"write:documents"}},
		{"POST", "/api/v1/templates/tpl_1/documents", []string{"write:documents"}},
		{"GET", "/api/v1/templates", []string{"read:documents"}},
		{"POST", "/api/v1/expense-categories", []string{"write:expenses"}},
		{"GET", "/api/v1/members/invitations", []string{"read:members"}},
		{"POST", "/api/v1/billing/checkout", []string{"write:billing"}},
		{"POST", "/api/v1/engagements/eng_1/periods/per_1/invoice", []string{"write:engagements", "write:invoices"}},
		{"GET", "/api/v1/engagements/eng_1/periods/per_1/invoice", []string{"read:engagements"}},
		{"POST", "/api/v1/engagements/eng_1/periods/per_1/report/send", []string{"write:engagements"}},
		{"GET", "/api/v1/session", nil},
		{"POST", "/api/v1/workspaces", nil},
		{"POST", "/api/v1/invitations/accept", nil},
		{"POST", "/api/v1/public/sign/tok", nil},
		{"GET", "/api/v1/invoicesx", nil},
		{"GET", "/api/health", nil},
	} {
		if got := Required(c.method, c.path); !slices.Equal(got, c.want) {
			t.Errorf("Required(%s %s) = %q, want %q", c.method, c.path, got, c.want)
		}
	}
}

// unguarded: the /api/v1 prefixes the spec leaves without a scope check (feedback goes to the Helvetly team, any role;
// the OpenAPI document is public).
var unguarded = []string{"/api/v1/auth/", "/api/v1/session", "/api/v1/account/", "/api/v1/public/",
	"/api/v1/invitations/", "/api/v1/workspaces", "/api/v1/notifications", "/api/v1/feedback", "/api/v1/openapi.json"}

// These authenticated routes cannot require one uniform resource scope: dashboard and suggestions
// filter each resource, chat checks the requested business action, and transcripts belong to a user.
// Their package tests verify scoped data and actions; enumerate methods and paths to catch new routes.
var scopedInHandler = []string{
	"GET /api/v1/reports/key-figures",
	"GET /api/v1/heidi/suggestions",
	"GET /api/v1/heidi/usage",
	"GET /api/v1/heidi/conversations",
	"GET /api/v1/heidi/conversations/x",
	"POST /api/v1/heidi/chat",
	"POST /api/v1/heidi/chat/confirm",
	"PUT /api/v1/heidi/consent", // owner or admin, checked by role in the handler
	// imports: the scope follows the batch's kind (write:<kind>, plus write:documents to upload)
	"POST /api/v1/imports",
	"GET /api/v1/imports",
	"GET /api/v1/imports/x",
	"DELETE /api/v1/imports/x",
	"PATCH /api/v1/imports/x/records/x",
	"POST /api/v1/imports/x/commit",
}

// TestEveryRouteIsMapped reads every route registered in internal/* so a new one cannot slip past the guard.
func TestEveryRouteIsMapped(t *testing.T) {
	files, err := filepath.Glob("../*/*.go")
	if err != nil {
		t.Fatal(err)
	}
	route := regexp.MustCompile(`"(GET|HEAD|POST|PUT|PATCH|DELETE) (/api/v1/[^"]*)"`)
	param := regexp.MustCompile(`\{[^}]+\}`)
	n := 0
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range route.FindAllStringSubmatch(string(src), -1) {
			n++
			p := param.ReplaceAllString(m[2], "x")
			open := p == "/api/v1/account" || slices.Contains(scopedInHandler, m[1]+" "+p) ||
				slices.ContainsFunc(unguarded, func(u string) bool { return strings.HasPrefix(p, u) })
			if got := Required(m[1], p); (got == nil) != open {
				t.Errorf("%s: %s %s maps to %q (unguarded: %v)", f, m[1], m[2], got, open)
			}
		}
	}
	if n < 150 {
		t.Fatalf("found only %d routes: is the source scan broken?", n)
	}
}

func TestHRScopes(t *testing.T) {
	got := HRScopes([]string{"*:*", "write:payroll", "read:clients", "read:employees"})
	if !slices.Equal(got, []string{"read:employees", "write:payroll"}) {
		t.Fatalf("HRScopes = %q", got)
	}
	if len(HRScopes([]string{"*:*"})) != 0 {
		t.Fatal("full access must hold no HR scope")
	}
}
