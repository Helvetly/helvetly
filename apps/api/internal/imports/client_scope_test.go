package imports

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// uploadFor uploads one file as an import of kind for the client (no client_id when "").
func (e *env) uploadFor(kind, clientID string) *httptest.ResponseRecorder {
	e.t.Helper()
	var b bytes.Buffer
	form := multipart.NewWriter(&b)
	_ = form.WriteField("kind", kind)
	if clientID != "" {
		_ = form.WriteField("client_id", clientID)
	}
	f, _ := form.CreateFormFile("files[]", "invoice.pdf")
	_, _ = f.Write([]byte("%PDF-1.7 invoice for " + clientID))
	_ = form.Close()
	r := httptest.NewRequest("POST", "/api/v1/imports", &b)
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, r)
	return w
}

func (e *env) clients(t *testing.T) {
	t.Helper()
	ctx, now := context.Background(), time.Now()
	e.person("ws_b", "usr_b", "owner", nil)
	for _, c := range []struct{ ws, id, name string }{
		{"ws_a", "cli_mine", "Kunde AG"}, {"ws_a", "cli_gone", "Alt AG"}, {"ws_b", "cli_other", "Fremd AG"},
	} {
		if err := e.db.CreateClient(ctx, c.ws, c.id, map[string]any{"name": c.name}, now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.raw.Exec(ctx, `UPDATE clients SET deleted_at = now() WHERE id = 'cli_gone'`); err != nil {
		t.Fatal(err)
	}
}

func TestUploadClientScope(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.clients(t)
	for _, tc := range []struct {
		name, kind, client string
		status             int
		want               *string
	}{
		{"no client: any client", "invoices", "", 201, nil},
		{"own client", "invoices", "cli_mine", 201, new("cli_mine")},
		{"another workspace's client", "invoices", "cli_other", 400, nil},
		{"deleted client", "invoices", "cli_gone", 400, nil},
		{"unknown client", "invoices", "cli_nope", 400, nil},
		{"not an invoice import", "clients", "cli_mine", 400, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := e.uploadFor(tc.kind, tc.client)
			if w.Code != tc.status {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.status, w.Body)
			}
			if w.Code != 201 {
				return
			}
			b := decode[store.ImportBatch](t, w)
			if (b.ClientID == nil) != (tc.want == nil) || (b.ClientID != nil && *b.ClientID != *tc.want) {
				t.Fatalf("client_id %v, want %v", b.ClientID, tc.want)
			}
		})
	}
}

func TestClientScopedImportAssignsEveryInvoice(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.clients(t)
	invoice := `{"client_id":"cli_other","client_name":"Somebody Else GmbH","number":"RE-%d","issue_date":"2025-10-01",
		"due_date":"2025-10-31","currency":"CHF","price_basis":"net","total":"108.10","lines":[{"description":"Beratung",
		"quantity":"1","unit":"hour","unit_price":"100.00","vat_category":"S","vat_rate":"8.1"}]}`
	e.model.replies = append(e.model.replies, answer(`{"records":[`+strings.ReplaceAll(invoice, "%d", "1")+`,`+strings.ReplaceAll(invoice, "%d", "2")+`]}`))
	b := decode[store.ImportBatch](t, e.uploadFor("invoices", "cli_mine"))
	got := e.extracted(b.ID)
	if got.ClientName == nil || *got.ClientName != "Kunde AG" || len(got.Records) != 2 {
		t.Fatalf("batch: %+v", got)
	}
	if !strings.Contains(e.model.seen[0].Message, `billed to the business's client "Kunde AG"`) {
		t.Fatalf("model not told the client: %s", e.model.seen[0].Message)
	}
	for _, r := range got.Records {
		if string(r.Data["client_id"]) != `"cli_mine"` || string(r.Data["client_name"]) != `"Kunde AG"` || r.Issues["client_id"] != "" {
			t.Fatalf("record not the client's: %s %v", r.Data["client_id"], r.Issues)
		}
	}
	// An edit cannot move an invoice to another client, of this workspace or another.
	rec := got.Records[0].ID
	edited := decode[store.ImportRecord](t, e.do("PATCH", "/api/v1/imports/"+b.ID+"/records/"+rec,
		map[string]any{"data": map[string]any{"client_id": "cli_other", "client_name": "Fremd AG"}}))
	if string(edited.Data["client_id"]) != `"cli_mine"` {
		t.Fatalf("edit moved the client: %s", edited.Data["client_id"])
	}
	out := decode[commitOut](t, e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": []string{got.Records[0].ID, got.Records[1].ID}}))
	for _, r := range out.Results {
		if r.Status != "created" || r.EntityID == nil {
			t.Fatalf("commit: %+v", out.Results)
		}
		var client string
		if err := e.raw.QueryRow(context.Background(), `SELECT client_id FROM invoices WHERE id = $1`, *r.EntityID).Scan(&client); err != nil || client != "cli_mine" {
			t.Fatalf("invoice client %q: %v", client, err)
		}
	}
	summaries := decode[[]store.ImportBatchSummary](t, e.do("GET", "/api/v1/imports?kind=invoices&client_id=cli_mine", nil))
	if len(summaries) != 1 || summaries[0].ClientID == nil || *summaries[0].ClientID != "cli_mine" {
		t.Fatalf("summaries: %+v", summaries)
	}
}

func TestUnscopedInvoiceImportStillMatchesTheDocument(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.clients(t)
	e.model.replies = append(e.model.replies, answer(`{"records":[{"client_name":"Kunde AG","number":"RE-9","issue_date":"2025-10-01","currency":"CHF",
		"lines":[{"description":"X","quantity":"1","unit":"hour","unit_price":"10.00","vat_category":"S","vat_rate":"8.1"}]}]}`))
	b := decode[store.ImportBatch](t, e.uploadFor("invoices", ""))
	got := e.extracted(b.ID)
	if got.ClientID != nil || len(got.Records) != 1 || got.Records[0].Data["client_id"] != nil {
		t.Fatalf("unscoped batch: %+v", got)
	}
	if strings.Contains(e.model.seen[0].Message, "billed to the business's client") {
		t.Fatalf("model told a client: %s", e.model.seen[0].Message)
	}
}

// Each entry point lists only its own batches: an invoice import never shows on Engagements, a client's only in that
// client's drawer, a Documents import only in Documents.
func TestImportListPerContext(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.clients(t)
	ids := map[string]string{}
	for name, up := range map[string][2]string{
		"invoices": {"invoices", ""}, "client": {"invoices", "cli_mine"}, "engagements": {"engagements", ""}, "documents": {"auto", ""},
	} {
		ids[name] = decode[store.ImportBatch](t, e.uploadFor(up[0], up[1])).ID
	}
	for _, tc := range []struct {
		query  string
		status int
		want   []string
	}{
		{"kind=invoices", 200, []string{ids["invoices"]}},
		{"kind=invoices&client_id=cli_mine", 200, []string{ids["client"]}},
		{"kind=engagements", 200, []string{ids["engagements"]}},
		{"kind=auto", 200, []string{ids["documents"]}},
		{"kind=clients", 200, nil},
		{"kind=engagements&client_id=cli_mine", 400, nil},
		{"kind=invoices&client_id=cli_other", 400, nil},
		{"kind=invoices&client_id=", 400, nil},
	} {
		t.Run(tc.query, func(t *testing.T) {
			w := e.do("GET", "/api/v1/imports?"+tc.query, nil)
			if w.Code != tc.status {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.status, w.Body)
			}
			if w.Code != 200 {
				return
			}
			var got []string
			for _, b := range decode[[]store.ImportBatchSummary](t, w) {
				got = append(got, b.ID)
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("batches %v, want %v", got, tc.want)
			}
		})
	}
}
