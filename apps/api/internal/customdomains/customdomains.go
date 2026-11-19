// Package customdomains serves a workspace's client portal on its own host (portal.firma.ch) through Cloudflare for
// SaaS custom hostnames: the settings add and remove the domain, and a job follows Cloudflare until the domain is
// active, then checks it daily. internal/portalscope resolves an active domain's Host to its workspace.
package customdomains

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Scopes forgets the portal resolver's cached domains after a change.
type Scopes interface{ Forget() }

type Service struct {
	db     *store.Store
	auth   Auth
	cf     Cloudflare // nil: custom domains are off on this installation
	target string     // the CNAME target, CUSTOM_DOMAIN_TARGET
	own    []string   // the installation's own hosts, never a workspace's domain
	scopes Scopes
	// checkLimit caps domain-check per client address: the origin asks once per new host.
	checkLimit *auth.RateLimiter
	// pausedUntil: the job waits after Cloudflare's 429 (Tick runs in one goroutine).
	pausedUntil time.Time
	log         *slog.Logger
	now         func() time.Time
}

// New wires the settings and the job; a nil cf turns custom domains off (GET answers enabled: false).
func New(db *store.Store, a Auth, cf Cloudflare, target string, own []string, scopes Scopes, log *slog.Logger) *Service {
	hosts := []string{target}
	for _, o := range own { // origins (PUBLIC_URL, …) or hostnames
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			o = u.Hostname()
		}
		if o != "" {
			hosts = append(hosts, o)
		}
	}
	return &Service{db: db, auth: a, cf: cf, target: target, own: hosts, scopes: scopes, log: log,
		checkLimit: auth.NewRateLimiter(120, time.Minute),
		now:        func() time.Time { return time.Now().UTC() }}
}

// Problems: why a domain is not active (store.WorkspaceDomain.Problem).
const (
	ProblemDNS         = "dns"         // the CNAME is missing or points elsewhere
	ProblemCertificate = "certificate" // Cloudflare could not issue or keep the certificate
	ProblemBlocked     = "blocked"     // Cloudflare blocked the hostname
	ProblemTaken       = "taken"       // another Cloudflare account has the hostname
	ProblemTimeout     = "timeout"     // still pending after pendingFor
)

const (
	pendingFor   = 7 * 24 * time.Hour
	firstRecheck = time.Minute
	maxRecheck   = time.Hour
	daily        = 24 * time.Hour
	// manualGap: "Re-check" asks Cloudflare at most this often per domain.
	manualGap = 10 * time.Second
)

var (
	errAdminOnly  = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the portal's domain.", nil)
	errExists     = auth.Error(http.StatusConflict, "domain_exists", "This workspace already has a domain. Remove it first.", nil)
	errTaken      = auth.Error(http.StatusConflict, "domain_taken", "This domain is already in use. Choose another one.", map[string]any{"fields": map[string]string{"hostname": "taken"}})
	errCloudflare = auth.Error(http.StatusBadGateway, "domain_unavailable", "The domain service did not answer. Try again in a minute.", nil)
	invalid       = map[string]string{
		Invalid:  "Enter a domain such as portal.yourcompany.com.",
		Apex:     "Use a subdomain such as portal.yourcompany.com: a domain's root cannot point elsewhere by CNAME.",
		Reserved: "This domain cannot be used. Choose one of your own.",
	}
)

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h func(http.ResponseWriter, *http.Request, store.Session) error) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/workspace/portal/domain", s.get)
	handle("PUT /api/v1/workspace/portal/domain", s.put)
	handle("POST /api/v1/workspace/portal/domain/check", s.recheck)
	handle("DELETE /api/v1/workspace/portal/domain", s.delete)
	mux.HandleFunc("GET /api/v1/public/portal/domain-check", s.known)
}

// known answers the origin's on-demand certificate question (Caddy's ask): 200 for a pending or active domain, 404
// for any other host, so certificates are only ever requested for workspaces' domains.
func (s *Service) known(w http.ResponseWriter, r *http.Request) {
	if !s.checkLimit.Allow(r) {
		s.auth.WriteError(w, r, auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many requests: try again in a minute.", nil))
		return
	}
	host, problem := Normalise(r.URL.Query().Get("domain"), s.own)
	ok := false
	if problem == "" && s.cf != nil {
		var err error
		if ok, err = s.db.PortalDomainKnown(r.Context(), host); err != nil {
			s.auth.WriteError(w, r, err)
			return
		}
	}
	if !ok {
		s.auth.WriteError(w, r, auth.ErrNotFound)
		return
	}
	w.WriteHeader(http.StatusOK)
}

type view struct {
	Hostname      string               `json:"hostname"`
	Status        string               `json:"status"`
	Stage         string               `json:"stage"`
	Problem       *string              `json:"problem"`
	Detail        *string              `json:"detail"`
	Records       []store.DomainRecord `json:"records"`
	LastCheckedAt *time.Time           `json:"last_checked_at"`
	CreatedAt     time.Time            `json:"created_at"`
}

// Stage is what the settings show: dns (waiting for the CNAME), certificate, active or problem.
func Stage(d store.WorkspaceDomain) string {
	switch {
	case d.Status == store.DomainActive:
		return "active"
	case d.Status == store.DomainFailed:
		return "problem"
	case d.CloudflareStatus == "active":
		return "certificate"
	}
	return "dns"
}

func viewOf(d store.WorkspaceDomain) view {
	v := view{Hostname: d.Hostname, Status: d.Status, Stage: Stage(d), Records: d.Records, LastCheckedAt: d.LastCheckedAt, CreatedAt: d.CreatedAt}
	if d.Problem != "" {
		v.Problem = &d.Problem
	}
	if d.Detail != "" {
		v.Detail = &d.Detail
	}
	return v
}

func (s *Service) write(w http.ResponseWriter, status int, d *store.WorkspaceDomain) {
	data := map[string]any{"enabled": s.cf != nil, "target": s.target, "domain": nil}
	if d != nil {
		data["domain"] = viewOf(*d)
	}
	auth.WriteJSON(w, status, map[string]any{"data": data})
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if s.cf == nil {
		s.write(w, http.StatusOK, nil)
		return nil
	}
	d, err := s.db.WorkspaceDomainOf(r.Context(), sess.Workspace.ID)
	if errors.Is(err, store.ErrNotFound) {
		s.write(w, http.StatusOK, nil)
		return nil
	}
	if err != nil {
		return err
	}
	s.write(w, http.StatusOK, &d)
	return nil
}

func (s *Service) mayChange(sess store.Session) error {
	switch {
	case s.cf == nil:
		return auth.ErrNotFound
	case sess.Role != "owner" && sess.Role != "admin":
		return errAdminOnly
	}
	return nil
}

// put adds the workspace's domain: pending until Cloudflare has seen the CNAME and issued the certificate.
func (s *Service) put(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.mayChange(sess); err != nil {
		return err
	}
	ctx := r.Context()
	if err := s.db.RequireFeature(ctx, sess.Workspace.ID, store.FeatureCustomPortalDomain); err != nil {
		return err
	}
	var in struct {
		Hostname string `json:"hostname"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	host, problem := Normalise(in.Hostname, s.own)
	if problem != "" {
		return auth.Error(http.StatusUnprocessableEntity, "domain_"+problem, invalid[problem], map[string]any{"fields": map[string]string{"hostname": problem}})
	}
	now := s.now()
	d := store.WorkspaceDomain{ID: auth.NewID("dom"), WorkspaceID: sess.Workspace.ID, Hostname: host, Status: store.DomainPending,
		Records: s.records(host, nil), NextCheckAt: now.Add(firstRecheck), CreatedBy: sess.User.ID, CreatedAt: now, UpdatedAt: now}
	switch err := s.db.CreateWorkspaceDomain(ctx, d); {
	case errors.Is(err, store.ErrDomainExists):
		return errExists
	case errors.Is(err, store.ErrDomainTaken):
		return errTaken
	case err != nil:
		return err
	}
	h, err := s.cf.Create(ctx, host)
	if err != nil {
		// Never accepted: the row goes, so the hostname is free to try again.
		if derr := s.db.DeleteWorkspaceDomain(context.WithoutCancel(ctx), d.ID); derr != nil {
			s.log.ErrorContext(ctx, "forget a domain cloudflare refused", "domain", d.ID, "error", derr)
		}
		if errors.Is(err, ErrDuplicate) {
			return errTaken
		}
		s.log.ErrorContext(ctx, "cloudflare create custom hostname", "workspace", sess.Workspace.ID, "error", err)
		return errCloudflare
	}
	s.apply(&d, h, now)
	actor := sess.User.ID
	payload, _ := json.Marshal(map[string]string{"hostname": host})
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.SaveWorkspaceDomainCheck(ctx, d, now); err != nil {
			return err
		}
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "workspace.portal_domain_added",
			SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: now, Payload: payload})
	})
	if err != nil {
		return err
	}
	s.scopes.Forget()
	s.write(w, http.StatusCreated, &d)
	return nil
}

// recheck asks Cloudflare now, for "Re-check" in the settings; at most once per manualGap.
func (s *Service) recheck(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.mayChange(sess); err != nil {
		return err
	}
	d, err := s.db.WorkspaceDomainOf(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	if d.LastCheckedAt == nil || s.now().Sub(*d.LastCheckedAt) >= manualGap {
		if d, err = s.Check(r.Context(), d); err != nil {
			s.log.ErrorContext(r.Context(), "check custom domain", "domain", d.ID, "error", err)
			return errCloudflare
		}
	}
	if d.Status == store.DomainRemoved {
		s.write(w, http.StatusOK, nil)
		return nil
	}
	s.write(w, http.StatusOK, &d)
	return nil
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.mayChange(sess); err != nil {
		return err
	}
	ctx := r.Context()
	d, err := s.db.WorkspaceDomainOf(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	if err := s.remove(ctx, d, &sess.User.ID); err != nil {
		s.log.ErrorContext(ctx, "remove custom domain", "domain", d.ID, "error", err)
		return errCloudflare
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// remove deletes the Cloudflare hostname, then marks the domain removed; actor is nil when the job removes it.
func (s *Service) remove(ctx context.Context, d store.WorkspaceDomain, actor *string) error {
	if d.CloudflareID != nil {
		if err := s.cf.Delete(ctx, *d.CloudflareID); err != nil {
			return err
		}
	}
	now := s.now()
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RemoveWorkspaceDomain(ctx, d.ID, now); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"hostname": d.Hostname})
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: d.WorkspaceID, Kind: "workspace.portal_domain_removed",
			SubjectType: "workspace", SubjectID: d.WorkspaceID, ActorID: actor, At: now, Payload: payload})
	})
	if err == nil {
		s.scopes.Forget()
	}
	return err
}

// records are the DNS records the workspace adds: the CNAME to the target, then the TXT records Cloudflare asks for.
func (s *Service) records(host string, txt []store.DomainRecord) []store.DomainRecord {
	return append([]store.DomainRecord{{Type: "CNAME", Name: host, Value: s.target}}, txt...)
}

// classify is the domain's status and problem from what Cloudflare says.
func classify(h Hostname) (string, string) {
	switch h.Status {
	case "active":
		if h.SSL == "active" {
			return store.DomainActive, ""
		}
	case "moved":
		return store.DomainFailed, ProblemDNS
	case "blocked", "pending_blocked", "test_blocked", "test_failed":
		return store.DomainFailed, ProblemBlocked
	}
	switch h.SSL {
	case "initializing_timed_out", "validation_timed_out", "issuance_timed_out", "deployment_timed_out", "deletion_timed_out",
		"expired", "deleted", "inactive":
		return store.DomainFailed, ProblemCertificate
	}
	return store.DomainPending, ""
}

// apply takes Cloudflare's answer into d and schedules the next check.
func (s *Service) apply(d *store.WorkspaceDomain, h Hostname, now time.Time) {
	d.CloudflareID = &h.ID
	d.CloudflareStatus, d.SSLStatus = h.Status, h.SSL
	d.Status, d.Problem = classify(h)
	d.Detail = ""
	if len(h.Errors) > 0 && d.Status != store.DomainActive {
		d.Detail = h.Errors[0]
	}
	d.Records = s.records(d.Hostname, h.Records)
	d.Checks++
	switch {
	case d.Status == store.DomainPending && now.Sub(d.CreatedAt) >= pendingFor:
		d.Status, d.Problem = store.DomainFailed, ProblemTimeout
		d.NextCheckAt = now.Add(daily)
	case d.Status == store.DomainPending:
		wait := firstRecheck << min(d.Checks, 6)
		d.NextCheckAt = now.Add(min(wait, maxRecheck))
	default:
		d.NextCheckAt = now.Add(daily)
	}
}

// Check asks Cloudflare about d and stores the answer.
func (s *Service) Check(ctx context.Context, d store.WorkspaceDomain) (store.WorkspaceDomain, error) {
	return s.check(ctx, d, func() (Hostname, error) {
		if d.CloudflareID == nil {
			return Hostname{}, ErrNotFound
		}
		return s.cf.Get(ctx, *d.CloudflareID)
	})
}

// check stores what get says of d: a domain whose workspace is gone or whose plan lost the feature is removed, one
// Cloudflare lost is added again, and the owners hear when a domain becomes active or an active one breaks.
func (s *Service) check(ctx context.Context, d store.WorkspaceDomain, get func() (Hostname, error)) (store.WorkspaceDomain, error) {
	allowed := false
	if !d.WorkspaceDeleted {
		var err error
		if allowed, err = s.db.FeatureAllowed(ctx, d.WorkspaceID, store.FeatureCustomPortalDomain); err != nil {
			return d, err
		}
	}
	if !allowed {
		if err := s.remove(ctx, d, nil); err != nil {
			return d, err
		}
		d.Status = store.DomainRemoved
		return d, nil
	}
	now := s.now()
	h, err := get()
	if errors.Is(err, ErrNotFound) || err == nil && h.Status == "deleted" {
		h, err = s.cf.Create(ctx, d.Hostname)
	}
	was := d.Status
	switch {
	case errors.Is(err, ErrDuplicate):
		d.Status, d.Problem, d.Detail, d.NextCheckAt = store.DomainFailed, ProblemTaken, "", now.Add(daily)
		d.Checks++
	case err != nil:
		// Cloudflare did not answer: try again later, the domain as it was.
		d.NextCheckAt = now.Add(min(firstRecheck<<min(d.Checks, 6), maxRecheck))
		if saveErr := s.db.SaveWorkspaceDomainCheck(ctx, d, now); saveErr != nil {
			return d, saveErr
		}
		return d, err
	default:
		s.apply(&d, h, now)
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.SaveWorkspaceDomainCheck(ctx, d, now); err != nil {
			return err
		}
		switch {
		case was == store.DomainActive && d.Status != store.DomainActive:
			return notifications.Notify(ctx, q, d.WorkspaceID, "portal.domain_failed",
				map[string]any{"hostname": d.Hostname, "problem": d.Problem}, store.NotifyTo{Roles: notifications.Managers}, now)
		case was != store.DomainActive && d.Status == store.DomainActive:
			return notifications.Notify(ctx, q, d.WorkspaceID, "portal.domain_active",
				map[string]any{"hostname": d.Hostname}, store.NotifyTo{Roles: notifications.Managers}, now)
		}
		return nil
	})
	if err == nil && was != d.Status {
		s.scopes.Forget()
	}
	return d, err
}

// Run checks the due domains every minute until ctx ends; off without Cloudflare.
func (s *Service) Run(ctx context.Context) {
	if s.cf == nil {
		return
	}
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Tick(ctx)
		}
	}
}

// batch is how many pending or failed domains one tick asks about one by one: with the client's spacing, 25 s.
const batch = 50

// rateLimitPause: after a 429 Cloudflare refuses the token's calls for five minutes.
const rateLimitPause = 5 * time.Minute

// Tick checks the domains due now. Pending and failed ones are asked about one by one, a batch at a time. Active ones
// are checked together from one listing of the zone's hostnames (1000 a page, so 50 000 domains are 50 calls), all of
// them at once whenever one is due, so they stay on one daily sweep instead of a call each.
func (s *Service) Tick(ctx context.Context) {
	if s.now().Before(s.pausedUntil) {
		return
	}
	due, err := s.db.DueWorkspaceDomains(ctx, s.now(), batch)
	if err != nil {
		s.log.ErrorContext(ctx, "due custom domains", "error", err)
		return
	}
	swept := false
	for _, d := range due {
		if ctx.Err() != nil {
			return
		}
		if d.Status == store.DomainActive {
			if !swept {
				err, swept = s.sweep(ctx), true
			}
		} else {
			_, err = s.Check(ctx, d)
		}
		if errors.Is(err, ErrRateLimited) {
			s.pausedUntil = s.now().Add(rateLimitPause)
			s.log.WarnContext(ctx, "cloudflare rate limit reached: custom domain checks paused", "for", rateLimitPause)
			return
		}
		if err != nil {
			s.log.ErrorContext(ctx, "check custom domain", "domain", d.ID, "error", err)
		}
	}
}

// sweep checks every active domain against one listing of the zone's custom hostnames.
func (s *Service) sweep(ctx context.Context) error {
	active, err := s.db.ActiveWorkspaceDomains(ctx)
	if err != nil || len(active) == 0 {
		return err
	}
	listed, err := s.cf.List(ctx)
	if err != nil {
		return err
	}
	byID := make(map[string]Hostname, len(listed))
	for _, h := range listed {
		byID[h.ID] = h
	}
	for _, d := range active {
		_, err := s.check(ctx, d, func() (Hostname, error) {
			if h, ok := byID[pointerValue(d.CloudflareID)]; ok {
				return h, nil
			}
			return Hostname{}, ErrNotFound
		})
		if errors.Is(err, ErrRateLimited) || ctx.Err() != nil {
			return err
		}
		if err != nil {
			s.log.ErrorContext(ctx, "check custom domain", "domain", d.ID, "error", err)
		}
	}
	return nil
}

func pointerValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
