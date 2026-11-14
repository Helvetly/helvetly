package engagements

import (
	"context"
	"encoding/json"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// AssistantList uses the same periods, balances and attention rules as the ordinary API.
func (s *Service) AssistantList(ctx context.Context, q store.Q, sess store.Session, query string, toInvoice bool) ([]EngagementView, error) {
	list, err := q.ListEngagements(ctx, sess.Workspace.ID, store.EngagementFilter{Q: query, Statuses: []string{"active"}, Today: s.today(sess.Workspace), Limit: 51})
	if err != nil {
		return nil, err
	}
	if len(list) > 50 {
		return nil, auth.Error(422, "assistant_query_too_broad", "Specify a client or engagement name, or open Engagements for more than 50 matches.", nil)
	}
	out := []EngagementView{}
	for _, e := range list {
		v, err := s.view(ctx, q, e, s.today(sess.Workspace))
		if err != nil {
			return nil, err
		}
		if !toInvoice || slices.Contains(v.Attention, "to_invoice") {
			out = append(out, v)
		}
	}
	return out, nil
}

// AssistantLog runs in the confirmation's transaction: consuming it and recording work are one write.
func (s *Service) AssistantLog(ctx context.Context, q store.Q, sess store.Session, id, quantity, date, unit string, note *string) (store.EngagementEntry, error) {
	e, err := q.Engagement(ctx, sess.Workspace.ID, id, true)
	if err != nil {
		return store.EngagementEntry{}, err
	}
	v, err := s.view(ctx, q, e, s.today(sess.Workspace))
	if err != nil {
		return store.EngagementEntry{}, err
	}
	if v.Status != "active" {
		return store.EngagementEntry{}, auth.Error(409, "engagement_inactive", "The engagement is no longer active.", nil)
	}
	if textValue := e.Unit; textValue == nil && unit != "" || textValue != nil && *textValue != unit {
		return store.EngagementEntry{}, auth.Error(409, "engagement_changed", "The engagement unit changed. Cancel and prepare a new entry.", nil)
	}
	body := map[string]json.RawMessage{}
	for key, value := range map[string]any{"quantity": quantity, "date": date, "note": note} {
		b, err := json.Marshal(value)
		if err != nil {
			return store.EngagementEntry{}, err
		}
		body[key] = b
	}
	en := store.EngagementEntry{ID: auth.NewID("ent"), CreatedBy: &store.UserRef{ID: sess.User.ID}}
	if err := s.applyEntry(ctx, q, sess, v, &en, body, true); err != nil {
		return en, err
	}
	err = q.CreateEntry(ctx, e.ID, en, s.now())
	return en, err
}
