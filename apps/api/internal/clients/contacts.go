package clients

import (
	"context"
	"encoding/json"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// People of a client (client_contacts): contacts (billing and correspondence) and participants (take the service);
// one person may be both. Exactly one contact is primary while any exist; every write runs in a transaction holding
// the client's row lock, so concurrent writes keep that rule. A person client is its own participant, so only a
// company has participants; a participant's portal switch needs their email and follows the client's own.

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
	var client store.Client
	err = s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		if client, err = q.Client(r.Context(), sess.Workspace.ID, clientID); err != nil {
			return err
		}
		if err := q.CreateContact(r.Context(), sess.Workspace.ID, clientID, id, fields, primary != nil && *primary, s.now()); err != nil {
			return err
		}
		if c, err = q.Contact(r.Context(), clientID, id); err != nil {
			return err
		}
		return s.checkPerson(r.Context(), q, sess, client, store.Contact{}, c, primary)
	})
	if err != nil {
		return err
	}
	s.inviteParticipant(r.Context(), sess, client, store.Contact{}, c)
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
	var client store.Client
	err = s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		var err error
		if client, err = q.Client(r.Context(), sess.Workspace.ID, clientID); err != nil {
			return err
		}
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
		if c, err = q.Contact(r.Context(), clientID, id); err != nil {
			return err
		}
		return s.checkPerson(r.Context(), q, sess, client, current, c, primary)
	})
	if err != nil {
		return err
	}
	s.inviteParticipant(r.Context(), sess, client, current, c)
	auth.WriteJSON(w, http.StatusOK, data(c))
	return nil
}

func (s *Service) deleteContact(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	clientID := r.PathValue("id")
	err := s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		current, err := q.Contact(r.Context(), clientID, r.PathValue("contact_id"))
		if err != nil {
			return err
		}
		if participantPortal(current) {
			client, err := q.Client(r.Context(), sess.Workspace.ID, clientID)
			if err != nil {
				return err
			}
			if err := s.auditParticipant(r.Context(), q, sess, "portal.participant_access_revoked", client, current); err != nil {
				return err
			}
		}
		return q.DeleteContact(r.Context(), clientID, current.ID)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// participantPortal: the person may sign in to the portal as a participant (their own switch, role and email).
func participantPortal(c store.Contact) bool {
	return c.PortalEnabled && c.Is(store.RoleParticipant) && c.Email != nil && *c.Email != ""
}

// checkPerson validates a written person against its client, inside the write's transaction (so a refusal rolls it
// back), and audits a participant's portal access starting or ending.
func (s *Service) checkPerson(ctx context.Context, q store.Q, sess store.Session, client store.Client, before, after store.Contact, primary *bool) error {
	invalid := map[string]string{}
	if after.Is(store.RoleParticipant) && !client.IsCompany {
		invalid["roles"] = "A person client is its own participant: only a company has participants."
	}
	if primary != nil && *primary && !after.Is(store.RoleContact) {
		invalid["is_primary"] = "Only a contact can be the primary contact."
	}
	if after.PortalEnabled && !after.Is(store.RoleParticipant) {
		invalid["portal_enabled"] = "Only a participant signs in to the portal."
	} else if after.PortalEnabled && (after.Email == nil || *after.Email == "") {
		invalid["portal_enabled"] = "Add an email to let this participant sign in."
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}
	was, now := participantPortal(before), participantPortal(after)
	if now && (!was || *before.Email != *after.Email) {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureClientPortal); err != nil {
			return err
		}
		return s.auditParticipant(ctx, q, sess, "portal.participant_access_granted", client, after)
	}
	if was && !now {
		return s.auditParticipant(ctx, q, sess, "portal.participant_access_revoked", client, before)
	}
	return nil
}

func (s *Service) auditParticipant(ctx context.Context, q store.Q, sess store.Session, kind string, client store.Client, p store.Contact) error {
	payload, err := json.Marshal(map[string]string{"client_id": client.ID, "client_name": client.Name, "participant_id": p.ID,
		"participant_name": p.Name})
	if err != nil {
		return err
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind, SubjectType: "client",
		SubjectID: client.ID, ActorID: &sess.User.ID, At: s.now(), Payload: payload})
}
