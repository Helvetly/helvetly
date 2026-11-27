package portal

import (
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// errPortalClosed: the workspace turned its whole portal off. The sign-in page says the portal is not available and
// names nobody.
var errPortalClosed = auth.Error(http.StatusNotFound, "portal_closed", "This client portal is not available.", nil)

// openScope is the request's scope when its workspace's portal is open: on, the plan includes it and a client has it
// on. Otherwise the workspace answers like an unknown one, so the endpoint names no workspace that has no portal.
func (s *Service) openScope(r *http.Request) (store.PortalScope, error) {
	scope, ok := portalscope.FromContext(r.Context())
	if !ok {
		return scope, auth.ErrNotFound
	}
	open, err := s.db.Q.FeatureAllowed(r.Context(), scope.WorkspaceID, store.FeatureClientPortal)
	if err == nil && open {
		open, err = s.db.Q.HasPortalClients(r.Context(), scope.WorkspaceID)
	}
	if err == nil && !open {
		return scope, auth.ErrNotFound
	}
	// Off is said only of a portal that would otherwise be open, so it reveals no workspace an unknown slug would not.
	var off bool
	if err == nil {
		off, err = s.db.Q.PortalOff(r.Context(), scope.WorkspaceID)
	}
	if err == nil && off {
		err = errPortalClosed
	}
	return scope, err
}

// getScope tells the portal's sign-in page whose portal it is: the workspace's name, logo and current address.
// Public and minimal; unscoped, an unknown slug (portalscope answers it) or a workspace without an open portal is 404.
func (s *Service) getScope(w http.ResponseWriter, r *http.Request) {
	if !s.publicLimit.Allow(r) {
		s.fail(w, r, errTooMany)
		return
	}
	scope, err := s.openScope(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var logo *string
	if scope.LogoFileID != nil {
		u := portalscope.PathPrefix(scope) + "/api/v1/public/portal/scope/logo?v=" + *scope.LogoFileID
		logo = &u
	}
	address, err := s.scopes.URLOf(r.Context(), scope)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{
		"name":     scope.Name,
		"slug":     scope.Slug,
		"logo_url": logo,
		"url":      address,
	})
}

// getScopeLogo serves the scope's workspace logo: the same image its invoices carry.
func (s *Service) getScopeLogo(w http.ResponseWriter, r *http.Request) {
	if !s.publicLimit.Allow(r) {
		s.fail(w, r, errTooMany)
		return
	}
	scope, err := s.openScope(r)
	switch {
	case err != nil:
	case scope.LogoFileID == nil:
		err = auth.ErrNotFound
	default:
		// Keep the favicon on the portal origin and check access on every image request.
		err = storage.ServeDirect(w, r, s.files, store.WorkspaceLogoKey(scope.WorkspaceID, *scope.LogoFileID), "logo", "")
	}
	if err != nil {
		s.fail(w, r, err)
	}
}
