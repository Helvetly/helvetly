package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

type fakeFiles struct {
	mu      sync.Mutex
	objects map[string][]byte
	proxy   bool // S3_PROXY_DOWNLOADS
}

func (f *fakeFiles) Put(_ context.Context, key string, body io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return err
}

func (f *fakeFiles) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

type object struct{ *bytes.Reader }

func (object) Close() error { return nil }
func (f *fakeFiles) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	b, err := f.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return object{bytes.NewReader(b)}, nil
}

func (f *fakeFiles) ProxyDownloads() bool { return f.proxy }

func (f *fakeFiles) Get(_ context.Context, key string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("no object %s", key)
	}
	return b, nil
}

func (f *fakeFiles) PresignDownload(_ context.Context, key string, _ time.Duration, filename string) (string, error) {
	return "https://s3.example/" + key + "?name=" + filename, nil
}

func (e *env) invoice(id, client, status string, number any, pdfKey any) {
	e.exec(`INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date, currency, language, vat_mode,
		discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, pdf_key, created_at, updated_at)
		VALUES ($1,'wsp_a','invoice',$2,$3,$4,'2026-01-05','2026-02-05','CHF','en','exclusive',0,10000,0,10000,810,10810,0,'[]',$5,now(),now())`,
		id, status, number, client, pdfKey)
}

func (e *env) get(c *http.Cookie, path string) (*http.Response, string) {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+"/w/studio/api/v1/public/portal"+path, nil)
	req.AddCookie(c)
	res, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func TestInvoicesNoDrafts(t *testing.T) {
	e := newEnv(t)
	e.invoice("inv_ok", "cli_1", "open", "2026-0001", "pdf/ok")
	e.invoice("inv_draft", "cli_1", "draft", nil, nil)
	e.invoice("inv_other", "cli_2", "open", "2026-0002", "pdf/other")
	c, _ := e.signIn("ana@acme.ch")
	res, body := e.get(c, "/invoices")
	if res.StatusCode != 200 || !strings.Contains(body, "inv_ok") || strings.Contains(body, "inv_draft") || strings.Contains(body, "inv_other") ||
		!strings.Contains(body, `"total":"108.10"`) {
		t.Fatalf("got %d %s", res.StatusCode, body)
	}
}

func TestInvoicePDFOtherClient404(t *testing.T) {
	e := newEnv(t)
	e.files.objects["pdf/ok"] = []byte("%PDF-ok")
	e.invoice("inv_ok", "cli_1", "open", "2026-0001", "pdf/ok")
	e.invoice("inv_draft", "cli_1", "draft", nil, nil)
	e.invoice("inv_other", "cli_2", "open", "2026-0002", "pdf/other")
	c, _ := e.signIn("ana@acme.ch")
	res, body := e.get(c, "/invoices/inv_ok/pdf")
	if res.StatusCode != 200 || body != "%PDF-ok" || res.Header.Get("Content-Type") != "application/pdf" ||
		!strings.Contains(res.Header.Get("Content-Disposition"), "2026-0001.pdf") || res.Header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("own: %d %q %v", res.StatusCode, body, res.Header)
	}
	for _, id := range []string{"inv_other", "inv_draft", "inv_missing"} {
		if res, _ := e.get(c, "/invoices/"+id+"/pdf"); res.StatusCode != 404 {
			t.Fatalf("%s: %d", id, res.StatusCode)
		}
	}
}

func (e *env) document(id string, trashed bool) {
	e.exec(`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at, deleted_at)
		VALUES ($1,'wsp_a',$1 || '.pdf',12,'application/pdf','obj/' || $1,now(),now(),CASE WHEN $2 THEN now() END)`, id, trashed)
}

func TestDocumentDownloadNotShared404(t *testing.T) {
	e := newEnv(t)
	for id, trashed := range map[string]bool{"doc_shared": false, "doc_private": false, "doc_trash": true} {
		e.document(id, trashed)
	}
	e.exec(`INSERT INTO document_shares (document_id, client_id, workspace_id, created_at) VALUES ('doc_shared','cli_1','wsp_a',now()), ('doc_trash','cli_1','wsp_a',now())`)
	c, _ := e.signIn("ana@acme.ch")
	if res, body := e.get(c, "/documents"); res.StatusCode != 200 || !strings.Contains(body, "doc_shared") || strings.Contains(body, "doc_private") || strings.Contains(body, "doc_trash") {
		t.Fatalf("list: %d %s", res.StatusCode, body)
	}
	res, _ := e.get(c, "/documents/doc_shared/download")
	if res.StatusCode != 302 || !strings.HasPrefix(res.Header.Get("Location"), "https://s3.example/obj/doc_shared") {
		t.Fatalf("download: %d %v", res.StatusCode, res.Header)
	}
	e.files.proxy = true // S3_PROXY_DOWNLOADS: the API streams the bytes itself
	e.files.objects["obj/doc_shared"] = []byte("%PDF-shared")
	if res, body := e.get(c, "/documents/doc_shared/download"); res.StatusCode != 200 || body != "%PDF-shared" ||
		res.Header.Get("Content-Disposition") != "attachment; filename=doc_shared.pdf" {
		t.Fatalf("proxied download: %d %v %q", res.StatusCode, res.Header, body)
	}
	for _, id := range []string{"doc_private", "doc_trash"} {
		if res, _ := e.get(c, "/documents/"+id+"/download"); res.StatusCode != 404 {
			t.Fatalf("proxied %s: %d", id, res.StatusCode)
		}
	}
	e.files.proxy = false
	for _, id := range []string{"doc_private", "doc_trash"} {
		if res, _ := e.get(c, "/documents/"+id+"/download"); res.StatusCode != 404 {
			t.Fatalf("%s: %d", id, res.StatusCode)
		}
	}
	// shared with the other client only
	e.exec(`INSERT INTO document_shares (document_id, client_id, workspace_id, created_at) VALUES ('doc_private','cli_2','wsp_a',now())`)
	if res, _ := e.get(c, "/documents/doc_private/download"); res.StatusCode != 404 {
		t.Fatalf("other client's share: %d", res.StatusCode)
	}
}

func (e *env) engagement(id, client, cancelled string, number, used int) {
	e.exec(`INSERT INTO engagements (id, workspace_id, number, client_id, title, unit, quantity, billing, price_basis, unit_price, currency, vat_category, vat_rate,
		start_date, recurrence, interval, cancelled_on, created_at, updated_at)
		VALUES ($1,'wsp_a',$4,$2,$1,'hour',10000,'arrears','net',15000,'CHF','S',810,current_date - 5,'monthly',1,NULLIF($3,'')::date,now(),now())`, id, client, cancelled, number)
	e.exec(`INSERT INTO engagement_periods (id, engagement_id, idx, starts_on, ends_on, natural_ends_on, full_quantity, quantity, unit_price, overage_unit_price)
		VALUES ('per_' || $1,$1,1,current_date - 5,current_date + 20,current_date + 20,10000,10000,15000,15000)`, id)
	e.exec(`INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, created_at)
		VALUES ('ent_' || $1,$1,'per_' || $1,current_date,$2,now())`, id, used)
}

func TestEngagementsActiveAndPast(t *testing.T) {
	e := newEnv(t)
	e.engagement("eng_live", "cli_1", "", 1, 12500)
	e.engagement("eng_cancel", "cli_1", "2020-01-01", 2, 1000)
	e.engagement("eng_other", "cli_2", "", 3, 1000)
	c, _ := e.signIn("ana@acme.ch")
	res, body := e.get(c, "/engagements")
	if res.StatusCode != 200 || strings.Contains(body, "eng_other") ||
		!strings.Contains(body, `"quantity":"10"`) || !strings.Contains(body, `"used":"12.5"`) || !strings.Contains(body, `"remaining":"0"`) || !strings.Contains(body, `"overage":"2.5"`) {
		t.Fatalf("got %d %s", res.StatusCode, body)
	}
	var out struct {
		Data []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, d := range out.Data {
		got[d.ID] = d.Status
	}
	if len(got) != 2 || got["eng_live"] != "active" || got["eng_cancel"] != "cancelled" {
		t.Fatalf("statuses: %v", got)
	}
}

func TestPortalStatus(t *testing.T) {
	d := func(s string) *string { return &s }
	period := func(ends string, remaining invoicecalc.Quantity) *periodView {
		return &periodView{StartsOn: "2026-11-01", EndsOn: ends, Remaining: remaining}
	}
	for _, c := range []struct {
		name   string
		e      store.Engagement
		period *periodView
		want   string
	}{
		{"running monthly", store.Engagement{StartDate: "2026-01-01", Recurrence: "monthly"}, period("2026-11-30", 5000), "active"},
		{"monthly used up stays active", store.Engagement{StartDate: "2026-01-01", Recurrence: "monthly"}, period("2026-11-30", 0), "active"},
		{"monthly whose next period is not opened yet", store.Engagement{StartDate: "2026-01-01", Recurrence: "monthly"}, period("2026-10-31", 5000), "active"},
		{"ended", store.Engagement{StartDate: "2026-01-01", Recurrence: "monthly", EndDate: d("2026-10-31")}, period("2026-10-31", 5000), "ended"},
		{"cancelled", store.Engagement{StartDate: "2026-01-01", Recurrence: "monthly", CancelledOn: d("2026-11-01")}, period("2026-11-30", 5000), "cancelled"},
		{"one-off running", store.Engagement{StartDate: "2026-11-01", Recurrence: "none"}, period("2026-11-30", 5000), "active"},
		{"one-off used up", store.Engagement{StartDate: "2026-11-01", Recurrence: "none"}, period("2026-11-30", 0), "used_up"},
		{"one-off period over", store.Engagement{StartDate: "2026-10-01", Recurrence: "none"}, period("2026-10-31", 5000), "expired"},
		{"one-off without a period", store.Engagement{StartDate: "2026-11-01", Recurrence: "none"}, nil, "active"},
	} {
		if got := portalStatus(c.e, c.period, "2026-11-20"); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

func TestEngagementEntries(t *testing.T) {
	e := scopedEnv(t)
	e.engagement("eng_live", "cli_1", "", 1, 1500)
	e.engagement("eng_other", "cli_2", "", 2, 1000)
	e.exec(`UPDATE engagement_entries SET note = 'Grammar', client_performance = 'Well prepared', created_by = NULL WHERE id = 'ent_eng_live'`)
	e.exec(`INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, note, created_at)
		VALUES ('ent_old','eng_live','per_eng_live',current_date - 1,500,'Older',now())`)
	// The same login is a client of the other workspace too.
	e.exec(`INSERT INTO engagements (id, workspace_id, number, client_id, title, unit, quantity, billing, price_basis, unit_price, currency, vat_category, vat_rate,
		start_date, recurrence, interval, created_at, updated_at)
		VALUES ('eng_b','wsp_b',1,'cli_9','B','hour',10000,'arrears','net',15000,'CHF','S',810,current_date - 5,'monthly',1,now(),now())`)
	c, _ := e.signIn("ana@acme.ch")

	res, body := e.get(c, "/engagements/eng_live/entries")
	if res.StatusCode != 200 {
		t.Fatalf("own: %d %s", res.StatusCode, body)
	}
	var out struct {
		Data []struct {
			StartsOn string           `json:"starts_on"`
			Entries  []map[string]any `json:"entries"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || len(out.Data) != 1 || len(out.Data[0].Entries) != 2 {
		t.Fatalf("shape: %v %s", err, body)
	}
	first := out.Data[0].Entries[0] // newest first
	if first["id"] != "ent_eng_live" || first["quantity"] != "1.5" || first["note"] != "Grammar" || first["client_performance"] != "Well prepared" {
		t.Fatalf("first: %v", first)
	}
	if len(first) != 5 {
		t.Fatalf("exposes more than date, quantity, note and client performance: %v", first)
	}

	for _, tc := range []struct{ name, path string }{
		{"another client of the workspace", "/engagements/eng_other/entries"},
		{"the same login's client in another workspace", "/engagements/eng_b/entries"},
		{"missing", "/engagements/eng_missing/entries"},
	} {
		if res, body := e.get(c, tc.path); res.StatusCode != 404 {
			t.Errorf("%s: %d %s", tc.name, res.StatusCode, body)
		}
	}
	if res, _ := e.get(&http.Cookie{Name: sessionCookie + "_wsp_a", Value: "x"}, "/engagements/eng_live/entries"); res.StatusCode != 401 {
		t.Errorf("signed out: %d", res.StatusCode)
	}

	// A session scoped to the other workspace reaches only that workspace's engagement.
	sc, _ := e.signInAt("/w/other", "ana@acme.ch")
	if res, _ := e.doAt("/w/other", "GET", "/engagements/eng_b/entries", nil, sc, ""); res.StatusCode != 200 {
		t.Errorf("scoped own: %d", res.StatusCode)
	}
	if res, _ := e.doAt("/w/other", "GET", "/engagements/eng_live/entries", nil, sc, ""); res.StatusCode != 404 {
		t.Errorf("scoped other workspace: %d", res.StatusCode)
	}
}
