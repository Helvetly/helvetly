package clients

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// profileFields: the only client fields a client may ask to change through the portal.
var profileFields = []string{"name", "billing_email", "phone", "street", "street_number", "apt", "zip", "city", "country",
	"vat_number", "registration_number"}

// addressFields are approved or discarded together, as the one choice "address".
var addressFields = []string{"street", "street_number", "apt", "zip", "city", "country"}

const maxRejectReason = 500

var errForbiddenDecide = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can decide on change requests.", nil)

// ParseProfile validates a portal change request body with the client field rules, restricted to profileFields.
func ParseProfile(body map[string]json.RawMessage) (map[string]any, error) {
	if len(body) == 0 {
		return nil, auth.Error(http.StatusBadRequest, "invalid_request", "Send at least one field to change.", nil)
	}
	parsers := map[string]fieldParser{}
	for _, k := range profileFields {
		parsers[k] = clientFields[k]
	}
	return parseFields(body, parsers, false)
}

func (s *Service) registerRequests(handle func(string, handler)) {
	handle("GET /api/v1/clients/{id}/change-request", s.getRequest)
	handle("POST /api/v1/clients/{id}/change-request/approve", s.approveRequest)
	handle("POST /api/v1/clients/{id}/change-request/reject", s.rejectRequest)
}

func (s *Service) getRequest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	c, err := s.db.Client(ctx, sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	req, err := s.db.PendingChangeRequest(ctx, sess.Workspace.ID, id)
	if errors.Is(err, store.ErrNotFound) {
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": nil}) // a normal page load, not an error
		return nil
	}
	if err != nil {
		return err
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return fmt.Errorf("encode client: %w", err)
	}
	var all map[string]any
	if err := json.Unmarshal(raw, &all); err != nil {
		return fmt.Errorf("decode client: %w", err)
	}
	current := map[string]any{}
	for k := range req.Fields {
		current[k] = all[k]
	}
	contactID := ""
	if req.ContactID != nil {
		contactID = *req.ContactID
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"id": req.ID, "fields": req.Fields, "current": current,
		"contact": map[string]string{"id": contactID, "name": req.ContactName}, "created_at": req.CreatedAt}})
	return nil
}

// optionalBody decodes a JSON object body that may be left out; false when an answer was written.
func (s *Service) optionalBody(w http.ResponseWriter, r *http.Request, v any) bool {
	return r.ContentLength == 0 || s.auth.Decode(w, r, v)
}

// chosenFields: the requested fields to apply, sorted; nil chosen means all of them, "address" every address field.
func chosenFields(requested map[string]any, chosen *[]string) ([]string, error) {
	if chosen != nil && len(*chosen) == 0 {
		return nil, auth.Error(http.StatusBadRequest, "invalid_request", "Choose at least one change to apply, or reject the request.", nil)
	}
	keep, picks := map[string]bool{}, []string{}
	for k := range requested {
		keep[k] = chosen == nil
	}
	if chosen != nil {
		picks = *chosen
	}
	for _, c := range picks {
		matched := false
		for k := range requested {
			if k == c && !slices.Contains(addressFields, k) || c == "address" && slices.Contains(addressFields, k) {
				keep[k], matched = true, true
			}
		}
		if !matched {
			return nil, auth.Error(http.StatusBadRequest, "invalid_request", fmt.Sprintf("%q is not a change in this request.", c), nil)
		}
	}
	out := []string{}
	for k, ok := range keep {
		if ok {
			out = append(out, k)
		}
	}
	slices.Sort(out)
	return out, nil
}

func (s *Service) approveRequest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canDelete(sess) {
		return errForbiddenDecide
	}
	var in struct {
		Fields *[]string `json:"fields"`
	}
	if !s.optionalBody(w, r, &in) {
		return nil
	}
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		req, err := q.PendingChangeRequest(ctx, sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		applied, err := chosenFields(req.Fields, in.Fields)
		if err != nil {
			return err
		}
		// Re-validated: the rules may have changed since the client asked.
		body := map[string]json.RawMessage{}
		for _, k := range applied {
			if body[k], err = json.Marshal(req.Fields[k]); err != nil {
				return fmt.Errorf("encode field %s: %w", k, err)
			}
		}
		fields, err := ParseProfile(body)
		if err != nil {
			return err
		}
		if found, err := q.UpdateClient(ctx, sess.Workspace.ID, id, fields, s.now()); err != nil || !found {
			if err == nil {
				err = store.ErrNotFound
			}
			return err
		}
		_, err = q.DecideChangeRequest(ctx, sess.Workspace.ID, id, "approved", sess.User.ID, applied, "", s.now())
		return err
	})
	if err != nil {
		return err
	}
	return s.get(w, r, sess)
}

func (s *Service) rejectRequest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canDelete(sess) {
		return errForbiddenDecide
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if !s.optionalBody(w, r, &in) {
		return nil
	}
	reason := strings.TrimSpace(in.Reason)
	if utf8.RuneCountInString(reason) > maxRejectReason {
		return validationFailed(map[string]string{"reason": fmt.Sprintf("Keep the reason to at most %d characters.", maxRejectReason)})
	}
	if _, err := s.db.DecideChangeRequest(r.Context(), sess.Workspace.ID, r.PathValue("id"), "rejected", sess.User.ID, nil, reason, s.now()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
