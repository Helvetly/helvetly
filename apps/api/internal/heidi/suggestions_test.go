package heidi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/store"
)

type noEngagements struct{}

func (noEngagements) AssistantList(context.Context, store.Q, store.Session, string, bool) ([]engagements.EngagementView, error) {
	return nil, nil
}
func (noEngagements) AssistantLog(context.Context, store.Q, store.Session, string, string, string, string, *string) (store.EngagementEntry, error) {
	return store.EngagementEntry{}, nil
}

// Every suggestion is answered without a model: by a local command or by a guide section.
func TestSuggestionsAreAnswerable(t *testing.T) {
	s, _, sess, _ := fixture(t)
	s.engagements = noEngagements{}
	prompts := []string{}
	for _, topic := range topics {
		prompts = append(prompts, topic.Prompt)
	}
	for _, topic := range clientTopics {
		prompts = append(prompts, fmt.Sprintf(topic.Prompt, "Müller AG"))
	}
	for _, prompt := range prompts {
		var result turn
		err := s.db.Tx(context.Background(), func(q store.Q) error {
			var e error
			result, e = s.answer(context.Background(), q, *sess, "thread", prompt, false)
			return e
		})
		if err != nil {
			t.Fatalf("%q: %v", prompt, err)
		}
		if _, howTo := guideAnswer(prompt); result.Provider && !howTo {
			t.Errorf("%q needs a model", prompt)
		}
	}
}

func TestSuggestionsFollowThePage(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	if err := s.db.CreateClient(context.Background(), sess.Workspace.ID, "cli_mueller", map[string]any{"name": "Müller AG"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	prompts := func(query string) []string {
		t.Helper()
		w := call(mux, "GET", "/api/v1/heidi/suggestions?"+query, "", "")
		var body struct{ Data []suggestion }
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &body) != nil {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body)
		}
		out := []string{}
		for _, s := range body.Data {
			out = append(out, s.Prompt)
		}
		return out
	}
	tests := []struct{ query, first string }{
		{"page=dashboard", "Which invoices are overdue?"},
		{"page=books", "How do I close a month?"},
		{"page=quotes", "How do I make a quote and turn it into an invoice?"},
		{"page=scheduling", "How do I schedule a session with a client?"},
		{"page=billing", "How do I choose or change my plan?"},
		{"page=products", "How do I add products and services to my catalogue?"},
		{"page=documents", "Which documents were added recently?"},
		{"page=clients&client=cli_mueller", "Which invoices are overdue for Müller AG?"},
		{"page=clients&client=cli_missing", "Show recent clients"},
		{"page=invoices&client=cli_mueller", "Which invoices are overdue?"},
	}
	for _, tt := range tests {
		got := prompts(tt.query)
		if len(got) == 0 || got[0] != tt.first {
			t.Errorf("%s: %q, want %q first", tt.query, got, tt.first)
		}
		for _, p := range got {
			if strings.Contains(p, "Müller") && !strings.Contains(tt.query, "page=clients") {
				t.Errorf("%s: client topic %q off its page", tt.query, p)
			}
		}
	}
	// Billing shows only billing and general how-tos, never another page's records.
	for _, p := range prompts("page=billing") {
		if strings.Contains(p, "overdue") || strings.Contains(p, "expenses") {
			t.Errorf("billing: unrelated %q", p)
		}
	}
	// Without read:invoices, the client's invoice topics are left out.
	sess.Role, sess.Scopes = "member", []string{"read:clients"}
	for _, p := range prompts("page=clients&client=cli_mueller") {
		if strings.Contains(p, "invoices") && strings.Contains(p, "Müller") {
			t.Errorf("member without invoices: %q", p)
		}
	}
	if w := call(mux, "GET", "/api/v1/heidi/suggestions?page=nowhere", "", ""); w.Code != 400 {
		t.Errorf("unknown page: %d", w.Code)
	}
}
