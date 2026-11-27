package documents

import (
	"errors"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Sharing a document with a client makes it visible in the client portal (docs/portal-contract.md "Staff side").
func (s *Service) registerShares(handle func(string, handler)) {
	handle("GET /api/v1/documents/{id}/shares", s.listShares)
	handle("POST /api/v1/documents/{id}/shares", s.share)
	// A query, not a path segment: "{id}/shares/{client_id}" overlaps "folders/{id}/star" in ServeMux.
	handle("DELETE /api/v1/documents/{id}/shares", s.unshare)
}

func (s *Service) listShares(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if _, err := s.db.Document(r.Context(), sess.Workspace.ID, r.PathValue("id")); err != nil {
		return err
	}
	shares, err := s.db.DocumentShares(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	participants, err := s.db.DocumentParticipantShares(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": shares, "participants": participants})
	return nil
}

func (s *Service) share(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		ClientID         string `json:"client_id"`
		ExpiresInSeconds *int64 `json:"expires_in_seconds"`
		// ParticipantID shares with one participant of the client only (their portal session sees it), never expiring.
		ParticipantID string `json:"participant_id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if body.ClientID == "" {
		return validationFailed(map[string]string{"client_id": "Choose a client."})
	}
	now := s.now()
	if body.ParticipantID != "" {
		err := s.db.ShareDocumentWithParticipant(r.Context(), sess.Workspace.ID, r.PathValue("id"), body.ClientID, body.ParticipantID, sess.User.ID, now)
		if errors.Is(err, store.ErrNotFound) {
			return validationFailed(map[string]string{"participant_id": "Choose a participant of this client."})
		}
		if err != nil {
			return err
		}
		return s.listShares(w, r, sess)
	}
	expiry, err := shareExpiry(now, body.ExpiresInSeconds)
	if err != nil {
		return err
	}
	if err := s.db.ShareDocument(r.Context(), sess.Workspace.ID, r.PathValue("id"), body.ClientID, sess.User.ID, now, expiry); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) unshare(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if participant := r.URL.Query().Get("participant_id"); participant != "" {
		if err := s.db.UnshareDocumentWithParticipant(r.Context(), sess.Workspace.ID, r.PathValue("id"), participant); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Give the client_id to stop sharing with.", nil)
	}
	if err := s.db.UnshareDocument(r.Context(), sess.Workspace.ID, r.PathValue("id"), clientID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
