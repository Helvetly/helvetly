package clients

import (
	"context"
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func (e *env) request(b *browser, clientID string, fields map[string]any) {
	e.t.Helper()
	if _, err := e.st.UpsertChangeRequest(context.Background(), "ccr_"+clientID, b.workspace, clientID, "", fields, time.Now()); err != nil {
		e.t.Fatal(err)
	}
}

func TestParseProfile(t *testing.T) {
	raw := func(s string) map[string]json.RawMessage {
		return map[string]json.RawMessage{"city": json.RawMessage(s)}
	}
	if got, err := ParseProfile(raw(`" Bern "`)); err != nil || got["city"] != "Bern" {
		t.Fatalf("got %v, %v", got, err)
	}
	for _, tc := range []struct{ field, in, want string }{
		{"preferred_name", `" Anna Muster "`, "Anna Muster"},
		{"website", `"example.ch"`, "https://example.ch"},
	} {
		got, err := ParseProfile(map[string]json.RawMessage{tc.field: json.RawMessage(tc.in)})
		if err != nil || got[tc.field] != tc.want {
			t.Errorf("%s: got %v, %v", tc.field, got, err)
		}
	}
	for name, body := range map[string]map[string]json.RawMessage{
		"unknown": {"note": json.RawMessage(`"x"`)}, "empty": {}, "invalid": {"billing_email": json.RawMessage(`"nope"`)}, "null name": {"name": json.RawMessage(`null`)},
		"sign-in email": {"email": json.RawMessage(`"new@acme.ch"`)}, "bad website": {"website": json.RawMessage(`"not a site"`)},
	} {
		if _, err := ParseProfile(body); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestApproveAppliesAndDecides(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	e.request(b, c.ID, map[string]any{"city": "Bern", "name": "Acme AG"})
	var got struct {
		Data struct {
			Fields  map[string]any `json:"fields"`
			Current map[string]any `json:"current"`
		} `json:"data"`
	}
	e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, &got)
	if got.Data.Fields["city"] != "Bern" || got.Data.Current["city"] != "Zürich" || got.Data.Current["name"] != "Acme" {
		t.Fatalf("request = %+v", got)
	}
	var out struct{ Data struct{ Name, City string } }
	e.do(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/approve", nil, 200, &out)
	if out.Data.Name != "Acme AG" || out.Data.City != "Bern" {
		t.Fatalf("client = %+v", out.Data)
	}
	var none struct {
		Data *struct{} `json:"data"`
	}
	e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, &none)
	if none.Data != nil {
		t.Fatalf("data = %+v, want null", none.Data)
	}
}

func TestApproveInvalidKeepsPending(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	e.request(b, c.ID, map[string]any{"billing_email": "nope"})
	e.fails(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/approve", nil, 422, "validation_failed", "billing_email")
	e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, nil)
}

func TestApproveMember403(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	m := e.join(b.workspace, "member")
	c := e.create(b, address("Acme"))
	e.request(b, c.ID, map[string]any{"city": "Bern"})
	e.fails(m, "POST", "/api/v1/clients/"+c.ID+"/change-request/approve", nil, 403, "forbidden")
	e.fails(m, "POST", "/api/v1/clients/"+c.ID+"/change-request/reject", nil, 403, "forbidden")
	e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, nil)
}

func TestApproveNothingPending404(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	e.fails(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/approve", nil, 404, "not_found")
	e.fails(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/reject", nil, 404, "not_found")
}

func TestRejectKeepsClient(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	e.request(b, c.ID, map[string]any{"city": "Bern"})
	e.do(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/reject", nil, 204, nil)
	var out struct{ Data struct{ City string } }
	e.do(b, "GET", "/api/v1/clients/"+c.ID, nil, 200, &out)
	if out.Data.City != "Zürich" {
		t.Fatalf("city = %q", out.Data.City)
	}
	var none struct {
		Data *struct{} `json:"data"`
	}
	e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, &none)
	if none.Data != nil {
		t.Fatalf("data = %+v, want null", none.Data)
	}
}

func TestApproveChosenFields(t *testing.T) {
	requested := map[string]any{"name": "Acme AG", "city": "Bern", "zip": "3000", "phone": "+41 31 000 00 00"}
	for _, tc := range []struct {
		name               string
		body               any
		status             int
		wantName, wantCity string
		applied            []string
	}{
		{"no body applies all", nil, 200, "Acme AG", "Bern", []string{"city", "name", "phone", "zip"}},
		{"name only", map[string]any{"fields": []string{"name"}}, 200, "Acme AG", "Zürich", []string{"name"}},
		{"address group", map[string]any{"fields": []string{"address"}}, 200, "Acme", "Bern", []string{"city", "zip"}},
		{"empty list", map[string]any{"fields": []string{}}, 400, "Acme", "Zürich", nil},
		{"field not requested", map[string]any{"fields": []string{"vat_number"}}, 400, "Acme", "Zürich", nil},
		{"address part alone", map[string]any{"fields": []string{"city"}}, 400, "Acme", "Zürich", nil},
		{"unknown key", map[string]any{"fields": []string{"name"}, "extra": true}, 400, "Acme", "Zürich", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			c := e.create(b, address("Acme"))
			e.request(b, c.ID, requested)
			if tc.status != 200 {
				e.fails(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/approve", tc.body, tc.status, "invalid_request")
				e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, nil)
			} else {
				e.do(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/approve", tc.body, 200, nil)
			}
			var out struct{ Data struct{ Name, City string } }
			e.do(b, "GET", "/api/v1/clients/"+c.ID, nil, 200, &out)
			if out.Data.Name != tc.wantName || out.Data.City != tc.wantCity {
				t.Fatalf("client = %+v", out.Data)
			}
			if tc.status != 200 {
				return
			}
			got, err := e.st.LastDecidedChangeRequest(context.Background(), b.workspace, c.ID)
			if err != nil || got.Status != "approved" || !slices.Equal(got.Applied, tc.applied) {
				t.Fatalf("decided = %+v, %v; want applied %v", got, err, tc.applied)
			}
		})
	}
}

func TestRejectReason(t *testing.T) {
	for _, tc := range []struct {
		name   string
		body   any
		status int
		want   *string
	}{
		{"no body", nil, 204, nil},
		{"blank", map[string]any{"reason": "   "}, 204, nil},
		{"trimmed", map[string]any{"reason": "  The VAT number is not yours. "}, 204, new("The VAT number is not yours.")},
		{"500 runes", map[string]any{"reason": strings.Repeat("ü", 500)}, 204, new(strings.Repeat("ü", 500))},
		{"too long", map[string]any{"reason": strings.Repeat("a", 501)}, 422, nil},
		{"not a string", map[string]any{"reason": 5}, 400, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			c := e.create(b, address("Acme"))
			e.request(b, c.ID, map[string]any{"city": "Bern"})
			if tc.status != 204 {
				code := map[int]string{422: "validation_failed", 400: "invalid_request"}[tc.status]
				e.fails(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/reject", tc.body, tc.status, code)
				e.do(b, "GET", "/api/v1/clients/"+c.ID+"/change-request", nil, 200, nil)
				return
			}
			e.do(b, "POST", "/api/v1/clients/"+c.ID+"/change-request/reject", tc.body, 204, nil)
			got, err := e.st.LastDecidedChangeRequest(context.Background(), b.workspace, c.ID)
			if err != nil || got.Status != "rejected" || got.Applied != nil {
				t.Fatalf("decided = %+v, %v", got, err)
			}
			if (got.Reason == nil) != (tc.want == nil) || got.Reason != nil && *got.Reason != *tc.want {
				t.Fatalf("reason = %v, want %v", got.Reason, tc.want)
			}
		})
	}
}

func TestListPendingChangeRequest(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	asked := e.create(b, address("Acme"))
	quiet := e.create(b, address("Beta"))
	decided := e.create(b, address("Gamma"))
	e.request(b, asked.ID, map[string]any{"city": "Bern"})
	e.request(b, decided.ID, map[string]any{"city": "Bern"})
	e.do(b, "POST", "/api/v1/clients/"+decided.ID+"/change-request/reject", nil, 204, nil)
	var out struct{ Data []store.Client }
	e.do(b, "GET", "/api/v1/clients", nil, 200, &out)
	got := map[string]bool{}
	for _, c := range out.Data {
		got[c.ID] = c.PendingChange
	}
	if want := map[string]bool{asked.ID: true, quiet.ID: false, decided.ID: false}; !maps.Equal(got, want) {
		t.Fatalf("pending = %v, want %v", got, want)
	}
}
