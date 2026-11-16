package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

// The trial (offer.trial): the first subscription of a customer starts with Days days of the access plan's features
// (Business) for at most Seats people, with small allowances for the whole trial that neither grow with seats nor
// restart with the month. A card is required, and a customer gets one trial: the person who starts it, their email
// and their card's fingerprint are recorded as digests (trial_claims), so a new workspace does not open a second one.
// After the trial Stripe bills the chosen plan for every member; what the trial used counts in that first month.

// TrialAIDailyCap bounds the model cost of every trial together in a UTC day, in micro-USD (USD 20), so trials opened
// in bulk cannot run up the model bill.
const TrialAIDailyCap int64 = 20_000_000

// SourceTrial marks a value the trial sets; SourcePaymentOverdue one frozen while a payment is overdue.
const (
	SourceTrial          = "trial"
	SourcePaymentOverdue = "payment_overdue"
)

// offerTrial is the trial of a published offer.
func offerTrial(ctx context.Context, q store.Q, offerID string) (OfferTrial, error) {
	v, err := q.Offer(ctx, offerID)
	if err != nil {
		return OfferTrial{}, fmt.Errorf("offer %s: %w", offerID, err)
	}
	var o struct {
		Trial OfferTrial `json:"trial"`
	}
	if err := json.Unmarshal(v.Document, &o); err != nil {
		return OfferTrial{}, fmt.Errorf("offer %s: %w", offerID, err)
	}
	return o.Trial, nil
}

// trialRights are a trialing workspace's rights: the trial's access plan for one seat (nothing is pooled), its
// overrides as limits, and its seats as the most people the workspace may have. They replace an operator's values:
// the trial's limits apply after them.
func (s *Service) trialRights(ctx context.Context, q store.Q, workspaceID, offer string) (Rights, error) {
	t, err := offerTrial(ctx, q, offer)
	if err != nil {
		return Rights{}, err
	}
	if planNames[t.AccessPlan] == "" || t.Seats < 1 {
		s.log.ErrorContext(ctx, "the offer's trial has no plan or seats", "offer", offer)
		return Rights{}, errEntitlementsUnavailable
	}
	r, err := s.rightsOn(ctx, q, workspaceID, offer, t.AccessPlan, 1)
	if err != nil {
		return Rights{}, err
	}
	limits := map[string]int64{string(MaxSeats): int64(t.Seats)}
	for key, v := range t.Overrides {
		limits[key] = v
	}
	for key, v := range limits {
		if e, ok := r.Items[key]; ok {
			e.State, e.Value, e.PerSeat, e.Source, e.ExpiresAt = StateLimited, v, false, SourceTrial, nil
			r.Items[key] = e
		}
	}
	r.Trial = true
	return r, nil
}

// trialClaims are the digests that recognise who starts a trial: the person, their email (lower case, without a
// +tag) and their card's fingerprint; an empty value is left out.
func trialClaims(userID, email, card string) map[string]string {
	digest := func(kind, v string) string {
		sum := sha256.Sum256([]byte(kind + ":" + v))
		return hex.EncodeToString(sum[:])
	}
	out := map[string]string{}
	if userID != "" {
		out["user"] = digest("user", userID)
	}
	if local, domain, ok := strings.Cut(strings.ToLower(strings.TrimSpace(email)), "@"); ok && local != "" && domain != "" {
		local, _, _ = strings.Cut(local, "+")
		out["email"] = digest("email", local+"@"+domain)
	}
	if card != "" {
		out["card"] = digest("card", card)
	}
	return out
}

// trialOffered: a Checkout for the workspace starts the trial: its first subscription, a trial in the offer, no more
// people than the trial allows, and nobody recognised as having had one (the person or their email; the card is
// checked once Stripe has it).
func trialOffered(ctx context.Context, q store.Q, b store.Billing, t OfferTrial, seats int64, user store.User) (bool, error) {
	if !trialAvailable(b) || t.Days < 1 || seats > int64(t.Seats) {
		return false, nil
	}
	claimed, err := q.TrialClaimed(ctx, trialClaims(user.ID, user.Email, ""))
	return !claimed, err
}

// claimTrial records who started the trialing subscription sub and reports whether they had a trial in another
// workspace before (then it must end now).
func (s *Service) claimTrial(ctx context.Context, q store.Q, workspaceID string, sub subscription) (bool, error) {
	userID := sub.Metadata["trial_user"]
	var email string
	if userID != "" {
		u, err := q.User(ctx, userID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return false, err
		}
		email = u.Email
	}
	return q.ClaimTrial(ctx, workspaceID, trialClaims(userID, email, sub.cardFingerprint()), s.now())
}

// endTrial ends a trial a recognised customer started again: Stripe bills the chosen plan now, as agreed for the end
// of the trial.
func (s *Service) endTrial(ctx context.Context, sub subscription) error {
	s.log.WarnContext(ctx, "ending a second trial of a recognised customer", "subscription", sub.ID, "workspace", sub.Metadata["workspace_id"])
	form := url.Values{"trial_end": {"now"}, "proration_behavior": {"none"}, "expand[]": subscriptionExpand}
	if err := s.stripe.Call(ctx, http.MethodPost, "/v1/subscriptions/"+url.PathEscape(sub.ID), form, "", &sub); err != nil {
		return err
	}
	if sub.Status == "trialing" { // never loop: the next delivery tries again
		return fmt.Errorf("billing: subscription %s still trialing after ending its trial", sub.ID)
	}
	return s.apply(ctx, sub, event{})
}

// trialAI is a trialing workspace's model allowance for the month (an aimodel.Allowance counts the month): the trial's
// allowance less what earlier months of the trial used; for the cost, also no more than the day's trial budget left.
func (s *Service) trialAI(ctx context.Context, q store.Q, workspaceID string, allowance int64, cost bool) (int64, error) {
	b, err := q.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	now := s.now()
	month := store.UsagePeriodStart(now)
	if b.TrialStart != nil {
		tokens, micros, err := q.AIUsage(ctx, workspaceID, store.UsagePeriod(*b.TrialStart), store.UsagePeriod(month.AddDate(0, 0, -1)))
		if err != nil {
			return 0, err
		}
		earlier := tokens
		if cost {
			earlier = micros
		}
		allowance = max(allowance-earlier, 0)
	}
	if !cost {
		return allowance, nil
	}
	// shortcut: read outside the model call's lock, so concurrent trials can overshoot the day's budget by their
	// calls in flight (each capped at USD 0.25); a shared lock is due if trials grow to many at once.
	spent, err := q.TrialAICostSince(ctx, time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC))
	if err != nil {
		return 0, err
	}
	_, mine, err := q.AIUsage(ctx, workspaceID, store.UsagePeriod(month), store.UsagePeriod(month))
	if err != nil {
		return 0, err
	}
	return min(allowance, mine+max(TrialAIDailyCap-spent, 0)), nil
}
