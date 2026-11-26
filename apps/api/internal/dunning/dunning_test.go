package dunning

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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
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
	mu    sync.Mutex
	sent  []mail.Message
	fail  bool
	delay time.Duration
	// uncertain: the server took the message, then the connection dropped before it answered
	uncertain bool
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	time.Sleep(m.delay)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail {
		return errors.New("smtp down")
	}
	m.sent = append(m.sent, msg)
	if m.uncertain {
		return fmt.Errorf("smtp: %w: EOF", mail.ErrUncertain)
	}
	return nil
}

func (m *fakeMailer) subjects() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for _, msg := range m.sent {
		out = append(out, msg.Subject)
	}
	return out
}

var zone = store.Workspace{Timezone: "Europe/Zurich"}.Location()

type env struct {
	t    *testing.T
	st   *store.Store
	pool *pgxpool.Pool
	svc  *Service
	mail *fakeMailer
	srv  *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, pool := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://app.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	files, m := &fakeStorage{objects: map[string][]byte{}}, &fakeMailer{}
	inv := invoices.New(st, a, files, m, discard)
	svc := New(st, a, inv, files, discard)
	svc.SetMailer(m)
	mux := http.NewServeMux()
	a.Register(mux)
	inv.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, pool: pool, svc: svc, mail: m, srv: srv}
}

type browser struct{ token, csrf, workspace string }

func step(timing string, days int, fee string) map[string]any {
	return map[string]any{"timing": timing, "days": days, "fee": fee}
}

// ready: a workspace with complete invoice settings and dunning on (steps 10 days after the due date, then 14 and
// 14 after the previous; fees 0, 20, 30), signed in as owner; dunning overrides settings.dunning.
func (e *env) ready(dunning map[string]any) *browser {
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
	d := map[string]any{"enabled": true, "steps": []any{step("after_due", 10, "0.00"), step("after_previous", 14, "20.00"),
		step("after_previous", 14, "30.00")}}
	for k, v := range dunning {
		d[k] = v
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{
		"seller": map[string]any{"name": "Muster GmbH", "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001",
			"city": "Zürich", "country": "CH", "vat_number": "CHE-109.322.551 MWST", "email": "billing@muster.ch"},
		"iban": "CH44 3199 9123 0008 8901 2", "bank_name": "ZKB", "dunning": d}, http.StatusOK, nil)
	return b
}

// invoice: an issued CHF 1'081.00 invoice (1'000.00 + 8.1 % VAT), due in 10 days, to a client with fields.
func (e *env) invoice(b *browser, fields map[string]any) string {
	e.t.Helper()
	body := map[string]any{"name": "Kunde AG", "street": "Rue du Lac", "street_number": "12", "zip": "1003", "city": "Lausanne",
		"country": "CH", "payment_terms_days": 10, "email": "ap@kunde.ch"}
	for k, v := range fields {
		body[k] = v
	}
	clientID := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, clientID, body, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	var out struct{ Data struct{ ID string } }
	e.do(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "lines": []any{
		map[string]any{"description": "Beratung", "quantity": "1", "unit": "hour", "unit_price": "1000.00"}}}, http.StatusCreated, &out)
	e.do(b, "POST", "/api/v1/invoices/"+out.Data.ID+"/issue", nil, http.StatusOK, nil)
	return out.Data.ID
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

func (e *env) status(b *browser, id string) Status {
	e.t.Helper()
	var out struct{ Data Status }
	e.do(b, "GET", "/api/v1/invoices/"+id+"/dunning", nil, http.StatusOK, &out)
	return out.Data
}

// tickAt runs the job with the clock days after the invoices' due date (due in 10 days from now).
func (e *env) tickAt(daysAfterDue int) {
	e.t.Helper()
	at := time.Now().AddDate(0, 0, 10+daysAfterDue)
	e.svc.now = func() time.Time { return at }
	if err := e.svc.Tick(context.Background()); err != nil {
		e.t.Fatal(err)
	}
}

func TestLevelsGoOutOnceInOrder(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"interest_enabled": true, "interest_from": "due_date"})
	id := e.invoice(b, nil)
	e.tickAt(0)
	e.tickAt(9)
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent before level 1 was due: %v", got)
	}
	e.tickAt(10)
	e.tickAt(10)
	e.tickAt(23) // 13 days after level 1: level 2 not due
	if got := e.mail.subjects(); len(got) != 1 || !strings.HasPrefix(got[0], "Zahlungserinnerung: Rechnung ") {
		t.Fatalf("after level 1: %v", got)
	}
	e.tickAt(24)
	st := e.status(b, id)
	if len(st.Notices) != 2 || st.Next == nil || st.Next.Level != 3 || st.Next.Title != "Letzte Mahnung" {
		t.Fatalf("status after level 2: %+v", st)
	}
	// interest from the day after the due date: 1081.00 × 5 % × 24 / 365 = 3.5539… → 3.55
	n := st.Notices[1]
	if n.Title != "2. Mahnung" || n.Open != 108100 || n.Fee != 2000 || n.Interest != 355 || n.Total != 108100+2000+355 ||
		n.InterestRate != 500 || n.InterestFrom == nil || n.Email != "ap@kunde.ch" || n.SentBy != nil {
		t.Fatalf("level 2 notice %+v", n)
	}
	if st.Notices[0].Interest != 150 { // 10 days: 1.4808… → 1.50 in 0.05
		t.Fatalf("level 1 interest %d", st.Notices[0].Interest)
	}
	e.tickAt(38)
	e.tickAt(80)
	got := e.mail.subjects()
	if len(got) != 3 || !strings.HasPrefix(got[1], "2. Mahnung:") || !strings.HasPrefix(got[2], "Letzte Mahnung:") {
		t.Fatalf("subjects %v", got)
	}
	if st := e.status(b, id); st.Next != nil {
		t.Fatalf("a level after the last: %+v", st.Next)
	}
	e.mail.mu.Lock()
	last := e.mail.sent[2]
	e.mail.mu.Unlock()
	if last.To[0] != "ap@kunde.ch" || last.ReplyTo != "billing@muster.ch" || len(last.Attachments) != 2 ||
		!strings.HasPrefix(last.Attachments[0].Name, "Letzte-Mahnung-") || !bytes.HasPrefix(last.Attachments[0].Data, []byte("%PDF-")) ||
		!strings.Contains(last.Text, "Mahngebühr: CHF 30.00") || !strings.Contains(last.Text, "Verzugszins 5 % vom ") {
		t.Fatalf("final notice %+v", last)
	}
}

func TestLevel1IsFreeOfInterestWhenDefaultStartsWithTheReminder(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"interest_enabled": true}) // interest_from defaults to "reminder"
	id := e.invoice(b, nil)
	e.tickAt(10)
	e.tickAt(24)
	st := e.status(b, id)
	// level 2 is 14 days after level 1: 1081.00 × 5 % × 14 / 365 = 2.0732… → 2.05
	if len(st.Notices) != 2 || st.Notices[0].Interest != 0 || st.Notices[0].InterestFrom != nil || st.Notices[1].Interest != 205 {
		t.Fatalf("notices %+v", st.Notices)
	}
}

func TestConcurrentTicksSendOnce(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	e.invoice(b, nil)
	e.mail.delay = 200 * time.Millisecond
	at := time.Now().AddDate(0, 0, 20)
	e.svc.now = func() time.Time { return at }
	var wg sync.WaitGroup
	for range 3 {
		wg.Go(func() {
			if err := e.svc.Tick(context.Background()); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if got := e.mail.subjects(); len(got) != 1 {
		t.Fatalf("three concurrent ticks sent %v", got)
	}
}

func TestFailedSendIsRetried(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	e.mail.fail = true
	e.tickAt(10)
	if st := e.status(b, id); len(st.Notices) != 0 {
		t.Fatalf("a failed send was recorded: %+v", st.Notices)
	}
	e.mail.fail = false
	e.tickAt(11)
	if st := e.status(b, id); len(st.Notices) != 1 || !st.Notices[0].Confirmed {
		t.Fatalf("the retry: %+v", st.Notices)
	}
	if n := e.sentNotifications(b.workspace); n != 1 {
		t.Fatalf("announced %d times", n)
	}
}

func (e *env) sentNotifications(ws string) int {
	e.t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(DISTINCT data->>'level') FROM notifications
		WHERE workspace_id = $1 AND event = 'dunning.sent'`, ws).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// TestUncertainSendIsNeverRepeated: a reminder the mail server may have taken (the connection dropped after the
// message) stays recorded, unconfirmed and unannounced, and no run or "Send now" sends that step again (audit F07).
func TestUncertainSendIsNeverRepeated(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	e.mail.uncertain = true
	e.tickAt(10)
	e.mail.uncertain = false
	st := e.status(b, id)
	if len(st.Notices) != 1 || st.Notices[0].Confirmed || len(e.mail.subjects()) != 1 {
		t.Fatalf("after an unknown outcome: %+v, %d sent", st.Notices, len(e.mail.subjects()))
	}
	if n := e.sentNotifications(b.workspace); n != 0 {
		t.Fatalf("announced %d times", n)
	}
	e.tickAt(10)
	e.tickAt(11)
	if got := e.status(b, id); len(got.Notices) != 1 || got.Notices[0].Level != 1 || len(e.mail.subjects()) != 1 {
		t.Fatalf("the step went again: %+v, %d sent", got.Notices, len(e.mail.subjects()))
	}

	// by hand the next step goes; an unknown outcome says so
	e.mail.uncertain = true
	var out struct{ Error struct{ Code string } }
	e.do(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", nil, http.StatusBadGateway, &out)
	if out.Error.Code != "delivery_uncertain" {
		t.Fatalf("send now: %+v", out)
	}
}

type storageBeforeSend struct {
	Storage
	before func()
}

func (s storageBeforeSend) Get(ctx context.Context, key string) ([]byte, error) {
	s.before()
	return s.Storage.Get(ctx, key)
}

func TestAutomaticReminderRechecksPauseBeforeSending(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	e.svc.files = storageBeforeSend{Storage: e.svc.files, before: func() {
		if err := e.st.SetDunningPaused(t.Context(), b.workspace, id, true); err != nil {
			t.Error(err)
		}
	}}
	e.tickAt(10)
	if len(e.mail.subjects()) != 0 || len(e.status(b, id).Notices) != 0 {
		t.Fatal("a reminder was sent after the invoice was paused")
	}
}

func TestOptOutPauseAndPayment(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	optedOut := e.invoice(b, map[string]any{"dunning_enabled": false})
	paused := e.invoice(b, nil)
	paid := e.invoice(b, nil)
	noEmail := e.invoice(b, map[string]any{"email": nil})
	e.do(b, "POST", "/api/v1/invoices/"+paused+"/dunning/pause", nil, http.StatusOK, nil)
	e.do(b, "POST", "/api/v1/invoices/"+paid+"/mark-paid", map[string]any{}, http.StatusOK, nil)
	e.tickAt(30)
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent %v", got)
	}
	if st := e.status(b, optedOut); st.ClientEnabled || st.Next == nil {
		t.Fatalf("opted out %+v", st)
	}
	if st := e.status(b, paid); st.Next != nil {
		t.Fatalf("paid invoice has a next level: %+v", st.Next)
	}
	if st := e.status(b, paused); !st.Paused {
		t.Fatalf("not paused: %+v", st)
	}
	e.fails(b, "POST", "/api/v1/invoices/"+noEmail+"/dunning/send", http.StatusConflict, "invalid_state")
	var resumed struct{ Data Status }
	e.do(b, "POST", "/api/v1/invoices/"+paused+"/dunning/resume", nil, http.StatusOK, &resumed)
	if resumed.Data.Paused {
		t.Fatal("still paused")
	}
	e.tickAt(31)
	if got := e.mail.subjects(); len(got) != 1 {
		t.Fatalf("after resuming: %v", got)
	}
}

func TestDisabledWorkspaceSendsNothing(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"enabled": false})
	id := e.invoice(b, nil)
	e.tickAt(60)
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent %v", got)
	}
	if st := e.status(b, id); st.Enabled || !st.Applies {
		t.Fatalf("status %+v", st)
	}
}

func TestManualSendAndLetter(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"enabled": false}) // by hand also with dunning off
	id := e.invoice(b, nil)
	at := time.Now().AddDate(0, 0, 11) // past due: sent before it, a step is a note
	e.svc.now = func() time.Time { return at }
	for level := 1; level <= 3; level++ {
		var out struct{ Data Status }
		e.do(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", nil, http.StatusOK, &out)
		if len(out.Data.Notices) != level || out.Data.Notices[level-1].SentBy == nil || *out.Data.Notices[level-1].SentBy != "Anna" {
			t.Fatalf("level %d: %+v", level, out.Data)
		}
	}
	e.fails(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", http.StatusConflict, "invalid_state")
	resp, raw := e.send(b, "GET", "/api/v1/invoices/"+id+"/dunning/2/pdf", nil)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(raw, []byte("%PDF-")) ||
		!strings.Contains(resp.Header.Get("Content-Disposition"), "2.-Mahnung-") {
		t.Fatalf("letter: %d %v", resp.StatusCode, resp.Header)
	}
	e.fails(b, "GET", "/api/v1/invoices/"+id+"/dunning/4/pdf", http.StatusNotFound, "not_found")
	e.fails(b, "GET", "/api/v1/invoices/"+id+"/dunning/x/pdf", http.StatusNotFound, "not_found")
	other := e.ready(nil)
	e.fails(other, "GET", "/api/v1/invoices/"+id+"/dunning", http.StatusNotFound, "not_found")
	e.fails(other, "POST", "/api/v1/invoices/"+id+"/dunning/pause", http.StatusNotFound, "not_found")
}

func TestInstalmentInvoicesAreNotDunned(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	if _, err := e.pool.Exec(context.Background(), `UPDATE invoices SET instalment_interval = 'monthly' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	e.tickAt(60)
	if st := e.status(b, id); st.Applies || st.Next != nil || len(e.mail.subjects()) != 0 {
		t.Fatalf("status %+v", st)
	}
	e.fails(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", http.StatusConflict, "invalid_state")
}

func TestSettingsValidation(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	eleven := make([]any, 11)
	for i := range eleven {
		eleven[i] = step("after_due", i+1, "0")
	}
	for _, c := range []struct {
		name    string
		dunning map[string]any
		field   string
	}{
		{"no steps", map[string]any{"steps": []any{}}, "dunning.steps"},
		{"eleven steps", map[string]any{"steps": eleven}, "dunning.steps"},
		{"zero days", map[string]any{"steps": []any{step("after_due", 0, "0")}}, "dunning.steps.0.days"},
		{"a note too early", map[string]any{"steps": []any{step("before_due", 31, "0")}}, "dunning.steps.0.days"},
		{"unknown timing", map[string]any{"steps": []any{step("someday", 3, "0")}}, "dunning.steps.0.timing"},
		{"first after the previous", map[string]any{"steps": []any{step("after_previous", 3, "0")}}, "dunning.steps.0.timing"},
		{"out of order", map[string]any{"steps": []any{step("after_due", 20, "0"), step("after_due", 10, "0")}}, "dunning.steps.1.timing"},
		{"fee on a note", map[string]any{"steps": []any{step("before_due", 3, "5.00")}}, "dunning.steps.0.fee"},
		{"fee not in 0.05", map[string]any{"steps": []any{step("after_due", 10, "2.33")}}, "dunning.steps.0.fee"},
		{"name too long", map[string]any{"steps": []any{map[string]any{"timing": "after_due", "days": 10, "name": strings.Repeat("x", 61)}}},
			"dunning.steps.0.name"},
		{"qr bill not a boolean", map[string]any{"steps": []any{map[string]any{"timing": "after_due", "days": 10, "qr_bill": "yes"}}},
			"dunning.steps.0.qr_bill"},
		{"rate over 15 %", map[string]any{"interest_rate": "16"}, "dunning.interest_rate"},
		{"unknown start", map[string]any{"interest_from": "tomorrow"}, "dunning.interest_from"},
	} {
		t.Run(c.name, func(t *testing.T) {
			var out struct {
				Error struct {
					Details struct{ Fields map[string]string }
				}
			}
			e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"dunning": c.dunning}, http.StatusUnprocessableEntity, &out)
			if out.Error.Details.Fields[c.field] == "" {
				t.Fatalf("fields %v, want %s", out.Error.Details.Fields, c.field)
			}
		})
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"dunning": map[string]any{"levels": []any{}}}, http.StatusBadRequest, nil)
	var got struct{ Data invoices.Settings }
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
	if d := got.Data.Dunning; !d.Enabled || len(d.Steps) != 3 || d.Steps[2].Fee != 3000 || !d.Steps[2].QRBill || d.InterestRate != 500 ||
		d.InterestFrom != "reminder" {
		t.Fatalf("settings kept %+v", d)
	}
	ten := make([]any, 10)
	for i := range ten {
		ten[i] = step("after_due", i+1, "0")
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"dunning": map[string]any{"steps": ten}}, http.StatusOK, nil)
}

// Settings saved before steps had "levels": they read as the same steps, and a notice sent for level 1 before the
// change is not sent again.
func TestLegacyLevelsBecomeSteps(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	e.tickAt(10)
	for _, c := range []struct {
		name, stored string
		want         []invoices.DunningStep
	}{
		{"three levels", `{"enabled": true, "levels": [{"days": 10, "fee": "0.00", "text": null}, {"days": 14, "fee": "20.00", "text": "Bitte zahlen"}, {"days": 7, "fee": "30.00", "text": null}], "interest_enabled": false, "interest_rate": "5.00", "interest_from": "reminder"}`,
			[]invoices.DunningStep{{Timing: "after_due", Days: 10, QRBill: true}, {Timing: "after_previous", Days: 14, Fee: 2000, QRBill: true},
				{Timing: "after_previous", Days: 7, Fee: 3000, QRBill: true}}},
		{"one level", `{"enabled": true, "levels": [{"days": 5, "fee": "0.00", "text": null}]}`,
			[]invoices.DunningStep{{Timing: "after_due", Days: 5, QRBill: true}}},
		{"steps win over levels", `{"enabled": true, "levels": [{"days": 5, "fee": "0.00"}], "steps": [{"timing": "before_due", "days": 3, "fee": "0.00", "qr_bill": false}]}`,
			[]invoices.DunningStep{{Timing: "before_due", Days: 3}}},
	} {
		t.Run(c.name, func(t *testing.T) {
			if _, err := e.pool.Exec(context.Background(), `UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning}', $2::jsonb)
				WHERE workspace_id = $1`, b.workspace, c.stored); err != nil {
				t.Fatal(err)
			}
			var got struct{ Data invoices.Settings }
			e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
			steps := got.Data.Dunning.Steps
			if len(steps) != len(c.want) {
				t.Fatalf("steps %+v", steps)
			}
			for i, s := range steps {
				if s.Timing != c.want[i].Timing || s.Days != c.want[i].Days || s.Fee != c.want[i].Fee || s.QRBill != c.want[i].QRBill {
					t.Fatalf("step %d: %+v, want %+v", i, s, c.want[i])
				}
			}
		})
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning}', $2::jsonb)
		WHERE workspace_id = $1`, b.workspace, `{"enabled": true, "levels": [{"days": 10, "fee": "0.00"}, {"days": 14, "fee": "20.00"}]}`); err != nil {
		t.Fatal(err)
	}
	e.tickAt(11)
	st := e.status(b, id)
	if len(st.Notices) != 1 || st.Next == nil || st.Next.Level != 2 || st.Next.Title != "Letzte Mahnung" || len(e.mail.subjects()) != 1 {
		t.Fatalf("after reading levels: %+v, sent %v", st, e.mail.subjects())
	}
}

// A reminder's wording is Helvetly's: a text a workspace saved for a step when that was possible is ignored, in the
// email and in the letter, and the settings no longer answer or accept it.
func TestOldOwnTextIsIgnored(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	e.invoice(b, nil)
	if _, err := e.pool.Exec(context.Background(), `UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning}', $2::jsonb)
		WHERE workspace_id = $1`, b.workspace, `{"enabled": true, "steps": [{"timing": "after_due", "days": 10, "fee": "0.00", "text": "Zahlen Sie sofort!", "qr_bill": true}]}`); err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Data struct {
			Dunning struct{ Steps []map[string]any }
		}
	}
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &raw)
	if steps := raw.Data.Dunning.Steps; len(steps) != 1 || steps[0]["text"] != nil {
		t.Fatalf("steps %+v", steps)
	}
	e.tickAt(10)
	e.mail.mu.Lock()
	defer e.mail.mu.Unlock()
	if len(e.mail.sent) != 1 || strings.Contains(e.mail.sent[0].Text, "sofort") || !strings.Contains(e.mail.sent[0].Text, "Guten Tag") {
		t.Fatalf("sent %+v", e.mail.sent)
	}
}

// A note before the due date: friendly wording, no fee or interest, its own name; skipped once the invoice is past
// due, and the reminders after it count from the due date.
func TestNotesBeforeTheDueDate(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"interest_enabled": true, "steps": []any{
		map[string]any{"timing": "before_due", "days": 3, "name": "Freundlicher Hinweis", "qr_bill": false},
		step("after_due", 5, "10.00"), step("after_previous", 7, "20.00")}})
	id := e.invoice(b, nil) // due in 10 days
	late := e.invoice(b, nil)
	e.tickAt(-4)
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent before the note was due: %v", got)
	}
	if st := e.status(b, id); st.Next == nil || st.Next.Level != 1 || st.Next.Title != "Freundlicher Hinweis" {
		t.Fatalf("next %+v", st.Next)
	}
	// only the first invoice gets its note: pause the second until after its due date
	e.do(b, "POST", "/api/v1/invoices/"+late+"/dunning/pause", nil, http.StatusOK, nil)
	e.tickAt(-3)
	e.tickAt(-2)
	st := e.status(b, id)
	if len(st.Notices) != 1 || st.Notices[0].Title != "Freundlicher Hinweis" || st.Notices[0].Fee != 0 || st.Notices[0].Interest != 0 ||
		st.Notices[0].QRBill || st.Next.Level != 2 {
		t.Fatalf("after the note: %+v", st)
	}
	e.mail.mu.Lock()
	note := e.mail.sent[0]
	e.mail.mu.Unlock()
	if !strings.HasPrefix(note.Subject, "Freundlicher Hinweis: ") || !strings.Contains(note.Text, "fällig wird") ||
		!strings.Contains(note.Text, "bis zum Fälligkeitsdatum") || strings.Contains(note.Text, "Mahngebühr") {
		t.Fatalf("note %q: %s", note.Subject, note.Text)
	}
	e.do(b, "POST", "/api/v1/invoices/"+late+"/dunning/resume", nil, http.StatusOK, nil)
	if st := e.status(b, late); st.Next == nil || st.Next.Level != 1 {
		t.Fatalf("late before its due date: %+v", st.Next)
	}
	e.tickAt(5)
	for _, inv := range []string{id, late} {
		st := e.status(b, inv)
		last := st.Notices[len(st.Notices)-1]
		// interest from the reminder: the note before the due date does not start it
		if last.Level != 2 || last.Title != "Zahlungserinnerung" || last.Fee != 1000 || last.Interest != 0 || !last.QRBill {
			t.Fatalf("%s after the due date: %+v", inv, st.Notices)
		}
	}
	e.tickAt(12)
	if st := e.status(b, late); len(st.Notices) != 2 || st.Notices[1].Title != "Letzte Mahnung" || st.Notices[1].Interest == 0 {
		t.Fatalf("final %+v", st.Notices)
	}
	resp, raw := e.send(b, "GET", "/api/v1/invoices/"+id+"/dunning/1/pdf", nil)
	if resp.StatusCode != http.StatusOK || !bytes.HasPrefix(raw, []byte("%PDF-")) ||
		!strings.Contains(resp.Header.Get("Content-Disposition"), "Freundlicher-Hinweis-") {
		t.Fatalf("note letter: %d %v", resp.StatusCode, resp.Header)
	}
}

func TestDigestSection(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	e.invoice(b, nil)
	e.tickAt(10)
	ws, err := e.svc.DigestWorkspaces(context.Background(), e.svc.now())
	if err != nil || len(ws) != 1 || ws[0].ID != b.workspace {
		t.Fatalf("digest workspaces %v %v", ws, err)
	}
	heading, lines, err := e.svc.DigestSection(context.Background(), ws[0], e.svc.now())
	if err != nil || heading != "Dunning" || len(lines) != 1 || !strings.HasPrefix(lines[0].Text, "Zahlungserinnerung sent for ") ||
		!strings.Contains(lines[0].Text, "Kunde AG: CHF 1'081.00") {
		t.Fatalf("section %q %+v %v", heading, lines, err)
	}
}

// member adds a person with the role to the workspace and returns their id.
func (e *env) member(ws, role string) string {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Ben " + role}
	if err := e.st.CreateUser(ctx, u, now); err != nil {
		e.t.Fatal(err)
	}
	if err := e.st.AddMember(ctx, ws, u.ID, role, now); err != nil {
		e.t.Fatal(err)
	}
	return u.ID
}

func (e *env) owner(ws string) string {
	e.t.Helper()
	members, err := e.st.ListMembers(context.Background(), ws)
	if err != nil || members[0].Role != "owner" {
		e.t.Fatalf("members %+v %v", members, err)
	}
	return members[0].UserID
}

// count: how many notifications of the event the person has in the workspace.
func (e *env) count(ws, userID, event string) int {
	e.t.Helper()
	got, err := e.st.Notifications(context.Background(), ws, userID, store.NotificationFilter{Limit: 50})
	if err != nil {
		e.t.Fatal(err)
	}
	n := 0
	for _, x := range got {
		if x.Event == event {
			n++
		}
	}
	return n
}

func (e *env) mute(userID, event string) {
	e.t.Helper()
	if err := e.st.SetUserNotificationPrefs(context.Background(), userID, store.NotificationPrefs{event: {}}, time.Now()); err != nil {
		e.t.Fatal(err)
	}
}

func TestOverdueNotifiesManagersOnce(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"enabled": false}) // dunning off: still overdue
	admin, member, muted := e.member(b.workspace, "admin"), e.member(b.workspace, "member"), e.member(b.workspace, "admin")
	e.mute(muted, "invoice.overdue")
	other := e.ready(nil)
	e.invoice(b, nil)

	e.tickAt(-1) // not due yet
	if n := e.count(b.workspace, admin, "invoice.overdue"); n != 0 {
		t.Fatalf("before due: %d", n)
	}
	e.tickAt(1)
	e.tickAt(2)
	for _, c := range []struct {
		name, ws, user string
		want           int
	}{
		{"owner", b.workspace, e.owner(b.workspace), 1},
		{"admin", b.workspace, admin, 1},
		{"member", b.workspace, member, 0},
		{"muted admin", b.workspace, muted, 0},
		{"other workspace", other.workspace, e.owner(other.workspace), 0},
	} {
		if n := e.count(c.ws, c.user, "invoice.overdue"); n != c.want {
			t.Errorf("%s: %d, want %d", c.name, n, c.want)
		}
	}
}

func TestOverdueSkipsOldInvoices(t *testing.T) {
	e := newEnv(t)
	b := e.ready(map[string]any{"enabled": false})
	e.invoice(b, nil)
	e.tickAt(overdueWindow + 1)
	if n := e.count(b.workspace, e.owner(b.workspace), "invoice.overdue"); n != 0 {
		t.Fatalf("old invoice: %d", n)
	}
}

func TestDunningSentNotifies(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	admin, member := e.member(b.workspace, "admin"), e.member(b.workspace, "member")
	owner := e.owner(b.workspace)
	id := e.invoice(b, nil)
	e.tickAt(10) // level 1 by the job: every manager
	e.tickAt(11)
	e.do(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", nil, http.StatusOK, nil) // level 2 by the owner
	for _, c := range []struct {
		name, user string
		want       int
	}{{"owner", owner, 1}, {"admin", admin, 2}, {"member", member, 0}} {
		if n := e.count(b.workspace, c.user, "dunning.sent"); n != c.want {
			t.Errorf("%s: %d, want %d", c.name, n, c.want)
		}
	}
}

// paymentDuringSend records a payment while the job renders the notice (after it read the invoice, before the notice
// row goes in), through the invoice-PDF read that sits in that window.
type paymentDuringSend struct {
	Storage
	once sync.Once
	pay  func()
}

func (p *paymentDuringSend) Get(ctx context.Context, key string) ([]byte, error) {
	p.once.Do(p.pay)
	return p.Storage.Get(ctx, key)
}

func TestPaymentWhileSendingUsesTheBalanceAtSend(t *testing.T) {
	for _, tc := range []struct {
		name     string
		path     string
		body     map[string]any
		status   int
		wantOpen []store.Money // the open amount of each notice after two runs
	}{
		{"paid in full", "/mark-paid", map[string]any{}, http.StatusOK, nil},
		{"partly paid", "/payments", map[string]any{"amount": "500.00", "method": "bank_transfer"}, http.StatusCreated,
			[]store.Money{58100}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.ready(nil)
			id := e.invoice(b, nil)
			e.svc.files = &paymentDuringSend{Storage: e.svc.files, pay: func() {
				e.do(b, "POST", "/api/v1/invoices/"+id+tc.path, tc.body, tc.status, nil)
			}}
			e.tickAt(10)
			e.tickAt(10)
			var open []store.Money
			for _, n := range e.status(b, id).Notices {
				open = append(open, n.Open)
			}
			if fmt.Sprint(open) != fmt.Sprint(tc.wantOpen) || len(e.mail.subjects()) != len(tc.wantOpen) {
				t.Fatalf("notices with open %v, %d emails; want %v", open, len(e.mail.subjects()), tc.wantOpen)
			}
		})
	}
}

// "10 days after the due date" counts civil days in the workspace's time zone: 00:30 in Zurich is the day before in UTC.
func TestStepDayInWorkspaceZone(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	var due string
	if err := e.pool.QueryRow(context.Background(), `SELECT due_date::text FROM invoices WHERE id = $1`, id).Scan(&due); err != nil {
		t.Fatal(err)
	}
	d, err := time.ParseInLocation(time.DateOnly, due, zone)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		at   time.Time
		want int
	}{
		{d.AddDate(0, 0, 9).Add(23*time.Hour + 30*time.Minute), 0}, // day 9, 23:30 in Zurich
		{d.AddDate(0, 0, 10).Add(30 * time.Minute), 1},             // day 10, 00:30 in Zurich; day 9 in UTC
	} {
		e.svc.now = func() time.Time { return tc.at.UTC() }
		if err := e.svc.Tick(context.Background()); err != nil {
			t.Fatal(err)
		}
		if got := len(e.mail.subjects()); got != tc.want {
			t.Fatalf("at %s: %d notices, want %d", tc.at, got, tc.want)
		}
	}
}
