package aiwrite

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

const path = "/api/v1/ai/write"

// fakeModel records each request and answers with answer as the model's text.
type fakeModel struct {
	mu     sync.Mutex
	reqs   []aimodel.Request
	answer string
}

func (f *fakeModel) Card() aimodel.RateCard                                      { return aimodel.Cards[aimodel.DefaultModel] }
func (f *fakeModel) InputTokens(context.Context, aimodel.Request) (int64, error) { return 100, nil }
func (f *fakeModel) Answer(_ context.Context, r aimodel.Request) (aimodel.Reply, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reqs = append(f.reqs, r)
	tokens := int64(140)
	return aimodel.Reply{Text: f.answer, Tokens: &tokens, Usage: &aimodel.Usage{Input: 100, Output: 40, Model: aimodel.DefaultModel, Tier: "default"}}, nil
}

func (f *fakeModel) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.reqs)
}

type env struct {
	t   *testing.T
	st  *store.Store
	raw *pgxpool.Pool
	srv *httptest.Server
}

type browser struct {
	c    *http.Client
	csrf string
}

func newEnv(t *testing.T, p aimodel.Provider) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(st, a, p, aimodel.Budget{DB: st, Pool: aimodel.PoolHeidi, Now: func() time.Time { return time.Now().UTC() }}).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv}
}

// member signs a new person into a new workspace; approved records their own AI approval there.
func (e *env) member(approved bool) (*browser, string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	ws := auth.NewID("wsp")
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
	token, csrf := rand.Text(), rand.Text()
	sum := sha256.Sum256([]byte(token))
	for _, err := range []error{
		e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Acme"}, "UTC", now),
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, "member", now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), csrf, u.ID, ws, now, now.Add(time.Hour)),
		e.st.SetAIConsent(ctx, ws, u.ID, approved, now),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	jar, _ := cookiejar.New(nil)
	base, _ := url.Parse(e.srv.URL)
	jar.SetCookies(base, []*http.Cookie{{Name: "helvetly_session", Value: token, Path: "/"}})
	return &browser{c: &http.Client{Jar: jar}, csrf: csrf}, ws
}

func (e *env) post(b *browser, body any) (int, map[string]any) {
	e.t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	res, err := b.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func errCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

func text(body map[string]any) string {
	d, _ := body["data"].(map[string]any)
	s, _ := d["text"].(string)
	return s
}

func TestValidation(t *testing.T) {
	m := &fakeModel{answer: `{"text":"ok"}`}
	e := newEnv(t, m)
	b, _ := e.member(true)
	many := map[string]string{}
	for i := range 21 {
		many[string(rune('a'+i))] = "x"
	}
	for _, tc := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"unknown field", map[string]any{"field": "client_name", "action": "improve", "text": "x"}, "field"},
		{"unknown action", map[string]any{"field": "invoice_intro", "action": "summarise", "text": "x"}, "action"},
		{"draft without text or context", map[string]any{"field": "product_description", "action": "draft", "context": map[string]string{"name": " "}}, "context"},
		{"improve without text", map[string]any{"field": "product_description", "action": "improve", "text": "  "}, "text"},
		{"shorten without text", map[string]any{"field": "product_description", "action": "shorten"}, "text"},
		{"formal without text", map[string]any{"field": "invoice_footer", "action": "formal"}, "text"},
		{"translate without text", map[string]any{"field": "email_message", "action": "translate", "language": "fr"}, "text"},
		{"friendly without text", map[string]any{"field": "email_message", "action": "friendly"}, "text"},
		{"custom without instruction", map[string]any{"field": "quote_intro", "action": "custom", "text": "x"}, "instruction"},
		{"instruction too long", map[string]any{"field": "quote_intro", "action": "custom", "instruction": strings.Repeat("x", 301)}, "instruction"},
		{"text too long", map[string]any{"field": "quote_intro", "action": "improve", "text": strings.Repeat("ä", 4001)}, "text"},
		{"unknown language", map[string]any{"field": "quote_intro", "action": "improve", "text": "x", "language": "pl"}, "language"},
		{"max_length zero", map[string]any{"field": "quote_intro", "action": "improve", "text": "x", "max_length": 0}, "max_length"},
		{"max_length too big", map[string]any{"field": "quote_intro", "action": "improve", "text": "x", "max_length": 4001}, "max_length"},
		{"too many context keys", map[string]any{"field": "quote_intro", "action": "improve", "text": "x", "context": many}, "context"},
		{"context value too long", map[string]any{"field": "quote_intro", "action": "improve", "text": "x", "context": map[string]string{"name": strings.Repeat("x", 301)}}, "context"},
	} {
		code, body := e.post(b, tc.body)
		e, _ := body["error"].(map[string]any)
		d, _ := e["details"].(map[string]any)
		f, _ := d["fields"].(map[string]any)
		if code != http.StatusUnprocessableEntity || errCode(body) != "validation_failed" || f[tc.field] == nil {
			t.Errorf("%s: %d %v", tc.name, code, body)
		}
	}
	if m.calls() != 0 {
		t.Fatalf("model called %d times on invalid input", m.calls())
	}
}

func TestConsentRequiredSpendsNothing(t *testing.T) {
	m := &fakeModel{answer: `{"text":"ok"}`}
	e := newEnv(t, m)
	b, ws := e.member(false)
	code, body := e.post(b, map[string]any{"field": "invoice_intro", "action": "improve", "text": "Hello"})
	if code != http.StatusForbidden || errCode(body) != "ai_consent_required" || m.calls() != 0 {
		t.Fatalf("%d %v, %d calls", code, body, m.calls())
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM ai_calls WHERE workspace_id = $1`, ws).Scan(&n); err != nil || n != 0 {
		t.Fatalf("ai_calls %d %v", n, err)
	}
}

func TestChargesHeidiPoolNotAutomation(t *testing.T) {
	m := &fakeModel{answer: `{"text":"  Monthly bookkeeping for your company.  "}`}
	e := newEnv(t, m)
	b, ws := e.member(true)
	code, body := e.post(b, map[string]any{"field": "engagement_description", "action": "draft", "language": "de",
		"context": map[string]string{"name": "Buchhaltung", "client": "Muster AG"}})
	if code != http.StatusOK || text(body) != "Monthly bookkeeping for your company." {
		t.Fatalf("%d %v", code, body)
	}
	r := m.reqs[0]
	if r.Schema == nil || !strings.Contains(r.Message, "German") || !strings.Contains(r.Message, "client: Muster AG") ||
		strings.Contains(r.Instructions, "Muster") || r.MaxOutputTokens != 1000/2+200 {
		t.Fatalf("request %+v", r)
	}
	var pool, kind string
	if err := e.raw.QueryRow(context.Background(), `SELECT pool, kind FROM ai_calls WHERE workspace_id = $1`, ws).Scan(&pool, &kind); err != nil ||
		pool != aimodel.PoolHeidi || kind != "write" {
		t.Fatalf("ai_calls %q %q %v", pool, kind, err)
	}
	var heidi, automation int64
	if err := e.raw.QueryRow(context.Background(), `SELECT coalesce(sum(tokens_used) FILTER (WHERE pool = 'heidi'), 0),
		coalesce(sum(tokens_used) FILTER (WHERE pool = 'automation'), 0) FROM heidi_usage WHERE workspace_id = $1`, ws).Scan(&heidi, &automation); err != nil ||
		heidi != 140 || automation != 0 {
		t.Fatalf("usage heidi %d automation %d %v", heidi, automation, err)
	}
}

func TestMaxLengthEnforced(t *testing.T) {
	m := &fakeModel{answer: `{"text":"Careful bookkeeping and payroll for small companies in Zurich"}`}
	e := newEnv(t, m)
	b, _ := e.member(true)
	code, body := e.post(b, map[string]any{"field": "product_description", "action": "improve", "text": "bookkeeping", "max_length": 30})
	if code != http.StatusOK || text(body) != "Careful bookkeeping and" {
		t.Fatalf("%d %v", code, body)
	}
}

func TestClip(t *testing.T) {
	for _, tc := range []struct {
		in   string
		max  int
		want string
	}{
		{" short ", 10, "short"},
		{"one two three", 7, "one two"},               // ends exactly at a word
		{"one two three", 9, "one two"},               // cut inside a word: back to the space
		{"averyveryverylongword", 8, "averyver"},      // no boundary: hard cut
		{"Grüezi, liebe Kundin", 8, "Grüezi"},         // runes, and a trailing comma dropped
		{"alpha beta, gamma delta", 12, "alpha beta"}, // trailing punctuation
	} {
		got := clip(tc.in, tc.max)
		if got != tc.want || utf8.RuneCountInString(got) > tc.max {
			t.Errorf("clip(%q, %d) = %q, want %q", tc.in, tc.max, got, tc.want)
		}
	}
}

func TestModelAnswers(t *testing.T) {
	for _, tc := range []struct {
		name   string
		p      aimodel.Provider
		status int
		code   string
		text   string
	}{
		{"development model", aimodel.Fake{}, http.StatusOK, "", "Written by the development model."},
		{"no model configured", nil, http.StatusServiceUnavailable, "ai_unavailable", ""},
		{"unreadable answer", &fakeModel{answer: "Sure! Here it is"}, http.StatusBadGateway, "ai_unreadable", ""},
		{"empty answer", &fakeModel{answer: `{"text":"  "}`}, http.StatusBadGateway, "ai_unreadable", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, tc.p)
			b, _ := e.member(true)
			code, body := e.post(b, map[string]any{"field": "invoice_footer", "action": "draft", "context": map[string]string{"terms": "30 days"}})
			if code != tc.status || errCode(body) != tc.code || text(body) != tc.text {
				t.Fatalf("%d %v", code, body)
			}
		})
	}
}
