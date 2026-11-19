package portal

import (
	"crypto/rand"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
)

// An address with several clients picks one after its code on the shared portal (PORTAL_URL/login): verify holds
// a choice instead of a session and choose records the client. The chosen workspace's own address (its own host when
// it has a domain, and cookies are host-only) can only open a session from a ticket, and a ticket must be bound to the
// browser that chose, or a client could send the link of their own ticket to someone else and have that browser
// signed in as themselves. So the browser goes to that address first (handoff), which keeps a random state in a
// cookie of its own and sends it back to the shared portal; the choice cookie there turns the choice into a ticket
// bound to the state (ticket), and the address shows and redeems the ticket only alongside the state's cookie, after
// the person confirms whom they continue as.
const (
	choiceCookie  = "helvetly_portal_choice"
	handoffCookie = "helvetly_portal_handoff"
	choiceTTL     = 10 * time.Minute
	ticketTTL     = 5 * time.Minute
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

// choose records which of its address's clients the choice is for and answers where to go next: that workspace's
// own address, for its handoff.
func (s *Service) choose(w http.ResponseWriter, r *http.Request) {
	if err := s.chooseClient(w, r); err != nil {
		s.fail(w, r, err)
	}
}

func (s *Service) chooseClient(w http.ResponseWriter, r *http.Request) error {
	choice, err := s.openChoice(r)
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
		chosen, err := s.db.Q.ChoosePortalClient(r.Context(), choice.ID, a.ClientID, a.WorkspaceID, s.now())
		if err != nil {
			return err
		}
		if !chosen {
			return errUnauthenticated // became a ticket in a concurrent request
		}
		auth.WriteJSON(w, http.StatusOK, map[string]string{"url": address + "api/v1/public/portal/auth/handoff"})
		return nil
	}
	return auth.ErrNotFound
}

// openChoice is the open choice of the shared portal's choice cookie.
func (s *Service) openChoice(r *http.Request) (store.PortalChoice, error) {
	c, err := r.Cookie(choiceCookie)
	if err != nil || scopeWorkspace(r) != "" {
		return store.PortalChoice{}, errUnauthenticated
	}
	choice, err := s.db.Q.PortalChoiceByToken(r.Context(), hashToken(c.Value), s.now())
	if err == store.ErrNotFound {
		return choice, errUnauthenticated
	}
	return choice, err
}

// bindingCookieName keeps one handoff state per workspace, like the sessions.
func bindingCookieName(r *http.Request) string { return handoffCookie + "_" + scopeWorkspace(r) }

// handoff is a top-level navigation to a workspace's own address: it keeps a new random state in that host's cookie
// and sends the browser back to the shared portal's sign-in with the state in the fragment. Anyone may start one;
// the state is worth nothing without the choice cookie of the browser it went to.
func (s *Service) handoff(w http.ResponseWriter, r *http.Request) {
	if scopeWorkspace(r) == "" {
		s.fail(w, r, auth.ErrNotFound)
		return
	}
	if !s.publicLimit.Allow(r) {
		s.fail(w, r, errTooMany)
		return
	}
	state := rand.Text()
	http.SetCookie(w, &http.Cookie{Name: bindingCookieName(r), Value: state, Path: "/", MaxAge: int(choiceTTL.Seconds()),
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, strings.TrimSuffix(s.cfg.PortalURL, "/")+"/login/#state="+state, http.StatusFound)
}

// issue spends the shared portal's choice on a ticket bound to the handoff's state and answers the address that
// shows it, with the ticket in the fragment (never sent to a server, so in no log or Referer). It needs no CSRF
// token: a JSON body is never sent cross-site without CORS, and the ticket only reaches the browser that holds the
// choice.
func (s *Service) issue(w http.ResponseWriter, r *http.Request) {
	if err := s.issueTicket(w, r); err != nil {
		s.fail(w, r, err)
	}
}

func (s *Service) issueTicket(w http.ResponseWriter, r *http.Request) error {
	choice, err := s.openChoice(r)
	if err != nil {
		return err
	}
	var in struct {
		State string `json:"state"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if in.State == "" || choice.ClientID == "" {
		return errUnauthenticated
	}
	address, err := s.scopes.CanonicalURL(r.Context(), store.Workspace{ID: choice.WorkspaceID})
	if err != nil {
		return err
	}
	now, ticket := s.now(), rand.Text()
	issued, err := s.db.Q.IssuePortalTicket(r.Context(), choice.ID, hashToken(ticket), hashToken(in.State), now, now.Add(ticketTTL))
	if err != nil {
		return err
	}
	if !issued {
		return errUnauthenticated
	}
	http.SetCookie(w, &http.Cookie{Name: choiceCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	auth.WriteJSON(w, http.StatusOK, map[string]string{"url": address + "login/#ticket=" + ticket})
	return nil
}

// ticketAccess is the ticket of the request's body under its own workspace's scope, bound to this browser's handoff
// state, with the access it opens. redeem spends it; otherwise it is left as it is.
func (s *Service) ticketAccess(w http.ResponseWriter, r *http.Request, redeem bool) (store.PortalTicket, store.PortalAccess, bool, error) {
	var t store.PortalTicket
	if !s.publicLimit.Allow(r) {
		return t, store.PortalAccess{}, false, errTooMany
	}
	var in struct {
		Ticket string `json:"ticket"`
	}
	if !s.auth.Decode(w, r, &in) {
		return t, store.PortalAccess{}, false, nil
	}
	binding, err := r.Cookie(bindingCookieName(r))
	if in.Ticket == "" || err != nil || binding.Value == "" || scopeWorkspace(r) == "" {
		return t, store.PortalAccess{}, false, errUnauthenticated
	}
	find := s.db.Q.PeekPortalTicket
	if redeem {
		find = s.db.Q.RedeemPortalTicket
	}
	t, err = find(r.Context(), hashToken(in.Ticket), hashToken(binding.Value), scopeWorkspace(r), s.now())
	if err == store.ErrNotFound {
		return t, store.PortalAccess{}, false, errUnauthenticated
	}
	if err != nil {
		return t, store.PortalAccess{}, false, err
	}
	access, err := s.access(r, t.Email)
	if err != nil {
		return t, store.PortalAccess{}, false, err
	}
	for _, a := range access {
		if a.ClientID == t.ClientID {
			return t, a, true, nil
		}
	}
	return t, store.PortalAccess{}, false, errNoAccess
}

// peekTicket names whom a ticket signs in as, so the person confirms it before it is spent.
func (s *Service) peekTicket(w http.ResponseWriter, r *http.Request) {
	t, a, ok, err := s.ticketAccess(w, r, false)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if ok {
		auth.WriteJSON(w, http.StatusOK, map[string]string{"email": t.Email, "client_name": a.ClientName, "workspace_name": a.WorkspaceName})
	}
}

// redeem opens the session a ticket was made for, ending the session this browser had in the scope.
func (s *Service) redeem(w http.ResponseWriter, r *http.Request) {
	t, a, ok, err := s.ticketAccess(w, r, true)
	if err == nil && ok {
		http.SetCookie(w, &http.Cookie{Name: bindingCookieName(r), Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
		err = s.open(w, r, t.Email, a, s.currentSession(r))
	}
	if err != nil {
		s.fail(w, r, err)
	}
}

// currentSession is the id of the session this browser holds in the request's scope, "" for none.
func (s *Service) currentSession(r *http.Request) string {
	c, err := r.Cookie(cookieName(r))
	if err != nil {
		return ""
	}
	sess, err := s.db.Q.PortalSessionByToken(r.Context(), hashToken(c.Value), s.now())
	if err != nil || !sess.Scoped || sess.Workspace.ID != scopeWorkspace(r) {
		return ""
	}
	return sess.ID
}
