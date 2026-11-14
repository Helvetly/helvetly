package clients

import (
	"context"
	"encoding/json"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Contacts: people at a client. Exactly one is primary while any exist; every write runs in a transaction holding
// the client's row lock, so concurrent writes keep that rule.

// contactInput splits a contact body into its fields and is_primary (nil when absent).
func contactInput(body map[string]json.RawMessage, create bool) (map[string]any, *bool, error) {
	raw, ok := body["is_primary"]
	delete(body, "is_primary")
	fields, err := parseFields(body, contactFields, create)
	if err != nil || !ok {
		return fields, nil, err
	}
	v, msg := boolean(raw)
	if msg != "" {
		return nil, nil, validationFailed(map[string]string{"is_primary": msg})
	}
	primary := v.(bool)
	return fields, &primary, nil
}

// inClient runs fn in a transaction holding the lock on the session's live client {id}.
func (s *Service) inClient(ctx context.Context, sess store.Session, clientID string, fn func(store.Q) error) error {
	return s.db.Tx(ctx, func(q store.Q) error {
		found, err := q.LockClient(ctx, sess.Workspace.ID, clientID)
		if err != nil {
			return err
		}
		if !found {
			return store.ErrNotFound
		}
		return fn(q)
	})
}

func (s *Service) createContact(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	fields, primary, err := contactInput(body, true)
	if err != nil {
		return err
	}
	clientID, id := r.PathValue("id"), auth.NewID("con")
	var c store.Contact
	err = s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		if err := q.CreateContact(r.Context(), sess.Workspace.ID, clientID, id, fields, primary != nil && *primary, s.now()); err != nil {
			return err
		}
		c, err = q.Contact(r.Context(), clientID, id)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(c))
	return nil
}

func (s *Service) updateContact(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	fields, primary, err := contactInput(body, false)
	if err != nil {
		return err
	}
	clientID, id := r.PathValue("id"), r.PathValue("contact_id")
	var c, current store.Contact
	err = s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		var err error
		if current, err = q.Contact(r.Context(), clientID, id); err != nil {
			return err
		}
		if primary != nil && !*primary && current.IsPrimary {
			return validationFailed(map[string]string{"is_primary": "Make another contact primary instead."})
		}
		makePrimary := primary != nil && *primary && !current.IsPrimary
		if err := q.UpdateContact(r.Context(), clientID, id, fields, makePrimary, s.now()); err != nil {
			return err
		}
		c, err = q.Contact(r.Context(), clientID, id)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(c))
	return nil
}

func (s *Service) deleteContact(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	clientID := r.PathValue("id")
	err := s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		return q.DeleteContact(r.Context(), clientID, r.PathValue("contact_id"))
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
