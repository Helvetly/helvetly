package portal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// profileFields are the only fields a client may ask to change (docs/portal-contract.md).
var profileFields = []string{"name", "billing_email", "phone", "street", "street_number", "apt", "zip", "city", "country",
	"vat_number", "registration_number"}

func (s *Service) registerProfile(handle func(string, handler)) {
	handle("GET /api/v1/public/portal/profile", s.getProfile)
	handle("POST /api/v1/public/portal/profile/requests", s.requestChange)
}

type requestView struct {
	ID        string         `json:"id"`
	Fields    map[string]any `json:"fields"`
	CreatedAt time.Time      `json:"created_at"`
}

// decisionView: how the client's last request was decided, with the reason for a rejection.
type decisionView struct {
	requestView
	Status    string     `json:"status"`
	Applied   []string   `json:"applied_fields"`
	Reason    *string    `json:"reason"`
	DecidedAt *time.Time `json:"decided_at"`
}

func (s *Service) getProfile(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	c, err := s.db.Q.Client(r.Context(), sess.Workspace.ID, sess.ClientID)
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
	profile := map[string]any{}
	for _, k := range profileFields {
		profile[k] = all[k]
	}
	var pending *requestView
	req, err := s.db.Q.PendingChangeRequest(r.Context(), sess.Workspace.ID, sess.ClientID)
	if err == nil {
		pending = &requestView{req.ID, req.Fields, req.CreatedAt}
	} else if err != store.ErrNotFound {
		return err
	}
	var decided *decisionView
	last, err := s.db.Q.LastDecidedChangeRequest(r.Context(), sess.Workspace.ID, sess.ClientID)
	if err == nil {
		decided = &decisionView{requestView{last.ID, last.Fields, last.CreatedAt}, last.Status, last.Applied, last.Reason, last.DecidedAt}
	} else if err != store.ErrNotFound {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"profile": profile, "pending": pending, "last_decision": decided})
	return nil
}

func (s *Service) requestChange(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	fields, err := clients.ParseProfile(body)
	if err != nil {
		return err
	}
	var req store.ChangeRequest
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		now := s.now()
		var err error
		req, err = q.UpsertChangeRequest(r.Context(), auth.NewID("ccr"), sess.Workspace.ID, sess.ClientID, "", fields, now)
		if err != nil {
			return err
		}
		return notifications.Notify(r.Context(), q, sess.Workspace.ID, "client.change_requested",
			map[string]any{"client_id": sess.ClientID, "client_name": sess.ClientName, "contact_name": sess.Email},
			store.NotifyTo{Roles: notifications.Managers}, now)
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, requestView{req.ID, req.Fields, req.CreatedAt})
	return nil
}
