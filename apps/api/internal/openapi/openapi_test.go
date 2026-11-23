package openapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"helvetly.com/api/internal/books"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/dashboard"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/dunning"
	"helvetly.com/api/internal/eaddress"
	"helvetly.com/api/internal/einvoice"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/instalments"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/ledger"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/products"
	"helvetly.com/api/internal/quotes"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/vatreturn"
)

// stubAuth is enough for the services to register their routes.
type stubAuth struct{}

func (stubAuth) SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }
}
func (stubAuth) WriteError(w http.ResponseWriter, _ *http.Request, _ error) { w.WriteHeader(500) }
func (stubAuth) Decode(http.ResponseWriter, *http.Request, any) bool        { return false }

// TestDocumentedRoutesAreRegistered: every documented operation is exactly a route the services register, as main
// wires them (a renamed or removed route fails here).
func TestDocumentedRoutesAreRegistered(t *testing.T) {
	mux := http.NewServeMux()
	inv := invoices.New(nil, stubAuth{}, nil, nil, nil)
	clients.New(nil, stubAuth{}, nil, nil).Register(mux)
	inv.Register(mux)
	expenses.New(nil, stubAuth{}, nil, nil).Register(mux)
	documents.New(nil, stubAuth{}, nil, 0, nil).Register(mux)
	engagements.New(nil, stubAuth{}, inv, nil).Register(mux)
	products.New(nil, stubAuth{}, nil).Register(mux)
	dashboard.New(nil, stubAuth{}).Register(mux)
	quotes.New(nil, stubAuth{}, inv, nil, nil, nil).Register(mux)
	instalments.New(nil, stubAuth{}, inv, nil, nil).Register(mux)
	dunning.New(nil, stubAuth{}, inv, nil, nil).Register(mux)
	books.New(nil, stubAuth{}).Register(mux)
	ledger.New(nil, stubAuth{}).Register(mux)
	vatreturn.New(nil, stubAuth{}).Register(mux)
	einvoice.New(nil, stubAuth{}, nil).Register(mux)
	scheduling.New(nil, stubAuth{}, inv, nil, "", "", nil).Register(mux)
	for _, op := range openapi.Operations {
		path := regexp.MustCompile(`\{[A-Za-z_]+\}`).ReplaceAllString(op.Path, "x1")
		if _, pattern := mux.Handler(httptest.NewRequest(op.Method, path, nil)); pattern != op.Method+" "+op.Path {
			t.Errorf("%s: %s %s is served by %q", op.ID, op.Method, op.Path, pattern)
		}
	}
}

// TestSchemasMatchGoTypes: each documented response schema has exactly the JSON fields, types and nullability of the
// Go type its handler writes. (The dashboard's unexported response is checked in package dashboard.)
func TestSchemasMatchGoTypes(t *testing.T) {
	for _, c := range []struct {
		schema string
		typ    reflect.Type
		extra  []string
	}{
		{"Client", reflect.TypeFor[store.Client](), nil},
		{"Contact", reflect.TypeFor[store.Contact](), nil},
		{"ElectronicAddress", reflect.TypeFor[eaddress.Address](), nil},
		{"Person", reflect.TypeFor[store.Uploader](), nil},
		{"InvoiceListItem", reflect.TypeFor[store.InvoiceListItem](), []string{"type_code"}},
		{"Invoice", reflect.TypeFor[store.Invoice](), []string{"type_code"}},
		{"InvoiceClient", reflect.TypeFor[store.InvoiceClient](), nil},
		{"InvoiceRef", reflect.TypeFor[store.InvoiceRef](), nil},
		{"InvoiceLine", reflect.TypeFor[store.InvoiceLine](), nil},
		{"VatGroup", reflect.TypeFor[invoicecalc.Group](), nil},
		{"PrepaymentRef", reflect.TypeFor[store.PrepaymentRef](), nil},
		{"PaymentMethods", reflect.TypeFor[store.PaymentMethods](), nil},
		{"PaymentInfo", reflect.TypeFor[store.InvoicePaymentInfo](), nil},
		{"Party", reflect.TypeFor[store.Party](), nil},
		{"Payment", reflect.TypeFor[store.Payment](), nil},
		{"Refund", reflect.TypeFor[store.Refund](), nil},
		{"InstalmentSchedule", reflect.TypeFor[store.InstalmentSchedule](), nil},
		{"InstalmentItem", reflect.TypeFor[store.InstalmentItem](), nil},
		{"PlanRef", reflect.TypeFor[store.PlanRef](), nil},
		{"Expense", reflect.TypeFor[store.Expense](), nil},
		{"DuplicateRef", reflect.TypeFor[store.DuplicateRef](), nil},
		{"CategoryRef", reflect.TypeFor[store.CategoryRef](), nil},
		{"ExpenseLine", reflect.TypeFor[store.ExpenseLine](), nil},
		{"ExpenseVat", reflect.TypeFor[store.ExpenseVAT](), nil},
		{"ExpenseBase", reflect.TypeFor[store.ExpenseBase](), nil},
		{"Document", reflect.TypeFor[store.Document](), nil},
		{"FolderRef", reflect.TypeFor[store.FolderRef](), nil},
		{"DocumentLink", reflect.TypeFor[store.DocumentLink](), nil},
		{"Engagement", reflect.TypeFor[engagements.EngagementView](), nil},
		{"EngagementClient", reflect.TypeFor[store.EngagementClient](), nil},
		{"EngagementPeriod", reflect.TypeFor[engagements.PeriodSummary](), nil},
		{"EngagementInvoice", reflect.TypeFor[store.EngagementInvoice](), nil},
		{"Product", reflect.TypeFor[store.Product](), nil},
	} {
		t.Run(c.schema, func(t *testing.T) {
			for _, d := range openapi.Drift(c.schema, c.typ, c.extra...) {
				t.Error(d)
			}
		})
	}
}

func TestDocumentIsConsistent(t *testing.T) {
	if len(openapi.Operations) == 0 {
		t.Fatal("no operations")
	}
	ids := map[string]bool{}
	for _, op := range openapi.Operations {
		if !regexp.MustCompile(`^[a-z]+(_[a-z]+)*$`).MatchString(op.ID) || ids[op.ID] {
			t.Errorf("operationId %q: want unique snake_case (it is the MCP tool name)", op.ID)
		}
		ids[op.ID] = true
		if op.Write != (op.Method != http.MethodGet) {
			t.Errorf("%s: x-helvetly-write must be set exactly on non-GET operations", op.ID)
		}
		if op.Summary == "" || op.Description == "" {
			t.Errorf("%s: needs a summary and a description", op.ID)
		}
		declared := map[string]bool{}
		for _, p := range op.Params {
			if p.In == "path" {
				declared[p.Name] = true
			}
		}
		for _, m := range regexp.MustCompile(`\{([A-Za-z_]+)\}`).FindAllStringSubmatch(op.Path, -1) {
			if !declared[m[1]] {
				t.Errorf("%s: path parameter %s is not declared", op.ID, m[1])
			}
		}
		if strings.Contains(string(op.Body), "$ref") {
			t.Errorf("%s: body schema still has a $ref", op.ID)
		}
	}
}

func TestBearerRoutes(t *testing.T) {
	allow := openapi.BearerRoutes("POST /api/mcp")
	for _, c := range []struct {
		method, path, resource string
		allowed, write         bool
	}{
		{"GET", "/api/v1/clients", "clients", true, false},
		{"HEAD", "/api/v1/clients", "clients", true, false},
		{"POST", "/api/v1/clients", "clients", true, true},
		{"PATCH", "/api/v1/clients/cli_1", "clients", true, true},
		{"DELETE", "/api/v1/clients/cli_1", "clients", true, true},
		{"POST", "/api/v1/clients/bulk", "", false, false},
		{"POST", "/api/v1/invoices/inv_1/issue", "invoices", true, true},
		{"GET", "/api/v1/reports/key-figures", "reports", true, false},
		{"POST", "/api/mcp", "", true, false},
		{"GET", "/api/mcp", "", false, false},
		{"GET", "/api/v1/session", "", false, false},
		{"POST", "/api/v1/account/tokens", "", false, false},
		{"GET", "/api/v1/members", "", false, false},
		{"POST", "/api/v1/billing/checkout", "", false, false},
		{"GET", "/api/v1/clients/cli_1/files", "clients", true, false},
		{"POST", "/api/v1/clients/cli_1/portal-invitation", "", false, false},
		{"PUT", "/api/v1/invoice-settings", "", false, false},
	} {
		allowed, resource, write := allow(httptest.NewRequest(c.method, c.path, nil))
		if allowed != c.allowed || resource != c.resource || write != c.write {
			t.Errorf("%s %s: %v %q %v, want %v %q %v", c.method, c.path, allowed, resource, write, c.allowed, c.resource, c.write)
		}
	}
}

// TestResources: every tag is one resource; the platform's scope matrix (src/lib/token-scopes.ts) lists the same.
func TestResources(t *testing.T) {
	got := openapi.Resources()
	tags := map[string]bool{}
	for _, op := range openapi.Operations {
		tags[op.Tag] = true
		if op.Resource != strings.ToLower(op.Tag) {
			t.Errorf("%s: resource %q", op.ID, op.Resource)
		}
	}
	if len(got) != len(tags) {
		t.Fatalf("%d resources for %d tags: %+v", len(got), len(tags), got)
	}
	writable := map[string]bool{}
	for _, r := range got {
		writable[r.Name] = r.Writable
	}
	if !writable["clients"] || !writable["invoices"] || writable["reports"] {
		t.Fatalf("writable: %+v", writable)
	}
}

func TestServesDocument(t *testing.T) {
	mux := http.NewServeMux()
	openapi.Register(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/openapi.json", nil))
	var doc struct {
		OpenAPI string         `json:"openapi"`
		Paths   map[string]any `json:"paths"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &doc) != nil || doc.OpenAPI != "3.1.0" || len(doc.Paths) == 0 {
		t.Fatalf("%d %.200s", rec.Code, rec.Body)
	}
}
