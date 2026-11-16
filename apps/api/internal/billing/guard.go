package billing

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// guarded lists writes that receive an early quota check. Canonical writes enforce
// the same quota in their transaction; uploads admit exact new stored bytes after hashing.
var guarded = map[string]Limit{
	"POST /api/v1/members/invitations":     Members,
	"POST /api/v1/clients":                 Clients,
	"POST /api/v1/clients/{id}/files":      Storage,
	"POST /api/v1/invoices":                Invoices,
	"POST /api/v1/invoices/{id}/duplicate": Invoices,
	"POST /api/v1/expenses":                Expenses,
	"POST /api/v1/expenses/{id}/duplicate": Expenses,
	"POST /api/v1/products":                Products,
	"POST /api/v1/products/{id}/duplicate": Products,
	"POST /api/v1/engagements":             Engagements,
	"POST /api/v1/engagements/{id}/renew":  Engagements,
	"POST /api/v1/engagements/{id}/resume": Engagements,
	"POST /api/v1/signatures":              Signatures,
	"POST /api/v1/documents":               Storage,
	"POST /api/v1/documents/{id}/copy":     Storage,
	"POST /api/v1/expenses/{id}/receipts":  Storage,
}

// gated lists the routes that need a plan feature (features.go): what adds to, configures or generates from a
// module. Reading what a workspace has, and removing it, stays in every plan, so a downgrade never locks data away.
// The canonical writes, imports, Heidi and the jobs check the same features themselves (store.RequireFeature).
var gated = map[string]Feature{
	"POST /api/v1/account/tokens": APIAccess,

	"POST /api/v1/heidi/chat":         store.FeatureHeidi,
	"POST /api/v1/heidi/chat/confirm": store.FeatureHeidi,
	"GET /api/v1/heidi/suggestions":   store.FeatureHeidi,

	"POST /api/v1/templates":                store.FeatureDocumentTemplates,
	"PUT /api/v1/templates/{id}":            store.FeatureDocumentTemplates,
	"POST /api/v1/templates/{id}/documents": store.FeatureDocumentTemplates,

	"POST /api/v1/signatures": store.FeatureSimpleSignatures,

	"GET /api/v1/vat-return":          store.FeatureVATReturns,
	"PUT /api/v1/vat-return/settings": store.FeatureVATReturns,

	"POST /api/v1/invoices/{id}/correct":     store.FeatureInvoiceCorrections,
	"POST /api/v1/invoices/{id}/credit-note": store.FeatureInvoiceCorrections,
	"POST /api/v1/invoices/{id}/debit-note":  store.FeatureInvoiceCorrections,
	"POST /api/v1/invoices/{id}/void":        store.FeatureInvoiceCorrections,

	"POST /api/v1/expenses":                 store.FeatureExpenses,
	"PATCH /api/v1/expenses/{id}":           store.FeatureExpenses,
	"POST /api/v1/expenses/{id}/duplicate":  store.FeatureExpenses,
	"POST /api/v1/expenses/{id}/receipts":   store.FeatureExpenses,
	"POST /api/v1/expenses/{id}/book":       store.FeatureExpenses,
	"POST /api/v1/expenses/preview":         store.FeatureExpenses,
	"POST /api/v1/expense-categories":       store.FeatureExpenses,
	"PATCH /api/v1/expense-categories/{id}": store.FeatureExpenses,

	"GET /api/v1/ledger":                 store.FeatureLedgerExports,
	"GET /api/v1/ledger/journal":         store.FeatureLedgerExports,
	"GET /api/v1/ledger/accounts/{code}": store.FeatureLedgerExports,
	"GET /api/v1/ledger/export":          store.FeatureLedgerExports,
	"PUT /api/v1/ledger/settings":        store.FeatureLedgerExports,

	"GET /api/v1/workspace/export":                store.FeatureDataExport,
	"GET /api/v1/clients/export":                  store.FeatureDataExport,
	"GET /api/v1/products/export":                 store.FeatureDataExport,
	"GET /api/v1/invoices/export":                 store.FeatureDataExport,
	"GET /api/v1/expenses/export":                 store.FeatureDataExport,
	"GET /api/v1/engagements/export":              store.FeatureDataExport,
	"GET /api/v1/engagements/{id}/entries/export": store.FeatureDataExport,
	"GET /api/v1/audit-log/export":                store.FeatureDataExport,

	"POST /api/v1/invoices/{id}/dunning/send":   store.FeatureInvoiceReminders,
	"POST /api/v1/invoices/{id}/dunning/resume": store.FeatureInvoiceReminders,
	"POST /api/v1/invoices/{id}/plan":           store.FeatureInvoiceInstalments,
	"POST /api/v1/instalment-plans/{id}/resume": store.FeatureInvoiceInstalments,

	"GET /api/v1/invoices/{id}/einvoice":                   store.FeatureEInvoiceXML,
	"POST /api/v1/invoices/{id}/transmissions":             store.FeatureEInvoiceXML,
	"POST /api/v1/invoices/{id}/transmissions/{tid}/retry": store.FeatureEInvoiceXML,
	"PUT /api/v1/transmission-channels/{name}/credentials": store.FeatureEInvoiceXML,

	"POST /api/v1/clients/{id}/portal-invitation": store.FeatureClientPortal,
	"POST /api/v1/documents/{id}/shares":          store.FeatureClientPortal, // a share shows the document in the portal
}

// Guard gives an early answer for writes that exceed a plan or need a feature it lacks, and makes an unsubscribed
// workspace read-only. Transactional canonical-write admission also covers jobs and races.
func (s *Service) Guard(next http.Handler) http.Handler {
	routes := http.NewServeMux()
	patterns := slices.Collect(maps.Keys(guarded))
	for p := range gated {
		if _, ok := guarded[p]; !ok {
			patterns = append(patterns, p)
		}
	}
	for _, pattern := range patterns {
		limited := s.limit(next, pattern)
		feature, ok := gated[pattern]
		if !ok {
			routes.Handle(pattern, limited)
			continue
		}
		routes.Handle(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := s.Require(r.Context(), s.db.Q, sess.Workspace.ID, feature); err != nil {
				s.writeError(w, r, err)
				return
			}
			limited.ServeHTTP(w, r)
		}))
	}
	limited := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := routes.Handler(r); pattern != "" {
			routes.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
	// A workspace without a live subscription is read-only: every change but the exempt routes answers 402.
	needsPlan := s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		b, err := s.db.WorkspaceBilling(r.Context(), sess.Workspace.ID)
		if err == nil && PlanOf(b, s.now()) == "" {
			err = errPlanRequired
			if lapsed(b, s.now()) {
				err = errPaymentOverdue
			}
		}
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		limited.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case !s.enabled:
			next.ServeHTTP(w, r)
		case readOnlyWithoutPlan(r):
			needsPlan(w, r)
		default:
			limited.ServeHTTP(w, r)
		}
	})
}

// planFree: what a workspace without a plan can still do. Besides signing in, switching and billing itself, the
// workspace's own settings and delete, workspaces, public pages, the account, accepting an invitation and marking
// notifications read, and feedback to the Helvetly team (none changes this workspace's data, and a locked workspace
// must not trap a person).
var planFree = []string{"/api/v1/auth/", "/api/v1/session", "/api/v1/billing/", "/api/v1/workspaces", "/api/v1/public/",
	"/api/v1/account/", "/api/v1/invitations/", "/api/v1/notifications/", "/api/v1/feedback"}

// readOnlyWithoutPlan: a change to the workspace's data, which needs a plan.
func readOnlyWithoutPlan(r *http.Request) bool {
	p := r.URL.Path
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions || !strings.HasPrefix(p, "/api/v1/") {
		return false
	}
	if p == "/api/v1/workspace" {
		return r.Method != http.MethodPatch && r.Method != http.MethodDelete
	}
	if p == "/api/v1/account" {
		return false
	}
	return !slices.ContainsFunc(planFree, func(prefix string) bool { return strings.HasPrefix(p, prefix) })
}

// AllowStorage checks exact new bytes inside the upload transaction. Existing hashes add zero bytes.
func (s *Service) AllowStorage(ctx context.Context, q store.Q, sess store.Session, add int64) error {
	return s.AllowResource(ctx, q, sess.Workspace.ID, string(Storage), add)
}

// AITokens is the workspace's monthly model token allowance (an aimodel.Allowance): its plan's plus the AI token
// packs bought this quota month (UTC), none without a plan, and unlimited (-1) when billing is off.
func (s *Service) AITokens(ctx context.Context, q store.Q, workspaceID string) (int64, error) {
	r, err := s.Entitlements(ctx, q, workspaceID)
	if err != nil || r.SelfHosted {
		return Unlimited, err
	}
	if r.Plan == "" {
		return 0, nil
	}
	monthly, err := r.Cap(AITokens)
	if err != nil || monthly == Unlimited {
		return monthly, err
	}
	if r.Trial {
		return s.trialAI(ctx, q, workspaceID, monthly, false)
	}
	if r.Items[string(AITokens)].Source == SourcePaymentOverdue {
		return 0, nil // packs bought before wait with the rest until the payment is made
	}
	bought, err := q.AITokenPacks(ctx, workspaceID, store.UsagePeriod(s.now()))
	return monthly + bought, err
}

// AICost is the workspace's monthly model cost guard in micro-USD (an aimodel.Allowance): its offer's
// ai_cost_usd_micros, pooled by paid seats (the trial's, within the day's trial budget); none without a plan or while a
// payment is overdue, unlimited (-1) when billing is off. AI token packs
// add tokens, not cost: a pack's tokens are spent only while this budget lasts.
func (s *Service) AICost(ctx context.Context, q store.Q, workspaceID string) (int64, error) {
	r, err := s.Entitlements(ctx, q, workspaceID)
	if err != nil || r.SelfHosted {
		return Unlimited, err
	}
	if r.Plan == "" {
		return 0, nil
	}
	cost, err := r.Cap(AICost)
	if err != nil || !r.Trial {
		return cost, err
	}
	return s.trialAI(ctx, q, workspaceID, cost, true)
}

// AllowResource is injected into Store's canonical writes before requests and jobs start.
func (s *Service) AllowResource(ctx context.Context, q store.Q, workspaceID, resource string, add int64) error {
	if !s.enabled {
		return nil
	}
	limit := Limit(resource)
	if !slices.Contains([]Limit{Members, Clients, Invoices, Quotes, Expenses, Products, Engagements, Signatures, Storage, InvoiceDrafts, QuotesRetained,
		AutomationActions, Downloads, Emails, EmailAttachments}, limit) {
		return fmt.Errorf("unknown quota resource %q", resource)
	}
	if add < 0 {
		return fmt.Errorf("quota addition cannot be negative")
	}
	if err := q.LockAdmission(ctx, workspaceID, resource); err != nil {
		return err
	}
	ws, err := q.AdmissionWorkspace(ctx, workspaceID)
	if err != nil {
		return err
	}
	b, err := q.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return err
	}
	r, err := s.entitlementsOf(ctx, q, workspaceID, b)
	if err != nil {
		return err
	}
	if r.Plan == "" {
		return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, errPlanRequired)
	}
	if err := s.requiredFeatures(ctx, q, r, limit); err != nil {
		return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, err)
	}
	plan := r.Plan
	max, err := r.capFor(limit)
	if err != nil {
		return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, err)
	}
	if max == Unlimited {
		return nil
	}
	now := s.now()
	n, err := usedAt(ctx, q, ws, b, limit, now)
	if err != nil {
		return err
	}
	if fits(n, add, max) {
		return notifyNear(ctx, q, workspaceID, plan, limit, now, store.UsagePeriod(quotaStart(b, now)), n+add, max)
	}
	s.noteRefused(workspaceID, limit, add)
	return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, auth.Error(http.StatusPaymentRequired, "limit_reached", limitMessage(plan, limit, max),
		map[string]any{"limit": limit, "used": n, "max": max, "plan": plan}))
}

// usedAt is the workspace's usage of limit: a monthly limit's recorded in usage_events from its first quota month
// (quotaStart) through the month being admitted (AdmissionPeriod); a state limit's, what exists at now.
func usedAt(ctx context.Context, q store.Q, ws store.Workspace, b store.Billing, limit Limit, now time.Time) (int64, error) {
	if monthlyLimits[limit] && limit != AITokens { // AI tokens are reserved by aimodel.Budget in heidi_usage
		u, err := q.UsageInPeriods(ctx, ws.ID, string(limit), store.UsagePeriod(quotaStart(b, now)), q.AdmissionPeriod(now))
		return u.Total(), err
	}
	u, err := q.WorkspaceUsage(ctx, ws, store.UsagePeriod(quotaStart(b, now)), now)
	return used(u, limit), err
}

// requiredFeatures refuses a limit whose feature the plan does not include with feature_not_in_plan, never as a
// spent allowance: Basic's zero expenses are a missing module, not a used-up month.
func (s *Service) requiredFeatures(ctx context.Context, q store.Q, r Rights, limit Limit) error {
	for _, f := range r.Items[string(limit)].RequiresFeatures {
		if err := s.requireIn(ctx, q, r, Feature(f)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) check(r *http.Request, sess store.Session, limit Limit, add int64) error {
	plan, n, max, ok, err := s.room(r.Context(), sess.Workspace, limit, add)
	if err != nil || ok {
		return err
	}
	return auth.Error(http.StatusPaymentRequired, "limit_reached", limitMessage(plan, limit, max),
		map[string]any{"limit": limit, "used": n, "max": max, "plan": plan})
}

// InvoiceAllowed reports whether the workspace's plan lets it create one more invoice this month: never without a
// plan (the workspace is read-only), always without billing. For the jobs that create invoices outside the guarded
// routes.
func (s *Service) InvoiceAllowed(ctx context.Context, ws store.Workspace) (bool, error) {
	if !s.enabled {
		return true, nil
	}
	plan, _, _, ok, err := s.room(ctx, ws, Invoices, 1)
	return ok && plan != "", err
}

// room: whether adding add keeps ws within its plan's limit, with the plan, the usage and the cap.
func (s *Service) room(ctx context.Context, ws store.Workspace, limit Limit, add int64) (plan string, n, max int64, ok bool, err error) {
	b, err := s.db.WorkspaceBilling(ctx, ws.ID)
	if err != nil {
		return "", 0, 0, false, err
	}
	r, err := s.entitlementsOf(ctx, s.db.Q, ws.ID, b)
	if err != nil {
		return "", 0, 0, false, err
	}
	if r.Plan == "" { // read-only: the plan guard refuses the change, not a limit
		return "", 0, Unlimited, true, nil
	}
	if err := s.requiredFeatures(ctx, s.db.Q, r, limit); err != nil {
		return "", 0, 0, false, err
	}
	if max, err = r.capFor(limit); err != nil || max == Unlimited {
		return r.Plan, 0, max, err == nil, err
	}
	n, err = usedAt(ctx, s.db.Q, ws, b, limit, s.now())
	if err != nil {
		return "", 0, 0, false, err
	}
	return r.Plan, n, max, fits(n, add, max), nil
}

func limitMessage(plan string, limit Limit, max int64) string {
	name := planNames[plan]
	switch limit {
	case Members:
		return fmt.Sprintf("The %s plan includes %d %s besides the owner. Upgrade the workspace to invite more people.", name, max, plural(max, "member", "members"))
	case Clients:
		return fmt.Sprintf("The %s plan includes %d clients. Upgrade the workspace to add more.", name, max)
	case Invoices:
		return fmt.Sprintf("The %s plan includes %d issued invoices a month. The draft is kept: upgrade the workspace to issue it now, or issue it next month.", name, max)
	case Quotes:
		return fmt.Sprintf("The %s plan includes %d sent quotes a month. The draft is kept: upgrade the workspace to send it now, or send it next month.", name, max)
	case InvoiceDrafts:
		return fmt.Sprintf("The %s plan keeps %d invoice drafts at a time. Issue or delete drafts to start more.", name, max)
	case QuotesRetained:
		return fmt.Sprintf("The %s plan keeps %d quotes. Upgrade the workspace or delete draft quotes to add more.", name, max)
	case Expenses:
		return fmt.Sprintf("The %s plan includes %d expenses a month. Upgrade the workspace to add more.", name, max)
	case Products:
		return fmt.Sprintf("The %s plan includes %d products and services. Upgrade the workspace or delete some to add more.", name, max)
	case Engagements:
		return fmt.Sprintf("The %s plan includes %d running %s. Upgrade the workspace to add more.", name, max, plural(max, "engagement", "engagements"))
	case Signatures:
		return fmt.Sprintf("The %s plan includes %d signature requests a month. Upgrade the workspace to send more.", name, max)
	case AITokens:
		return fmt.Sprintf("The %s plan includes %d AI tokens a month. Upgrade the workspace or add people to use more.", name, max)
	case Downloads:
		return fmt.Sprintf("The %s plan includes %s of downloads a month, all used this month. Downloads start again on the 1st (UTC); upgrade the workspace or add people for more now.", name, bytesText(max))
	case Emails:
		return fmt.Sprintf("The %s plan includes %d business email recipients a month. Download the PDF to send it yourself, or upgrade the workspace or add people to send more.", name, max)
	case EmailAttachments:
		return fmt.Sprintf("The %s plan includes %s of email attachments a month (each recipient counts). Download the PDF to send it yourself, or upgrade the workspace or add people to send more.", name, bytesText(max))
	}
	return fmt.Sprintf("The %s plan includes %s of storage. Upgrade the workspace or remove files to upload more.", name, bytesText(max))
}

func plural(n int64, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func bytesText(n int64) string {
	if n >= gb {
		return fmt.Sprintf("%g GB", float64(n)/gb)
	}
	return fmt.Sprintf("%d MB", n/1_000_000)
}

// limit is the early quota check of a guarded route, next itself for a route without a quota.
func (s *Service) limit(next http.Handler, pattern string) http.Handler {
	limit, ok := guarded[pattern]
	if !ok {
		return next
	}
	return s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		if limit == Invoices {
			// The canonical write knows the document kind: legal corrections stay available at the cap.
			next.ServeHTTP(w, r)
			return
		}
		add := int64(1)
		if limit == Storage {
			if strings.HasSuffix(r.URL.Path, "/copy") {
				doc, err := s.db.Document(r.Context(), sess.Workspace.ID, r.PathValue("id"))
				if err != nil {
					if errors.Is(err, store.ErrNotFound) {
						err = auth.ErrNotFound
					}
					s.writeError(w, r, err)
					return
				}
				add = doc.Size
			} else {
				if r.ContentLength < 0 {
					s.writeError(w, r, auth.Error(http.StatusLengthRequired, "length_required", "Uploads require a Content-Length header.", nil))
					return
				}
				// The handler hashes first and admits exact new stored bytes in its transaction.
				// Multipart framing and an idempotent reuse must not consume storage quota.
				next.ServeHTTP(w, r)
				return
			}
		}
		if err := s.check(r, sess, limit, add); err != nil {
			s.writeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}
