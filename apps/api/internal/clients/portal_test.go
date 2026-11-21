package clients

import (
	"bytes"
	"context"
	"errors"
	"helvetly.com/api/internal/portalscope"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	mailer "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type fakeMailer struct {
	mu   sync.Mutex
	sent []mailer.Message
	err  error
}

func (m *fakeMailer) Send(_ context.Context, msg mailer.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return m.err
}

func (m *fakeMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

func newPortalEnv(t *testing.T) (*env, *fakeMailer) {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	files := &fakeStorage{objects: map[string][]byte{}}
	svc := New(st, a, files, discard)
	m := &fakeMailer{}
	svc.SetMailer(m, portalscope.New("https://portal.example.com", st.Q))
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, srv: srv, files: files}, m
}

// portalClient makes a client with an email, the portal on and a live session; it returns the id and the token.
func (e *env) portalClient(b *browser) (clientID, token string) {
	e.t.Helper()
	c := e.create(b, address("Acme"))
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": "ana@acme.ch", "portal_enabled": true}, 200, nil)
	token = "tok_" + c.ID
	now := time.Now().UTC()
	if err := e.st.CreatePortalSession(context.Background(), "pss_"+c.ID, token, "csrf", "ana@acme.ch", c.ID, b.workspace, false, now, now.Add(time.Hour)); err != nil {
		e.t.Fatal(err)
	}
	return c.ID, token
}

func (e *env) sessionGone(token string) bool {
	e.t.Helper()
	_, err := e.st.PortalSessionByToken(context.Background(), token, time.Now().UTC())
	return errors.Is(err, store.ErrNotFound)
}

func (e *env) portalBackOn(b *browser, clientID string) {
	e.t.Helper()
	e.do(b, "PATCH", "/api/v1/clients/"+clientID, map[string]any{"portal_enabled": true, "email": "ana@acme.ch"}, 200, nil)
}

func TestContactsHaveNoPortalAccess(t *testing.T) {
	e, m := newPortalEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	e.do(b, "POST", "/api/v1/clients/"+c.ID+"/contacts", map[string]any{"name": "Ana", "email": "ana@acme.ch", "portal_access": true}, 400, nil)
	if m.count() != 0 {
		t.Fatal("a contact was invited")
	}
}

func TestClientPortalDisabledEndsSessions(t *testing.T) {
	e, _ := newPortalEnv(t)
	b := e.workspace()
	clientID, token := e.portalClient(b)
	if e.sessionGone(token) {
		t.Fatal("session should be live")
	}
	e.do(b, "PATCH", "/api/v1/clients/"+clientID, map[string]any{"portal_enabled": false}, 200, nil)
	e.portalBackOn(b, clientID)
	if !e.sessionGone(token) {
		t.Fatal("session survived the client switch off")
	}
}

func TestClientDeleteEndsSessions(t *testing.T) {
	e, _ := newPortalEnv(t)
	b := e.workspace()
	clientID, token := e.portalClient(b)
	e.do(b, "DELETE", "/api/v1/clients/"+clientID, nil, 204, nil)
	if !e.sessionGone(token) {
		t.Fatal("session survived client delete")
	}
}

func TestClientEmailChangeEndsSessions(t *testing.T) {
	e, _ := newPortalEnv(t)
	b := e.workspace()
	clientID, token := e.portalClient(b)
	path := "/api/v1/clients/" + clientID
	e.do(b, "PATCH", path, map[string]any{"email": "ANA@acme.ch", "billing_email": "books@acme.ch"}, 200, nil) // same login
	if e.sessionGone(token) {
		t.Fatal("session ended without a login change")
	}
	e.do(b, "PATCH", path, map[string]any{"email": "ana@other.ch"}, 200, nil)
	e.portalBackOn(b, clientID)
	if !e.sessionGone(token) {
		t.Fatal("session survived an address change")
	}
}

func TestInviteWhenTurnedOnOrMoved(t *testing.T) {
	e, m := newPortalEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	path := "/api/v1/clients/" + c.ID
	e.fails(b, "PATCH", path, map[string]any{"portal_enabled": true}, 409, "no_portal_address")
	if m.count() != 0 {
		t.Fatal("invited without an address")
	}
	var out struct{ Data store.Client }
	e.do(b, "PATCH", path, map[string]any{"billing_email": "Books@Acme.ch", "portal_enabled": true}, 200, &out) // the portal's first address
	e.do(b, "PATCH", path, map[string]any{"billing_email": "books@acme.ch", "note": "x"}, 200, nil)             // same login: no second mail
	if m.count() != 1 || m.sent[0].To[0] != "books@acme.ch" {
		t.Fatalf("mails = %+v", m.sent)
	}
	msg := m.sent[0]
	if !strings.Contains(msg.Text, "https://portal.example.com/w/acme/") || !strings.Contains(msg.Text, "Acme") {
		t.Fatalf("invite = %+v", msg)
	}
	e.do(b, "GET", path, nil, 200, &out)
	if out.Data.PortalInvitedAt == nil {
		t.Fatal("invite time not recorded")
	}

	// The email takes over as the login: it is invited; off and on again invites again; a failure is soft.
	e.do(b, "PATCH", path, map[string]any{"email": "ana@acme.ch"}, 200, nil)
	e.do(b, "PATCH", path, map[string]any{"portal_enabled": false}, 200, nil)
	m.err = errors.New("smtp down")
	e.do(b, "PATCH", path, map[string]any{"portal_enabled": true}, 200, nil)
	if m.count() != 3 || m.sent[1].To[0] != "ana@acme.ch" || m.sent[2].To[0] != "ana@acme.ch" {
		t.Fatalf("mails = %+v", m.sent)
	}
}

func TestNoMailerNoInvite(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	var out struct{ Data store.Client }
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": "ana@acme.ch", "portal_enabled": true}, 200, &out)
	if out.Data.PortalInvitedAt != nil {
		t.Fatal("invite recorded without a mailer")
	}
}

func TestResendPortalInvite(t *testing.T) {
	e, m := newPortalEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	path := "/api/v1/clients/" + c.ID + "/portal-invitation"
	e.do(b, "POST", path, nil, 409, nil) // the portal is off
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"portal_enabled": true, "email": "ana@acme.ch"}, 200, nil)
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": nil}, 200, nil) // the address removed later
	e.fails(b, "POST", path, nil, 409, "no_portal_address")
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": "ana@acme.ch"}, 200, nil)
	var out struct{ Data store.Client }
	e.do(b, "POST", path, nil, 200, &out)
	if m.count() != 3 || m.sent[2].To[0] != "ana@acme.ch" || out.Data.PortalInvitedAt == nil {
		t.Fatalf("mails = %+v, invited = %v", m.sent, out.Data.PortalInvitedAt)
	}
	if out.Data.PortalSignedInAt != nil {
		t.Fatal("signed in before any sign-in")
	}
	m.err = errors.New("smtp down")
	e.do(b, "POST", path, nil, 502, nil)
	e.do(b, "POST", "/api/v1/clients/cli_missing/portal-invitation", nil, 404, nil)
	other := e.workspace()
	e.do(other, "POST", path, nil, 404, nil) // another workspace's client
}

func TestResendWithoutMailer(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Acme"))
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": "ana@acme.ch", "portal_enabled": true}, 200, nil)
	e.do(b, "POST", "/api/v1/clients/"+c.ID+"/portal-invitation", nil, 503, nil)
}

// With the whole portal off, a client's switch still saves, but no invitation goes out and a resend is refused; on
// again, the resend works.
func TestNoInviteWhilePortalOff(t *testing.T) {
	e, m := newPortalEnv(t)
	b := e.workspace()
	if err := e.st.SetPortalOff(context.Background(), b.workspace, true); err != nil {
		t.Fatal(err)
	}
	c := e.create(b, address("Acme"))
	var out struct{ Data store.Client }
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": "ana@acme.ch", "portal_enabled": true}, 200, &out)
	if m.count() != 0 || !out.Data.PortalEnabled {
		t.Fatalf("mails = %+v, enabled = %v", m.sent, out.Data.PortalEnabled)
	}
	path := "/api/v1/clients/" + c.ID + "/portal-invitation"
	e.do(b, "POST", path, nil, 409, nil)
	if err := e.st.SetPortalOff(context.Background(), b.workspace, false); err != nil {
		t.Fatal(err)
	}
	e.do(b, "POST", path, nil, 200, nil)
	if m.count() != 1 {
		t.Fatalf("mails = %+v", m.sent)
	}
}

// Turning the portal on invites the client, so it needs an email or a billing email; one already on keeps working
// when its address is removed later (the resend says what is missing).
func TestPortalNeedsAnAddress(t *testing.T) {
	e, m := newPortalEnv(t)
	b := e.workspace()
	withAddress := func(name string, extra map[string]any) map[string]any {
		body := address(name)
		for k, v := range extra {
			body[k] = v
		}
		return body
	}
	for _, tc := range []struct {
		name   string
		body   map[string]any
		status int
	}{
		{"no address", map[string]any{"portal_enabled": true}, 409},
		{"blank email", map[string]any{"portal_enabled": true, "email": " "}, 409},
		{"email", map[string]any{"portal_enabled": true, "email": "ana@acme.ch"}, 201},
		{"billing email", map[string]any{"portal_enabled": true, "billing_email": "books@acme.ch"}, 201},
		{"portal off", map[string]any{"portal_enabled": false}, 201},
	} {
		t.Run("create "+tc.name, func(t *testing.T) {
			if tc.status == 409 {
				e.fails(b, "POST", "/api/v1/clients", withAddress(tc.name, tc.body), 409, "no_portal_address")
				return
			}
			e.create(b, withAddress(tc.name, tc.body))
		})
	}

	c := e.create(b, address("Later"))
	path := "/api/v1/clients/" + c.ID
	for _, tc := range []struct {
		name   string
		body   map[string]any
		status int
	}{
		{"turned on without an address", map[string]any{"portal_enabled": true}, 409},
		{"turned on with a billing email", map[string]any{"portal_enabled": true, "billing_email": "books@later.ch"}, 200},
		{"its address removed while on", map[string]any{"billing_email": nil}, 200},
		{"another change while on", map[string]any{"note": "x"}, 200},
	} {
		t.Run("update "+tc.name, func(t *testing.T) {
			if tc.status == 409 {
				e.fails(b, "PATCH", path, tc.body, 409, "no_portal_address")
				return
			}
			e.do(b, "PATCH", path, tc.body, tc.status, nil)
		})
	}
	if got := e.client(b, c.ID); !got.PortalEnabled || got.BillingEmail != nil {
		t.Fatalf("client = %+v", got)
	}
	if m.count() != 1 { // the turn-on with an address (a create sends no invitation)
		t.Fatalf("mails = %d", m.count())
	}
}
