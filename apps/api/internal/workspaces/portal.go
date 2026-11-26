package workspaces

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
)

// PortalAddresses is what the portal address settings use of internal/portalscope.
type PortalAddresses interface {
	Slug(ctx context.Context, ws store.Workspace) (string, error)
	URLFor(slug string) string
	URLOf(ctx context.Context, s store.PortalScope) (string, error)
}

// SetPortal turns on the client portal's address settings (/api/v1/workspace/portal).
func (s *Service) SetPortal(p PortalAddresses) { s.portal = p }

func (s *Service) registerPortal(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/workspace/portal", s.auth.SignedIn(s.getPortal))
	mux.HandleFunc("GET /api/v1/workspace/portal/availability", s.auth.SignedIn(s.portalAvailability))
	mux.HandleFunc("PUT /api/v1/workspace/portal", s.auth.SignedIn(s.putPortal))
	mux.HandleFunc("PUT /api/v1/workspace/portal/access", s.auth.SignedIn(s.putPortalAccess))
}

var errPortalAdminOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the portal address.", nil)

// writePortal answers with the slug, the whole address, where clients sign in (canonical_url: the active custom
// domain, else the address; portalscope.CanonicalURL) and whether the portal is on for the workspace.
func (s *Service) writePortal(w http.ResponseWriter, r *http.Request, workspaceID, slug string) {
	off, err := s.db.PortalOff(r.Context(), workspaceID)
	var canonical string
	if err == nil {
		canonical, err = s.portal.URLOf(r.Context(), store.PortalScope{WorkspaceID: workspaceID, Slug: slug})
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	available, err := s.db.FeatureAllowed(r.Context(), workspaceID, store.FeatureClientPortal)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"slug": slug, "url": s.portal.URLFor(slug),
		"canonical_url": canonical, "enabled": !off, "feature_available": available}})
}

// getPortal is where the workspace's clients sign in: its slug, the whole address and whether the portal is on.
func (s *Service) getPortal(w http.ResponseWriter, r *http.Request, sess store.Session) {
	slug, err := s.portal.Slug(r.Context(), sess.Workspace)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	s.writePortal(w, r, sess.Workspace.ID, slug)
}

// putPortalAccess turns the whole client portal on or off (owner or admin), audited. Off, no client signs in, every
// portal session ends and no invitation goes out; each client's own switch is kept.
func (s *Service) putPortalAccess(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errPortalAdminOnly)
		return
	}
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	if in.Enabled == nil {
		s.auth.WriteError(w, r, auth.Error(http.StatusUnprocessableEntity, "invalid", "Say whether the portal is on.", map[string]any{"fields": map[string]string{"enabled": "required"}}))
		return
	}
	slug, err := s.portal.Slug(r.Context(), sess.Workspace)
	if err == nil {
		err = s.db.Tx(r.Context(), func(q store.Q) error {
			off, err := q.LockPortalOff(r.Context(), sess.Workspace.ID)
			if err != nil || off == !*in.Enabled {
				return err
			}
			if err := q.SetPortalOff(r.Context(), sess.Workspace.ID, !*in.Enabled); err != nil {
				return err
			}
			kind := "workspace.portal_turned_off"
			if *in.Enabled {
				kind = "workspace.portal_turned_on"
			}
			actor := sess.User.ID
			return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind,
				SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: s.now(), Payload: []byte(`{}`)})
		})
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	s.writePortal(w, r, sess.Workspace.ID, slug)
}

// slugProblem is why the workspace cannot take slug: "invalid", "reserved", "taken" or "".
func (s *Service) slugProblem(ctx context.Context, workspaceID, slug string) (string, error) {
	if p := portalscope.Problem(slug); p != "" {
		return p, nil
	}
	owner, err := s.db.PortalSlugOwner(ctx, slug)
	if err != nil || owner == "" || owner == workspaceID {
		return "", err
	}
	return "taken", nil
}

// slugChecksPerMinute is how many addresses one person may check a minute: plenty for typing, too few to list them.
const slugChecksPerMinute = 30

var errSlugChecksTooMany = auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many address checks. Wait a moment.", nil)

// portalAvailability answers the slug editor as it types: {available, problem}. Only those who may change the slug
// ask, and each person a limited number of times, so it cannot list other workspaces' addresses.
func (s *Service) portalAvailability(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errPortalAdminOnly)
		return
	}
	if !s.slugLimit.AllowKey(sess.User.ID) {
		s.auth.WriteError(w, r, errSlugChecksTooMany)
		return
	}
	problem, err := s.slugProblem(r.Context(), sess.Workspace.ID, strings.ToLower(strings.TrimSpace(r.URL.Query().Get("slug"))))
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	var p *string
	if problem != "" {
		p = &problem
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"available": problem == "", "problem": p}})
}

var slugMessages = map[string]string{
	"invalid":  "Use 3 to 32 lowercase letters, digits and hyphens, not at the start or end.",
	"reserved": "This address is reserved. Choose another one.",
	"taken":    "Another workspace uses this address. Choose another one.",
}

// putPortal changes the slug (owner or admin). The previous one keeps redirecting to it, and the change goes into
// the audit log.
func (s *Service) putPortal(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errPortalAdminOnly)
		return
	}
	var in struct {
		Slug string `json:"slug"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	slug := strings.ToLower(strings.TrimSpace(in.Slug))
	previous, err := s.portal.Slug(r.Context(), sess.Workspace)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	if slug == previous {
		s.writePortal(w, r, sess.Workspace.ID, slug)
		return
	}
	problem, err := s.slugProblem(r.Context(), sess.Workspace.ID, slug)
	if err == nil && problem == "" {
		err = s.db.Tx(r.Context(), func(q store.Q) error {
			if err := q.SetPortalSlug(r.Context(), sess.Workspace.ID, slug, s.now()); err != nil {
				return err
			}
			payload, _ := json.Marshal(map[string]string{"from": previous, "to": slug})
			actor := sess.User.ID
			return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "workspace.portal_address_changed",
				SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: s.now(), Payload: payload})
		})
		if errors.Is(err, store.ErrPortalSlugTaken) {
			problem, err = "taken", nil
		}
	}
	if err == nil && problem != "" {
		status := http.StatusUnprocessableEntity
		if problem == "taken" {
			status = http.StatusConflict
		}
		err = auth.Error(status, "slug_"+problem, slugMessages[problem], map[string]any{"fields": map[string]string{"slug": problem}})
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	s.writePortal(w, r, sess.Workspace.ID, slug)
}
