package heidi

import (
	"context"
	"errors"
	"strings"
	"testing"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func TestAModelFailureIsAnsweredInPlainWordsByItsCause(t *testing.T) {
	failed := func(kind string) error {
		return errors.Join(aimodel.ErrProvider, &aimodel.ProviderError{Kind: kind})
	}
	for _, tc := range []struct {
		name, role string
		err        error
		code, text string
	}{
		{"temporary", "member", failed(aimodel.FailServer), "heidi_provider_unavailable", "Heidi couldn't answer right now. Nothing was changed. Try again in a moment."},
		{"rate limit", "member", failed(aimodel.FailRateLimited), "heidi_busy", "Heidi is busy right now. Try again in a minute."},
		{"overloaded", "owner", failed(aimodel.FailOverloaded), "heidi_busy", "Heidi is busy right now. Try again in a minute."},
		{"setup, owner", "owner", failed(aimodel.FailConfig), "heidi_ai_misconfigured", "AI is not configured correctly. Check the model settings."},
		{"setup, admin", "admin", failed(aimodel.FailConfig), "heidi_ai_misconfigured", "AI is not configured correctly. Check the model settings."},
		{"setup, member", "member", failed(aimodel.FailConfig), "heidi_provider_unavailable", "Heidi couldn't answer right now. Nothing was changed. Try again in a moment."},
		{"timeout", "owner", errors.Join(aimodel.ErrProvider, aimodel.ErrUnaccounted, &aimodel.ProviderError{Kind: aimodel.FailTimeout}), "heidi_provider_unavailable", "Heidi couldn't answer right now. Nothing was changed. Try again"},
		{"another call in flight", "owner", aimodel.ErrUncertain, "heidi_usage_uncertain", "Heidi is still finishing an earlier request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := answerOf(store.Session{Role: tc.role}, ProviderReply{}, 0, tc.err)
			status, code, message, ok := auth.Describe(err)
			if !ok || status != 503 || code != tc.code || !strings.HasPrefix(message, tc.text) {
				t.Fatalf("%d %s %q", status, code, message)
			}
			if strings.Contains(message, "OpenAI") || strings.Contains(message, "reconcil") {
				t.Fatalf("jargon: %q", message)
			}
		})
	}
}

func TestAnAnswerCutShortByItsOutputBudgetIsShownWithANote(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	p := &testProvider{input: 20, answer: func(_ context.Context, r ProviderRequest) (ProviderReply, error) {
		if r.MaxOutputTokens < 8000 {
			t.Errorf("output budget %d leaves a reasoning model no room for a long answer", r.MaxOutputTokens)
		}
		tokens := int64(4120)
		return ProviderReply{Text: "Refund 16 of 24 lessons:", Tokens: &tokens},
			&aimodel.ProviderError{Kind: aimodel.FailIncomplete, Reason: "max_output_tokens", Status: "incomplete"}
	}}
	s.provider = p
	grant(t, mux)
	w := chat(t, mux, "cut", "How do I refund 16 of 24 prepaid lessons on an invoice with 6 instalments?")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Refund 16 of 24 lessons:") || !strings.Contains(w.Body.String(), "This answer was cut short") ||
		!strings.Contains(w.Body.String(), `"type":"done"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	u, err := s.db.HeidiUsage(context.Background(), sess.Workspace.ID, aimodel.PoolHeidi, s.now().In(sess.Workspace.Location()).Format("2006-01"))
	if err != nil || u.Uncertain || u.TokensUsed != 4120 {
		t.Fatalf("usage=%+v err=%v, want the known usage settled", u, err)
	}
}
