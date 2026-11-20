package portal

import (
	"crypto/rand"
	"crypto/subtle"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
)

// An address with several clients picks one after its code on the shared portal (PORTAL_URL/login): verify holds
// a choice instead of a session, choose turns it into a one-time ticket, and the chosen workspace's own portal
// address redeems the ticket for its own scoped session (cookies are host-only; the address may be its own domain).
const (
	choiceCookie = "helvetly_portal_choice"
	choiceTTL    = 10 * time.Minute
	ticketTTL    = 2 * time.Minute
)

// account is one client the chooser offers, with its supplier's name and logo.
type account struct {
	ClientID      string  `json:"client_id"`
	ClientName    string  `json:"client_name"`
	WorkspaceName string  `json:"workspace_name"`
	LogoURL       *string `json:"logo_url"`
}

// offerChoice answers verify for an address with several clients: the accounts and the choice's CSRF token, with a
// cookie that opens nothing but the choice.
func (s *Service) offerChoice(w http.ResponseWriter, r *http.Request, email string, access []store.PortalAccess) error {
	accounts := make([]account, 0, len(access))
	for _, a := range access {
		var logo *string
		if a.WorkspaceLogoFileID != nil {
			slug, err := s.scopes.Slug(r.Context(), store.Workspace{ID: a.WorkspaceID, Name: a.WorkspaceName})
			if err != nil {
				return err
			}
			u := portalscope.Prefix(slug) + "/api/v1/public/portal/scope/logo?v=" + *a.WorkspaceLogoFileID
			logo = &u
		}
		accounts = append(accounts, account{a.ClientID, a.ClientName, a.WorkspaceName, logo})
	}
	now := s.now()
	token, csrf, expires := rand.Text(), rand.Text(), now.Add(choiceTTL)
	if err := s.db.Q.CreatePortalChoice(r.Context(), auth.NewID("pch"), hashToken(token), csrf, email, now, expires); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: choiceCookie, Value: token, Path: "/", Expires: expires,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	auth.WriteJSON(w, http.StatusOK, map[string]any{"csrf_token": csrf, "accounts": accounts})
	return nil
}

// choose spends the choice on one of its address's clients and answers where to go: that workspace's portal
// address with a one-time ticket in the fragment (never sent to a server, so in no log or Referer).
func (s *Service) choose(w http.ResponseWriter, r *http.Request) {
	if err := s.chooseClient(w, r); err != nil {
		s.fail(w, r, err)
	}
}

func (s *Service) chooseClient(w http.ResponseWriter, r *http.Request) error {
	c, err := r.Cookie(choiceCookie)
	if err != nil || scopeWorkspace(r) != "" {
		return errUnauthenticated
	}
	choice, err := s.db.Q.PortalChoiceByToken(r.Context(), hashToken(c.Value), s.now())
	if err == store.ErrNotFound {
		return errUnauthenticated
	}
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get(csrfHeader)), []byte(choice.CSRFToken)) != 1 {
		return errCSRF
	}
	var in struct {
		ClientID string `json:"client_id"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	access, err := s.access(r, choice.Email)
	if err != nil {
		return err
	}
	for _, a := range access {
		if a.ClientID != in.ClientID {
			continue
		}
		address, err := s.scopes.CanonicalURL(r.Context(), store.Workspace{ID: a.WorkspaceID, Name: a.WorkspaceName})
		if err != nil {
			return err
		}
		now, ticket := s.now(), rand.Text()
		chosen, err := s.db.Q.ChoosePortalClient(r.Context(), choice.ID, hashToken(ticket), a.ClientID, a.WorkspaceID, now, now.Add(ticketTTL))
		if err != nil {
			return err
		}
		if !chosen {
			return errUnauthenticated // spent by a concurrent choose
		}
		http.SetCookie(w, &http.Cookie{Name: choiceCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
		auth.WriteJSON(w, http.StatusOK, map[string]string{"url": address + "login/#ticket=" + ticket})
		return nil
	}
	return auth.ErrNotFound
}

// redeem opens the session a ticket was made for, only under that workspace's own scope.
func (s *Service) redeem(w http.ResponseWriter, r *http.Request) {
	if err := s.redeemTicket(w, r); err != nil {
		s.fail(w, r, err)
	}
}

func (s *Service) redeemTicket(w http.ResponseWriter, r *http.Request) error {
	if !s.publicLimit.Allow(r) {
		return errTooMany
	}
	var in struct {
		Ticket string `json:"ticket"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if in.Ticket == "" {
		return errUnauthenticated
	}
	// Spent whatever happens next: a ticket shown anywhere but its workspace's scope is not tried again.
	t, err := s.db.Q.RedeemPortalTicket(r.Context(), hashToken(in.Ticket), s.now())
	if err == store.ErrNotFound || err == nil && t.WorkspaceID != scopeWorkspace(r) {
		return errUnauthenticated
	}
	if err != nil {
		return err
	}
	access, err := s.access(r, t.Email)
	if err != nil {
		return err
	}
	for _, a := range access {
		if a.ClientID == t.ClientID {
			return s.open(w, r, t.Email, a, "")
		}
	}
	return errNoAccess
}
