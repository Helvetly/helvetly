package heidi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

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
	var dispatch *proposedChange
	appendResult := func(ctx context.Context, q store.Q, t turn) error {
		message := Message{ID: auth.NewID("msg"), Access: accessKey(sess), Role: "assistant", Text: t.Text, Actions: t.Actions, GeneratedBy: t.generatedBy()}
		return q.AppendHeidiMessage(ctx, sess.Workspace.ID, sess.User.ID, body.ConversationID, message.ID, message, s.now())
	}
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
		if pending.ID != body.ConfirmationID || (pending.Kind != "log_entry" && pending.Kind != "workspace_operation") {
			return invalid("This confirmation does not match the pending operation.")
		}
		if !pending.ExpiresAt.After(s.now()) {
			return auth.Error(409, "confirmation_expired", "This confirmation expired. Send the request again.", nil)
		}
		if pending.Kind == "workspace_operation" {
			var change proposedChange
			if err := json.Unmarshal(pending.Payload, &change); err != nil {
				return err
			}
			result.Text = "× " + change.Label
			if *body.Approved {
				if !change.available(sess) {
					return auth.Error(403, "forbidden", "Your workspace permissions have changed. Cancel and ask again.", nil)
				}
				dispatch = &change
				// Commit the claim before dispatch. A retry after a lost response cannot issue the write twice.
				result.Text = "Submitted: " + change.Label + ". Check the record if no outcome follows."
			}
		} else if *body.Approved {
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
		if pending.Kind == "log_entry" && *body.Approved {
			if err := s.learn(r.Context(), q, sess, "create_engagement_entry"); err != nil {
				return err
			}
		}
		return appendResult(r.Context(), q, result)
	})
	if err != nil {
		return err
	}
	if dispatch != nil {
		// The member already confirmed; finish the single dispatch and retain its outcome even if the tab disconnects.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), time.Minute)
		defer cancel()
		raw, opErr := s.execute(r.WithContext(ctx), sess, dispatch.Command)
		result.Text = "✓ " + dispatch.Label
		if opErr == nil && raw != nil {
			var changed bool
			result.Text, changed = bulkReceipt(dispatch.Label, raw)
			if !changed {
				opErr = auth.Error(http.StatusConflict, "operation_not_applied", result.Text, nil)
			}
		}
		if opErr != nil {
			result.Text = "The application could not verify the outcome. Check the record before trying again."
			if status, _, message, ok := auth.Describe(opErr); ok && status < 500 {
				result.Text = message
			}
		}
		saveCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer stop()
		if err := s.db.Tx(saveCtx, func(q store.Q) error {
			if err := q.LockHeidiConversation(saveCtx, sess.Workspace.ID, sess.User.ID, body.ConversationID, false, s.now()); err != nil {
				return err
			}
			if opErr == nil {
				if err := s.learn(saveCtx, q, sess, dispatch.Command.Operation); err != nil {
					return err
				}
			}
			return appendResult(saveCtx, q, result)
		}); err != nil {
			return err
		}
		if opErr != nil {
			return opErr
		}
	}
	_ = writeEvents(&stream{w: w}, result)
	return nil
}

// Bulk handlers return HTTP 200 even when every selected item is skipped.
func bulkReceipt(label string, raw json.RawMessage) (string, bool) {
	var out struct {
		Data struct {
			Updated *int
			Skipped []struct{ ID, Reason string }
		}
	}
	if json.Unmarshal(raw, &out) != nil || out.Data.Updated == nil {
		return label + ": check the record list for the outcome.", false
	}
	text := fmt.Sprintf("%s — updated: %d, skipped: %d.", label, *out.Data.Updated, len(out.Data.Skipped))
	for _, v := range out.Data.Skipped[:min(10, len(out.Data.Skipped))] {
		text += "\n- " + md(v.ID) + ": " + md(v.Reason)
	}
	return text, *out.Data.Updated > 0
}
