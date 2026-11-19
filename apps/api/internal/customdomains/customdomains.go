// Package customdomains serves a workspace's client portal on its own host (portal.firma.ch). The workspace adds a
// CNAME to CUSTOM_DOMAIN_TARGET and a TXT record that proves it owns the domain; a job checks the DNS itself, then
// asks the domain over HTTPS, which makes the origin's Caddy get its certificate on demand (it asks domain-check
// first). internal/portalscope resolves an active domain's Host to its workspace.
package customdomains

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
	check  Checker // nil: custom domains are off on this installation
	target string  // the CNAME target, CUSTOM_DOMAIN_TARGET
	own    []string
	secret []byte // keys the ownership tokens
	scopes Scopes
	// certLimit caps domain-check per client address.
	certLimit *auth.RateLimiter
	log       *slog.Logger
	now       func() time.Time
}

// New wires the settings and the job; a nil check turns custom domains off (GET answers enabled: false). own are
// the installation's origins or hosts, never a workspace's domain.
func New(db *store.Store, a Auth, check Checker, target string, own []string, secret []byte, scopes Scopes, log *slog.Logger) *Service {
	hosts := []string{target}
	for _, o := range own {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			o = u.Hostname()
		}
		if o != "" {
			hosts = append(hosts, o)
		}
	}
	return &Service{db: db, auth: a, check: check, target: target, own: hosts, secret: secret, scopes: scopes, log: log,
		certLimit: auth.NewRateLimiter(600, time.Minute),
		now:       func() time.Time { return time.Now().UTC() }}
}

// Problems: why a domain is not active (store.WorkspaceDomain.Problem).
const (
	ProblemDNS          = "dns"          // the CNAME is missing or leads elsewhere
	ProblemVerification = "verification" // the TXT record that proves ownership is missing
	ProblemCertificate  = "certificate"  // the DNS is right but the domain does not answer over HTTPS yet
	ProblemPlan         = "plan"         // the plan no longer includes custom domains
)

const (
	// releaseAfter: a domain pending or failed this long is released, so nobody holds a name they cannot prove.
	releaseAfter = 14 * 24 * time.Hour
	// restoreFor: a deleted workspace keeps its domain while it may be restored.
	restoreFor   = 30 * 24 * time.Hour
	firstRecheck = time.Minute
	maxRecheck   = time.Hour
	daily        = 24 * time.Hour
	// manualGap: "Re-check" looks at most this often per domain.
	manualGap = 10 * time.Second
	// batch: domains one tick checks (the job runs every minute: 144 000 a day).
	batch = 100
)

// TXTPrefix names the ownership record: _helvetly-verify.<host>.
const TXTPrefix = "_helvetly-verify."

var (
	errAdminOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the portal's domain.", nil)
	errExists    = auth.Error(http.StatusConflict, "domain_exists", "This workspace already has a domain. Remove it first.", nil)
	errActive    = auth.Error(http.StatusConflict, "domain_taken", "This domain is already in use. Choose another one.", map[string]any{"fields": map[string]string{"hostname": "taken"}})
	errDNS       = auth.Error(http.StatusBadGateway, "domain_unavailable", "The domain's DNS did not answer. Try again in a minute.", nil)
	invalid      = map[string]string{
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
	mux.HandleFunc("GET /api/v1/public/portal/domain-check", s.certifiable)
}

// certifiable answers the origin's on-demand certificate question (Caddy's ask): 200 only for a domain whose
// workspace proved it owns it, 404 for any other host, so certificates are never requested for anyone else's.
func (s *Service) certifiable(w http.ResponseWriter, r *http.Request) {
	if !s.certLimit.Allow(r) {
		s.auth.WriteError(w, r, auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many requests: try again in a minute.", nil))
		return
	}
	host, problem := Normalise(r.URL.Query().Get("domain"), s.own)
	ok := false
	if problem == "" && s.check != nil {
		var err error
		if ok, err = s.db.PortalDomainCertifiable(r.Context(), host); err != nil {
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

// Record is one DNS record the workspace adds at its DNS provider.
type Record struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Token is the value of workspaceID's ownership record for host: the same whenever it is asked, so a workspace can
// prove a name before it has a row for it.
func (s *Service) Token(workspaceID, host string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("portal-domain:" + workspaceID + ":" + host))
	return "helvetly-" + hex.EncodeToString(m.Sum(nil))[:32]
}

func (s *Service) txt(workspaceID, host string) Record {
	return Record{Type: "TXT", Name: TXTPrefix + host, Value: s.Token(workspaceID, host)}
}

// records are what the workspace adds: the CNAME to the target and the ownership TXT record.
func (s *Service) records(workspaceID, host string) []Record {
	return []Record{{Type: "CNAME", Name: host, Value: s.target}, s.txt(workspaceID, host)}
}

type view struct {
	Hostname      string     `json:"hostname"`
	Status        string     `json:"status"`
	Stage         string     `json:"stage"`
	Problem       *string    `json:"problem"`
	Detail        *string    `json:"detail"`
	Records       []Record   `json:"records"`
	VerifiedAt    *time.Time `json:"verified_at"`
	LastCheckedAt *time.Time `json:"last_checked_at"`
	// ReleasesAt is when a domain that is not active is released, nil for an active one.
	ReleasesAt *time.Time `json:"releases_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Stage is what the settings show: dns (waiting for the records), certificate, active or problem.
func Stage(d store.WorkspaceDomain) string {
	switch {
	case d.Status == store.DomainActive:
		return "active"
	case d.Status == store.DomainFailed:
		return "problem"
	case d.Problem == ProblemCertificate:
		return "certificate"
	}
	return "dns"
}

func (s *Service) viewOf(d store.WorkspaceDomain) view {
	v := view{Hostname: d.Hostname, Status: d.Status, Stage: Stage(d), Records: s.records(d.WorkspaceID, d.Hostname),
		VerifiedAt: d.VerifiedAt, LastCheckedAt: d.LastCheckedAt, CreatedAt: d.CreatedAt}
	if d.Problem != "" {
		v.Problem = &d.Problem
	}
	if d.Detail != "" {
		v.Detail = &d.Detail
	}
	if d.Status != store.DomainActive {
		at := d.StatusSince.Add(releaseAfter)
		v.ReleasesAt = &at
	}
	return v
}

func (s *Service) write(w http.ResponseWriter, status int, d *store.WorkspaceDomain) {
	data := map[string]any{"enabled": s.check != nil, "target": s.target, "domain": nil}
	if d != nil {
		data["domain"] = s.viewOf(*d)
	}
	auth.WriteJSON(w, status, map[string]any{"data": data})
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if s.check == nil {
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
	case s.check == nil:
		return auth.ErrNotFound
	case sess.Role != "owner" && sess.Role != "admin":
		return errAdminOnly
	}
	return nil
}

// put adds the workspace's domain, pending until its DNS is right and it answers over HTTPS. A name another
// workspace holds without having proved it is taken over by a workspace whose TXT record is in place.
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
		NextCheckAt: now.Add(firstRecheck), StatusSince: now, CreatedBy: sess.User.ID, CreatedAt: now, UpdatedAt: now}
	actor := sess.User.ID
	added := func(q store.Q) error {
		if err := q.CreateWorkspaceDomain(ctx, d); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"hostname": host})
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "workspace.portal_domain_added",
			SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: now, Payload: payload})
	}
	err := s.db.Tx(ctx, added)
	if errors.Is(err, store.ErrDomainTaken) {
		err = s.takeOver(ctx, sess.Workspace.ID, host, now, added)
	}
	switch {
	case errors.Is(err, store.ErrDomainExists):
		return errExists
	case err != nil:
		return err
	}
	s.scopes.Forget()
	s.write(w, http.StatusCreated, &d)
	return nil
}

// takeOver gives host to workspaceID when the workspace holding it never proved it and workspaceID's TXT record is
// in place: the holder's domain is released (and told). Otherwise domain_taken, naming the record that would prove it.
func (s *Service) takeOver(ctx context.Context, workspaceID, host string, now time.Time, add func(store.Q) error) error {
	holder, err := s.db.WorkspaceDomainByHostname(ctx, host)
	if errors.Is(err, store.ErrNotFound) {
		return s.db.Tx(ctx, add) // released meanwhile
	}
	if err != nil {
		return err
	}
	if holder.VerifiedAt != nil || holder.Status == store.DomainActive {
		return errActive
	}
	rec := s.txt(workspaceID, host)
	proven, err := s.check.HasTXT(ctx, rec.Name, rec.Value)
	if err != nil {
		s.log.WarnContext(ctx, "custom domain ownership lookup", "error", err)
		return errDNS
	}
	if !proven {
		return auth.Error(http.StatusConflict, "domain_taken",
			"Another workspace has added this domain without proving it owns it. If the domain is yours, add this TXT record, then add the domain again.",
			map[string]any{"fields": map[string]string{"hostname": "taken"}, "verify": rec})
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := s.release(ctx, q, holder, "claimed", now); err != nil {
			return err
		}
		return add(q)
	})
	if errors.Is(err, store.ErrDomainTaken) {
		return errActive // another claim won the race
	}
	return err
}

// release removes a domain the workspace held without finishing it and tells its owners and admins why: "expired"
// (pending or failed for releaseAfter) or "claimed" (another workspace proved it owns it).
func (s *Service) release(ctx context.Context, q store.Q, d store.WorkspaceDomain, reason string, now time.Time) error {
	if err := q.RemoveWorkspaceDomain(ctx, d.ID, now); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{"hostname": d.Hostname, "reason": reason})
	if err := q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: d.WorkspaceID, Kind: "workspace.portal_domain_removed",
		SubjectType: "workspace", SubjectID: d.WorkspaceID, At: now, Payload: payload}); err != nil {
		return err
	}
	return notifications.Notify(ctx, q, d.WorkspaceID, "portal.domain_released",
		map[string]any{"hostname": d.Hostname, "reason": reason}, store.NotifyTo{Roles: notifications.Managers}, now)
}

// recheck looks at the domain now, for "Re-check" in the settings; at most once per manualGap.
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
			return errDNS
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
	now := s.now()
	actor := sess.User.ID
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RemoveWorkspaceDomain(ctx, d.ID, now); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"hostname": d.Hostname})
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: d.WorkspaceID, Kind: "workspace.portal_domain_removed",
			SubjectType: "workspace", SubjectID: d.WorkspaceID, ActorID: &actor, At: now, Payload: payload})
	})
	if err != nil {
		return err
	}
	s.scopes.Forget()
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Check looks at d and stores what it found. A deleted workspace's domain waits while the workspace may be restored,
// then goes; a plan without the feature turns the domain off (it comes back with the plan); a domain pending or
// failed for releaseAfter is released. Otherwise the DNS decides: the CNAME always, the TXT record until it has
// proved ownership once; then the domain must answer over HTTPS. Owners hear when it becomes active or breaks.
func (s *Service) Check(ctx context.Context, d store.WorkspaceDomain) (store.WorkspaceDomain, error) {
	now := s.now()
	if d.WorkspaceDeletedAt != nil {
		if now.Sub(*d.WorkspaceDeletedAt) < restoreFor {
			d.NextCheckAt = now.Add(daily)
			return d, s.db.SaveWorkspaceDomainCheck(ctx, d, now)
		}
		d.Status = store.DomainRemoved
		return d, s.db.RemoveWorkspaceDomain(ctx, d.ID, now)
	}
	if d.Status != store.DomainActive && now.Sub(d.StatusSince) >= releaseAfter {
		err := s.db.Tx(ctx, func(q store.Q) error { return s.release(ctx, q, d, "expired", now) })
		if err == nil {
			d.Status = store.DomainRemoved
			s.scopes.Forget()
		}
		return d, err
	}
	allowed, err := s.db.FeatureAllowed(ctx, d.WorkspaceID, store.FeatureCustomPortalDomain)
	if err != nil {
		return d, err
	}
	was := d.Status
	next := d
	next.Checks++
	next.Problem, next.Detail = "", ""
	if !allowed {
		next.Status, next.Problem = store.DomainFailed, ProblemPlan
	} else if err := s.look(ctx, &next, now); err != nil {
		// The DNS did not answer: try again later, the domain as it was.
		d.Checks++
		d.NextCheckAt = now.Add(backoff(d.Checks))
		if saveErr := s.db.SaveWorkspaceDomainCheck(ctx, d, now); saveErr != nil {
			return d, saveErr
		}
		return d, err
	}
	switch {
	case next.Status == store.DomainPending:
		next.NextCheckAt = now.Add(backoff(next.Checks))
	default:
		next.NextCheckAt = now.Add(daily)
	}
	if next.Status != was {
		next.StatusSince = now
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.SaveWorkspaceDomainCheck(ctx, next, now); err != nil {
			return err
		}
		switch {
		case was == store.DomainActive && next.Status != store.DomainActive:
			return notifications.Notify(ctx, q, d.WorkspaceID, "portal.domain_failed",
				map[string]any{"hostname": d.Hostname, "problem": next.Problem}, store.NotifyTo{Roles: notifications.Managers}, now)
		case was != store.DomainActive && next.Status == store.DomainActive:
			return notifications.Notify(ctx, q, d.WorkspaceID, "portal.domain_active",
				map[string]any{"hostname": d.Hostname}, store.NotifyTo{Roles: notifications.Managers}, now)
		}
		return nil
	})
	if err != nil {
		return d, err
	}
	if next.Status != was {
		s.scopes.Forget()
	}
	return next, nil
}

// look sets d's status and problem from its DNS and HTTPS; an error is a lookup that did not answer.
func (s *Service) look(ctx context.Context, d *store.WorkspaceDomain, now time.Time) error {
	// A domain that was active stays failed until it works again; one never active stays pending.
	broken := store.DomainPending
	if d.Status != store.DomainPending {
		broken = store.DomainFailed
	}
	points, err := s.check.PointsAt(ctx, d.Hostname, s.target)
	if err != nil {
		return err
	}
	if !points {
		d.Status, d.Problem, d.Detail = broken, ProblemDNS, "No CNAME record from "+d.Hostname+" to "+s.target+" was found."
		return nil
	}
	if d.VerifiedAt == nil {
		rec := s.txt(d.WorkspaceID, d.Hostname)
		proven, err := s.check.HasTXT(ctx, rec.Name, rec.Value)
		if err != nil {
			return err
		}
		if !proven {
			d.Status, d.Problem, d.Detail = broken, ProblemVerification, "No TXT record "+rec.Name+" with the value shown was found."
			return nil
		}
		// Stored before the HTTPS request, so the origin's certificate question (domain-check) already says yes.
		d.VerifiedAt = &now
		if err := s.db.SaveWorkspaceDomainCheck(ctx, *d, now); err != nil {
			return err
		}
	}
	if err := s.check.Serves(ctx, d.Hostname); err != nil {
		d.Status, d.Problem, d.Detail = broken, ProblemCertificate, err.Error()
		return nil
	}
	d.Status = store.DomainActive
	return nil
}

func backoff(checks int) time.Duration { return min(firstRecheck<<min(checks, 6), maxRecheck) }

// Run checks the due domains every minute until ctx ends; off without custom domains.
func (s *Service) Run(ctx context.Context) {
	if s.check == nil {
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

// Tick checks up to batch domains that are due, oldest first.
func (s *Service) Tick(ctx context.Context) {
	due, err := s.db.DueWorkspaceDomains(ctx, s.now(), batch)
	if err != nil {
		s.log.ErrorContext(ctx, "due custom domains", "error", err)
		return
	}
	for _, d := range due {
		if ctx.Err() != nil {
			return
		}
		if _, err := s.Check(ctx, d); err != nil {
			s.log.ErrorContext(ctx, "check custom domain", "domain", d.ID, "error", err)
		}
	}
}
