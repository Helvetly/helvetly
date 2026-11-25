package notifications

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"html"
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

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
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

type env struct {
	t    *testing.T
	st   *store.Store
	svc  *Service
	mail *fakeMailer
	srv  *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	key := bytes.Repeat([]byte{7}, 32)
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: key, SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	m := &fakeMailer{}
	svc := New(st, a, m, "https://helvetly.example.com", key, discard)
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, svc: svc, mail: m, srv: srv}
}

type browser struct{ token, csrf, workspace, user string }

func (e *env) workspace() string {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return ws
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, user: u.ID}
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

// want sends the request (b nil: no session) and checks the status.
func (e *env) want(b *browser, method, path string, body any, status int) []byte {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if b != nil {
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, status, raw)
	}
	return raw
}

func (e *env) notify(ws, event string, data map[string]any, to store.NotifyTo, at time.Time) {
	e.t.Helper()
	if err := e.st.Tx(context.Background(), func(q store.Q) error { return Notify(context.Background(), q, ws, event, data, to, at) }); err != nil {
		e.t.Fatal(err)
	}
}

type page struct {
	Data []struct {
		ID, Event, Title, Href, Category string
		Body                             *string
		Read                             bool
	}
	Unread int
	Next   *string
}

func (e *env) bell(b *browser, query string) page {
	e.t.Helper()
	var p page
	if err := json.Unmarshal(e.want(b, "GET", "/api/v1/notifications"+query, nil, 200), &p); err != nil {
		e.t.Fatal(err)
	}
	return p
}

func paid(n string) map[string]any {
	return map[string]any{"invoice_id": "inv_" + n, "number": "RE-" + n, "client": "Muster AG", "amount": "100.00", "currency": "CHF"}
}

func TestRecipientsAndBell(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	owner, admin, member := e.join(ws, "owner"), e.join(ws, "admin"), e.join(ws, "member")
	other := e.join(e.workspace(), "owner")

	e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{Roles: Managers, Except: owner.user}, time.Now())
	e.notify(ws, "signature.declined", map[string]any{"request_id": "sig_1", "title": "NDA", "signer": "Bob", "reason": "No"},
		store.NotifyTo{UserIDs: []string{member.user}}, time.Now())

	for _, c := range []struct {
		who    *browser
		events []string
	}{
		{owner, nil},                             // recorded it
		{admin, []string{"invoice.paid"}},        // a manager
		{member, []string{"signature.declined"}}, // the sender only
		{other, nil},                             // another workspace
	} {
		p := e.bell(c.who, "")
		if len(p.Data) != len(c.events) || p.Unread != len(c.events) {
			t.Fatalf("%+v: want %v", p, c.events)
		}
		for i, ev := range c.events {
			if p.Data[i].Event != ev {
				t.Fatalf("%+v: want %v", p, c.events)
			}
		}
	}
	p := e.bell(admin, "")
	if n := p.Data[0]; n.Title != "Invoice RE-1 was paid" || n.Href != "/invoices?id=inv_1" || n.Body == nil || *n.Body != "CHF 100.00 received from Muster AG." {
		t.Fatalf("rendered %+v", n)
	}
	e.want(admin, "POST", "/api/v1/notifications/read", nil, 204)
	if p := e.bell(admin, ""); p.Unread != 0 || !p.Data[0].Read {
		t.Fatalf("after read: %+v", p)
	}
}

func TestPaging(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin := e.join(ws, "admin")
	for i := range 3 {
		e.notify(ws, "invoice.paid", paid(string(rune('a'+i))), store.NotifyTo{Roles: Managers}, time.Now())
	}
	first := e.bell(admin, "?limit=2")
	if len(first.Data) != 2 || first.Next == nil || first.Unread != 3 || first.Data[0].Title != "Invoice RE-c was paid" {
		t.Fatalf("first page %+v", first)
	}
	second := e.bell(admin, "?limit=2&before="+*first.Next)
	if len(second.Data) != 1 || second.Next != nil || second.Data[0].Title != "Invoice RE-a was paid" {
		t.Fatalf("second page %+v", second)
	}
	e.want(admin, "GET", "/api/v1/notifications?limit=51", nil, 422)
	e.want(admin, "GET", "/api/v1/notifications?before=x", nil, 422)
}

func TestPrefs(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin := e.join(ws, "admin")

	e.want(admin, "PUT", "/api/v1/account/notifications", map[string]any{"events": []map[string]any{{"event": "nope"}}}, 422)
	raw := e.want(admin, "PUT", "/api/v1/account/notifications", map[string]any{"events": []map[string]any{
		{"event": "invoice.paid", "email": false, "in_app": false},
		{"event": "member.joined", "email": true, "in_app": false},
	}}, 200)
	var p struct {
		MailReady bool `json:"mail_ready"`
		Events    []choice
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	by := map[string]choice{}
	for _, c := range p.Events {
		by[c.Event] = c
	}
	paidC, joined, signed, partly := by["invoice.paid"], by["member.joined"], by["signature.completed"], by["invoice.partly_paid"]
	if !p.MailReady || len(p.Events) != len(Events) || paidC.InApp || joined.InApp || !joined.Email ||
		signed.EmailAvailable || signed.Email || !signed.InApp ||
		!partly.EmailAvailable || partly.Email || !partly.InApp || partly.Category != "invoices" {
		t.Fatalf("prefs %+v", p)
	}

	// Both off: no row. Bell off but email on: an email, not in the bell.
	e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{Roles: Managers}, time.Now().Add(-2*time.Minute))
	e.notify(ws, "member.joined", map[string]any{"name": "Bob"}, store.NotifyTo{Roles: Managers}, time.Now().Add(-2*time.Minute))
	if p := e.bell(admin, ""); len(p.Data) != 0 {
		t.Fatalf("bell %+v", p)
	}
	e.svc.Tick(context.Background())
	if len(e.mail.sent) != 1 || e.mail.sent[0].Subject != "Bob joined the workspace" {
		t.Fatalf("sent %+v", e.mail.sent)
	}
}

func TestEmailBurstsAndUnsubscribe(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	owner, admin := e.join(ws, "owner"), e.join(ws, "admin")
	now := time.Now()
	e.svc.now = func() time.Time { return now }

	e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{Roles: Managers, Except: owner.user}, now.Add(-90*time.Second))
	e.notify(ws, "invoice.paid", paid("2"), store.NotifyTo{Roles: Managers, Except: owner.user}, now.Add(-30*time.Second))
	e.notify(ws, "signature.completed", map[string]any{"title": "NDA"}, store.NotifyTo{UserIDs: []string{admin.user}}, now.Add(-time.Hour))

	e.svc.Tick(context.Background()) // the burst is still settling; the signature never emails
	if len(e.mail.sent) != 0 {
		t.Fatalf("sent early %+v", e.mail.sent)
	}
	now = now.Add(time.Minute)
	e.svc.Tick(context.Background())
	e.svc.Tick(context.Background())
	if len(e.mail.sent) != 1 {
		t.Fatalf("want one email, sent %+v", e.mail.sent)
	}
	m := e.mail.sent[0]
	if m.Subject != "2 invoices were paid" || !strings.Contains(m.Text, "Invoice RE-1 was paid") || !strings.Contains(m.Text, "Invoice RE-2 was paid") ||
		!strings.HasPrefix(m.ListUnsubscribe, "https://helvetly.example.com/api/v1/public/notifications/unsubscribe?token=") {
		t.Fatalf("email %+v", m)
	}

	token := e.svc.token(admin.user, "invoice.paid")
	e.want(nil, "POST", "/api/v1/public/notifications/unsubscribe", map[string]string{"token": token[:len(token)-2] + "xx"}, 400)
	e.want(nil, "POST", "/api/v1/public/notifications/unsubscribe", map[string]string{"token": e.svc.token(admin.user, "signature.completed")}, 400)
	e.want(nil, "POST", "/api/v1/public/notifications/unsubscribe?token="+token, nil, 200)
	prefs, err := e.st.UserNotificationPrefs(context.Background(), admin.user, false)
	if err != nil || prefs["invoice.paid"] != (store.NotificationChoice{Email: false, InApp: true}) {
		t.Fatalf("prefs %+v %v", prefs, err)
	}

	// Email off now: the next one shows in the bell only.
	e.notify(ws, "invoice.paid", paid("3"), store.NotifyTo{Roles: Managers, Except: owner.user}, now.Add(-2*time.Minute))
	e.svc.Tick(context.Background())
	if len(e.mail.sent) != 1 || e.bell(admin, "").Unread != 4 {
		t.Fatalf("after unsubscribe: sent %d", len(e.mail.sent))
	}
}

func TestSignedInOnly(t *testing.T) {
	e := newEnv(t)
	e.want(nil, "GET", "/api/v1/notifications", nil, 401)
	e.want(nil, "GET", "/api/v1/account/notifications", nil, 401)
}

func TestRenderChangeRequested(t *testing.T) {
	m := render(store.Notification{Event: "client.change_requested",
		Data: []byte(`{"client_id":"cli_1","client_name":"Acme AG","contact_name":"Ana"}`)})
	if !strings.Contains(m.title, "Acme AG") || !strings.Contains(m.body, "Ana") || m.href != "/clients?id=cli_1" {
		t.Fatalf("message = %+v", m)
	}
}

func TestRenderDunningSent(t *testing.T) {
	for _, c := range []struct{ data, want string }{
		{`{"invoice_id":"inv_1","number":"RE-1","level":2,"title":"Zahlungshinweis"}`, "Zahlungshinweis sent for invoice RE-1"},
		{`{"invoice_id":"inv_1","number":"RE-1","level":2}`, "Payment reminder 2 sent for invoice RE-1"},
	} {
		if m := render(store.Notification{Event: "dunning.sent", Data: []byte(c.data)}); m.title != c.want {
			t.Errorf("%s: %q, want %q", c.data, m.title, c.want)
		}
	}
}

func TestReadOneAndBubbleCutoff(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin, other := e.join(ws, "admin"), e.join(ws, "admin")
	now := time.Now()
	e.svc.now = func() time.Time { return now }
	for i := range 3 {
		e.notify(ws, "invoice.paid", paid(string(rune('a'+i))), store.NotifyTo{Roles: Managers}, now)
	}
	p := e.bell(admin, "")
	oldest, middle := p.Data[2].ID, p.Data[1].ID

	// Read 10 minutes ago, read just now, unread: the bubble (read_after = now - 5 min) keeps the last two.
	e.svc.now = func() time.Time { return now.Add(-10 * time.Minute) }
	e.want(admin, "POST", "/api/v1/notifications/"+oldest+"/read", nil, 204)
	e.svc.now = func() time.Time { return now }
	e.want(admin, "POST", "/api/v1/notifications/"+middle+"/read", nil, 204)
	e.want(admin, "POST", "/api/v1/notifications/"+middle+"/read", nil, 204) // keeps the first read time
	cutoff := url.QueryEscape(now.Add(-5 * time.Minute).Format(time.RFC3339))
	bubble := e.bell(admin, "?read_after="+cutoff)
	if len(bubble.Data) != 2 || bubble.Data[1].ID != middle || !bubble.Data[1].Read || bubble.Unread != 1 {
		t.Fatalf("bubble %+v", bubble)
	}
	if all := e.bell(admin, ""); len(all.Data) != 3 {
		t.Fatalf("page keeps every item: %+v", all)
	}
	if unread := e.bell(admin, "?unread=true"); len(unread.Data) != 1 || unread.Data[0].Read {
		t.Fatalf("unread filter %+v", unread)
	}

	// Unread again: back in the bubble.
	e.want(admin, "POST", "/api/v1/notifications/"+oldest+"/unread", nil, 204)
	if bubble := e.bell(admin, "?read_after="+cutoff); len(bubble.Data) != 3 || bubble.Unread != 2 {
		t.Fatalf("after unread %+v", bubble)
	}

	// Someone else's notification, or a bad id: not found.
	e.want(other, "POST", "/api/v1/notifications/"+oldest+"/read", nil, 404)
	e.want(admin, "POST", "/api/v1/notifications/x/read", nil, 404)
	e.want(admin, "GET", "/api/v1/notifications?read_after=yesterday", nil, 422)
}

func TestCategoryFilter(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin := e.join(ws, "admin")
	e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{Roles: Managers}, time.Now())
	e.notify(ws, "member.joined", map[string]any{"name": "Bob"}, store.NotifyTo{Roles: Managers}, time.Now())
	p := e.bell(admin, "?category=team")
	if len(p.Data) != 1 || p.Data[0].Event != "member.joined" || p.Data[0].Category != "team" || p.Unread != 2 {
		t.Fatalf("team %+v", p)
	}
	e.want(admin, "GET", "/api/v1/notifications?category=nope", nil, 422)
}

func TestOnceAndDefaults(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin := e.join(ws, "admin")
	now := time.Now().Add(-2 * time.Minute)
	for range 2 {
		e.notify(ws, "invoice.overdue", map[string]any{"invoice_id": "inv_1", "number": "RE-1"},
			store.NotifyTo{Roles: Managers, Once: "invoice.overdue:inv_1"}, now)
	}
	// A manager who joins later gets the key's first notification, not a repeat for the others.
	late := e.join(ws, "owner")
	e.notify(ws, "invoice.overdue", map[string]any{"invoice_id": "inv_1", "number": "RE-1"},
		store.NotifyTo{Roles: Managers, Once: "invoice.overdue:inv_1"}, now)
	if n := len(e.bell(admin, "").Data); n != 1 {
		t.Fatalf("admin got %d", n)
	}
	if n := len(e.bell(late, "").Data); n != 1 {
		t.Fatalf("late owner got %d", n)
	}
	// invoice.overdue's email starts off: the bell only.
	e.svc.Tick(context.Background())
	if len(e.mail.sent) != 0 {
		t.Fatalf("sent %+v", e.mail.sent)
	}
	if err := e.st.Tx(context.Background(), func(q store.Q) error {
		return Notify(context.Background(), q, ws, "no.such.event", nil, store.NotifyTo{Roles: Managers}, now)
	}); err == nil {
		t.Fatal("unknown event accepted")
	}
}

func TestEveryEventRenders(t *testing.T) {
	seen := map[string]bool{}
	for _, ev := range Events {
		if seen[ev.Name] || !slices.Contains(Categories, ev.Category) {
			t.Fatalf("%s: duplicate or unknown category %q", ev.Name, ev.Category)
		}
		seen[ev.Name] = true
		m := render(store.Notification{Event: ev.Name, Data: []byte(`{"invoice_id":"inv_1","number":"RE-1","title":"NDA"}`)})
		if m.title == "" || m.title == "Something happened in your workspace" || !strings.HasPrefix(m.href, "/") || actions[ev.Name] == "" {
			t.Fatalf("%s renders %+v", ev.Name, m)
		}
	}
}

func TestEmailMessage(t *testing.T) {
	s := &Service{publicURL: "https://app.example.com", key: []byte("0123456789abcdef0123456789abcdef")}
	at := time.Date(2026, 11, 10, 13, 5, 0, 0, time.UTC)
	n := func(ev, data string, after time.Duration) store.Notification {
		return store.Notification{UserID: "usr_1", Event: ev, Data: []byte(data), CreatedAt: at.Add(after), Email: "a@example.com",
			WorkspaceName: "Acme & Co", WorkspaceTimezone: "Europe/Zurich"}
	}
	paid := func(no, client string, after time.Duration) store.Notification {
		return n("invoice.paid", `{"invoice_id":"inv_`+no+`","number":"RE-`+no+`","currency":"CHF","amount":"10.00","client":"`+client+`"}`, after)
	}
	for _, c := range []struct {
		name, subject string
		burst         []store.Notification
		html, text    []string
		notHTML       []string
	}{
		{"one event", "<b>Jo</b> asked to change their billing details",
			[]store.Notification{n("client.change_requested", `{"client_id":"cli_1","client_name":"<b>Jo</b>","contact_name":"ana@example.com"}`, 0)},
			[]string{">Acme &amp; Co</p>", "&lt;b&gt;Jo&lt;/b&gt; asked to change", "ana@example.com sent the change from the client portal",
				`href="https://app.example.com/clients?id=cli_1"`, ">Review the request</strong></a>"},
			[]string{"Acme & Co\n", "Review the request: https://app.example.com/clients?id=cli_1", "Unsubscribe: https://app.example.com/unsubscribe#"},
			[]string{"<li>", "<b>Jo</b>"}},
		{"a burst", "2 invoices were paid", []store.Notification{paid("1", "Acme AG", 0), paid("2", "<i>Berg</i>", 40*time.Second)},
			[]string{"<strong>Invoice RE-1 was paid</strong></a>", "CHF 10.00 received from Acme AG · 14:05</span>", "&lt;i&gt;Berg&lt;/i&gt; · 14:05",
				`href="https://app.example.com/invoices?id=inv_2"`, `href="https://app.example.com/notifications"`, ">Open notifications</strong></a>"},
			[]string{"- Invoice RE-2 was paid\n  CHF 10.00 received from <i>Berg</i> · 14:05\n  https://app.example.com/invoices?id=inv_2\n",
				"Open notifications: https://app.example.com/notifications"},
			[]string{"<i>Berg</i>"}},
	} {
		m := s.message(c.burst)
		if m.Subject != c.subject || m.To[0] != "a@example.com" || !strings.HasPrefix(m.ListUnsubscribe, "https://app.example.com/api/v1/public/notifications/unsubscribe?token=") ||
			!strings.Contains(m.Footer, "Acme &amp; Co on Helvetly") || !strings.Contains(m.Footer, ">Unsubscribe</a>") {
			t.Fatalf("%s: %+v", c.name, m)
		}
		if strings.Count(m.HTML, html.EscapeString(c.subject)) != 1 {
			t.Errorf("%s: the title is not shown exactly once: %s", c.name, m.HTML)
		}
		for _, w := range c.html {
			if !strings.Contains(m.HTML, w) {
				t.Errorf("%s: no %q in %s", c.name, w, m.HTML)
			}
		}
		for _, w := range c.notHTML {
			if strings.Contains(m.HTML, w) {
				t.Errorf("%s: %q in %s", c.name, w, m.HTML)
			}
		}
		for _, w := range c.text {
			if !strings.Contains(m.Text, w) {
				t.Errorf("%s: no %q in %s", c.name, w, m.Text)
			}
		}
	}
}

// Several job instances tick at once against the same database: every burst is claimed and emailed exactly once.
func TestParallelTicksEmailOnce(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	now := time.Now()
	e.svc.now = func() time.Time { return now }
	const people = 8
	for range people {
		b := e.join(ws, "admin")
		e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{UserIDs: []string{b.user}}, now.Add(-2*time.Minute))
		e.notify(ws, "invoice.paid", paid("2"), store.NotifyTo{UserIDs: []string{b.user}}, now.Add(-90*time.Second))
	}
	var wg sync.WaitGroup
	for range 6 {
		wg.Go(func() { e.svc.Tick(context.Background()) })
	}
	wg.Wait()
	to := map[string]int{}
	for _, m := range e.mail.sent {
		to[m.To[0]]++
		if m.Subject != "2 invoices were paid" {
			t.Fatalf("a burst was split: %q", m.Subject)
		}
	}
	if len(e.mail.sent) != people || len(to) != people {
		t.Fatalf("sent %d emails to %d people, want %d each once", len(e.mail.sent), len(to), people)
	}
}

// Someone removed from the workspace before the burst settles is not emailed its events any more.
func TestRemovedMemberNotEmailed(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin := e.join(ws, "admin")
	now := time.Now()
	e.svc.now = func() time.Time { return now }
	e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{UserIDs: []string{admin.user}}, now.Add(-2*time.Minute))
	if err := e.st.RemoveMember(context.Background(), ws, admin.user); err != nil {
		t.Fatal(err)
	}
	e.svc.Tick(context.Background())
	if len(e.mail.sent) != 0 {
		t.Fatalf("emailed a former member: %+v", e.mail.sent[0].Subject)
	}
}

// AI import results are shown in the bell only until someone turns email on.
func TestAIImportEmailsStartOff(t *testing.T) {
	for _, name := range []string{"import.ready", "import.failed"} {
		e, ok := lookup(name)
		if d := e.defaults(); !ok || !d.Bell || d.Email || !d.EmailOffered {
			t.Errorf("%s defaults %+v, want bell on, email offered but off", name, d)
		}
	}
}

func TestNeedsYouClassification(t *testing.T) {
	for _, tc := range []struct {
		event    string
		needsYou bool
		settled  string
	}{
		{"invoice.overdue", true, "invoice.paid"},
		{"einvoice.delivery_failed", true, "einvoice.delivered"},
		{"portal.domain_failed", true, "portal.domain_active"},
		{"import.ready", true, ""},
		{"client.change_requested", true, ""},
		{"invoice.paid", false, ""},
		{"member.joined", false, ""},
		{"signature.signed", false, ""},
	} {
		if needsYou[tc.event] != tc.needsYou || settledBy[tc.event] != tc.settled {
			t.Errorf("%s: needs you %v settled by %q", tc.event, needsYou[tc.event], settledBy[tc.event])
		}
	}
	for name, by := range settledBy {
		if _, ok := lookup(by); !ok || !needsYou[name] {
			t.Errorf("%s settled by unknown %s or not needing you", name, by)
		}
	}
	for name := range needsYou {
		if _, ok := lookup(name); !ok {
			t.Errorf("unknown event %s needs you", name)
		}
	}
}

func TestOverdueSettledByPayment(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	admin := e.join(ws, "admin")
	now := time.Now()
	type item struct {
		Event, Title, Action string
		NeedsYou             bool `json:"needs_you"`
		Resolved             *struct{ Title, Action string }
	}
	list := func() []item {
		var p struct{ Data []item }
		if err := json.Unmarshal(e.want(admin, "GET", "/api/v1/notifications", nil, 200), &p); err != nil {
			t.Fatal(err)
		}
		return p.Data
	}
	e.notify(ws, "invoice.overdue", paid("1"), store.NotifyTo{Roles: Managers}, now)
	e.notify(ws, "invoice.overdue", paid("2"), store.NotifyTo{Roles: Managers}, now)
	if got := list(); len(got) != 2 || !got[0].NeedsYou || got[0].Resolved != nil || got[0].Action != "View invoice" {
		t.Fatalf("before payment %+v", got)
	}
	// Invoice 1 is paid: its overdue item shows the payment; invoice 2 still needs you.
	e.notify(ws, "invoice.paid", paid("1"), store.NotifyTo{Roles: Managers}, now)
	got := list()
	if len(got) != 3 || got[0].Event != "invoice.paid" || got[0].NeedsYou {
		t.Fatalf("after payment %+v", got)
	}
	if got[1].Resolved != nil {
		t.Fatalf("invoice 2 settled by another invoice's payment: %+v", got[1])
	}
	if r := got[2].Resolved; r == nil || r.Title != "Invoice RE-1 was paid" || r.Action != "View invoice" {
		t.Fatalf("invoice 1 not settled: %+v", got[2])
	}
}

func TestRenderApproval(t *testing.T) {
	for _, c := range []struct{ event, data, title, href, action string }{
		{"approval.requested", `{"invoice_id":"inv_1","kind":"credit_note","client":"Acme AG","actor":"Ana"}`,
			"Ana asks you to approve credit note for Acme AG", "/invoices?id=inv_1", "Review the draft"},
		{"approval.approved", `{"doc_type":"quote","doc_id":"quo_1","kind":"quote","client":"Acme AG"}`,
			"Your quote for Acme AG was approved", "/quotes?id=quo_1", "Send it"},
		{"approval.approved", `{"doc_type":"expense","doc_id":"exp_1","kind":"expense","client":"SBB"}`,
			"Your expense from SBB was approved", "/expenses?id=exp_1", "Book it"},
		{"approval.approved", `{"doc_type":"invoice","doc_id":"inv_2","invoice_id":"inv_2","kind":"invoice"}`,
			"Your invoice was approved", "/invoices?id=inv_2", "Issue it"},
		{"approval.rejected", `{"doc_type":"expense","doc_id":"exp_1","kind":"expense","client":"SBB","actor":"Bo"}`,
			"Bo rejected your expense from SBB", "/expenses?id=exp_1", "Open the draft"},
	} {
		m := render(store.Notification{Event: c.event, Data: []byte(c.data)})
		if m.title != c.title || m.href != c.href || m.action != c.action {
			t.Errorf("%s %s: %+v", c.event, c.data, m)
		}
	}
}

func TestRenderScheduling(t *testing.T) {
	session := `"occurrence_id":"soc_1","title":"Coaching","client_id":"cli_1","client_name":"Anna Muster","when":"Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich)"`
	for _, c := range []struct{ event, data, title, body, href, action string }{
		{"scheduling.booked", `{` + session + `}`, "Anna Muster booked Coaching", "Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich)",
			"/scheduling?occurrence=soc_1", "Open the session"},
		{"scheduling.booking_requested", `{` + session + `}`, "Anna Muster asks to book Coaching",
			"Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich) · Confirm or decline it.", "/scheduling?occurrence=soc_1", "Review the booking"},
		{"scheduling.cancel_requested", `{` + session + `,"late":true}`, "Anna Muster asks to cancel Coaching",
			"Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich) · Late: it counts as a used session if you approve it.",
			"/scheduling?occurrence=soc_1", "Review the request"},
		{"scheduling.reschedule_requested", `{` + session + `,"late":false}`, "Anna Muster asks to move Coaching",
			"Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich)", "/scheduling?occurrence=soc_1", "Review the request"},
		{"scheduling.cancelled_by_client", `{` + session + `}`, "Anna Muster cancelled Coaching",
			"Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich) · On time, so it does not count.", "/scheduling?occurrence=soc_1", "Open the session"},
		{"scheduling.proposal_answered", `{` + session + `,"answer":"declined"}`, "Anna Muster declined your new time for Coaching",
			"Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich)", "/scheduling?occurrence=soc_1", "Open the session"},
		{"scheduling.calendar_disconnected", `{"provider":"google","account_email":"ana@example.com"}`,
			"Your Google calendar was disconnected", "ana@example.com · Connect it again so your sessions stay in your calendar.",
			"/settings/scheduling#calendars", "Connect it again"},
		{"scheduling.event_detached", `{"occurrence_id":"soc_2","provider":"microsoft","starts_at":"2026-12-01T08:00:00Z"}`,
			"A session was removed from your Microsoft calendar",
			"The session still takes place: push it to your calendar again or cancel it in Scheduling.", "/scheduling?occurrence=soc_2",
			"Open the session"},
	} {
		m := render(store.Notification{Event: c.event, Data: []byte(c.data)})
		if m.title != c.title || m.body != c.body || m.href != c.href || m.action != c.action {
			t.Errorf("%s: %+v", c.event, m)
		}
	}
}
