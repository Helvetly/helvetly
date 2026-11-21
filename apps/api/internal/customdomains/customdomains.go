// Package customdomains serves a workspace's client portal on its own host (portal.firma.ch) through Cloudflare for
// SaaS custom hostnames. The workspace adds a CNAME to CUSTOM_DOMAIN_TARGET and the TXT record Cloudflare names for
// the hostname; the app creates the custom hostname, follows it until Cloudflare has seen the CNAME and issued the
// certificate, and checks the TXT record itself, since Cloudflare activates a hostname on its CNAME alone (which a
// dangling record from a former customer would give anyone). internal/portalscope resolves an active domain's Host
// to its workspace.
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
	"slices"
	"sync"
	"sync/atomic"
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
	dns    Checker
	target string // the CNAME target, CUSTOM_DOMAIN_TARGET
	own    []string
	secret []byte // keys the take-over records
	scopes Scopes
	log    *slog.Logger
	now    func() time.Time
}

// New wires the settings and the job; a nil cf turns custom domains off (GET answers enabled: false). own are the
// installation's origins or hosts, never a workspace's domain.
func New(db *store.Store, a Auth, cf Cloudflare, dns Checker, target string, own []string, secret []byte, scopes Scopes, log *slog.Logger) *Service {
	hosts := []string{target}
	for _, o := range own {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			o = u.Hostname()
		}
		if o != "" {
			hosts = append(hosts, o)
		}
	}
	return &Service{db: db, auth: a, cf: cf, dns: dns, target: target, own: hosts, secret: secret, scopes: scopes, log: log,
		now: func() time.Time { return time.Now().UTC() }}
}

// Problems: why a domain is not active (store.WorkspaceDomain.Problem).
const (
	ProblemDNS          = "dns"          // Cloudflare has not seen the CNAME, or it leads elsewhere now
	ProblemVerification = "verification" // the TXT record that proves ownership is missing
	ProblemCertificate  = "certificate"  // Cloudflare has not issued the certificate (yet)
	ProblemBlocked      = "blocked"      // Cloudflare blocked the hostname
	ProblemTaken        = "taken"        // the hostname is a custom hostname of another Cloudflare account
	ProblemPlan         = "plan"         // the plan no longer includes custom domains
)

const (
	// releaseAfter: a domain pending or failed this long is released, so nobody holds a name they cannot prove. Not
	// one the plan turned off once it was proven: it comes back with the plan, for as long as the workspace exists.
	releaseAfter = 14 * 24 * time.Hour
	// restoreFor: a deleted workspace keeps its domain while it may be restored.
	restoreFor   = 30 * 24 * time.Hour
	firstRecheck = time.Minute
	maxRecheck   = time.Hour
	daily        = 24 * time.Hour
	// manualGap: "Re-check" looks at most this often per domain.
	manualGap = 10 * time.Second
	// batch: domains one tick claims, checked by workers at once. With the client's spacing of calls a tick takes
	// about batch/2 seconds: 144 000 checks a day, against 50 000 domains checked daily plus the pending ones.
	batch   = 100
	workers = 4
	// lease: a claimed domain is skipped by other instances this long, unless its check stores the next one first.
	lease = 10 * time.Minute
	// orphanGrace: the cleanup leaves custom hostnames younger than this, which a check may be about to store.
	orphanGrace = time.Hour
	// cleanupEvery: how often the zone's custom hostnames are compared with the domains; the first an hour after start.
	cleanupEvery = 24 * time.Hour
)

// TXTPrefix names the take-over record: _helvetly-verify.<host>. Cloudflare's own ownership record belongs to the
// custom hostname, which the workspace holding the name without proof shares; a workspace taking the name over proves
// it with a record of its own.
const TXTPrefix = "_helvetly-verify."

// errElsewhere: the hostname is a custom hostname on another Cloudflare account (another SaaS serves it).
var errElsewhere = errors.New("custom hostname of another cloudflare account")

var (
	errAdminOnly  = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the portal's domain.", nil)
	errExists     = auth.Error(http.StatusConflict, "domain_exists", "This workspace already has a domain. Remove it first.", nil)
	errActive     = auth.Error(http.StatusConflict, "domain_taken", "This domain is already in use. Choose another one.", map[string]any{"fields": map[string]string{"hostname": "taken"}})
	errTakenCF    = auth.Error(http.StatusConflict, "domain_elsewhere", "This domain is connected to another service on Cloudflare. Remove it there first, then add it again.", map[string]any{"fields": map[string]string{"hostname": "taken"}})
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
}

// Record is one DNS record the workspace adds at its DNS provider.
type Record struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Token is the value of workspaceID's take-over record for host: the same whenever it is asked, so a workspace can
// prove a name before it has a row for it.
func (s *Service) Token(workspaceID, host string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("portal-domain:" + workspaceID + ":" + host))
	return "helvetly-" + hex.EncodeToString(m.Sum(nil))[:32]
}

func (s *Service) txt(workspaceID, host string) Record {
	return Record{Type: "TXT", Name: TXTPrefix + host, Value: s.Token(workspaceID, host)}
}

// proof is the TXT record that proves d's workspace owns the domain: the one Cloudflare names for the custom hostname
// or, for a hostname it names none for, the workspace's own. None before Cloudflare took the hostname.
func (s *Service) proof(d store.WorkspaceDomain) (Record, bool) {
	switch {
	case d.OwnershipName != "":
		return Record{Type: "TXT", Name: d.OwnershipName, Value: d.OwnershipValue}, true
	case d.CloudflareID != nil:
		return s.txt(d.WorkspaceID, d.Hostname), true
	}
	return Record{}, false
}

// records are what the workspace adds: the CNAME to the target and the ownership TXT record.
func (s *Service) records(d store.WorkspaceDomain) []Record {
	out := []Record{{Type: "CNAME", Name: d.Hostname, Value: s.target}}
	if r, ok := s.proof(d); ok {
		out = append(out, r)
	}
	return out
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
	// ReleasesAt is when a domain that is not active is released, nil for an active one or one that is kept.
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

// kept: a proven domain the plan turned off is not released; it comes back with the plan.
func kept(d store.WorkspaceDomain) bool { return d.Problem == ProblemPlan && d.VerifiedAt != nil }

func (s *Service) viewOf(d store.WorkspaceDomain) view {
	v := view{Hostname: d.Hostname, Status: d.Status, Stage: Stage(d), Records: s.records(d),
		VerifiedAt: d.VerifiedAt, LastCheckedAt: d.LastCheckedAt, CreatedAt: d.CreatedAt}
	if d.Problem != "" {
		v.Problem = &d.Problem
	}
	if d.Detail != "" {
		v.Detail = &d.Detail
	}
	if d.Status != store.DomainActive && !kept(d) {
		at := d.StatusSince.Add(releaseAfter)
		v.ReleasesAt = &at
	}
	return v
}

func (s *Service) write(w http.ResponseWriter, status int, d *store.WorkspaceDomain) {
	data := map[string]any{"enabled": s.cf != nil, "target": s.target, "domain": nil}
	if d != nil {
		data["domain"] = s.viewOf(*d)
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

// put adds the workspace's domain: the row first, which reserves the name among workspaces, then Cloudflare's custom
// hostname. A name another workspace holds without having proved it is taken over by a workspace whose take-over
// record is in place.
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
		err = s.takeOver(ctx, &d, now, added)
	}
	switch {
	case errors.Is(err, store.ErrDomainExists):
		return errExists
	case err != nil:
		return err
	}
	s.scopes.Forget()
	if d.CloudflareID == nil {
		if err := s.attach(ctx, &d, now); err != nil {
			// Never accepted: the domain goes again, so the name is free to try later.
			if rerr := s.remove(context.WithoutCancel(ctx), d, nil); rerr != nil {
				s.log.ErrorContext(ctx, "remove a domain cloudflare refused", "domain", d.ID, "error", rerr)
			}
			if errors.Is(err, errElsewhere) {
				return errTakenCF
			}
			s.log.ErrorContext(ctx, "cloudflare custom hostname", "workspace", sess.Workspace.ID, "error", err)
			return errCloudflare
		}
	}
	s.write(w, http.StatusCreated, &d)
	return nil
}

// attach gives the new domain d its Cloudflare custom hostname and stores it; a hostname whose row could not be
// stored is deleted again. It goes on when the request ends, so no hostname is left behind half-made.
func (s *Service) attach(ctx context.Context, d *store.WorkspaceDomain, now time.Time) error {
	ctx = context.WithoutCancel(ctx)
	h, err := s.create(ctx, *d)
	if err != nil {
		return err
	}
	apply(d, h)
	saved, err := s.db.SaveWorkspaceDomainCheck(ctx, *d, d.Status, now)
	if err == nil && !saved {
		err = store.ErrNotFound // removed meanwhile
	}
	if err != nil {
		s.deleteHostname(ctx, h.ID)
	}
	return err
}

// create makes d's custom hostname. When Cloudflare already has the name, the zone's own one is d's if d held it or
// proved the name, or if no other domain ever held it (a check whose row was not stored made it); one a removed
// domain held is made afresh, since its ownership record may still be in the DNS. errElsewhere when the name is
// another account's.
func (s *Service) create(ctx context.Context, d store.WorkspaceDomain) (Hostname, error) {
	h, err := s.cf.Create(ctx, d.Hostname)
	if !errors.Is(err, ErrDuplicate) {
		return h, err
	}
	h, err = s.cf.Find(ctx, d.Hostname)
	switch {
	case errors.Is(err, ErrNotFound):
		return Hostname{}, errElsewhere
	case err != nil:
		return Hostname{}, err
	case d.CloudflareID != nil && *d.CloudflareID == h.ID || d.VerifiedAt != nil:
		return h, nil
	}
	heldBefore, err := s.db.CloudflareHostnameHeldBefore(ctx, h.ID, d.ID)
	if err != nil || !heldBefore {
		return h, err
	}
	if err := s.cf.Delete(ctx, h.ID); err != nil {
		return Hostname{}, err
	}
	h, err = s.cf.Create(ctx, d.Hostname)
	if errors.Is(err, ErrDuplicate) {
		return Hostname{}, errElsewhere
	}
	return h, err
}

// apply takes Cloudflare's answer into d.
func apply(d *store.WorkspaceDomain, h Hostname) {
	if d.CloudflareID == nil || *d.CloudflareID != h.ID {
		d.OwnershipName, d.OwnershipValue = "", "" // a new hostname has its own record
	}
	d.CloudflareID = &h.ID
	d.CloudflareStatus, d.SSLStatus = h.Status, h.SSL
	if h.OwnershipName != "" {
		d.OwnershipName, d.OwnershipValue = h.OwnershipName, h.OwnershipValue
	}
	d.Detail = ""
	if len(h.Errors) > 0 {
		d.Detail = h.Errors[0]
	}
}

// deleteHostname deletes a custom hostname nothing holds any more; one that stays is the cleanup's.
func (s *Service) deleteHostname(ctx context.Context, id string) {
	if err := s.cf.Delete(context.WithoutCancel(ctx), id); err != nil {
		s.log.WarnContext(ctx, "delete cloudflare custom hostname (the cleanup tries again)", "hostname_id", id, "error", err)
	}
}

// takeOver gives d's name to d's workspace when the workspace holding it never proved it and d's workspace's
// take-over record is in place: the holder's domain is released (and told), and d takes its custom hostname, proven.
// Otherwise domain_taken, naming the record that would prove it.
func (s *Service) takeOver(ctx context.Context, d *store.WorkspaceDomain, now time.Time, add func(store.Q) error) error {
	holder, err := s.db.WorkspaceDomainByHostname(ctx, d.Hostname, false)
	if errors.Is(err, store.ErrNotFound) {
		return s.db.Tx(ctx, add) // released meanwhile
	}
	if err != nil {
		return err
	}
	if holder.VerifiedAt != nil || holder.Status == store.DomainActive {
		return errActive
	}
	rec := s.txt(d.WorkspaceID, d.Hostname)
	proven, err := s.dns.HasTXT(ctx, rec.Name, rec.Value)
	if err != nil {
		s.log.WarnContext(ctx, "custom domain ownership lookup", "error", err)
		return auth.Error(http.StatusBadGateway, "domain_unavailable", "The domain's DNS did not answer. Try again in a minute.", nil)
	}
	if !proven {
		return auth.Error(http.StatusConflict, "domain_taken",
			"Another workspace has added this domain without proving it owns it. If the domain is yours, add this TXT record, then add the domain again.",
			map[string]any{"fields": map[string]string{"hostname": "taken"}, "verify": rec})
	}
	d.VerifiedAt = &now
	err = s.db.Tx(ctx, func(q store.Q) error {
		current, err := q.WorkspaceDomainByHostname(ctx, d.Hostname, true)
		if errors.Is(err, store.ErrNotFound) {
			return add(q)
		}
		if err != nil {
			return err
		}
		if current.ID != holder.ID || current.VerifiedAt != nil || current.Status == store.DomainActive {
			return errActive
		}
		d.CloudflareID, d.CloudflareStatus, d.SSLStatus = current.CloudflareID, current.CloudflareStatus, current.SSLStatus
		d.OwnershipName, d.OwnershipValue = current.OwnershipName, current.OwnershipValue
		if err := s.release(ctx, q, current, "claimed", now); err != nil {
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

// remove marks d removed (actor nil: the app did), then deletes its custom hostname.
func (s *Service) remove(ctx context.Context, d store.WorkspaceDomain, actor *string) error {
	now := s.now()
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RemoveWorkspaceDomain(ctx, d.ID, now); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"hostname": d.Hostname})
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: d.WorkspaceID, Kind: "workspace.portal_domain_removed",
			SubjectType: "workspace", SubjectID: d.WorkspaceID, ActorID: actor, At: now, Payload: payload})
	})
	if err != nil {
		return err
	}
	s.scopes.Forget()
	if d.CloudflareID != nil {
		s.deleteHostname(ctx, *d.CloudflareID)
	}
	return nil
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
	d, err := s.db.WorkspaceDomainOf(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	if err := s.remove(r.Context(), d, &sess.User.ID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Check looks at d and stores what it found. A deleted workspace's domain waits while the workspace may be restored,
// then goes; a plan without the feature turns the domain off (it comes back with the plan); a domain pending or
// failed for releaseAfter is released. Otherwise Cloudflare's hostname and the ownership record decide. Owners hear
// when it becomes active or breaks.
func (s *Service) Check(ctx context.Context, d store.WorkspaceDomain) (store.WorkspaceDomain, error) {
	now := s.now()
	if d.WorkspaceDeletedAt != nil {
		if now.Sub(*d.WorkspaceDeletedAt) < restoreFor {
			d.NextCheckAt = now.Add(daily)
			_, err := s.db.SaveWorkspaceDomainCheck(ctx, d, d.Status, now)
			return d, err
		}
		d.Status = store.DomainRemoved
		return d, s.remove(ctx, d, nil)
	}
	if d.Status != store.DomainActive && !kept(d) && now.Sub(d.StatusSince) >= releaseAfter {
		released := false
		err := s.db.Tx(ctx, func(q store.Q) error {
			current, err := q.WorkspaceDomainByHostname(ctx, d.Hostname, true)
			if errors.Is(err, store.ErrNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			if current.ID != d.ID || current.Status == store.DomainActive || kept(current) || now.Sub(current.StatusSince) < releaseAfter {
				return nil
			}
			d = current
			released = true
			return s.release(ctx, q, d, "expired", now)
		})
		if err != nil || !released {
			return d, err
		}
		s.scopes.Forget()
		if d.CloudflareID != nil {
			s.deleteHostname(ctx, *d.CloudflareID)
		}
		d.Status = store.DomainRemoved
		return d, nil
	}
	allowed, err := s.db.FeatureAllowed(ctx, d.WorkspaceID, store.FeatureCustomPortalDomain)
	if err != nil {
		return d, err
	}
	was := d.Status
	next := d
	next.Checks++
	next.Problem = ""
	created := false
	if !allowed {
		next.Status, next.Problem, next.Detail = store.DomainFailed, ProblemPlan, ""
	} else if created, err = s.look(ctx, &next, now); err != nil {
		// Cloudflare or the DNS did not answer: try again later, the domain as it was.
		d.Checks++
		d.NextCheckAt = now.Add(backoff(d.Checks))
		if _, saveErr := s.db.SaveWorkspaceDomainCheck(ctx, d, was, now); saveErr != nil {
			return d, saveErr
		}
		return d, err
	}
	if next.Status == store.DomainPending {
		next.NextCheckAt = now.Add(backoff(next.Checks))
	} else {
		next.NextCheckAt = now.Add(daily)
	}
	if next.Status != was {
		next.StatusSince = now
	}
	saved := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		ok, err := q.SaveWorkspaceDomainCheck(ctx, next, was, now)
		if err != nil || !ok {
			return err // another check stored its own answer, and told the owners if need be
		}
		saved = true
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
		if created {
			s.deleteHostname(ctx, *next.CloudflareID)
		}
		return d, err
	}
	if saved && next.Status != was {
		s.scopes.Forget()
	}
	return next, nil
}

// look sets d's status and problem from Cloudflare's hostname and the ownership record; created when it made the
// hostname. An error is a call that did not answer.
func (s *Service) look(ctx context.Context, d *store.WorkspaceDomain, now time.Time) (created bool, err error) {
	var h Hostname
	switch {
	case d.CloudflareID == nil:
		err = ErrNotFound
	case d.CloudflareStatus == "active" && d.SSLStatus == "active":
		h, err = s.cf.Get(ctx, *d.CloudflareID)
	default:
		// On its way: ask Cloudflare to validate again now instead of on its own growing backoff.
		h, err = s.cf.Refresh(ctx, *d.CloudflareID)
	}
	if errors.Is(err, ErrNotFound) || err == nil && h.Status == "deleted" {
		// Not made yet, or Cloudflare lost it: (again) now.
		h, err = s.create(context.WithoutCancel(ctx), *d)
		created = err == nil
	}
	broken := store.DomainPending // a domain that was active stays failed until it works again
	if d.Status != store.DomainPending {
		broken = store.DomainFailed
	}
	if errors.Is(err, errElsewhere) {
		d.Status, d.Problem, d.Detail = store.DomainFailed, ProblemTaken, ""
		return false, nil
	}
	if err != nil {
		return false, err
	}
	apply(d, h)
	if rec, ok := s.proof(*d); ok && d.VerifiedAt == nil {
		proven, err := s.dns.HasTXT(ctx, rec.Name, rec.Value)
		if err != nil {
			if created {
				s.deleteHostname(ctx, h.ID)
			}
			return false, err
		}
		if proven {
			d.VerifiedAt = &now
		}
	}
	d.Status, d.Problem = classify(h, d.VerifiedAt != nil, broken)
	if d.Status == store.DomainActive {
		d.Detail = ""
	}
	return created, nil
}

// classify is the domain's status and problem from Cloudflare's hostname and whether the ownership is proven; broken
// is the status of a domain that does not work (yet).
func classify(h Hostname, proven bool, broken string) (string, string) {
	switch h.Status {
	case "blocked", "pending_blocked", "test_blocked", "test_failed":
		return store.DomainFailed, ProblemBlocked
	case "active", "active_redeploying":
	default:
		return broken, ProblemDNS
	}
	switch {
	case !proven:
		return broken, ProblemVerification
	case h.SSL != "active":
		return broken, ProblemCertificate
	}
	return store.DomainActive, ""
}

func backoff(checks int) time.Duration { return min(firstRecheck<<min(checks, 6), maxRecheck) }

// Run checks the due domains every minute and cleans the zone up daily, until ctx ends; off without Cloudflare.
func (s *Service) Run(ctx context.Context) {
	if s.cf == nil {
		return
	}
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	cleanup := time.NewTimer(time.Hour)
	defer cleanup.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Tick(ctx)
		case <-cleanup.C:
			if err := s.Cleanup(ctx); err != nil {
				s.log.ErrorContext(ctx, "clean up cloudflare custom hostnames", "error", err)
			}
			cleanup.Reset(cleanupEvery)
		}
	}
}

// Tick claims up to batch domains that are due, oldest first, and checks them with a few workers. When Cloudflare
// starts refusing calls, the rest wait for their claim to lapse.
func (s *Service) Tick(ctx context.Context) {
	now := s.now()
	due, err := s.db.ClaimDueWorkspaceDomains(ctx, now, now.Add(lease), batch)
	if err != nil {
		s.log.ErrorContext(ctx, "due custom domains", "error", err)
		return
	}
	var limited atomic.Bool
	jobs := make(chan store.WorkspaceDomain)
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			for d := range jobs {
				_, err := s.Check(ctx, d)
				if errors.Is(err, ErrRateLimited) {
					limited.Store(true)
				}
				if err != nil {
					s.log.ErrorContext(ctx, "check custom domain", "domain", d.ID, "error", err)
				}
			}
		})
	}
	for _, d := range due {
		if ctx.Err() != nil || limited.Load() {
			break
		}
		jobs <- d
	}
	close(jobs)
	wg.Wait()
	if limited.Load() {
		s.log.WarnContext(ctx, "cloudflare rate limit reached: custom domain checks paused")
	}
}

// Cleanup deletes the zone's custom hostnames the app made that no domain holds any more: a removed domain's whose
// delete failed, or one whose row was never stored. A name no domain ever had is left alone (not the app's), and so
// is a hostname younger than orphanGrace or one a domain is still being given.
func (s *Service) Cleanup(ctx context.Context) error {
	now := s.now()
	deleted := 0
	err := s.cf.List(ctx, func(hs []Hostname) error {
		names := make([]string, len(hs))
		for i, h := range hs {
			names[i] = h.Name
		}
		known, live, err := s.db.DomainHostnamesKnown(ctx, slices.Compact(slices.Sorted(slices.Values(names))))
		if err != nil {
			return err
		}
		for _, h := range hs {
			id, held := live[h.Name]
			if !known[h.Name] || held && (id == h.ID || id == "") || now.Sub(h.CreatedAt) < orphanGrace {
				continue
			}
			if err := s.cf.Delete(ctx, h.ID); err != nil {
				return err
			}
			deleted++
		}
		return nil
	})
	if deleted > 0 {
		s.log.InfoContext(ctx, "deleted orphaned cloudflare custom hostnames", "count", deleted)
	}
	return err
}
