package heidi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/ainotice"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func grant(t *testing.T, mux http.Handler) {
	t.Helper()
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":true,"version":"`+ainotice.Version+`"}`, "application/json"); w.Code != 200 {
		t.Fatalf("grant: %d %s", w.Code, w.Body)
	}
}

func usageOf(t *testing.T, mux http.Handler) (out struct {
	Mode              string `json:"mode"`
	ProviderAvailable bool   `json:"provider_available"`
	Consent           struct {
		Granted   bool    `json:"granted"`
		ChangedAt *string `json:"changed_at"`
		ChangedBy string  `json:"changed_by"`
	} `json:"consent"`
}) {
	t.Helper()
	w := call(mux, "GET", "/api/v1/heidi/usage", "", "")
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatalf("usage: %d %s", w.Code, w.Body)
	}
	return out
}

func TestNothingReachesOpenAIWithoutTheSendersOwnApproval(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	tokens := int64(5)
	p := &testProvider{input: 5, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		return ProviderReply{Text: "Explanation.", Tokens: &tokens}, nil
	}}
	s.provider = p
	s.allowance = func(context.Context, store.Q, string) (int64, error) { return 100, nil }
	ctx, now := context.Background(), time.Now()

	// An owner's approval written before approvals were per person counts only for that owner.
	other := store.User{ID: "usr_other", Email: "other@example.test", Name: "Other"}
	for _, err := range []error{s.db.CreateUser(ctx, other, now), s.db.AddMember(ctx, sess.Workspace.ID, other.ID, "owner", now),
		s.db.SetAIConsent(ctx, sess.Workspace.ID, other.ID, true, now)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if u := usageOf(t, mux); u.Mode != "local" || !u.ProviderAvailable || u.Consent.Granted || u.Consent.ChangedAt != nil {
		t.Fatalf("another member's approval counted: %+v", u)
	}
	w := chat(t, mux, "c1", "Explain this accounting term", "%PDF-1.7\nprivate")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "you have not approved AI use") {
		t.Fatalf("without approval: %d %s", w.Code, w.Body)
	}
	noProvider(t, p, "without own approval")
	if w := chat(t, mux, "c2", "Which invoices are overdue?"); w.Code != 200 {
		t.Fatalf("local command needs no approval: %d %s", w.Code, w.Body)
	}

	sess.Role = "member" // any role approves for itself, and only itself
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":true,"user_id":"usr_other"}`, "application/json"); w.Code != 400 {
		t.Fatalf("a target identity was accepted: %d %s", w.Code, w.Body)
	}
	grant(t, mux)
	if u := usageOf(t, mux); u.Mode != "openai" || !u.Consent.Granted || u.Consent.ChangedBy != "Heidi" || u.Consent.ChangedAt == nil {
		t.Fatalf("after own approval: %+v", u)
	}
	if w := chat(t, mux, "c3", "Explain this accounting term"); w.Code != 200 || p.calls.Load() != 1 {
		t.Fatalf("with approval: %d calls=%d %s", w.Code, p.calls.Load(), w.Body)
	}

	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":false}`, "application/json"); w.Code != 200 {
		t.Fatalf("withdraw: %d %s", w.Code, w.Body)
	}
	before := [3]int32{p.counted.Load(), p.classified.Load(), p.calls.Load()}
	if w := chat(t, mux, "c4", "Explain this accounting term"); w.Code != 200 ||
		[3]int32{p.counted.Load(), p.classified.Load(), p.calls.Load()} != before {
		t.Fatalf("after withdrawal: %d count/classify/answer %d/%d/%d", w.Code, p.counted.Load(), p.classified.Load(), p.calls.Load())
	}
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{}`, "application/json"); w.Code != 400 {
		t.Fatalf("missing granted: %d", w.Code)
	}
	if c, err := s.db.AIConsent(ctx, sess.Workspace.ID, sess.User.ID); err != nil || c.Granted || c.ChangedAt == nil {
		t.Fatalf("own row after withdrawal: %+v %v", c, err)
	}
	if c, err := s.db.AIConsent(ctx, sess.Workspace.ID, other.ID); err != nil || !c.Granted || c.ChangedBy != "Other" {
		t.Fatalf("the other member's own approval changed: %+v %v", c, err)
	}
}

// Withdrawing consent while a turn is being classified stops the main call, which is the one that carries attachments.
func TestConsentWithdrawnDuringATurnStopsTheMainCall(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	p := &testProvider{input: 10, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		t.Error("the main call reached the provider after consent was withdrawn")
		return ProviderReply{}, nil
	}}
	p.scope = func(ProviderRequest) (ProviderReply, error) {
		if err := s.db.SetAIConsent(context.Background(), sess.Workspace.ID, sess.User.ID, false, time.Now()); err != nil {
			t.Error(err)
		}
		zero := int64(0)
		return ProviderReply{Text: `{"in_scope":true,"reason":"test"}`, Tokens: &zero}, nil
	}
	s.provider = p
	grant(t, mux)
	w := chat(t, mux, "withdrawn", "Explain what this receipt says", "%PDF-1.7 private receipt")
	// The classifier's own count and answer ran before the withdrawal; the main call is neither counted nor sent.
	if p.counted.Load() != 1 || p.classified.Load() != 1 || p.calls.Load() != 0 || !strings.Contains(w.Body.String(), "approved AI use") {
		t.Fatalf("classified=%d calls=%d: %d %s", p.classified.Load(), p.calls.Load(), w.Code, w.Body)
	}
}

// noProvider: nothing reached the provider, counting included.
func noProvider(t *testing.T, p *testProvider, when string) {
	t.Helper()
	if c, k, a := p.counted.Load(), p.classified.Load(), p.calls.Load(); c != 0 || k != 0 || a != 0 {
		t.Fatalf("%s: count=%d classify=%d answer=%d", when, c, k, a)
	}
}

// The same person's approval in one workspace does not carry to another.
func TestApprovalDoesNotCarryToAnotherWorkspace(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	p := &testProvider{input: 5, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		t.Error("the answer reached the provider")
		return ProviderReply{}, nil
	}}
	s.provider = p
	ctx, now := context.Background(), time.Now()
	other := store.Workspace{ID: "ws_other", Name: "Other", Timezone: "Europe/Zurich"}
	for _, err := range []error{s.db.CreateWorkspace(ctx, other, other.Timezone, now), s.db.AddMember(ctx, other.ID, sess.User.ID, "owner", now),
		s.db.SetAIConsent(ctx, other.ID, sess.User.ID, true, now)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if w := chat(t, mux, "x1", "Explain this accounting term"); w.Code != 200 || !strings.Contains(w.Body.String(), "approved AI use") {
		t.Fatalf("approval from another workspace counted: %d %s", w.Code, w.Body)
	}
	noProvider(t, p, "approved only in another workspace")
}

// The notice comes from the API in the person's language, and an approval names the version shown: an old tab (an
// earlier version, or none) is refused and writes nothing; a withdrawal is taken whatever version it names.
func TestApprovalNamesTheNoticeInForce(t *testing.T) {
	s, mux, sess, _, raw := fixtureRaw(t)
	ctx := context.Background()
	type consentOut struct {
		Data   store.AIConsent `json:"data"`
		Notice ainotice.Notice `json:"notice"`
	}
	get := func(lang string) (out consentOut) {
		t.Helper()
		w := call(mux, "GET", "/api/v1/heidi/consent?lang="+lang, "", "")
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
			t.Fatalf("GET %s: %d %s", lang, w.Code, w.Body)
		}
		return out
	}
	rows := func() (n int) {
		t.Helper()
		if err := raw.QueryRow(ctx, `SELECT count(*) FROM workspace_ai_consents WHERE workspace_id = $1`, sess.Workspace.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	for _, lang := range []string{"de", "xx", ""} {
		got, want := get(lang), ainotice.For(lang)
		if got.Notice.Version != ainotice.Version || got.Notice.Title != want.Title || len(got.Notice.Sections) != len(want.Sections) ||
			got.Data.Granted || got.Data.CurrentVersion != ainotice.Version || got.Data.ChangedAt != nil {
			t.Fatalf("GET %q: %+v", lang, got)
		}
	}

	for _, c := range []struct{ name, body string }{
		{"no version (a platform from before versions)", `{"granted":true}`},
		{"an earlier version", `{"granted":true,"version":"2000-01-01"}`},
		{"an empty version", `{"granted":true,"version":""}`},
	} {
		w := call(mux, "PUT", "/api/v1/heidi/consent", c.body, "application/json")
		if w.Code != 409 || !strings.Contains(w.Body.String(), `"ai_consent_version_changed"`) || rows() != 0 {
			t.Fatalf("%s: %d %s, %d rows", c.name, w.Code, w.Body, rows())
		}
	}
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":true,"version":"`+ainotice.Version+`","workspace_id":"ws_other"}`, "application/json"); w.Code != 400 || rows() != 0 {
		t.Fatalf("a target workspace was accepted: %d %s", w.Code, w.Body)
	}

	grant(t, mux)
	if got := get("en").Data; !got.Granted || got.Version != ainotice.Version {
		t.Fatalf("after approval: %+v", got)
	}
	grant(t, mux) // the same choice again adds no row
	if rows() != 1 {
		t.Fatalf("%d rows after approving twice", rows())
	}

	storetest.OutdateAIConsent(t, raw, sess.Workspace.ID, sess.User.ID) // a new notice is deployed
	if got := get("en").Data; got.Granted || got.Version != "2000-01-01" || got.ChangedAt == nil {
		t.Fatalf("an approval of an earlier notice counted: %+v", got)
	}
	if err := auth.RequireAIConsent(ctx, s.db.Q, sess.Workspace.ID, sess.User.ID); err == nil {
		t.Fatal("RequireAIConsent let an approval of an earlier notice through")
	}
	// A withdrawal from a card still showing the earlier notice is recorded under the notice in force.
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":false,"version":"2000-01-01"}`, "application/json"); w.Code != 200 || rows() != 2 {
		t.Fatalf("stale withdrawal: %d %s, %d rows", w.Code, w.Body, rows())
	}
	if got := get("en").Data; got.Granted || got.Version != ainotice.Version {
		t.Fatalf("after withdrawal: %+v", got)
	}
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":false}`, "application/json"); w.Code != 200 || rows() != 2 {
		t.Fatalf("withdrawal without a version: %d %s, %d rows", w.Code, w.Body, rows())
	}
}

// Only the person's own approval of the notice in force lets a Heidi turn reach the model; in every other state
// nothing is counted, classified or sent.
func TestHeidiNeedsTheOwnApprovalOfTheNoticeInForce(t *testing.T) {
	for _, c := range []struct {
		name    string
		set     func(t *testing.T, s *Service, mux http.Handler, sess *store.Session, raw *pgxpool.Pool)
		allowed bool
	}{
		{"no approval", func(*testing.T, *Service, http.Handler, *store.Session, *pgxpool.Pool) {}, false},
		{"an earlier notice", func(t *testing.T, _ *Service, mux http.Handler, sess *store.Session, raw *pgxpool.Pool) {
			grant(t, mux)
			storetest.OutdateAIConsent(t, raw, sess.Workspace.ID, sess.User.ID)
		}, false},
		{"withdrawn after approval", func(t *testing.T, _ *Service, mux http.Handler, _ *store.Session, _ *pgxpool.Pool) {
			grant(t, mux)
			if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":false}`, "application/json"); w.Code != 200 {
				t.Fatal(w.Body)
			}
		}, false},
		{"another member approved", func(t *testing.T, s *Service, _ http.Handler, sess *store.Session, _ *pgxpool.Pool) {
			ctx, now := context.Background(), time.Now()
			for _, err := range []error{s.db.CreateUser(ctx, store.User{ID: "usr_o", Email: "o@example.test"}, now),
				s.db.AddMember(ctx, sess.Workspace.ID, "usr_o", "owner", now), s.db.SetAIConsent(ctx, sess.Workspace.ID, "usr_o", true, now)} {
				if err != nil {
					t.Fatal(err)
				}
			}
		}, false},
		{"the current notice", func(t *testing.T, _ *Service, mux http.Handler, _ *store.Session, _ *pgxpool.Pool) { grant(t, mux) }, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			s, mux, sess, _, raw := fixtureRaw(t)
			tokens := int64(5)
			p := &testProvider{input: 5, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
				return ProviderReply{Text: "Explanation.", Tokens: &tokens}, nil
			}}
			s.provider = p
			c.set(t, s, mux, sess, raw)
			w := chat(t, mux, "v1", "Explain this accounting term", "%PDF-1.7 private")
			if u := usageOf(t, mux); u.Consent.Granted != c.allowed || (u.Mode == "openai") != c.allowed {
				t.Fatalf("usage: %+v", u)
			}
			if c.allowed {
				if w.Code != 200 || p.calls.Load() != 1 {
					t.Fatalf("approved: %d calls=%d %s", w.Code, p.calls.Load(), w.Body)
				}
				return
			}
			if w.Code != 200 || !strings.Contains(w.Body.String(), "you have not approved AI use") {
				t.Fatalf("refused: %d %s", w.Code, w.Body)
			}
			noProvider(t, p, c.name)
		})
	}
}

// A new notice deployed while a turn is classified stops the main call before it is counted, like a withdrawal.
func TestNoticeChangedDuringATurnStopsTheMainCall(t *testing.T) {
	s, mux, sess, _, raw := fixtureRaw(t)
	p := &testProvider{input: 10, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		t.Error("the main call reached the provider after the notice changed")
		return ProviderReply{}, nil
	}}
	p.scope = func(ProviderRequest) (ProviderReply, error) {
		storetest.OutdateAIConsent(t, raw, sess.Workspace.ID, sess.User.ID)
		zero := int64(0)
		return ProviderReply{Text: `{"in_scope":true,"reason":"test"}`, Tokens: &zero}, nil
	}
	s.provider = p
	grant(t, mux)
	w := chat(t, mux, "changed", "Explain what this receipt says", "%PDF-1.7 private receipt")
	if p.counted.Load() != 1 || p.classified.Load() != 1 || p.calls.Load() != 0 || !strings.Contains(w.Body.String(), "approved AI use") {
		t.Fatalf("counted=%d classified=%d calls=%d: %d %s", p.counted.Load(), p.classified.Load(), p.calls.Load(), w.Code, w.Body)
	}
}
