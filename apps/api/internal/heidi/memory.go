package heidi

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

func heidiStyleOperation() openapi.Operation {
	return openapi.Operation{
		ID: "set_heidi_reply_style", Method: http.MethodPatch, Path: "/api/v1/heidi/memory",
		Summary: "Set my preferred reply style", Resource: "account", Write: true, JSONOnly: true, BodyRequired: true,
		Description: "Only when the current user asks to remember a reply length for future chats. A one-off request for a brief or detailed answer does not change memory. Requires memory to be enabled and confirmation.",
		Body:        json.RawMessage(`{"type":"object","additionalProperties":false,"required":["reply_style"],"properties":{"reply_style":{"type":"string","enum":["auto","brief","detailed"]}}}`),
	}
}

// This route also handles forgetting memory. A style command may only change reply length.
func validateHeidiStyleBody(raw json.RawMessage) error {
	var body map[string]string
	if err := json.Unmarshal(raw, &body); err != nil || len(body) != 1 || !slices.Contains([]string{"auto", "brief", "detailed"}, body["reply_style"]) {
		return errors.New("Choose a reply style: auto, brief or detailed.")
	}
	return nil
}

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
	if !ok || id == "set_heidi_reply_style" || !canOperate(sess, op) {
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

func (s *Service) replyStyle(ctx context.Context, sess store.Session) (string, error) {
	m, err := s.db.HeidiMemory(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil || !m.Enabled {
		return "", err
	}
	switch m.ReplyStyle {
	case "brief":
		return "\nThe user prefers brief answers unless the current request asks for more detail. Keep necessary facts and review details.", nil
	case "detailed":
		return "\nThe user prefers detailed answers unless the current request asks for brevity. Explain relevant steps and figures using available evidence.", nil
	default:
		return "", nil
	}
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
		"enabled": m.Enabled, "reply_style": m.ReplyStyle, "topics": learnedTopics(m, sess),
		"has_memory": len(m.Topics) > 0 || m.ReplyStyle != "auto",
	})
	return nil
}

func (s *Service) setMemory(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Enabled *bool   `json:"enabled"`
		Style   *string `json:"reply_style"`
	}
	clear := r.Method == http.MethodDelete
	if !clear {
		if !s.auth.Decode(w, r, &in) {
			return nil
		}
		if (in.Enabled == nil) == (in.Style == nil) || in.Style != nil && !slices.Contains([]string{"auto", "brief", "detailed"}, *in.Style) {
			return invalid("Change one memory setting at a time. Reply style may be auto, brief or detailed.")
		}
	}
	ok, err := s.db.SetHeidiMemory(r.Context(), sess.Workspace.ID, sess.User.ID, in.Enabled, in.Style, clear)
	if err != nil {
		return err
	}
	if !ok {
		return auth.Error(409, "memory_disabled", "Turn on memory to set a reply style.", nil)
	}
	return s.memory(w, r, sess)
}
