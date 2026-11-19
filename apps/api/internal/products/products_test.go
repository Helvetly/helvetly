package products

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// ---- the test server ----

type env struct {
	t   *testing.T
	st  *store.Store
	raw *pgxpool.Pool
	srv *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	New(st, a, discard).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv}
}

type browser struct{ token, csrf, workspace string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func (e *env) send(b *browser, method, path string, body any) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	switch v := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(v)
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	resp, raw := e.send(b, method, path, body)
	if resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

// fails checks the error code and, for validation, exactly which fields failed.
func (e *env) fails(b *browser, method, path string, body any, status int, code string, fields ...string) {
	e.t.Helper()
	var out struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Fields map[string]string `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
	got := []string{}
	for f := range out.Error.Details.Fields {
		got = append(got, f)
	}
	slices.Sort(got)
	slices.Sort(fields)
	if len(fields) > 0 && !slices.Equal(got, fields) {
		e.t.Fatalf("%s %s: invalid fields %v, want %v", method, path, out.Error.Details.Fields, fields)
	}
}

// product is the JSON as a client reads it (decimals as strings).
type product struct {
	ID, Type, Name, Currency     string
	SKU, GTIN, Unit, Description *string
	UnitPrice                    string `json:"unit_price"`
	UnitPriceNet                 string `json:"unit_price_net"`
	UnitPriceGross               string `json:"unit_price_gross"`
	VATCategory                  string `json:"vat_category"`
	VATRate                      string `json:"vat_rate"`
	IsArchived                   bool   `json:"is_archived"`
	PriceBasis                   string `json:"price_basis"`
}

func (e *env) create(b *browser, body any) product {
	e.t.Helper()
	var out struct{ Data product }
	e.do(b, "POST", "/api/v1/products", body, 201, &out)
	return out.Data
}

func names(list []product) []string {
	n := []string{}
	for _, p := range list {
		n = append(n, p.Name)
	}
	return n
}

// ---- tests ----

func TestCreateDerivesPrices(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	tests := []struct {
		name                       string
		body                       string
		category, rate, net, gross string
	}{
		{"net basis at the default rate", `{"name":"Consulting","unit_price":"100"}`, "S", "8.1", "100.00", "108.10"},
		{"gross basis, exact", `{"name":"Book","price_basis":"gross","unit_price":"108.10"}`, "S", "8.1", "100.00", "108.10"},
		{"gross basis rounds the VAT once", `{"name":"Coffee","price_basis":"gross","unit_price":10}`, "S", "8.1", "9.25", "10.00"},
		{"reduced rate as a JSON number literal", `{"name":"Food","unit_price":12.35,"vat_rate":2.6}`, "S", "2.6", "12.35", "12.67"},
		{"exempt has no VAT", `{"name":"Course","unit_price":"50","vat_category":"E"}`, "E", "0", "50.00", "50.00"},
	}
	for _, tt := range tests {
		p := e.create(b, tt.body)
		if p.VATCategory != tt.category || p.VATRate != tt.rate || p.UnitPriceNet != tt.net || p.UnitPriceGross != tt.gross {
			t.Errorf("%s: %s %s net %s gross %s, want %s %s %s %s", tt.name, p.VATCategory, p.VATRate, p.UnitPriceNet,
				p.UnitPriceGross, tt.category, tt.rate, tt.net, tt.gross)
		}
	}
	p := e.create(b, map[string]any{"name": "  Widget ", "unit_price": "1", "type": "product", "sku": "W-1/a", "gtin": "4006381333931",
		"unit": "piece", "currency": "eur", "description": "Blue\r\nlarge"})
	if !strings.HasPrefix(p.ID, "prd_") || p.Name != "Widget" || p.Type != "product" || *p.SKU != "W-1/a" || *p.GTIN != "4006381333931" ||
		*p.Unit != "piece" || p.Currency != "EUR" || *p.Description != "Blue\nlarge" || p.PriceBasis != "net" || p.IsArchived {
		t.Fatalf("created: %+v", p)
	}
	// Moving off S zeroes the rate; back to S takes the default rate.
	var out struct{ Data product }
	e.do(b, "PATCH", "/api/v1/products/"+p.ID, map[string]any{"vat_category": "Z"}, 200, &out)
	if out.Data.VATRate != "0" || out.Data.UnitPriceGross != "1.00" {
		t.Fatalf("zero-rated: %+v", out.Data)
	}
	e.do(b, "PATCH", "/api/v1/products/"+p.ID, map[string]any{"vat_category": "S", "description": nil}, 200, &out)
	if out.Data.VATRate != "8.1" || out.Data.Description != nil {
		t.Fatalf("back to standard: %+v", out.Data)
	}
}

func TestValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	tests := []struct {
		body   any
		status int
		code   string
		fields []string
	}{
		{map[string]any{}, 422, "validation_failed", []string{"name", "unit_price"}},
		{map[string]any{"name": " ", "unit_price": "-1"}, 422, "validation_failed", []string{"name", "unit_price"}},
		{map[string]any{"name": "A", "unit_price": "1.234"}, 422, "validation_failed", []string{"unit_price"}},
		{map[string]any{"name": "A", "unit_price": "100000000.01"}, 422, "validation_failed", []string{"unit_price"}},
		{map[string]any{"name": "A", "unit_price": "1", "sku": "has space"}, 422, "validation_failed", []string{"sku"}},
		{map[string]any{"name": "A", "unit_price": "1", "type": "product", "gtin": "4006381333932"}, 422, "validation_failed", []string{"gtin"}},
		{map[string]any{"name": "A", "unit_price": "1", "type": "product", "gtin": "1234567"}, 422, "validation_failed", []string{"gtin"}},
		{map[string]any{"name": "A", "unit_price": "1", "gtin": "96385074"}, 422, "validation_failed", []string{"gtin"}}, // a service
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "0"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "150"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "100.01"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "-1"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "kkk2.6"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "12,5"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_rate": "8.123"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "vat_category": "Z", "vat_rate": "8.1"}, 422, "validation_failed", []string{"vat_rate"}},
		{map[string]any{"name": "A", "unit_price": "1", "unit": "litre", "currency": "XXX", "type": "thing"}, 422, "validation_failed",
			[]string{"unit", "currency", "type"}},
		{map[string]any{"name": "A", "unit_price": "1", "colour": "red"}, 400, "invalid_request", nil},
	}
	for _, tt := range tests {
		e.fails(b, "POST", "/api/v1/products", tt.body, tt.status, tt.code, tt.fields...)
	}
	// Valid GTIN-8, -12 and -14 check digits.
	for _, g := range []string{"96385074", "036000291452", "10012345678902"} {
		e.create(b, map[string]any{"name": "G" + g, "unit_price": "1", "type": "product", "gtin": g})
	}
}

func TestSKUUniqueAmongActive(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	first := e.create(b, map[string]any{"name": "First", "unit_price": "1", "sku": "ABC-1"})
	e.fails(b, "POST", "/api/v1/products", map[string]any{"name": "Second", "unit_price": "1", "sku": "abc-1"}, 422, "validation_failed", "sku")

	e.do(b, "POST", "/api/v1/products/"+first.ID+"/archive", nil, 200, nil)
	second := e.create(b, map[string]any{"name": "Second", "unit_price": "1", "sku": "abc-1"}) // archived SKUs are free
	e.fails(b, "POST", "/api/v1/products/"+first.ID+"/unarchive", nil, 422, "validation_failed", "sku")

	var bulk struct {
		Data struct {
			Updated int
			Skipped []struct{ ID, Reason string }
		}
	}
	e.do(b, "POST", "/api/v1/products/bulk", map[string]any{"ids": []string{first.ID, second.ID}, "action": "unarchive"}, 200, &bulk)
	if bulk.Data.Updated != 0 || len(bulk.Data.Skipped) != 2 {
		t.Fatalf("bulk unarchive: %+v", bulk.Data)
	}
	e.do(b, "POST", "/api/v1/products/bulk", map[string]any{"ids": []string{second.ID}, "action": "archive"}, 200, &bulk)
	e.do(b, "POST", "/api/v1/products/bulk", map[string]any{"ids": []string{first.ID, second.ID}, "action": "unarchive"}, 200, &bulk)
	if bulk.Data.Updated != 1 || len(bulk.Data.Skipped) != 1 || bulk.Data.Skipped[0].Reason != skuReason {
		t.Fatalf("one of two restored: %+v", bulk.Data)
	}
	// Editing into a taken SKU is a 422 as well, and duplicates never copy it.
	third := e.create(b, map[string]any{"name": "Third", "unit_price": "1"})
	e.fails(b, "PATCH", "/api/v1/products/"+third.ID, map[string]any{"sku": "ABC-1"}, 422, "validation_failed", "sku")
	var dup struct{ Data product }
	e.do(b, "POST", "/api/v1/products/"+first.ID+"/duplicate", nil, 201, &dup)
	if dup.Data.SKU != nil || dup.Data.Name != "First (copy)" || dup.Data.IsArchived {
		t.Fatalf("duplicate: %+v", dup.Data)
	}
}

func TestPermissionsAndScope(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	p := e.create(member, map[string]any{"name": "Made by a member", "unit_price": "1"})
	e.do(member, "PATCH", "/api/v1/products/"+p.ID, map[string]any{"name": "Renamed"}, 200, nil)
	e.do(member, "POST", "/api/v1/products/"+p.ID+"/duplicate", nil, 201, nil)
	for _, path := range []string{"/archive", "/unarchive"} {
		e.fails(member, "POST", "/api/v1/products/"+p.ID+path, nil, 403, "forbidden")
	}
	e.fails(member, "DELETE", "/api/v1/products/"+p.ID, nil, 403, "forbidden")
	e.fails(member, "POST", "/api/v1/products/bulk", map[string]any{"ids": []string{p.ID}, "action": "delete"}, 403, "forbidden")

	other := e.workspace()
	e.fails(other, "GET", "/api/v1/products/"+p.ID, nil, 404, "not_found")
	e.fails(other, "PATCH", "/api/v1/products/"+p.ID, map[string]any{"name": "X"}, 404, "not_found")
	e.fails(other, "DELETE", "/api/v1/products/"+p.ID, nil, 404, "not_found")

	e.do(owner, "DELETE", "/api/v1/products/"+p.ID, nil, 204, nil)
	e.fails(owner, "GET", "/api/v1/products/"+p.ID, nil, 404, "not_found")
}

func TestListSearchAndExport(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.create(b, map[string]any{"name": "Webdesign Paket", "unit_price": "900", "sku": "WEB"})
	e.create(b, map[string]any{"name": "Hosting web", "unit_price": "20", "currency": "EUR"})
	e.create(b, map[string]any{"name": "Stunde Web", "unit_price": "150"})
	e.create(b, map[string]any{"name": "Webcam", "unit_price": "80", "type": "product", "currency": "EUR"})
	e.create(b, map[string]any{"name": "=cmd()", "unit_price": "1", "type": "product", "description": "spreadsheet"})
	gone := e.create(b, map[string]any{"name": "Web archive", "unit_price": "5"})
	e.do(b, "POST", "/api/v1/products/"+gone.ID+"/archive", nil, 200, nil)

	type listOut struct {
		Data []product
	}
	tests := []struct{ query, want string }{
		{"", "=cmd(),Hosting web,Stunde Web,Webcam,Webdesign Paket"},
		{"type=product", "=cmd(),Webcam"},
		{"status=archived", "Web archive"},
		{"currency=EUR", "Hosting web,Webcam"},
		{"search=web&sort=-unit_price", "Webdesign Paket,Stunde Web,Webcam,Hosting web"},
		{"search=spread", "=cmd()"},
	}
	for _, tt := range tests {
		var out listOut
		e.do(b, "GET", "/api/v1/products?"+tt.query, nil, 200, &out)
		if got := strings.Join(names(out.Data), ","); got != tt.want {
			t.Errorf("list ?%s = %s, want %s", tt.query, got, tt.want)
		}
	}
	e.fails(b, "GET", "/api/v1/products?sort=price", nil, 400, "invalid_request")

	var found struct{ Data []product }
	e.do(b, "GET", "/api/v1/products/search?q=web&currency=EUR", nil, 200, &found)
	// SKU equal first, then name prefixes (EUR first), then contains (EUR first); archived never.
	if got := strings.Join(names(found.Data), ","); got != "Webdesign Paket,Webcam,Hosting web,Stunde Web" {
		t.Fatalf("search ranking: %s", got)
	}
	e.do(b, "GET", "/api/v1/products/search?limit=2", nil, 200, &found)
	if len(found.Data) != 2 {
		t.Fatalf("search limit: %d", len(found.Data))
	}

	resp, body := e.send(b, "GET", "/api/v1/products/export?type=product", nil)
	if resp.StatusCode != 200 || !bytes.HasPrefix(body, []byte("\xEF\xBB\xBF")) ||
		!strings.Contains(resp.Header.Get("Content-Disposition"), "products-") {
		t.Fatalf("export: %d %s", resp.StatusCode, body)
	}
	rows, err := csv.NewReader(bytes.NewReader(body[3:])).ReadAll()
	if err != nil || len(rows) != 3 || rows[0][0] != "type" || rows[1][1] != "'=cmd()" || rows[2][1] != "Webcam" || rows[2][8] != "86.48" {
		t.Fatalf("export rows: %v %v", rows, err)
	}
}
