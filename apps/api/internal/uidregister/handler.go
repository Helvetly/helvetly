package uidregister

import (
	"context"
	"errors"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

var errUnavailable = auth.Error(http.StatusServiceUnavailable, "uid_register_unavailable",
	"The Swiss UID register can't be reached right now.", nil)

// Routes answers the client form's lookups; the browser never calls the register itself.
// Session-only: not in the public API, so personal tokens and MCP never reach it. A nil reg (lookups turned off)
// answers every lookup as unavailable.
func Routes(mux *http.ServeMux, a Auth, reg Register) {
	if reg == nil {
		reg = off{}
	}
	mux.HandleFunc("GET /api/v1/uid-register/search", a.SignedIn(func(w http.ResponseWriter, r *http.Request, _ store.Session) {
		q := r.URL.Query().Get("q")
		if len(q) > 200 {
			a.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "Search for at most 200 characters.", nil))
			return
		}
		found, err := reg.Search(r.Context(), q)
		if err != nil {
			a.WriteError(w, r, unavailable(err))
			return
		}
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": found})
	}))
	mux.HandleFunc("GET /api/v1/uid-register/companies/{uid}", a.SignedIn(func(w http.ResponseWriter, r *http.Request, _ store.Session) {
		c, ok, err := reg.Lookup(r.Context(), r.PathValue("uid"))
		switch {
		case err != nil:
			a.WriteError(w, r, unavailable(err))
		case !ok:
			a.WriteError(w, r, auth.ErrNotFound)
		default:
			auth.WriteJSON(w, http.StatusOK, map[string]any{"data": c})
		}
	}))
}

func unavailable(err error) error {
	if errors.Is(err, ErrUnavailable) {
		return errUnavailable
	}
	return err
}

type off struct{}

func (off) Search(context.Context, string) ([]Company, error) { return nil, ErrUnavailable }
func (off) Lookup(context.Context, string) (Company, bool, error) {
	return Company{}, false, ErrUnavailable
}
