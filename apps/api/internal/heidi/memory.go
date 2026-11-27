package heidi

import (
	"cmp"
	"context"
	"net/http"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Local answers have no API operation to copy. The same topics cover equivalent planner operations.
var localTopics = map[string]suggestion{
	"latest_issued_invoice":   {"Latest issued invoice", "What was the latest issued invoice?", "invoices", "read:invoices"},
	"overdue_invoices":        {"Overdue invoices", "Which invoices are overdue?", "invoices", "read:invoices"},
	"list_invoices":           {"Recent invoices", "Show recent invoices", "invoices", "read:invoices"},
	"list_clients":            {"Recent clients", "Show recent clients", "clients", "read:clients"},
	"list_documents":          {"Recent documents", "Which documents were added recently?", "documents", "read:documents"},
	"get_expense_summary":     {"This month’s expenses", "Summarize this month’s expenses", "expenses", "read:expenses"},
	"list_engagements":        {"Hours left", "How many hours are left?", "engagements", "read:engagements"},
	"get_engagements_summary": {"To invoice", "What needs invoicing?", "engagements", "read:engagements"},
	"list_sessions":           {"Today's schedule", "What is on my schedule today?", "scheduling", "read:scheduling"},
}

func memoryTopic(sess store.Session, id string) (suggestion, bool) {
	if t, ok := localTopics[id]; ok {
		return t, permissions.Allows(sess.Role, sess.Scopes, t.Scope)
	}
	op, ok := workspaceOps[id]
	if !ok || !canOperate(sess, op) {
		return suggestion{}, false
	}
	prompt := op.Summary
	if op.Write {
		prompt = "How do I " + strings.ToLower(op.Summary) + "?"
	}
	return suggestion{Title: op.Summary, Prompt: prompt, Page: op.Resource}, true
}

// Only a completed, known operation increments memory; its arguments, files and conversation never enter it.
func (s *Service) learn(ctx context.Context, q store.Q, sess store.Session, id string) error {
	if _, ok := memoryTopic(sess, id); !ok {
		return nil
	}
	return q.CountHeidiTopic(ctx, sess.Workspace.ID, sess.User.ID, id)
}

type learnedTopic struct {
	suggestion
	Count int `json:"count"`
}

func learnedTopics(m store.HeidiMemory, sess store.Session) []learnedTopic {
	learned := []learnedTopic{}
	if m.Enabled {
		for id, count := range m.Topics {
			if t, ok := memoryTopic(sess, id); ok {
				learned = append(learned, learnedTopic{t, count})
			}
		}
	}
	slices.SortFunc(learned, func(a, b learnedTopic) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), strings.Compare(a.Title, b.Title))
	})
	return learned
}

func (s *Service) memorySuggestions(ctx context.Context, sess store.Session, page string) ([]suggestion, error) {
	m, err := s.db.HeidiMemory(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return nil, err
	}
	var result []suggestion
	for _, t := range learnedTopics(m, sess) {
		if page == "dashboard" || page == t.Page {
			result = append(result, t.suggestion)
			if len(result) == 3 {
				break
			}
		}
	}
	return result, nil
}

func (s *Service) memory(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	m, err := s.db.HeidiMemory(r.Context(), sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, 200, map[string]any{
		"enabled": m.Enabled, "topics": learnedTopics(m, sess), "has_memory": len(m.Topics) > 0,
	})
	return nil
}

func (s *Service) setMemory(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	clear := r.Method == http.MethodDelete
	if !clear {
		if !s.auth.Decode(w, r, &in) {
			return nil
		}
		if in.Enabled == nil {
			return invalid("Set whether Heidi learns from your activity.")
		}
	}
	if err := s.db.SetHeidiMemory(r.Context(), sess.Workspace.ID, sess.User.ID, in.Enabled, clear); err != nil {
		return err
	}
	return s.memory(w, r, sess)
}
