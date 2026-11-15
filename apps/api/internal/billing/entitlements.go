package billing

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Entitlement is a workspace's effective value of one feature or limit.
type Entitlement struct {
	store.LimitDef
	State     string     // enabled or disabled (a feature); limited, unlimited (a limit); missing: nothing new may be spent
	Value     int64      // the cap when limited, 0 granting none
	PerSeat   bool       // the plan's value grows with every paid seat (a pooled limit)
	Source    string     // where the value comes from: SourcePlan, SourceWorkspace (an operator's) or SourceNone
	ExpiresAt *time.Time // when the workspace's own value ends; nil for the plan's or one without an end
}

const (
	SourcePlan      = "plan"
	SourceWorkspace = "workspace"
	SourceNone      = "none"
)

// Rights is what a workspace may use now: one entitlement per defined key of its offer, on its plan, with its pooled
// limits grown by its paid seats.
type Rights struct {
	SelfHosted bool   // billing is off: no commercial limits, every feature, by configuration (never on an error)
	Plan       string // "" without a plan: the workspace is read-only
	OfferID    string
	Seats      int64 // the paid seats pooled limits grow by
	Trial      bool  // the workspace is in its trial: the trial's limits, for the whole trial (trialRights)
	Items      map[string]Entitlement
	Order      []string // Items' keys in the offer's order
}

var errEntitlementsUnavailable = auth.Error(http.StatusServiceUnavailable, "entitlements_unavailable",
	"This workspace's plan cannot be read right now, so nothing new can be added. Try again later.", nil)

// Includes reports whether the feature is enabled: always self-hosted, never without a plan or a value.
func (r Rights) Includes(f Feature) bool {
	return r.SelfHosted || r.Items[string(f)].State == StateEnabled
}

// Cap is the cap on a limit: Unlimited when the plan has none (and self-hosted). Without a plan the workspace is
// read-only (errPlanRequired); a key the offer has no value for refuses with entitlements_unavailable, never as
// unlimited.
func (r Rights) Cap(key Limit) (int64, error) {
	if r.SelfHosted {
		return Unlimited, nil
	}
	if r.Plan == "" {
		return 0, errPlanRequired
	}
	switch e := r.Items[string(key)]; e.State {
	case StateLimited:
		return e.Value, nil
	case StateUnlimited:
		return Unlimited, nil
	}
	return 0, errEntitlementsUnavailable
}

// capFor is Cap with Members, the people besides the owner, limited to the self-service seats less the owner (on a
// per-seat price every one of them is billed; the trial allows its own seats).
func (r Rights) capFor(l Limit) (int64, error) {
	if l != Members {
		return r.Cap(l)
	}
	if r.SelfHosted {
		return Unlimited, nil
	}
	n, err := r.Cap(MaxSeats)
	if err != nil || n == Unlimited {
		return n, err
	}
	return max(n-1, 0), nil
}

// features lists the enabled features, in the offer's order.
func (r Rights) features() []Feature {
	out := []Feature{}
	for _, key := range r.Order {
		if e := r.Items[key]; e.Kind == KindAccess && e.State == StateEnabled {
			out = append(out, Feature(key))
		}
	}
	return out
}

// Entitlements resolves what the workspace may use now, in q's transaction (call it after LockAdmission for a
// write it admits). Self-hosted when billing is off; no plan when the workspace is read-only.
func (s *Service) Entitlements(ctx context.Context, q store.Q, workspaceID string) (Rights, error) {
	if !s.enabled {
		return Rights{SelfHosted: true}, nil
	}
	b, err := q.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return Rights{}, err
	}
	return s.entitlementsOf(ctx, q, workspaceID, b)
}

// baseRights are the rights of the workspace's plan in full, for its billing b: the trial's while it lasts, else its
// plan's for its paid seats.
func (s *Service) baseRights(ctx context.Context, q store.Q, workspaceID string, b store.Billing) (Rights, error) {
	if !s.enabled {
		return Rights{SelfHosted: true}, nil
	}
	plan := PlanOf(b, s.now())
	if plan == "" {
		return Rights{}, nil
	}
	offer, err := q.WorkspaceOffer(ctx, workspaceID)
	if err != nil {
		return Rights{}, err
	}
	if b.Status == "trialing" {
		return s.trialRights(ctx, q, workspaceID, offer)
	}
	return s.rightsOn(ctx, q, workspaceID, offer, plan, paidSeats(b))
}

// entitlementsOf is Entitlements for the workspace's billing b, read already: baseRights with this month's costly
// allowances granted pro rata (allowances.go) and, while a payment is overdue, no new model cost.
func (s *Service) entitlementsOf(ctx context.Context, q store.Q, workspaceID string, b store.Billing) (Rights, error) {
	r, err := s.baseRights(ctx, q, workspaceID, b)
	if err != nil || r.Plan == "" || r.SelfHosted || r.Trial {
		return r, err
	}
	r.prorate(b, s.now())
	if b.Status == "past_due" { // a payment is overdue: no new model cost until it is paid, the rest works on in the grace
		for _, l := range []Limit{AITokens, AICost} {
			if e, ok := r.Items[string(l)]; ok {
				e.State, e.Value, e.Source = StateLimited, 0, SourcePaymentOverdue
				r.Items[string(l)] = e
			}
		}
	}
	return r, nil
}

// rightsOn resolves a workspace's rights on plan of offer with seats paid seats, in one query.
func (s *Service) rightsOn(ctx context.Context, q store.Q, workspaceID, offer, plan string, seats int64) (Rights, error) {
	if offer == "" {
		s.log.ErrorContext(ctx, "workspace has a plan but no offer", "workspace", workspaceID, "plan", plan)
		return Rights{}, errEntitlementsUnavailable
	}
	rows, err := q.ResolveLimits(ctx, workspaceID, offer, plan, s.now())
	if err != nil {
		return Rights{}, fmt.Errorf("resolving limits: %w", err)
	}
	r, err := resolve(rows, seats)
	if err != nil {
		s.log.ErrorContext(ctx, "resolving limits failed", "workspace", workspaceID, "offer", offer, "error", err)
		return Rights{}, errEntitlementsUnavailable
	}
	r.Plan, r.OfferID = plan, offer
	return r, nil
}

// paidSeats is the seats a subscription pays for: on a per-seat price its quantity, or the seats paid for the
// current period when a reduction waits for the renewal; one on an earlier flat price. A seat whose payment is pending
// is not in the quantity yet, so it grants nothing.
func paidSeats(b store.Billing) int64 {
	if !b.PerSeat || b.Seats == nil {
		return 1
	}
	n := *b.Seats
	if b.PaidSeats != nil {
		n = max(n, *b.PaidSeats)
	}
	return max(n, 1)
}

// resolve computes every entitlement: the workspace's own unexpired value replaces the whole result; otherwise the
// plan's value grows by its per-seat increment for every paid seat after the first; a key without either is missing.
// A feature whose required feature is not enabled is disabled, and such a limit is limited to 0, whatever the seats
// or the value.
func resolve(rows []store.ResolvedLimit, seats int64) (Rights, error) {
	r := Rights{Seats: max(seats, 1), Items: make(map[string]Entitlement, len(rows)), Order: make([]string, 0, len(rows))}
	for _, l := range rows {
		e := Entitlement{LimitDef: l.LimitDef, State: StateMissing, Source: SourceNone}
		if p := l.Plan; p != nil && (p.State != StateLimited || p.Value != nil) {
			e.State, e.Source, e.PerSeat = p.State, SourcePlan, p.PerSeat > 0
			if p.State == StateLimited {
				v, ok := grow(*p.Value, p.PerSeat, r.Seats)
				if !ok {
					return Rights{}, fmt.Errorf("%s: %d + %d per seat for %d seats overflows", l.Key, *p.Value, p.PerSeat, r.Seats)
				}
				e.Value = v
			}
		}
		if w := l.Workspace; w != nil && (w.State != StateLimited || w.Value != nil) {
			e.State, e.Source, e.ExpiresAt, e.Value = w.State, SourceWorkspace, w.ExpiresAt, 0
			if w.Value != nil {
				e.Value = *w.Value
			}
		}
		r.Items[l.Key] = e
		r.Order = append(r.Order, l.Key)
	}
	for changed := true; changed; { // until a feature disabled through another's dependency has disabled its own
		changed = false
		for key, e := range r.Items {
			off := slices.ContainsFunc(e.RequiresFeatures, func(f string) bool { return r.Items[f].State != StateEnabled })
			switch {
			case !off:
			case e.Kind == KindAccess && e.State != StateDisabled:
				e.State, changed = StateDisabled, true
			case e.Kind != KindAccess && (e.State != StateLimited || e.Value != 0):
				e.State, e.Value = StateLimited, 0
			default:
				continue
			}
			r.Items[key] = e
		}
	}
	return r, nil
}

// grow is base + (seats-1) × inc, false when it overflows.
func grow(base, inc, seats int64) (int64, bool) {
	extra := seats - 1
	if extra <= 0 || inc == 0 {
		return base, true
	}
	if base < 0 || inc < 0 || extra > (math.MaxInt64-base)/inc {
		return 0, false
	}
	return base + extra*inc, true
}

// SetWorkspaceOverride gives a workspace its own value of a key on its offer (the current offer when it has none
// yet), replacing the plan's whole value until w.ExpiresAt (nil: until cleared); audited, before and after, in the
// same transaction. w.Reason and actor are required.
func SetWorkspaceOverride(ctx context.Context, db *store.Store, w store.WorkspaceLimit, actor string, now time.Time) error {
	if w.Reason == "" || actor == "" {
		return errors.New("an override needs a reason and an actor")
	}
	if w.ExpiresAt != nil && !w.ExpiresAt.After(now) {
		return errors.New("an override must expire in the future")
	}
	return db.Tx(ctx, func(q store.Q) error {
		offer, def, err := overrideTarget(ctx, q, w.WorkspaceID, w.Key)
		if err != nil {
			return err
		}
		if err := validOverride(def, w.State, w.Value); err != nil {
			return err
		}
		w.OfferID, w.SetBy = offer, actor
		before, err := q.LockWorkspaceLimit(ctx, w.WorkspaceID, offer, w.Key)
		if err != nil {
			return err
		}
		if err := q.SetWorkspaceLimit(ctx, w); err != nil {
			return err
		}
		return q.AuditOffer(ctx, actor, "limit.override.set", w.WorkspaceID+"/"+offer+"/"+w.Key, auditValue(before), auditValue(&w), w.Reason)
	})
}

// ClearWorkspaceOverride drops a workspace's own value of a key on its offer, audited with the value it had.
func ClearWorkspaceOverride(ctx context.Context, db *store.Store, workspaceID, key, actor, reason string) error {
	if reason == "" || actor == "" {
		return errors.New("clearing an override needs a reason and an actor")
	}
	return db.Tx(ctx, func(q store.Q) error {
		offer, _, err := overrideTarget(ctx, q, workspaceID, key)
		if err != nil {
			return err
		}
		before, err := q.LockWorkspaceLimit(ctx, workspaceID, offer, key)
		if err != nil {
			return err
		}
		if before == nil {
			return fmt.Errorf("workspace %s has no override of %s on %s", workspaceID, key, offer)
		}
		if err := q.ClearWorkspaceLimit(ctx, workspaceID, offer, key); err != nil {
			return err
		}
		return q.AuditOffer(ctx, actor, "limit.override.clear", workspaceID+"/"+offer+"/"+key, auditValue(before), nil, reason)
	})
}

// overrideTarget is the offer an override of key for the workspace applies to, and the key's definition.
func overrideTarget(ctx context.Context, q store.Q, workspaceID, key string) (string, store.LimitDef, error) {
	if _, err := q.AdmissionWorkspace(ctx, workspaceID); err != nil {
		return "", store.LimitDef{}, fmt.Errorf("workspace %s: %w", workspaceID, err)
	}
	defs, err := q.LimitDefs(ctx)
	if err != nil {
		return "", store.LimitDef{}, err
	}
	i := slices.IndexFunc(defs, func(d store.LimitDef) bool { return d.Key == key })
	if i < 0 {
		return "", store.LimitDef{}, fmt.Errorf("unknown key %q", key)
	}
	offer, err := q.WorkspaceOffer(ctx, workspaceID)
	if err == nil && offer == "" {
		var cur store.OfferVersion
		cur, err = q.CurrentOffer(ctx)
		offer = cur.ID
	}
	return offer, defs[i], err
}

func validOverride(def store.LimitDef, state string, value *int64) error {
	switch {
	case def.Kind == KindAccess && (state == StateEnabled || state == StateDisabled) && value == nil:
	case def.Kind != KindAccess && state == StateLimited && value != nil && *value >= 0:
	case def.Kind != KindAccess && state == StateUnlimited && value == nil && def.AllowUnlimited:
	default:
		return fmt.Errorf("%s (%s) cannot be %s %v: a feature is enabled or disabled, a limit limited to 0 or more or, where allowed, unlimited",
			def.Key, def.Kind, state, valueText(value))
	}
	return nil
}

func valueText(v *int64) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(*v)
}

// auditValue is an override as offer_audit records it; nil when there is none.
func auditValue(w *store.WorkspaceLimit) any {
	if w == nil {
		return nil
	}
	return map[string]any{"state": w.State, "value": w.Value, "expires_at": w.ExpiresAt, "reason": w.Reason, "set_by": w.SetBy}
}
