package quotes

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
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// today in every test: 2026-11-16 (Europe/Zurich).
var fixedNow = time.Date(2026, 11, 16, 9, 0, 0, 0, time.UTC)

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
		return nil, fmt.Errorf("no object %s", key)
	}
	return b, nil
}

func (f *fakeStorage) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key, nil
}
func (f *fakeStorage) ProxyDownloads() bool                       { return false }
func (f *fakeStorage) Delete(_ context.Context, key string) error { return nil }
func (f *fakeStorage) Open(context.Context, string) (io.ReadSeekCloser, error) {
	return nil, errors.New("unused")
}

type fakeMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

type env struct {
	t     *testing.T
	st    *store.Store
	pool  *pgxpool.Pool
	srv   *httptest.Server
	svc   *Service
	mail  *fakeMailer
	files *fakeStorage
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
	e := &env{t: t, st: st, pool: pool, mail: &fakeMailer{}, files: &fakeStorage{objects: map[string][]byte{}}}
	inv := invoices.New(st, a, e.files, e.mail, discard)
	e.svc = New(st, a, inv, e.files, e.mail, discard)
	e.svc.now = func() time.Time { return fixedNow }
	ap := approvals.New(st, a)
	e.svc.SetApprovals(ap)
	mux := http.NewServeMux()
	a.Register(mux)
	ap.Register(mux)
	inv.Register(mux)
	e.svc.Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct{ token, csrf, workspace string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "Europe/Zurich", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
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
		"iban": "CH44 3199 9123 0008 8901 2"}, http.StatusOK, nil)
	return b
}

func (e *env) client(b *browser) string {
	e.t.Helper()
	id := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, id, map[string]any{"name": "Kunde AG", "email": "ap@kunde.ch",
		"street": "Rue du Lac", "street_number": "12", "zip": "1003", "city": "Lausanne", "country": "CH", "language": "de"}, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
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
	if resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

// quote calls the API and returns the quote it answers with.
func (e *env) quote(b *browser, method, path string, body any, want int) store.Quote {
	e.t.Helper()
	var out struct{ Data store.Quote }
	e.do(b, method, path, body, want, &out)
	return out.Data
}

// fails checks the error code and, for a validation error, the field.
func (e *env) fails(b *browser, method, path string, body any, status int, code, field string) {
	e.t.Helper()
	var out struct {
		Error struct {
			Code    string
			Details struct{ Fields map[string]string }
		}
	}
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code || (field != "" && out.Error.Details.Fields[field] == "") {
		e.t.Fatalf("%s %s: got %+v, want %s on %q", method, path, out.Error, code, field)
	}
}

func line(qty, price string) map[string]any {
	return map[string]any{"description": "Beratung", "quantity": qty, "unit": "hour", "unit_price": price, "vat_category": "S", "vat_rate": "8.1"}
}

func (e *env) draft(b *browser, clientID string) store.Quote {
	return e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": clientID, "lines": []any{line("2", "100.00")}}, http.StatusCreated)
}

func TestDrafts(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	q := e.draft(b, c)
	if q.Status != "draft" || q.Number != nil || q.IssueDate != "2026-11-16" || q.ValidUntil != "2026-12-16" || q.Revision != 1 {
		t.Fatalf("draft: %+v", q)
	}
	if q.NetTotal.String() != "200.00" || q.VATTotal.String() != "16.20" || q.PayableTotal.String() != "216.20" {
		t.Fatalf("totals: net %s vat %s payable %s", q.NetTotal, q.VATTotal, q.PayableTotal)
	}
	q = e.quote(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"lines": []any{line("3", "100.00")}, "valid_until": "2026-12-31",
		"note": "internal"}, http.StatusOK)
	if q.NetTotal.String() != "300.00" || q.ValidUntil != "2026-12-31" || q.Note == nil {
		t.Fatalf("patched: %+v", q)
	}

	for _, tc := range []struct {
		name         string
		method, path string
		body         any
		status       int
		code, field  string
	}{
		{"valid before date", "PATCH", "/api/v1/quotes/" + q.ID, map[string]any{"valid_until": "2026-11-01"}, 422, "validation_failed", "valid_until"},
		{"bad valid_until", "PATCH", "/api/v1/quotes/" + q.ID, map[string]any{"valid_until": "soon"}, 422, "validation_failed", "valid_until"},
		{"invoice-only field", "PATCH", "/api/v1/quotes/" + q.ID, map[string]any{"due_date": "2026-12-01"}, 400, "invalid_request", ""},
		{"bad line", "PATCH", "/api/v1/quotes/" + q.ID, map[string]any{"lines": []any{line("0", "1.00")}}, 422, "validation_failed", "lines.0.quantity"},
		{"no client", "POST", "/api/v1/quotes", map[string]any{"lines": []any{}}, 422, "validation_failed", "client_id"},
		{"unknown client", "POST", "/api/v1/quotes", map[string]any{"client_id": "cli_nope"}, 422, "validation_failed", "client_id"},
		{"accept a draft", "POST", "/api/v1/quotes/" + q.ID + "/accept", map[string]any{}, 409, "invalid_state", ""},
		{"invoice a draft", "POST", "/api/v1/quotes/" + q.ID + "/invoice", map[string]any{}, 409, "invalid_state", ""},
		{"revise a draft", "POST", "/api/v1/quotes/" + q.ID + "/revise", map[string]any{}, 409, "invalid_state", ""},
	} {
		t.Run(tc.name, func(t *testing.T) { e.fails(b, tc.method, tc.path, tc.body, tc.status, tc.code, tc.field) })
	}

	// another workspace sees nothing
	other := e.workspace()
	e.fails(other, "GET", "/api/v1/quotes/"+q.ID, nil, 404, "not_found", "")
	var list struct{ Data []store.Quote }
	e.do(other, "GET", "/api/v1/quotes", nil, 200, &list)
	if len(list.Data) != 0 {
		t.Fatalf("other workspace lists %d quotes", len(list.Data))
	}

	e.do(b, "GET", "/api/v1/quotes/"+q.ID+"/pdf", nil, 200, nil)
	e.do(b, "DELETE", "/api/v1/quotes/"+q.ID, nil, http.StatusNoContent, nil)
	e.fails(b, "GET", "/api/v1/quotes/"+q.ID, nil, 404, "not_found", "")
}

func TestSendAcceptInvoice(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	q := e.draft(b, c)
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
	if q.Status != "sent" || q.Number == nil || *q.Number != "Q-2026-001" || q.SentAt == nil {
		t.Fatalf("sent: %+v", q)
	}
	if len(e.mail.sent) != 1 {
		t.Fatalf("%d emails", len(e.mail.sent))
	}
	m := e.mail.sent[0]
	if m.To[0] != "ap@kunde.ch" || m.Subject != "Offerte Q-2026-001 von Muster GmbH" || m.ReplyTo != "billing@muster.ch" ||
		!strings.Contains(m.Text, "CHF 216.20, gültig bis 16.12.2026") || m.Attachments[0].Name != "Offerte-Q-2026-001.pdf" ||
		!bytes.HasPrefix(m.Attachments[0].Data, []byte("%PDF")) {
		t.Fatalf("email: %s %s %q %s", m.To, m.Subject, m.Text, m.Attachments[0].Name)
	}

	e.fails(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"note": "x"}, 409, "quote_locked", "")
	e.fails(b, "DELETE", "/api/v1/quotes/"+q.ID, nil, 409, "invalid_state", "")
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"to": []string{"boss@kunde.ch"}}, http.StatusOK) // resend
	if len(e.mail.sent) != 2 || e.mail.sent[1].To[0] != "boss@kunde.ch" || *q.Number != "Q-2026-001" {
		t.Fatalf("resend: %d %s", len(e.mail.sent), e.mail.sent[len(e.mail.sent)-1].To)
	}

	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/accept", map[string]any{"note": "  per phone "}, http.StatusOK)
	if q.Status != "accepted" || *q.DecidedBy != "staff" || *q.DecisionNote != "per phone" {
		t.Fatalf("accepted: %+v", q)
	}
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/decline", map[string]any{}, 409, "invalid_state", "")
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/revise", map[string]any{}, 409, "invalid_state", "")

	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/invoice", map[string]any{}, http.StatusCreated)
	if q.Invoice == nil {
		t.Fatalf("no invoice: %+v", q)
	}
	var inv struct {
		Data struct {
			Status   string
			Kind     string
			Total    string
			Quote    *store.InvoiceRef
			ClientID string `json:"client_id"`
			Lines    []struct{ Description string }
		}
	}
	e.do(b, "GET", "/api/v1/invoices/"+q.Invoice.ID, nil, 200, &inv)
	if inv.Data.Status != "draft" || inv.Data.Kind != "invoice" || inv.Data.Total != "216.20" || inv.Data.ClientID != c ||
		inv.Data.Quote == nil || inv.Data.Quote.ID != q.ID || inv.Data.Quote.Number != "Q-2026-001" || len(inv.Data.Lines) != 1 {
		t.Fatalf("invoice: %+v", inv.Data)
	}
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/invoice", map[string]any{}, 409, "quote_invoiced", "")

	// deleting the draft frees the quote
	e.do(b, "DELETE", "/api/v1/invoices/"+q.Invoice.ID, nil, http.StatusNoContent, nil)
	q = e.quote(b, "GET", "/api/v1/quotes/"+q.ID, nil, http.StatusOK)
	if q.Invoice != nil {
		t.Fatalf("still linked: %+v", q.Invoice)
	}
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/invoice", map[string]any{}, http.StatusCreated)
}

func TestConcurrentInvoiceOnce(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/accept", map[string]any{}, http.StatusOK)
	var wg sync.WaitGroup
	var mu sync.Mutex
	codes := map[int]int{}
	for range 4 {
		wg.Go(func() {
			raw, _ := json.Marshal(map[string]any{})
			req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/quotes/"+q.ID+"/invoice", bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-CSRF-Token", b.csrf)
			req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			mu.Lock()
			codes[resp.StatusCode]++
			mu.Unlock()
		})
	}
	wg.Wait()
	if codes[201] != 1 || codes[409] != 3 {
		t.Fatalf("status codes %v, want one 201 and three 409", codes)
	}
}

func TestExpiryRevisionNumbers(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	q := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "issue_date": "2026-10-01", "lines": []any{line("1", "50.00")}},
		http.StatusCreated)
	if q.ValidUntil != "2026-10-31" {
		t.Fatalf("default valid_until from the date: %s", q.ValidUntil)
	}
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if q.Status != "expired" || len(e.mail.sent) != 0 {
		t.Fatalf("status %s, %d emails", q.Status, len(e.mail.sent))
	}
	var list struct{ Data []store.Quote }
	e.do(b, "GET", "/api/v1/quotes?status=expired", nil, 200, &list)
	if len(list.Data) != 1 {
		t.Fatalf("expired filter: %d", len(list.Data))
	}
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, 409, "invalid_state", "")
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/decline", map[string]any{}, http.StatusOK) // staff may answer late
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/revise", map[string]any{}, http.StatusOK)
	if q.Status != "draft" || q.Revision != 2 || *q.Number != "Q-2026-001" || q.DecidedAt != nil {
		t.Fatalf("revised: %+v", q)
	}
	e.do(b, "GET", "/api/v1/quotes?search="+url.QueryEscape("rev. 2"), nil, 200, &list)
	if len(list.Data) != 1 || list.Data[0].ID != q.ID {
		t.Fatalf("search by the number as shown: %d", len(list.Data))
	}
	e.quote(b, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"issue_date": "2026-11-16", "valid_until": "2026-12-15"}, http.StatusOK)
	q = e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
	if q.Status != "sent" || *q.Number != "Q-2026-001" || e.mail.sent[0].Attachments[0].Name != "Offerte-Q-2026-001-r2.pdf" {
		t.Fatalf("resent revision: %+v", q)
	}
	second := e.draft(b, c)
	second = e.quote(b, "POST", "/api/v1/quotes/"+second.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if *second.Number != "Q-2026-002" {
		t.Fatalf("second number %s", *second.Number)
	}
	other := e.workspace()
	third := e.draft(other, e.client(other))
	third = e.quote(other, "POST", "/api/v1/quotes/"+third.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if *third.Number != "Q-2026-001" {
		t.Fatalf("numbers are per workspace: %s", *third.Number)
	}
}

func TestSendRefusals(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"to": []string{"nope"}}, 422, "validation_failed", "to")
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"subject": " "}, 422, "validation_failed", "subject")
	if q = e.quote(b, "GET", "/api/v1/quotes/"+q.ID, nil, 200); q.Number != nil || q.Status != "draft" {
		t.Fatalf("a refused send changed the quote: %+v", q)
	}
	e.svc.mail = nil
	e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, 503, "mail_unavailable", "")
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
}

func TestClientDecision(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	ctx := context.Background()
	ws := store.Workspace{ID: b.workspace, Timezone: "Europe/Zurich"}
	decide := func(id, clientID string, accept bool, note *string) (store.Quote, error) {
		var t store.Quote
		err := e.st.Tx(ctx, func(q store.Q) error {
			var err error
			t, err = Decide(ctx, q, ws, id, clientID, accept, note, fixedNow)
			return err
		})
		return t, err
	}
	draft := e.draft(b, c)
	if _, err := decide(draft.ID, c, true, nil); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("a draft is not the client's to see: %v", err)
	}
	q := e.quote(b, "POST", "/api/v1/quotes/"+e.draft(b, c).ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if _, err := decide(q.ID, e.client(b), true, nil); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("another client's quote: %v", err)
	}
	note := "Bitte ab Januar"
	got, err := decide(q.ID, c, true, &note)
	if err != nil || got.Status != "accepted" || *got.DecidedBy != "client" {
		t.Fatalf("accept: %+v %v", got, err)
	}
	if _, err := decide(q.ID, c, false, nil); err == nil {
		t.Fatal("answered twice")
	}
	var n int
	var data string
	if err := e.pool.QueryRow(ctx, `SELECT count(*), max(data::text) FROM notifications WHERE workspace_id = $1 AND event = 'quote.accepted'`,
		b.workspace).Scan(&n, &data); err != nil {
		t.Fatal(err)
	}
	if n != 1 || !strings.Contains(data, note) || !strings.Contains(data, "Q-2026-001") {
		t.Fatalf("%d notifications: %s", n, data)
	}

	late := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "issue_date": "2026-10-01"}, http.StatusCreated)
	e.quote(b, "POST", "/api/v1/quotes/"+late.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	if _, err := decide(late.ID, c, true, nil); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired accepted by the client: %v", err)
	}
}

// Concurrent first sends of different drafts take consecutive numbers; two sends of one draft number it once.
func TestConcurrentFirstSendsNumberGapless(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	var ids []string
	for range 5 {
		ids = append(ids, e.draft(b, c).ID)
	}
	ids = append(ids, ids[0]) // the first draft sent twice at once
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Go(func() {
			raw, _ := json.Marshal(map[string]any{"email": false})
			req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/quotes/"+id+"/send", bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-CSRF-Token", b.csrf)
			req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Errorf("send %s: status %d", id, resp.StatusCode)
			}
		})
	}
	wg.Wait()
	year := time.Now().In(store.Workspace{Timezone: "Europe/Zurich"}.Location()).Year()
	var numbers []string
	for _, id := range ids[:5] {
		numbers = append(numbers, *e.quote(b, "GET", "/api/v1/quotes/"+id, nil, http.StatusOK).Number)
	}
	slices.Sort(numbers)
	for i, n := range numbers {
		if want := fmt.Sprintf("Q-%d-%03d", year, i+1); n != want {
			t.Fatalf("numbers %v, want Q-%d-001 to -005", numbers, year)
		}
	}
}

// The client may accept through the last day of valid_until in the workspace's time zone, not the server's (UTC).
func TestClientDecisionAtMidnightInWorkspaceZone(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	ctx := context.Background()
	ws := store.Workspace{ID: b.workspace, Timezone: "Europe/Zurich"}
	zurich := ws.Location()
	for _, tc := range []struct {
		name string
		at   time.Time // valid_until is 2026-12-15
		ok   bool
	}{
		{"23:30 on the last day", time.Date(2026, 12, 15, 23, 30, 0, 0, zurich), true},                      // 22:30 UTC
		{"00:30 the day after, still the 15th in UTC", time.Date(2026, 12, 16, 0, 30, 0, 0, zurich), false}, // 23:30 UTC
	} {
		q := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "lines": []any{line("1", "50.00")},
			"issue_date": "2026-11-16", "valid_until": "2026-12-15"}, http.StatusCreated)
		e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
		err := e.st.Tx(ctx, func(tx store.Q) error {
			_, err := Decide(ctx, tx, ws, q.ID, c, true, nil, tc.at)
			return err
		})
		if (err == nil) != tc.ok {
			t.Errorf("%s: accept error %v, want ok %v", tc.name, err, tc.ok)
		}
	}
}

func TestDuplicate(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	src := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "issue_date": "2026-10-01", "valid_until": "2026-10-21",
		"reference": "PO-7", "lines": []any{line("2", "100.00")}}, http.StatusCreated)
	e.quote(b, "POST", "/api/v1/quotes/"+src.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	src = e.quote(b, "POST", "/api/v1/quotes/"+src.ID+"/accept", map[string]any{}, http.StatusOK)

	dup := e.quote(b, "POST", "/api/v1/quotes/"+src.ID+"/duplicate", nil, http.StatusCreated)
	if dup.ID == src.ID || dup.Status != "draft" || dup.Number != nil || dup.Revision != 1 || dup.SentAt != nil ||
		dup.DecidedAt != nil || dup.Invoice != nil || dup.IssueDate != "2026-11-16" || dup.ValidUntil != "2026-12-06" {
		t.Fatalf("duplicate: %+v", dup)
	}
	if dup.ClientID != c || dup.Reference == nil || *dup.Reference != "PO-7" || dup.PayableTotal.String() != "216.20" ||
		len(dup.Lines) != 1 || dup.Lines[0].ID == src.Lines[0].ID || dup.Lines[0].Description != "Beratung" {
		t.Fatalf("duplicate content: %+v", dup)
	}
	if again := e.quote(b, "GET", "/api/v1/quotes/"+src.ID, nil, http.StatusOK); again.Status != "accepted" || *again.Number != "Q-2026-001" {
		t.Fatalf("original changed: %+v", again)
	}
	// the copy is an ordinary draft: editable, and numbered on its own first send
	e.quote(b, "PATCH", "/api/v1/quotes/"+dup.ID, map[string]any{"note": "copy"}, http.StatusOK)
	if sent := e.quote(b, "POST", "/api/v1/quotes/"+dup.ID+"/send", map[string]any{"email": false}, http.StatusOK); *sent.Number != "Q-2026-002" {
		t.Fatalf("copy number %s", *sent.Number)
	}

	other := e.workspace()
	e.fails(other, "POST", "/api/v1/quotes/"+src.ID+"/duplicate", nil, 404, "not_found", "")
	e.fails(b, "POST", "/api/v1/quotes/quo_nope/duplicate", nil, 404, "not_found", "")

	if _, err := e.pool.Exec(context.Background(), `UPDATE clients SET deleted_at = now() WHERE id = $1`, c); err != nil {
		t.Fatal(err)
	}
	e.fails(b, "POST", "/api/v1/quotes/"+src.ID+"/duplicate", nil, 409, "invalid_state", "")
}
