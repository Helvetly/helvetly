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

func TestNothingReachesOpenAIWithoutConsent(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	tokens := int64(5)
	p := &testProvider{input: 5, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		return ProviderReply{Text: "Explanation.", Tokens: &tokens}, nil
	}}
	s.provider = p
	s.allowance = func(context.Context, store.Q, string) (int64, error) { return 100, nil }

	if u := usageOf(t, mux); u.Mode != "local" || !u.ProviderAvailable || u.Consent.Granted || u.Consent.ChangedAt != nil {
		t.Fatalf("a new workspace starts without consent: %+v", u)
	}
	w := chat(t, mux, "c1", "Explain this accounting term", "%PDF-1.7\nprivate")
	if w.Code != 200 || p.calls.Load() != 0 || !strings.Contains(w.Body.String(), "not allowed Heidi to use OpenAI") {
		t.Fatalf("without consent: %d calls=%d %s", w.Code, p.calls.Load(), w.Body)
	}
	if w := chat(t, mux, "c2", "Which invoices are overdue?"); w.Code != 200 {
		t.Fatalf("local command needs no consent: %d %s", w.Code, w.Body)
	}

	sess.Role = "member"
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":true}`, "application/json"); w.Code != 403 {
		t.Fatalf("a member granted consent: %d", w.Code)
	}
	sess.Role = "admin"
	grant(t, mux)
	if u := usageOf(t, mux); u.Mode != "openai" || !u.Consent.Granted || u.Consent.ChangedBy != "Heidi" || u.Consent.ChangedAt == nil {
		t.Fatalf("after grant: %+v", u)
	}
	if w := chat(t, mux, "c3", "Explain this accounting term"); w.Code != 200 || p.calls.Load() != 1 {
		t.Fatalf("with consent: %d calls=%d %s", w.Code, p.calls.Load(), w.Body)
	}

	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{"granted":false}`, "application/json"); w.Code != 200 {
		t.Fatalf("revoke: %d %s", w.Code, w.Body)
	}
	if w := chat(t, mux, "c4", "Explain this accounting term"); w.Code != 200 || p.calls.Load() != 1 {
		t.Fatalf("after revoke: %d calls=%d", w.Code, p.calls.Load())
	}
	if w := call(mux, "PUT", "/api/v1/heidi/consent", `{}`, "application/json"); w.Code != 400 {
		t.Fatalf("missing granted: %d", w.Code)
	}
	if c, err := s.db.AIConsent(context.Background(), sess.Workspace.ID); err != nil || c.Granted || c.ChangedAt == nil {
		t.Fatalf("after revoke: %+v %v", c, err)
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
	if p.classified.Load() != 1 || p.calls.Load() != 0 || !strings.Contains(w.Body.String(), "has not allowed Heidi to use OpenAI") {
		t.Fatalf("classified=%d calls=%d: %d %s", p.classified.Load(), p.calls.Load(), w.Code, w.Body)
	}
}
