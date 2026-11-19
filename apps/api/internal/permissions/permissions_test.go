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
		{[]string{"*:invoices", "write:ledger", "read:billing", "read:members"}, true},
		{[]string{"write:invoice-settings", "write:vat-return", "write:periods", "read:audit-log", "read:workspace", "read:api"}, true},
		{[]string{"write:settings"}, false},
		{nil, false},
		{[]string{}, false},
		{many, false},
		{[]string{"read:clients", "read:clients"}, false},
		{[]string{"delete:clients"}, false},
		{[]string{"read:people"}, false},
		{[]string{"read"}, false},
		{[]string{"read:clients:x"}, false},
		{[]string{""}, false},
		{[]string{"read:employees", "write:payroll"}, true},
		{[]string{"read:employee-documents"}, false}, // the finer HR scopes became the employees and payroll areas
		{[]string{"write:payroll-approval"}, false},
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
		// HR resources: an owner always; an admin the admin default (payroll view) or what the owner set; a member only
		// when named. "*" resources never reach them.
		{"owner", nil, "write:payroll", true},
		{"owner", nil, "write:employees", true},
		{"admin", nil, "read:payroll", true},
		{"admin", nil, "write:payroll", false},
		{"admin", nil, "read:employees", false},
		{"admin", []string{}, "read:payroll", false},
		{"admin", []string{"write:employees"}, "read:employees", true},
		{"admin", []string{"write:employees"}, "read:payroll", false},
		{"admin", []string{"write:employees"}, "write:invoices", true},
		{"member", []string{"*:*"}, "read:employees", false},
		{"member", []string{"*:*"}, "read:payroll", false},
		{"member", []string{"read:*"}, "read:payroll", false},
		{"member", []string{"write:*"}, "write:employees", false},
		{"member", []string{"read:employees"}, "read:employees", true},
		{"member", []string{"read:employees"}, "read:payroll", false},
		{"member", []string{"write:payroll"}, "read:payroll", true},
		{"member", []string{"read:payroll"}, "write:payroll", false},
		{"member", []string{"*:payroll"}, "write:payroll", true},
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
		{"PUT", "/api/v1/invoice-settings", []string{"write:invoice-settings"}},
		{"DELETE", "/api/v1/invoice-settings/logo", []string{"write:invoice-settings"}},
		{"PUT", "/api/v1/email-templates/quote/fr", []string{"write:invoice-settings"}},
		{"GET", "/api/v1/transmission-channels", []string{"read:invoice-settings"}},
		{"GET", "/api/v1/engagement-settings", []string{"read:engagements"}},
		{"POST", "/api/v1/engagements/eng_1/invoices", []string{"write:engagements", "write:invoices"}},
		{"DELETE", "/api/v1/engagements/eng_1/invoices/inv_1", []string{"write:engagements", "write:invoices"}},
		{"GET", "/api/v1/invoices/inv_1/engagement", []string{"read:invoices", "read:engagements"}},
		{"PATCH", "/api/v1/workspace", []string{"write:workspace"}},
		{"GET", "/api/v1/workspace/portal", []string{"read:clients|read:workspace"}},
		{"PUT", "/api/v1/workspace/portal", []string{"write:workspace"}},
		{"GET", "/api/v1/workspace/portal/availability", []string{"read:workspace"}},
		{"GET", "/api/v1/ledger/export", []string{"read:ledger"}},
		{"PUT", "/api/v1/ledger/settings", []string{"write:ledger"}},
		{"GET", "/api/v1/vat-return", []string{"read:vat-return"}},
		{"PUT", "/api/v1/vat-return/settings", []string{"write:vat-return"}},
		{"POST", "/api/v1/periods", []string{"write:periods"}},
		{"POST", "/api/v1/periods/2026-10/reopen", []string{"write:periods"}},
		{"GET", "/api/v1/audit-log/export", []string{"read:audit-log"}},
		// a person's own tokens: the api area at any level, whatever the method
		{"GET", "/api/v1/account/tokens", []string{"read:api"}},
		{"POST", "/api/v1/account/tokens", []string{"read:api"}},
		{"DELETE", "/api/v1/account/tokens/tok_1", []string{"read:api"}},
		{"GET", "/api/v1/account/tokensx", nil},
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
	"GET /api/v1/heidi/consent", // any role, its own approval
	"PUT /api/v1/heidi/consent", // any role, for itself
	"POST /api/v1/ai/write",     // any member: writes nothing, its consent and Heidi's pool are checked in the handler
	// imports: the scope follows the batch's kind (write:<kind>, plus write:documents to upload)
	"POST /api/v1/imports",
	"POST /api/v1/imports/documents", // auto, plus read:documents for the chosen files
	"GET /api/v1/imports",
	"GET /api/v1/imports/x",
	"GET /api/v1/imports/x/files/x/content",
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
				!strings.HasPrefix(p, tokensPath) && slices.ContainsFunc(unguarded, func(u string) bool { return strings.HasPrefix(p, u) })
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

func TestRequiredHR(t *testing.T) {
	for _, c := range []struct {
		method, path string
		want         []string
	}{
		{"GET", "/api/v1/employees", []string{"read:employees|read:payroll"}},
		{"GET", "/api/v1/employees/emp_1", []string{"read:employees"}},
		{"PATCH", "/api/v1/employees/emp_1", []string{"write:employees"}},
		{"GET", "/api/v1/employment/settings", []string{"read:employees|read:payroll"}},
		{"PUT", "/api/v1/employment/settings", []string{"write:employees", "write:payroll"}},
		{"GET", "/api/v1/employees/emp_1/pay-terms", []string{"read:payroll"}},
		{"POST", "/api/v1/employees/emp_1/pay-terms", []string{"write:payroll"}},
		{"DELETE", "/api/v1/employees/emp_1/pay-terms/pt_1", []string{"write:payroll"}},
		{"GET", "/api/v1/employees/emp_1/protected", []string{"write:payroll"}},
		{"GET", "/api/v1/employees/emp_1/documents", []string{"read:employees"}},
		{"GET", "/api/v1/employees/emp_1/documents/doc_1/download", []string{"read:employees"}},
		{"DELETE", "/api/v1/employees/emp_1/documents/doc_1", []string{"write:employees"}},
		{"GET", "/api/v1/payroll/entries", []string{"read:payroll"}},
		{"POST", "/api/v1/payroll/entries", []string{"write:payroll"}},
		{"POST", "/api/v1/payroll/entries/pay_1/approve", []string{"write:payroll"}},
		{"POST", "/api/v1/payroll/entries/pay_1/payment", []string{"write:payroll"}},
		{"POST", "/api/v1/payroll/entries/pay_1/correct", []string{"write:payroll"}},
		{"GET", "/api/v1/payroll/export", []string{"read:payroll"}},
		{"GET", "/api/v1/payroll/bookings/preview", []string{"read:payroll"}},
		{"POST", "/api/v1/payroll/bookings", []string{"write:payroll"}},
	} {
		if got := Required(c.method, c.path); !slices.Equal(got, c.want) {
			t.Errorf("Required(%s %s) = %q, want %q", c.method, c.path, got, c.want)
		}
	}
}

func TestEffectiveHR(t *testing.T) {
	for _, c := range []struct {
		role   string
		scopes []string
		want   []string
	}{
		{"owner", nil, []string{"write:employees", "write:payroll"}},
		{"admin", nil, []string{"read:payroll"}}, // the Accountant level until the owner sets otherwise
		{"admin", []string{}, []string{}},
		{"admin", []string{"write:payroll", "read:employees"}, []string{"read:employees", "write:payroll"}},
		{"member", []string{"*:*"}, []string{}},
		{"member", []string{"read:*", "read:payroll"}, []string{"read:payroll"}},
	} {
		if got := EffectiveHR(c.role, c.scopes); !slices.Equal(got, c.want) {
			t.Errorf("EffectiveHR(%s, %q) = %q, want %q", c.role, c.scopes, got, c.want)
		}
	}
}

func TestForRole(t *testing.T) {
	ptr := func(s ...string) *[]string { return &s }
	for _, c := range []struct {
		role   string
		scopes *[]string
		want   []string
		err    error
	}{
		{"owner", nil, nil, nil},
		{"owner", ptr("read:payroll"), nil, ErrNotMember},
		{"admin", nil, nil, nil},
		{"admin", ptr(), []string{}, nil},
		{"admin", ptr("read:payroll", "write:employees"), []string{"read:payroll", "write:employees"}, nil},
		{"admin", ptr("read:invoices"), nil, ErrInvalid}, // an admin's general access is not a list
		{"admin", ptr("read:payroll", "read:payroll"), nil, ErrInvalid},
		{"member", nil, []string{"*:*"}, nil},
		{"member", ptr("read:*", "read:payroll"), []string{"read:*", "read:payroll"}, nil},
		{"member", ptr(), nil, ErrInvalid},
	} {
		got, err := ForRole(c.role, c.scopes)
		if err != c.err || !slices.Equal(got, c.want) || (got == nil) != (c.want == nil) {
			t.Errorf("ForRole(%s, %v) = %q, %v; want %q, %v", c.role, c.scopes, got, err, c.want, c.err)
		}
	}
}
