package heidi

import (
	"encoding/json"
	"errors"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func (s *Service) confirm(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !s.limit.Allow(r) {
		return auth.Error(429, "rate_limited", "Wait before sending another message.", nil)
	}
	var body struct {
		ConversationID string `json:"conversation_id"`
		ConfirmationID string `json:"confirmation_id"`
		Approved       *bool  `json:"approved"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if !conversationID.MatchString(body.ConversationID) || body.ConfirmationID == "" || body.Approved == nil {
		return invalid("Send a conversation, confirmation and approval decision.")
	}
	result := turn{Text: "Cancelled. No work was recorded."}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockHeidiConversation(r.Context(), sess.Workspace.ID, sess.User.ID, body.ConversationID, false, s.now()); err != nil {
			return err
		}
		pending, err := q.HeidiConfirmation(r.Context(), sess.Workspace.ID, sess.User.ID, body.ConversationID)
		if errors.Is(err, store.ErrNotFound) {
			return auth.Error(409, "confirmation_consumed", "This confirmation was already answered or does not exist.", nil)
		}
		if err != nil {
			return err
		}
		if pending.ID != body.ConfirmationID || pending.Kind != "log_entry" {
			return invalid("This confirmation does not match the pending operation.")
		}
		if !pending.ExpiresAt.After(s.now()) {
			return auth.Error(409, "confirmation_expired", "This confirmation expired. Send the request again.", nil)
		}
		if *body.Approved {
			if err := need(sess, "write:engagements"); err != nil {
				return err
			}
			if s.engagements == nil {
				return auth.Error(503, "unavailable", "Engagement assistance is unavailable.", nil)
			}
			var request logRequest
			if err := json.Unmarshal(pending.Payload, &request); err != nil {
				return err
			}
			if _, err = s.engagements.AssistantLog(r.Context(), q, sess, request.EngagementID, request.Quantity, request.Date, request.EngagementUnit, request.Note); err != nil {
				return err
			}
			result.Text = "Recorded " + request.Quantity + " " + request.EngagementUnit + " on **" + md(request.Title) + "**, dated " + request.Date + "."
			result.Statuses = []string{"Recorded engagement entry"}
			result.Actions = []Action{{ID: "open_engagement", EngagementID: request.EngagementID, Label: "Open " + request.Title}}
		}
		if err := q.DeleteHeidiConfirmation(r.Context(), sess.Workspace.ID, sess.User.ID, body.ConversationID, pending.ID); err != nil {
			return err
		}
		message := Message{ID: auth.NewID("msg"), Role: "assistant", Text: result.Text, Actions: result.Actions, GeneratedBy: result.generatedBy()}
		return q.AppendHeidiMessage(r.Context(), sess.Workspace.ID, sess.User.ID, body.ConversationID, message.ID, message, s.now())
	})
	if err != nil {
		return err
	}
	_ = writeEvents(&stream{w: w}, result)
	return nil
}
