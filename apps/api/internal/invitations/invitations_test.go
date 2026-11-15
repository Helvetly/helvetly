package invitations

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
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	hmail "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type fakeMailer struct {
	mu   sync.Mutex
	sent []hmail.Message
	err  error
}

func (m *fakeMailer) Send(_ context.Context, msg hmail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return m.err
}

type env struct {
	t     *testing.T
	st    *store.Store
	srv   *httptest.Server
	mail  *fakeMailer
	seats *seatSyncs
}

// seatSyncs records the workspaces billing was asked to bill for their members.
type seatSyncs struct {
	mu  sync.Mutex
	got []string
}

func (s *seatSyncs) SyncSeats(_ context.Context, workspaceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.got = append(s.got, workspaceID)
}

// newEnv passes a nil Mailer when withMail is false.
func newEnv(t *testing.T, withMail bool) *env {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, st: st, mail: &fakeMailer{}, seats: &seatSyncs{}}
	var m Mailer
	if withMail {
		m = e.mail
	}
	mux := http.NewServeMux()
	a.Register(mux)
	svc := New(st, a, m, "https://helvetly.example.com", discard)
	svc.SetSeats(e.seats)
	svc.Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct{ token, csrf, workspace, email string }

func (e *env) newWorkspace() string {
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return ws
}

// join makes a user (with the email, or a random one) a member of ws and signs them in there.
func (e *env) join(ws, role, email string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	if email == "" {
		email = strings.ToLower(rand.Text()) + "@example.com"
	}
	u := store.User{ID: auth.NewID("usr"), Email: email, Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, email: email}
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

// outsider is a signed-in user with the email whose own workspace is not the invited one.
func (e *env) outsider(email string) *browser { return e.join(e.newWorkspace(), "owner", email) }

func (e *env) do(b *browser, method, path string, body any) (int, []byte, []*http.Cookie) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw, resp.Cookies()
}

func (e *env) want(b *browser, method, path string, body any, status int, code string) []byte {
	e.t.Helper()
	got, raw, _ := e.do(b, method, path, body)
	if got != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, got, status, raw)
	}
	if code != "" && !strings.Contains(string(raw), `"code":"`+code+`"`) {
		e.t.Fatalf("%s %s: want code %q: %s", method, path, code, raw)
	}
	return raw
}

type invited struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	URL       string `json:"url"`
	EmailSent bool   `json:"email_sent"`
}

func (e *env) invite(b *browser, email, role string) invited {
	e.t.Helper()
	var out struct{ Data invited }
	raw := e.want(b, "POST", "/api/v1/members/invitations", map[string]any{"email": email, "role": role}, 201, "")
	if err := json.Unmarshal(raw, &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func tokenOf(t *testing.T, link string) string {
	t.Helper()
	u, err := url.Parse(link)
	if err != nil || u.Query().Get("token") == "" {
		t.Fatalf("bad url %q", link)
	}
	return u.Query().Get("token")
}

func (e *env) accept(b *browser, link string, status int, code string) []byte {
	e.t.Helper()
	return e.want(b, "POST", "/api/v1/invitations/accept", map[string]any{"token": tokenOf(e.t, link)}, status, code)
}

func TestInviteExistingMember409(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	m := e.join(owner.workspace, "member", "")
	e.want(owner, "POST", "/api/v1/members/invitations", map[string]any{"email": m.email, "role": "member"}, 409, "already_member")
}

func TestAdminCannotInviteOwner(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	admin := e.join(owner.workspace, "admin", "")
	e.want(admin, "POST", "/api/v1/members/invitations", map[string]any{"email": "x@example.com", "role": "owner"}, 403, "forbidden")
	e.want(owner, "POST", "/api/v1/members/invitations", map[string]any{"email": "x@example.com", "role": "owner"}, 201, "")
}

func TestMemberCannotInvite(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	m := e.join(owner.workspace, "member", "")
	e.want(m, "POST", "/api/v1/members/invitations", map[string]any{"email": "x@example.com", "role": "member"}, 403, "forbidden")
	e.want(m, "GET", "/api/v1/members/invitations", nil, 200, "")
}

func TestReinviteReplacesOldLink(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	first := e.invite(owner, "guest@example.com", "member")
	second := e.invite(owner, "guest@example.com", "member")
	e.accept(guest, first.URL, 404, "invitation_invalid")
	e.accept(guest, second.URL, 200, "")
	var list struct{ Data []invited }
	_ = json.Unmarshal(e.want(owner, "GET", "/api/v1/members/invitations", nil, 200, ""), &list)
	if len(list.Data) != 0 {
		t.Fatalf("open invitations %v, want none", list.Data)
	}
}

func TestAcceptWrongEmail(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	other := e.outsider("")
	inv := e.invite(owner, "guest@example.com", "member")
	raw := e.accept(other, inv.URL, 403, "invitation_email_mismatch")
	if !strings.Contains(string(raw), `"email":"guest@example.com"`) {
		t.Fatalf("want details.email: %s", raw)
	}
}

func TestAcceptExpired(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	// The token must still match, so expire by re-tokening to a known token.
	token := "known-token"
	sum := sha256.Sum256([]byte(token))
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		return q.RetokenInvitation(context.Background(), owner.workspace, inv.ID, hex.EncodeToString(sum[:]), time.Now().Add(-time.Hour), time.Now())
	})
	if err != nil {
		t.Fatal(err)
	}
	e.accept(guest, "https://h/invite?token="+token, 410, "invitation_expired")
}

func TestAcceptRevoked(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	e.want(owner, "DELETE", "/api/v1/members/invitations/"+inv.ID, nil, 204, "")
	e.accept(guest, inv.URL, 404, "invitation_invalid")
}

func TestAcceptTwiceSamePerson(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	_, raw, cookies := e.do(guest, "POST", "/api/v1/invitations/accept", map[string]any{"token": tokenOf(t, inv.URL)})
	var tok struct {
		CSRF string `json:"csrf_token"`
	}
	_ = json.Unmarshal(raw, &tok)
	for _, c := range cookies {
		if c.Name == "helvetly_session" { // accepting swaps the session, so the second try uses the new one
			guest = &browser{token: c.Value, csrf: tok.CSRF, workspace: owner.workspace, email: guest.email}
		}
	}
	e.accept(guest, inv.URL, 200, "")
}

func TestAcceptByOtherAfterUse(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	other := e.outsider("")
	inv := e.invite(owner, "guest@example.com", "member")
	e.accept(guest, inv.URL, 200, "")
	e.accept(other, inv.URL, 404, "invitation_invalid")
}

func TestAcceptRaisesRole(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	// Already a member by the time the (older) invitation is accepted.
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "admin")
	var id string
	if err := e.st.Tx(context.Background(), func(q store.Q) error {
		u, err := q.UserByEmail(context.Background(), "guest@example.com")
		id = u.ID
		if err != nil {
			return err
		}
		return q.JoinMember(context.Background(), owner.workspace, u.ID, "member", []string{"*:*"}, time.Now())
	}); err != nil {
		t.Fatal(err)
	}
	e.accept(guest, inv.URL, 200, "")
	var role string
	_ = e.st.Tx(context.Background(), func(q store.Q) (err error) {
		role, err = q.MemberRole(context.Background(), owner.workspace, id)
		return err
	})
	if role != "admin" {
		t.Fatalf("role %q, want admin", role)
	}
}

func TestAcceptSwitchesSession(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	status, raw, cookies := e.do(guest, "POST", "/api/v1/invitations/accept", map[string]any{"token": tokenOf(t, inv.URL)})
	if status != 200 || !strings.Contains(string(raw), "csrf_token") {
		t.Fatalf("accept: %d %s", status, raw)
	}
	var fresh *browser
	for _, c := range cookies {
		if c.Name == "helvetly_session" {
			fresh = &browser{token: c.Value, csrf: "x"}
		}
	}
	if fresh == nil {
		t.Fatal("no session cookie")
	}
	_, body, _ := e.do(fresh, "GET", "/api/v1/session", nil)
	if !strings.Contains(string(body), owner.workspace) {
		t.Fatalf("session not in invited workspace: %s", body)
	}
}

func TestInviteRateLimit(t *testing.T) {
	e := newEnv(t, false)
	owner := e.join(e.newWorkspace(), "owner", "")
	for i := range 30 {
		e.invite(owner, fmt.Sprintf("p%d@example.com", i), "member")
	}
	e.want(owner, "POST", "/api/v1/members/invitations", map[string]any{"email": "p31@example.com", "role": "member"}, 429, "rate_limited")
}

func TestInviteWithoutMailer(t *testing.T) {
	e := newEnv(t, false)
	owner := e.join(e.newWorkspace(), "owner", "")
	inv := e.invite(owner, "guest@example.com", "member")
	if inv.EmailSent || !strings.HasPrefix(inv.URL, "https://helvetly.example.com/invite?token=") {
		t.Fatalf("got %+v", inv)
	}
}

func TestInviteMailsInvitee(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	inv := e.invite(owner, "guest@example.com", "member")
	if !inv.EmailSent || len(e.mail.sent) != 1 || e.mail.sent[0].To[0] != "guest@example.com" ||
		!strings.Contains(e.mail.sent[0].Text, inv.URL) {
		t.Fatalf("got %+v, sent %+v", inv, e.mail.sent)
	}
}

func TestInviteByLinkSendsNoMail(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	var out struct{ Data invited }
	raw := e.want(owner, "POST", "/api/v1/members/invitations",
		map[string]any{"email": "guest@example.com", "role": "member", "send_email": false}, 201, "")
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out.Data.EmailSent || out.Data.URL == "" || len(e.mail.sent) != 0 {
		t.Fatalf("got %+v, sent %+v", out.Data, e.mail.sent)
	}
}

func TestInviteMailFailure(t *testing.T) {
	e := newEnv(t, true)
	e.mail.err = errors.New("smtp down")
	owner := e.join(e.newWorkspace(), "owner", "")
	if inv := e.invite(owner, "guest@example.com", "member"); inv.EmailSent || inv.URL == "" {
		t.Fatalf("got %+v", inv)
	}
}

func TestInviteEmailNormalised(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	if inv := e.invite(owner, " B@X.ch ", "member"); inv.Email != "b@x.ch" {
		t.Fatalf("email %q", inv.Email)
	}
	e.want(owner, "POST", "/api/v1/members/invitations", map[string]any{"email": "nope", "role": "member"}, 400, "invalid_request")
	e.want(owner, "POST", "/api/v1/members/invitations", map[string]any{"email": "Bob <b@x.ch>", "role": "member"}, 400, "invalid_request")
}

func TestResend(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	e.ageInvitation(t, owner.workspace, inv.ID)
	var out struct{ Data invited }
	raw := e.want(owner, "POST", "/api/v1/members/invitations/"+inv.ID+"/resend", nil, 200, "")
	_ = json.Unmarshal(raw, &out)
	if out.Data.URL == inv.URL || len(e.mail.sent) != 2 {
		t.Fatalf("resend %+v, sent %d", out.Data, len(e.mail.sent))
	}
	e.accept(guest, inv.URL, 404, "invitation_invalid")
	e.accept(guest, out.Data.URL, 200, "")
}

func TestPreviewUnknownToken(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	e.want(owner, "GET", "/api/v1/invitations/preview?token=nope", nil, 404, "")
}

func TestPreview(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	inv := e.invite(owner, "guest@example.com", "admin")
	raw := e.want(owner, "GET", "/api/v1/invitations/preview?token="+tokenOf(t, inv.URL), nil, 200, "")
	for _, want := range []string{`"workspace_name":"Acme"`, `"status":"open"`, `"role":"admin"`, `"invited_by":"Anna owner"`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("want %s in %s", want, raw)
		}
	}
}

// ageInvitation backdates the sent time (and invalidates the link) so a resend is past the cooldown.
func (e *env) ageInvitation(t *testing.T, ws, id string) {
	t.Helper()
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		return q.RetokenInvitation(context.Background(), ws, id, "aged", time.Now().Add(time.Hour), time.Now().Add(-2*time.Minute))
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestResendCooldown(t *testing.T) {
	e := newEnv(t, false)
	owner := e.join(e.newWorkspace(), "owner", "")
	inv := e.invite(owner, "guest@example.com", "member")
	path := "/api/v1/members/invitations/" + inv.ID + "/resend"
	e.want(owner, "POST", path, nil, 429, "rate_limited")
	e.ageInvitation(t, owner.workspace, inv.ID)
	e.want(owner, "POST", path, nil, 200, "")
	e.want(owner, "POST", path, nil, 429, "rate_limited")
}

func TestResendCountsTowardLimit(t *testing.T) {
	e := newEnv(t, false)
	owner := e.join(e.newWorkspace(), "owner", "")
	inv := e.invite(owner, "old@example.com", "member")
	// An invitation sent long ago leaves the window; its resend brings it back in.
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		return q.RetokenInvitation(context.Background(), owner.workspace, inv.ID, "aged", time.Now().Add(time.Hour), time.Now().Add(-2*time.Hour))
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 29 {
		e.invite(owner, fmt.Sprintf("p%d@example.com", i), "member")
	}
	n, err := e.st.CountInvitationsSince(context.Background(), owner.workspace, time.Now().Add(-time.Hour))
	if err != nil || n != 29 {
		t.Fatalf("before resend: %d %v", n, err)
	}
	e.want(owner, "POST", "/api/v1/members/invitations/"+inv.ID+"/resend", nil, 200, "")
	if n, _ := e.st.CountInvitationsSince(context.Background(), owner.workspace, time.Now().Add(-time.Hour)); n != 30 {
		t.Fatalf("after resend: %d, want 30", n)
	}
	e.want(owner, "POST", "/api/v1/members/invitations/"+inv.ID+"/resend", nil, 429, "rate_limited")
}

func TestAcceptCopiesScopes(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	invite := func(body map[string]any, status int, code string) []byte {
		return e.want(owner, "POST", "/api/v1/members/invitations", body, status, code)
	}
	invite(map[string]any{"email": "a@example.com", "role": "admin", "scopes": []string{"read:*"}}, 400, "invalid_request")
	invite(map[string]any{"email": "a@example.com", "role": "member", "scopes": []string{"read:*", "read:*"}}, 422, "validation_failed")
	if raw := invite(map[string]any{"email": "full@example.com", "role": "member"}, 201, ""); !strings.Contains(string(raw), `"scopes":["*:*"]`) {
		t.Fatalf("default scopes: %s", raw)
	}
	var out struct{ Data invited }
	raw := invite(map[string]any{"email": "guest@example.com", "role": "member", "scopes": []string{"read:*", "write:expenses"}}, 201, "")
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	guest := e.outsider("guest@example.com")
	_, _, cookies := e.do(guest, "POST", "/api/v1/invitations/accept", map[string]any{"token": tokenOf(t, out.Data.URL)})
	for _, c := range cookies {
		if c.Name == "helvetly_session" {
			guest = &browser{token: c.Value, csrf: "x"}
		}
	}
	if _, body, _ := e.do(guest, "GET", "/api/v1/session", nil); !strings.Contains(string(body), `"scopes":["read:*","write:expenses"]`) {
		t.Fatalf("session scopes: %s", body)
	}
}

func TestAcceptNotifiesManagers(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("joiner@example.com")
	inv := e.invite(owner, "joiner@example.com", "member")
	if status, raw, _ := e.do(guest, "POST", "/api/v1/invitations/accept", map[string]any{"token": tokenOf(t, inv.URL)}); status != 200 {
		t.Fatalf("accept: %d %s", status, raw)
	}
	ctx := context.Background()
	members, err := e.st.ListMembers(ctx, owner.workspace)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range members {
		got, err := e.st.Notifications(ctx, owner.workspace, m.UserID, store.NotificationFilter{Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		want := map[string]int{"owner": 1}[m.Role] // the joiner is not told about joining
		if len(got) != want || want == 1 && (got[0].Event != "member.joined" || !strings.Contains(string(got[0].Data), "joiner@example.com")) {
			t.Fatalf("%s: %+v", m.Role, got)
		}
	}
}

func TestAcceptWithoutAFreeSeat(t *testing.T) {
	e := newEnv(t, false)
	ws := e.newWorkspace()
	owner := e.join(ws, "owner", "owner@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	guest := e.outsider("guest@example.com")
	// the plan's seats are full by the time the invitation is accepted
	e.st.SetAdmission(func(context.Context, store.Q, string, string, int64) error { return store.ErrAdmissionDenied })
	e.accept(guest, inv.URL, http.StatusConflict, "workspace_full")
	e.st.SetAdmission(nil)
	e.accept(guest, inv.URL, http.StatusOK, "") // refused, not spent: it works once a seat is free
}

func TestInviteNotifiesTheOtherManagers(t *testing.T) {
	e := newEnv(t, true)
	ws := e.newWorkspace()
	owner, admin, member := e.join(ws, "owner", ""), e.join(ws, "admin", "admin@example.com"), e.join(ws, "member", "")
	e.invite(owner, "new@example.com", "member")
	ctx := context.Background()
	for _, c := range []struct {
		email string
		want  int
	}{{owner.email, 0}, {admin.email, 1}, {member.email, 0}} {
		u, err := e.st.UserByEmail(ctx, c.email)
		if err != nil {
			t.Fatal(err)
		}
		got, err := e.st.Notifications(ctx, ws, u.ID, store.NotificationFilter{Limit: 10})
		if err != nil || len(got) != c.want || c.want == 1 && (got[0].Event != "member.invited" ||
			!strings.Contains(string(got[0].Data), "new@example.com")) {
			t.Fatalf("%s: %+v %v", c.email, got, err)
		}
	}
}

// An accepted invitation takes a seat, so billing is asked to bill it; a refused one is not.
func TestAcceptSyncsSeats(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	guest := e.outsider("guest@example.com")
	inv := e.invite(owner, "guest@example.com", "member")
	e.accept(e.outsider("other@example.com"), inv.URL, 403, "invitation_email_mismatch")
	if len(e.seats.got) != 0 {
		t.Fatalf("a refused acceptance synced seats: %v", e.seats.got)
	}
	e.accept(guest, inv.URL, 200, "")
	if len(e.seats.got) != 1 || e.seats.got[0] != owner.workspace {
		t.Fatalf("seat syncs %v, want one for %s", e.seats.got, owner.workspace)
	}
}

// Only an owner invites someone with access to employees or payroll.
func TestOnlyOwnersInviteWithHRScopes(t *testing.T) {
	e := newEnv(t, false)
	ws := e.newWorkspace()
	owner, admin := e.join(ws, "owner", "o@example.com"), e.join(ws, "admin", "a@example.com")
	body := map[string]any{"email": "hr@example.com", "role": "member", "scopes": []string{"read:*", "read:employees"}}
	e.want(admin, "POST", "/api/v1/members/invitations", body, 403, "forbidden")
	e.want(owner, "POST", "/api/v1/members/invitations", body, 201, "")
}
