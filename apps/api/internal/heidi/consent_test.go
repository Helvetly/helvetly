package heidi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func grant(t *testing.T, mux http.Handler) {
	t.Helper()
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":true}`, "application/json"); w.Code != 200 {
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
