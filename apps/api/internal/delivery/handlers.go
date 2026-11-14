package delivery

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/invoices/{id}/transmissions", s.list)
	handle("POST /api/v1/invoices/{id}/transmissions", s.queue)
	handle("POST /api/v1/invoices/{id}/transmissions/{tid}/retry", s.retry)
	handle("GET /api/v1/transmission-channels", s.listChannels)
	handle("PUT /api/v1/transmission-channels/{name}/credentials", s.putCredentials)
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if _, err := s.db.Invoice(r.Context(), sess.Workspace.ID, r.PathValue("id"), sess.Workspace.Today(s.now()), false); err != nil {
		return err
	}
	out, err := s.db.Transmissions(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
	return nil
}

// queue checks the invoice can be sent through the channel (its XML renders and is archived now, so a problem is
// answered at once rather than found by the job) and queues it; 202 with the transmission.
func (s *Service) queue(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct{ Channel, Format string }
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx := r.Context()
	c := s.channel(body.Channel)
	if c == nil {
		return errUnknownChannel
	}
	if !slices.Contains(c.Formats(), body.Format) {
		return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "This channel does not take that format.",
			map[string]any{"fields": map[string]string{"format": "invalid"}})
	}
	if c.NeedsCredentials() {
		if _, err := s.db.TransmissionCredentials(ctx, sess.Workspace.ID, c.Name()); errors.Is(err, store.ErrNotFound) {
			return auth.Error(http.StatusConflict, "channel_not_configured",
				"Add this workspace's credentials for the channel before sending through it.", nil)
		} else if err != nil {
			return err
		}
	}
	inv, err := s.db.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), sess.Workspace.Today(s.now()), false)
	if err != nil {
		return err
	}
	if _, _, err := s.export(ctx, sess, inv, body.Format); err != nil {
		return err
	}
	t, _, err := s.db.QueueTransmission(ctx, store.Transmission{ID: auth.NewID("trn"), WorkspaceID: sess.Workspace.ID,
		InvoiceID: inv.ID, Channel: c.Name(), Format: body.Format, CreatedBy: &sess.User.ID}, s.now())
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusAccepted, map[string]any{"data": t})
	return nil
}

// retry re-queues a failed or rejected transmission; 409 for one still on its way or done.
func (s *Service) retry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	t, err := s.db.Transmission(ctx, sess.Workspace.ID, r.PathValue("id"), r.PathValue("tid"))
	if err != nil {
		return err
	}
	t, requeued, err := s.db.QueueTransmission(ctx, t, s.now())
	if err != nil {
		return err
	}
	if !requeued {
		return auth.Error(http.StatusConflict, "invalid_state", "Only a failed or rejected transmission can be retried.", nil)
	}
	auth.WriteJSON(w, http.StatusAccepted, map[string]any{"data": t})
	return nil
}

type channelJSON struct {
	Name             string   `json:"name"`
	Kind             Kind     `json:"kind"`
	Formats          []string `json:"formats"`
	NeedsCredentials bool     `json:"needs_credentials"`
	Configured       bool     `json:"configured"`
}

// listChannels: what this server offers and whether the workspace has credentials for each; never the credentials.
func (s *Service) listChannels(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	configured, err := s.db.ConfiguredChannels(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	out := []channelJSON{}
	for _, c := range s.channels {
		out = append(out, channelJSON{Name: c.Name(), Kind: c.Kind(), Formats: c.Formats(), NeedsCredentials: c.NeedsCredentials(),
			Configured: !c.NeedsCredentials() || slices.Contains(configured, c.Name())})
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
	return nil
}

// putCredentials seals and stores the workspace's credentials for a channel: owners and admins only, 204.
func (s *Service) putCredentials(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if sess.Role != "owner" && sess.Role != "admin" {
		return auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can set channel credentials.", nil)
	}
	c := s.channel(r.PathValue("name"))
	if c == nil || !c.NeedsCredentials() {
		return auth.ErrNotFound
	}
	var body struct {
		Credentials json.RawMessage `json:"credentials"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	var fields map[string]any
	if json.Unmarshal(body.Credentials, &fields) != nil || len(fields) == 0 {
		return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Enter the channel's credentials.",
			map[string]any{"fields": map[string]string{"credentials": "invalid"}})
	}
	sealed, err := s.sealer.seal(sess.Workspace.ID, c.Name(), body.Credentials)
	if err != nil {
		return err
	}
	if err := s.db.PutTransmissionCredentials(r.Context(), sess.Workspace.ID, c.Name(), sealed, sess.User.ID, s.now()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
