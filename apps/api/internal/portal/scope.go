package portal

import (
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// getScope tells the portal's sign-in page whose portal it is: the workspace's name, logo and current address.
// Public and minimal; unscoped (or an unknown slug, which portalscope answers itself) is 404.
func (s *Service) getScope(w http.ResponseWriter, r *http.Request) {
	scope, ok := portalscope.FromContext(r.Context())
	if !s.publicLimit.Allow(r) {
		s.fail(w, r, errTooMany)
		return
	}
	if !ok {
		s.fail(w, r, auth.ErrNotFound)
		return
	}
	var logo *string
	if scope.LogoFileID != nil {
		u := portalscope.Prefix(scope.Slug) + "/api/v1/public/portal/scope/logo?v=" + *scope.LogoFileID
		logo = &u
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{
		"name":     scope.Name,
		"slug":     scope.Slug,
		"logo_url": logo,
		"url":      s.scopes.URLFor(scope.Slug),
	})
}

// getScopeLogo serves the scope's workspace logo: the same image its invoices carry.
func (s *Service) getScopeLogo(w http.ResponseWriter, r *http.Request) {
	scope, ok := portalscope.FromContext(r.Context())
	var err error
	switch {
	case !s.publicLimit.Allow(r):
		err = errTooMany
	case !ok || scope.LogoFileID == nil:
		err = auth.ErrNotFound
	default:
		// App chrome like the staff app's logo: no download allowance (the empty billing workspace).
		err = storage.Serve(w, r, s.files, "", store.WorkspaceLogoKey(scope.WorkspaceID, *scope.LogoFileID), "logo", "")
	}
	if err != nil {
		s.fail(w, r, err)
	}
}
