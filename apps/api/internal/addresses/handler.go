package addresses

import (
	"cmp"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Auth is what the handler uses of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
}

// Routes answers the location fields' suggestions; the browser never calls Photon itself.
// Session-only: not in the public API, so personal tokens and MCP never reach it. A nil s (ADDRESS_SUGGEST_URL=off)
// answers an empty list, as does every failure: typing a location never waits on, or fails because of, Photon.
func Routes(mux *http.ServeMux, a Auth, s *Service) {
	mux.HandleFunc("GET /api/v1/addresses/suggest", a.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		found := []Address{}
		if s != nil {
			q := r.URL.Query()
			lang := strings.ToLower(cmp.Or(q.Get("lang"), r.Header.Get("Accept-Language")))
			found = s.Suggest(r.Context(), sess.Workspace.ID, q.Get("q"), q.Get("country"), lang[:min(len(lang), 2)])
		}
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": found})
	}))
}
