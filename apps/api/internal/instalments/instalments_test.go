package instalments

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return err
}

func (f *fakeStorage) Get(_ context.Context, key string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("no object %q", key)
	}
	return b, nil
}

func (f *fakeStorage) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key, nil
}

func (f *fakeStorage) ProxyDownloads() bool { return false }

type object struct{ *bytes.Reader }

func (object) Close() error { return nil }
func (f *fakeStorage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	b, err := f.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return object{bytes.NewReader(b)}, nil
}

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

type fakeMailer struct {
	mu        sync.Mutex
	sendError error
	attempts  int
	sent      []mail.Message
	fail      bool
	delay     time.Duration // set before the job runs
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	time.Sleep(m.delay)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.attempts++
	if m.sendError != nil {
		return m.sendError
	}
	if m.fail {
		return errors.New("smtp down")
	}
	m.sent = append(m.sent, msg)
	return nil
}

// with: the messages whose subject starts with prefix.
func (m *fakeMailer) with(prefix string) []mail.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []mail.Message
	for _, msg := range m.sent {
		if strings.HasPrefix(msg.Subject, prefix) {
			out = append(out, msg)
		}
	}
	return out
}

var zone = store.Workspace{Timezone: "Europe/Zurich"}.Location()

type env struct {
	t    *testing.T
	st   *store.Store
	pool *pgxpool.Pool
	svc  *Service
	eng  *engagements.Service
	mail *fakeMailer
	srv  *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, pool := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	files, m := &fakeStorage{objects: map[string][]byte{}}, &fakeMailer{}
	inv := invoices.New(st, a, files, m, discard)
	svc := New(st, a, inv, files, discard)
	svc.SetMailer(m)
	eng := engagements.New(st, a, inv, discard)
	eng.SetMailer(m, "https://app.example.com")
	eng.AddDigestSource(svc)
	mux := http.NewServeMux()
	a.Register(mux)
	inv.Register(mux)
	eng.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, pool: pool, svc: svc, eng: eng, mail: m, srv: srv}
}

type browser struct{ token, csrf, workspace string }

// ready: a workspace with complete invoice settings, signed in as owner.
func (e *env) ready() *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	ws := auth.NewID("wsp")
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Acme"}, zone.String(), now),
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, "owner", now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{
		"seller": map[string]any{"name": "Muster GmbH", "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001",
			"city": "Zürich", "country": "CH", "vat_number": "CHE-109.322.551 MWST", "email": "billing@muster.ch"},
		"iban": "CH44 3199 9123 0008 8901 2", "bank_name": "ZKB"}, http.StatusOK, nil)
	return b
}

func (e *env) client(b *browser, email string) string {
	e.t.Helper()
	body := map[string]any{"name": "Kunde AG", "street": "Rue du Lac", "street_number": "12", "zip": "1003", "city": "Lausanne",
		"country": "CH", "payment_terms_days": 10}
	if email != "" {
		body["email"] = email
	}
	id := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, id, body, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) send(b *browser, method, path string, body any) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
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

func (e *env) fails(b *browser, method, path string, want int, code string) {
	e.t.Helper()
	var out struct{ Error struct{ Code string } }
	e.do(b, method, path, nil, want, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
}

type viewedPlan struct {
	ID     string
	Status string
	Items  []struct {
		Seq       int
		InvoiceID *string `json:"invoice_id"`
		Status    string
	}
}

// plan: a CHF 1'000.00 + VAT draft for clientID and a monthly plan of 3 on it.
func (e *env) plan(b *browser, clientID string, body map[string]any) viewedPlan {
	e.t.Helper()
	var draft struct{ Data struct{ ID string } }
	e.do(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "lines": []any{
		map[string]any{"description": "Beratung", "quantity": "1", "unit": "hour", "unit_price": "1000.00"}}}, http.StatusCreated, &draft)
	req := map[string]any{"count": 3, "interval": "monthly", "first_due_date": today()}
	for k, v := range body {
		req[k] = v
	}
	var out struct{ Data viewedPlan }
	e.do(b, "POST", "/api/v1/invoices/"+draft.Data.ID+"/plan", req, http.StatusCreated, &out)
	return out.Data
}

func (e *env) get(b *browser, id string) viewedPlan {
	e.t.Helper()
	var out struct{ Data viewedPlan }
	e.do(b, "GET", "/api/v1/instalment-plans/"+id, nil, http.StatusOK, &out)
	return out.Data
}

func (e *env) tick(at time.Time) {
	e.t.Helper()
	if err := e.svc.Tick(context.Background(), at); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) count(query string, args ...any) (n int) {
	e.t.Helper()
	if err := e.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func (e *env) partials(b *browser) int {
	return e.count(`SELECT count(*) FROM invoices WHERE workspace_id = $1 AND kind = 'partial' AND status <> 'draft'`, b.workspace)
}

func today() string { return time.Now().In(zone).Format(time.DateOnly) }

func days(n int) time.Time { return time.Now().AddDate(0, 0, n) }

func TestTickIssuesDueItemsOnce(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, "ap@kunde.ch"), nil) // item 1 due today, issued 10 days ahead: due now
	now := time.Now()
	e.tick(now)
	e.tick(now)
	if n := e.partials(b); n != 1 {
		t.Fatalf("%d partials after two ticks", n)
	}
	got := e.get(b, p.ID)
	if got.Status != "active" || got.Items[0].Status != "issued" || got.Items[0].InvoiceID == nil || got.Items[1].Status != "scheduled" {
		t.Fatalf("plan %+v", got)
	}
	if sent := e.mail.with(""); len(sent) != 1 || sent[0].To[0] != "ap@kunde.ch" || len(sent[0].Attachments) != 1 {
		t.Fatalf("auto-sent %+v", sent)
	}
}

func TestPlanDoneAfterLastItem(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, ""), map[string]any{"auto_send": false}) // no email: still issued
	e.tick(days(70))
	if n := e.partials(b); n != 3 {
		t.Fatalf("%d partials", n)
	}
	var list struct{ Data []viewedPlan }
	e.do(b, "GET", "/api/v1/instalment-plans", nil, http.StatusOK, &list)
	if len(list.Data) != 1 || list.Data[0].Status != "done" || list.Data[0].Items[2].Status != "issued" {
		t.Fatalf("plans %+v", list.Data)
	}
	e.fails(b, "POST", "/api/v1/instalment-plans/"+p.ID+"/cancel", http.StatusConflict, "invalid_state")
}

func TestTickSkipsPausedCancelled(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	clientID := e.client(b, "ap@kunde.ch")
	paused, cancelled := e.plan(b, clientID, nil), e.plan(b, clientID, nil)
	e.do(b, "POST", "/api/v1/instalment-plans/"+paused.ID+"/pause", nil, http.StatusOK, nil)
	e.do(b, "POST", "/api/v1/instalment-plans/"+cancelled.ID+"/cancel", nil, http.StatusOK, nil)
	e.fails(b, "POST", "/api/v1/instalment-plans/"+paused.ID+"/pause", http.StatusConflict, "invalid_state")
	e.fails(b, "POST", "/api/v1/instalment-plans/"+cancelled.ID+"/resume", http.StatusConflict, "invalid_state")
	e.fails(b, "POST", "/api/v1/instalment-plans/pln_missing/pause", http.StatusNotFound, "not_found")
	e.tick(time.Now())
	if n := e.partials(b); n != 0 {
		t.Fatalf("%d partials from paused and cancelled plans", n)
	}
	e.do(b, "POST", "/api/v1/instalment-plans/"+paused.ID+"/resume", nil, http.StatusOK, nil)
	e.tick(time.Now())
	if n := e.partials(b); n != 1 {
		t.Fatalf("%d partials after resume", n)
	}
}

func TestCancelKeepsIssued(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, "ap@kunde.ch"), nil)
	e.tick(time.Now())
	var out struct{ Data viewedPlan }
	e.do(b, "POST", "/api/v1/instalment-plans/"+p.ID+"/cancel", nil, http.StatusOK, &out)
	if s := out.Data; s.Status != "cancelled" || s.Items[0].Status != "issued" || s.Items[1].Status != "cancelled" || s.Items[2].Status != "cancelled" {
		t.Fatalf("cancelled plan %+v", s)
	}
	e.tick(days(70))
	if n := e.partials(b); n != 1 {
		t.Fatalf("%d partials after cancel", n)
	}
	if n := e.count(`SELECT count(*) FROM invoices WHERE id = $1 AND status = 'open'`, *out.Data.Items[0].InvoiceID); n != 1 {
		t.Fatal("issued partial no longer open")
	}
	if n := e.count(`SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'plan.cancelled' AND subject_id = $2`,
		b.workspace, p.ID); n != 1 {
		t.Fatalf("%d plan.cancelled events", n)
	}
}

func TestRemindersBeforeAfterOnce(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	// item 1 falls due in 20 days and is issued today; reminders: 5 days before, 3 and 10 days after
	p := e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly),
		"lead_days": 20, "auto_send": false})
	e.tick(time.Now())
	invoiceID := *e.get(b, p.ID).Items[0].InvoiceID
	logged := func() int { return e.count(`SELECT count(*) FROM reminder_log WHERE target_id = $1`, invoiceID) }
	reminders := func() int { return len(e.mail.with("Zahlungserinnerung")) }

	e.mail.fail = true
	e.tick(days(16))
	if logged() != 0 {
		t.Fatal("a failed send was logged: it would never be retried")
	}
	e.mail.fail = false
	for _, step := range []struct {
		at   int
		want int
	}{{16, 1}, {16, 1}, {23, 2}, {24, 2}, {31, 3}, {31, 3}} {
		e.tick(days(step.at))
		if got := reminders(); got != step.want || logged() != step.want {
			t.Fatalf("day %d: %d reminders, %d logged, want %d", step.at, got, logged(), step.want)
		}
	}
	m := e.mail.with("Zahlungserinnerung")[0]
	if m.To[0] != "ap@kunde.ch" || m.ReplyTo != "billing@muster.ch" || len(m.Attachments) != 1 || !strings.Contains(m.Text, "Rate 1 von 3") ||
		!strings.Contains(m.Text, "Offener Betrag: CHF") {
		t.Fatalf("reminder %+v", m)
	}
}

// With instalment reminders off (Settings → Client emails), a plan's invoices get none.
func TestNoRemindersWhenTurnedOff(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"instalments": map[string]any{"reminders_enabled": false}}, http.StatusOK, nil)
	e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly), "lead_days": 20, "auto_send": false})
	e.tick(time.Now())
	for _, d := range []int{16, 23, 31} {
		e.tick(days(d))
	}
	if got := e.mail.with("Zahlungserinnerung"); len(got) != 0 {
		t.Fatalf("reminders %+v", got)
	}
}

func TestReminderSkipsClientWithoutEmail(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.plan(b, e.client(b, ""), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly), "lead_days": 20})
	e.tick(time.Now())
	e.tick(days(16))
	if n := e.count(`SELECT count(*) FROM reminder_log WHERE workspace_id = $1`, b.workspace); n != 0 || len(e.mail.with("Zahlungserinnerung")) != 0 {
		t.Fatalf("%d reminders logged for a client without email", n)
	}
}

func TestReminderLanguage(t *testing.T) {
	ref, email := "210000000003139471430009017", "billing@muster.ch"
	number := "2026-007"
	inv := store.Invoice{Kind: "invoice", Number: &number, Language: "de", Currency: "CHF", Buyer: &store.Party{Name: "Kunde AG"},
		Seller: &store.Party{Name: "Muster GmbH", Email: &email}}
	inv.Payment.Reference = &ref
	for _, c := range []struct{ lang, kind, subject, sentence string }{
		{"de", "before", "Zahlungserinnerung: Rate 2 von 3 der Rechnung 2026-007", "fällig am 01.12.2026"},
		{"fr", "after", "Rappel de paiement: versement 2 sur 3 de la facture 2026-007", "échu le 01.12.2026"},
		{"it", "before", "Promemoria di pagamento: rata 2 di 3 della fattura 2026-007", "in scadenza il 01.12.2026"},
		{"en", "after", "Payment reminder: instalment 2 of 3 of invoice 2026-007", "due on 01.12.2026, has not reached us"},
		{"xx", "before", "Payment reminder: instalment 2 of 3 of invoice 2026-007", "due on 01.12.2026."},
	} {
		m := reminderMessage(inv, store.ReminderTarget{Seq: 2, Count: 3, Kind: c.kind, DueDate: "2026-12-01", Open: 36035,
			ClientEmail: "ap@kunde.ch", Language: c.lang, Number: "2026-007"}, []byte("%PDF"))
		if m.Subject != c.subject || !strings.Contains(m.Text, c.sentence) || !strings.Contains(m.Text, "360.35") ||
			!strings.Contains(m.Text, ref) || !strings.Contains(m.Text, "\nMuster GmbH\n") || m.ReplyTo != email {
			t.Errorf("%s: %q\n%s", c.lang, m.Subject, m.Text)
		}
		if c.lang == "de" {
			mailtest.Golden(t, "instalment-reminder", m)
		}
	}
}

func TestDigestIncludesInstalments(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	clientID := e.client(b, "ap@kunde.ch")
	e.plan(b, clientID, map[string]any{"auto_send": false}) // item 1 due today
	e.tick(time.Now())
	ws := store.Workspace{ID: b.workspace, Timezone: zone.String()}

	heading, lines, err := e.svc.DigestSection(context.Background(), ws, time.Now())
	if err != nil || heading != "Instalments" || len(lines) != 2 || !strings.Contains(lines[0].Text, "instalment 1/3, Kunde AG: CHF 360.35, due") ||
		!strings.HasPrefix(lines[1].Text, "Issued ") || !strings.HasPrefix(lines[1].Path, "/invoices?id=inv_") {
		t.Fatalf("%q %+v %v", heading, lines, err)
	}
	_, later, err := e.svc.DigestSection(context.Background(), ws, days(40))
	if err != nil || len(later) == 0 || !strings.HasPrefix(later[0].Text, "Overdue: ") {
		t.Fatalf("40 days on: %+v %v", later, err)
	}

	// the engagements digest carries the section (an engagement ending soon puts the workspace in it)
	start, end := days(-15).In(zone).Format(time.DateOnly), days(9).In(zone).Format(time.DateOnly)
	e.do(b, "POST", "/api/v1/engagements", map[string]any{"client_id": clientID, "title": "German", "quantity": "30", "unit_price": "100",
		"unit": "hour", "start_date": start, "end_date": end, "recurrence": "none", "vat_category": "Z"}, http.StatusCreated, nil)
	y, mo, d := time.Now().In(zone).Date()
	at := time.Date(y, mo, d, 7, 5, 0, 0, zone)
	if time.Now().After(at) {
		at = time.Now()
	}
	if err := e.eng.Tick(context.Background(), at); err != nil {
		t.Fatal(err)
	}
	digests := e.mail.with("Workspace roundup:")
	if len(digests) != 1 || !strings.Contains(digests[0].Text, "Instalments\n- ") || !strings.Contains(digests[0].Text, "https://app.example.com/invoices?id=") ||
		!strings.Contains(digests[0].HTML, "Instalments</h2>") {
		t.Fatalf("digests %+v", digests)
	}
}

// A workspace with instalments and no engagement notices gets one digest a day, in the 07:00 hour.
func TestDigestWithoutNoticesOncePerDay(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"auto_send": false}) // item 1 due today
	e.tick(time.Now())
	y, mo, d := time.Now().In(zone).Date()
	for _, step := range []struct {
		hour, minute, want int
	}{{6, 5, 0}, {7, 5, 1}, {8, 5, 1}, {30, 30, 1}} { // 30:30 is 06:30 the next day
		if err := e.eng.Tick(context.Background(), time.Date(y, mo, d, step.hour, step.minute, 0, 0, zone)); err != nil {
			t.Fatal(err)
		}
		if got := e.mail.with("Workspace roundup:"); len(got) != step.want {
			t.Fatalf("%02d:%02d: %d digests, want %d", step.hour, step.minute, len(got), step.want)
		}
	}
	m := e.mail.with("Workspace roundup:")[0]
	if !strings.Contains(m.Text, "in Acme.") || !strings.Contains(m.Text, "\nInstalments\n- ") || !strings.Contains(m.Text, "instalment 1/3, Kunde AG: CHF 360.35") {
		t.Fatalf("digest %q", m.Text)
	}
}

// An item whose due date passed while its plan was paused is issued, due the workspace's default terms from today.
func TestLateItemIssuedAfterResume(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"auto_send": false})
	e.do(b, "POST", "/api/v1/instalment-plans/"+p.ID+"/pause", nil, http.StatusOK, nil)
	if _, err := e.pool.Exec(context.Background(), `UPDATE instalment_plan_items SET due_date = due_date - 20, issue_on = issue_on - 20
		WHERE plan_id = $1 AND seq = 1`, p.ID); err != nil {
		t.Fatal(err)
	}
	e.do(b, "POST", "/api/v1/instalment-plans/"+p.ID+"/resume", nil, http.StatusOK, nil)
	e.tick(time.Now())
	if n := e.partials(b); n != 1 {
		t.Fatalf("%d partials after resume past the due date", n)
	}
	want := time.Now().In(zone).AddDate(0, 0, 30).Format(time.DateOnly) // default_terms_days 30
	if n := e.count(`SELECT count(*) FROM invoices WHERE id = $1 AND due_date = $2::date`, *e.get(b, p.ID).Items[0].InvoiceID, want); n != 1 {
		t.Fatalf("late partial not due %s", want)
	}
}

type fakeLimits struct{ allowed bool }

func (f fakeLimits) InvoiceAllowed(context.Context, store.Workspace) (bool, error) {
	return f.allowed, nil
}

// Over the plan's invoice limit the job skips the item, the tick succeeds and the digest says why.
func TestTickSkipsItemOverPlanLimit(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.plan(b, e.client(b, "ap@kunde.ch"), nil)
	e.svc.SetLimits(fakeLimits{allowed: false})
	e.tick(time.Now())
	if n := e.partials(b); n != 0 {
		t.Fatalf("%d partials over the plan limit", n)
	}
	_, lines, err := e.svc.DigestSection(context.Background(), store.Workspace{ID: b.workspace, Timezone: zone.String()}, time.Now())
	if err != nil || len(lines) == 0 || !strings.HasPrefix(lines[len(lines)-1].Text, "Plan invoice not issued: plan limit reached") {
		t.Fatalf("digest %+v %v", lines, err)
	}
	e.svc.SetLimits(fakeLimits{allowed: true})
	e.tick(time.Now())
	if n := e.partials(b); n != 1 {
		t.Fatalf("%d partials within the limit", n)
	}
}

func TestTickRetriesFailedAutoSend(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.plan(b, e.client(b, "ap@kunde.ch"), nil) // item 1 due now, auto_send
	deliveries := func() int {
		return e.count(`SELECT count(*) FROM invoice_deliveries d JOIN invoices i ON i.id = d.invoice_id WHERE i.workspace_id = $1`, b.workspace)
	}
	now := time.Now()
	e.mail.fail = true
	e.tick(now)
	e.mail.fail = false
	if n := deliveries(); n != 0 {
		t.Fatalf("%d deliveries after a failed send", n)
	}
	e.tick(days(8)) // past the retry window: left for a person to send
	if n := deliveries(); n != 0 {
		t.Fatalf("%d deliveries after the retry window", n)
	}
	e.tick(now)
	e.tick(now)
	// the +8 days run sent one reminder; everything else is the invoice
	if n, sent := deliveries(), len(e.mail.with(""))-len(e.mail.with("Zahlungserinnerung")); n != 1 || sent != 1 {
		t.Fatalf("%d deliveries, %d invoices sent", n, sent)
	}
}

// Two instances retrying the same failed send at once send it once.
func TestRetrySendOnceAcrossInstances(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.plan(b, e.client(b, "ap@kunde.ch"), nil) // item 1 due now, auto_send
	now := time.Now()
	e.mail.fail = true
	e.tick(now)
	e.mail.fail, e.mail.delay = false, 100*time.Millisecond
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			if err := e.svc.Tick(context.Background(), now); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if n := e.count(`SELECT count(*) FROM invoice_deliveries d JOIN invoices i ON i.id = d.invoice_id WHERE i.workspace_id = $1`,
		b.workspace); n != 1 || len(e.mail.with("")) != 1 {
		t.Fatalf("%d deliveries, %d mails from two instances", n, len(e.mail.with("")))
	}
}

func TestTickDoesNotRetryWithoutClientEmail(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.plan(b, e.client(b, ""), nil) // auto_send, but nowhere to send
	e.tick(time.Now())
	if e.partials(b) != 1 {
		t.Fatal("the plan item was not issued")
	}
	unsent, err := e.st.UnsentPlanPartials(context.Background(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range unsent {
		if u.Workspace.ID == b.workspace {
			t.Fatalf("retried without an email address: %+v", u)
		}
	}
}

// paymentDuringRemind records a payment while the job prepares a reminder (after it listed the target, before the
// reminder is logged and sent), through the invoice-PDF read that sits in that window.
type paymentDuringRemind struct {
	Storage
	once sync.Once
	pay  func()
}

func (p *paymentDuringRemind) Get(ctx context.Context, key string) ([]byte, error) {
	p.once.Do(p.pay)
	return p.Storage.Get(ctx, key)
}

func TestReminderUsesTheBalanceAtSend(t *testing.T) {
	for _, tc := range []struct {
		name     string
		path     string
		body     map[string]any
		status   int
		wantOpen string // in the reminder; "" for no reminder
	}{
		{"paid in full", "/mark-paid", map[string]any{}, http.StatusOK, ""},
		{"partly paid", "/payments", map[string]any{"amount": "100.00", "method": "bank_transfer"}, http.StatusCreated,
			"Offener Betrag: CHF 260.35"}, // 360.35 − 100.00
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.ready()
			p := e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly),
				"lead_days": 20, "auto_send": false})
			e.tick(time.Now())
			invoiceID := *e.get(b, p.ID).Items[0].InvoiceID
			e.svc.files = &paymentDuringRemind{Storage: e.svc.files, pay: func() {
				e.do(b, "POST", "/api/v1/invoices/"+invoiceID+tc.path, tc.body, tc.status, nil)
			}}
			e.tick(days(16))
			got := e.mail.with("Zahlungserinnerung")
			switch {
			case tc.wantOpen == "" && len(got) != 0:
				t.Fatalf("a reminder for a paid invoice: %s", got[0].Text)
			case tc.wantOpen != "" && (len(got) != 1 || !strings.Contains(got[0].Text, tc.wantOpen)):
				t.Fatalf("%d reminders, want one with %q: %v", len(got), tc.wantOpen, slices.Collect(func(yield func(string) bool) {
					for _, m := range got {
						yield(m.Text)
					}
				}))
			}
		})
	}
}

func TestOpenOf(t *testing.T) {
	schedule := func(paid, credited store.Money) store.Invoice {
		return store.Invoice{Status: "open", Total: 30000, AmountPaid: paid, AmountCredited: credited,
			Instalments: &store.InstalmentSchedule{Interval: "monthly", Items: []store.InstalmentItem{
				{Seq: 1, Amount: 10000}, {Seq: 2, Amount: 10000}, {Seq: 3, Amount: 10000}}}}
	}
	paidOff := schedule(30000, 0)
	paidOff.Status = "paid"
	for _, tc := range []struct {
		name string
		inv  store.Invoice
		want []store.Money // seq 1, 2, 3
	}{
		{"schedule, nothing paid", schedule(0, 0), []store.Money{10000, 10000, 10000}},
		{"schedule, oldest first", schedule(15000, 0), []store.Money{0, 5000, 10000}},
		{"schedule, credit from the last", schedule(15000, 12000), []store.Money{0, 3000, 0}},
		{"schedule, paid", paidOff, []store.Money{0, 0, 0}},
		{"plan partial", store.Invoice{Status: "open", Total: 36030, RoundingAmount: 5, AmountPaid: 10000},
			[]store.Money{26035, 26035, 26035}},
		{"plan partial, void", store.Invoice{Status: "void", Total: 36035}, []store.Money{0, 0, 0}},
	} {
		got := []store.Money{openOf(tc.inv, 1), openOf(tc.inv, 2), openOf(tc.inv, 3)}
		if !slices.Equal(got, tc.want) {
			t.Errorf("%s: open %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Three instances running the job at once issue each due item once, number the partials without gaps, auto-send each
// once and send each reminder once.
func TestConcurrentTicksIssueAndRemindOnce(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, "ap@kunde.ch"), nil) // monthly from today, auto_send: all three due 70 days on
	at := days(70)
	e.mail.delay = 50 * time.Millisecond
	var wg sync.WaitGroup
	for range 3 {
		wg.Go(func() {
			if err := e.svc.Tick(context.Background(), at); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if n := e.partials(b); n != 3 {
		t.Fatalf("%d partials, want 3", n)
	}
	if n := e.count(`SELECT COALESCE(sum(seq), 0)::int FROM invoice_counters WHERE workspace_id = $1`, b.workspace); n != 3 {
		t.Fatalf("the counter is not at 3 after three partials: a number was skipped or reused")
	}
	for _, it := range e.get(b, p.ID).Items {
		if it.InvoiceID == nil {
			t.Fatalf("item %d not issued", it.Seq)
		}
	}
	reminders, logged := len(e.mail.with("Zahlungserinnerung")), e.count(`SELECT count(*) FROM reminder_log WHERE workspace_id = $1`, b.workspace)
	if sent := len(e.mail.with("")) - reminders; sent != 3 || reminders != logged || reminders == 0 {
		t.Fatalf("%d invoice emails (want 3), %d reminders for %d logged", sent, reminders, logged)
	}
}
