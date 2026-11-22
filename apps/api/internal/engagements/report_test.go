package engagements

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"

	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
)

type fakeMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (f *fakeMailer) Send(_ context.Context, m mail.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return nil
}

// reportEnv has the real invoices service as the seller source (the producer of Seller).
func reportEnv(t *testing.T) (*env, *browser, view, string) {
	e := newEnv(t)
	e.svc.inv = invoices.New(e.st, e.svc.auth, nil, nil, e.svc.log)
	b := e.workspace()
	v := e.create(b, input(e.client(b), nil))
	e.entry(v.ID, "2026-11-05", 2500)
	return e, b, v, "/api/v1/engagements/" + v.ID
}

func TestReportPDF200(t *testing.T) {
	e, b, v, path := reportEnv(t)
	p := path + "/periods/" + e.periodList(b, v.ID)[0].ID + "/report"
	resp, raw := e.send(b, "GET", p, nil)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/pdf" || !strings.HasPrefix(string(raw), "%PDF-") {
		t.Fatalf("%d %q %.8q", resp.StatusCode, resp.Header.Get("Content-Type"), raw)
	}
	if d := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(d, "inline") {
		t.Fatal(d)
	}
	resp, _ = e.send(b, "GET", p+"?download=1", nil)
	if d := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(d, "attachment") || !strings.Contains(d, "German") {
		t.Fatal(d)
	}
}

func TestReportOtherWorkspace404(t *testing.T) {
	e, b, v, path := reportEnv(t)
	p := path + "/periods/" + e.periodList(b, v.ID)[0].ID + "/report"
	other := e.workspace()
	e.do(other, "GET", p, nil, http.StatusNotFound, nil)
	e.do(b, "GET", path+"/periods/nope/report", nil, http.StatusNotFound, nil)
}

func TestSendReportNoEmail422(t *testing.T) {
	e, b, v, path := reportEnv(t)
	e.svc.SetMailer(&fakeMailer{}, "https://x")
	e.fails(b, "POST", path+"/periods/"+e.periodList(b, v.ID)[0].ID+"/report/send", map[string]any{}, 422, "validation_failed", "to")
}

func TestSendReportBadBcc422(t *testing.T) {
	e, b, v, path := reportEnv(t)
	e.svc.SetMailer(&fakeMailer{}, "https://x")
	e.fails(b, "POST", path+"/periods/"+e.periodList(b, v.ID)[0].ID+"/report/send", map[string]any{"to": []string{"a@example.com"},
		"bcc": []string{"nope"}}, 422, "validation_failed", "bcc")
}

func TestSendReportAttachesPDF(t *testing.T) {
	e, b, v, path := reportEnv(t)
	m := &fakeMailer{}
	e.svc.SetMailer(m, "https://x")
	if _, err := e.pool.Exec(context.Background(), `UPDATE clients SET billing_email = 'bill@example.com'`); err != nil {
		t.Fatal(err)
	}
	var out struct {
		Data struct{ To []string } `json:"data"`
	}
	e.do(b, "POST", path+"/periods/"+e.periodList(b, v.ID)[0].ID+"/report/send", map[string]any{"cc": []string{"cc@example.com"},
		"bcc": []string{"bill@example.com", "CC@example.com", "audit@example.com"}}, 200, &out)
	if len(m.sent) != 1 || strings.Join(out.Data.To, ",") != "bill@example.com" || strings.Join(m.sent[0].Cc, ",") != "cc@example.com" ||
		strings.Join(m.sent[0].Bcc, ",") != "audit@example.com" {
		t.Fatalf("%+v %+v", out, m.sent)
	}
	a := m.sent[0].Attachments
	if len(a) != 1 || a[0].ContentType != "application/pdf" || !strings.HasPrefix(string(a[0].Data), "%PDF-") {
		t.Fatalf("%+v", a)
	}
}

func TestExportCSVInjection(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.create(b, input(e.client(b), map[string]any{"title": "=SUM(A1)"}))
	resp, raw := e.send(b, "GET", "/api/v1/engagements/export", nil)
	body := string(raw)
	if resp.StatusCode != 200 || !strings.HasPrefix(body, "\xEF\xBB\xBFnumber,title,client") || !strings.Contains(body, "'=SUM(A1)") {
		t.Fatalf("%d %q", resp.StatusCode, body)
	}
}

func TestEntriesExportPeriodFilter(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-10-01"}))
	e.entry(v.ID, "2026-10-05", 1000)
	e.entry(v.ID, "2026-11-05", 2000)
	path := "/api/v1/engagements/" + v.ID + "/entries/export"
	_, all := e.send(b, "GET", path, nil)
	if n := strings.Count(string(all), "\n"); n != 3 {
		t.Fatalf("all: %q", all)
	}
	first := e.periodList(b, v.ID)[1].ID // newest first
	resp, one := e.send(b, "GET", path+"?period_id="+first, nil)
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "-entries.csv") || strings.Count(string(one), "\n") != 2 ||
		!strings.Contains(string(one), "2026-10-05,2026-10-01,2026-10-31,1,hour") {
		t.Fatalf("%q %q", resp.Header.Get("Content-Disposition"), one)
	}
}

func TestReportFallbacks(t *testing.T) {
	e, b, v, path := reportEnv(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `UPDATE engagement_entries SET performed_by = NULL`); err != nil {
		t.Fatal(err)
	}
	_, raw := e.send(b, "GET", path+"/periods/"+e.periodList(b, v.ID)[0].ID+"/report", nil)
	// the PDF's text is UTF-16BE: "–" is 20 13, "Std." is 00 53 00 74 00 64 00 2E
	if !strings.Contains(string(raw), "\x20\x13)") {
		t.Fatalf("no dash %q", raw)
	}
	if !strings.Contains(string(raw), "\x00S\x00t\x00d\x00.)") {
		t.Fatal("unit in the row quantity")
	}
}

func TestSendReportMessageLimit(t *testing.T) {
	e, b, v, path := reportEnv(t)
	e.svc.SetMailer(&fakeMailer{}, "https://x")
	if _, err := e.pool.Exec(context.Background(), `UPDATE clients SET billing_email = 'bill@example.com'`); err != nil {
		t.Fatal(err)
	}
	send := path + "/periods/" + e.periodList(b, v.ID)[0].ID + "/report/send"
	for _, tc := range []struct {
		name  string
		runes int
		ok    bool
	}{
		{"at the limit, counted in characters not bytes", emailtemplate.MaxMessage, true},
		{"one over the limit", emailtemplate.MaxMessage + 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{"message": strings.Repeat("é", tc.runes)}
			if tc.ok {
				e.do(b, "POST", send, body, http.StatusOK, nil)
			} else {
				e.fails(b, "POST", send, body, http.StatusUnprocessableEntity, "validation_failed", "message")
			}
		})
	}
}
