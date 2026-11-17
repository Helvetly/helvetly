package emailtemplate

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db   *store.Store
	auth Auth
}

func New(db *store.Store, a Auth) *Service { return &Service{db: db, auth: a} }

type item struct {
	Kind      string   `json:"kind"`
	Language  string   `json:"language"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	Custom    bool     `json:"custom"`
	Default   Template `json:"default"`
	Variables []string `json:"variables"`
}

func newItem(kind, language string, own *store.EmailTemplate) item {
	def := Default(kind, language)
	it := item{Kind: kind, Language: language, Subject: def.Subject, Body: def.Body, Default: def, Variables: Variables(kind)}
	if own != nil {
		it.Subject, it.Body, it.Custom = own.Subject, own.Body, true
	}
	return it
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/email-templates", s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		own, err := s.db.EmailTemplates(r.Context(), sess.Workspace.ID)
		if err != nil {
			s.auth.WriteError(w, r, err)
			return
		}
		list := make([]item, 0, len(Kinds)*len(Languages))
		for _, kind := range Kinds {
			for _, language := range Languages {
				i := slices.IndexFunc(own, func(t store.EmailTemplate) bool { return t.Kind == kind && t.Language == language })
				if i < 0 {
					list = append(list, newItem(kind, language, nil))
				} else {
					list = append(list, newItem(kind, language, &own[i]))
				}
			}
		}
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": list})
	}))
	mux.HandleFunc("PUT /api/v1/email-templates/{kind}/{language}", s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		kind, language := r.PathValue("kind"), r.PathValue("language")
		if !known(kind, language) {
			s.auth.WriteError(w, r, auth.ErrNotFound)
			return
		}
		var body Template
		if !s.auth.Decode(w, r, &body) {
			return
		}
		body.Subject = strings.TrimSpace(body.Subject) // the body stays as typed: its line breaks are the message
		if bad := Check(kind, body); len(bad) > 0 {
			s.auth.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "Check the email text.", map[string]any{"fields": bad}))
			return
		}
		own := store.EmailTemplate{Kind: kind, Language: language, Subject: body.Subject, Body: body.Body}
		if err := s.db.SetEmailTemplate(r.Context(), sess.Workspace.ID, own, sess.User.ID, time.Now().UTC()); err != nil {
			s.auth.WriteError(w, r, err)
			return
		}
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": newItem(kind, language, &own)})
	}))
	mux.HandleFunc("DELETE /api/v1/email-templates/{kind}/{language}", s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		kind, language := r.PathValue("kind"), r.PathValue("language")
		if !known(kind, language) {
			s.auth.WriteError(w, r, auth.ErrNotFound)
			return
		}
		if err := s.db.DeleteEmailTemplate(r.Context(), sess.Workspace.ID, kind, language); err != nil {
			s.auth.WriteError(w, r, err)
			return
		}
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": newItem(kind, language, nil)})
	}))
}

func known(kind, language string) bool {
	return slices.Contains(Kinds, kind) && slices.Contains(Languages, language)
}
