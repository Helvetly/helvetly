package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

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

// Guard gives an early 402 for writes that exceed a plan and makes an unsubscribed
// workspace read-only. Transactional canonical-write admission also covers jobs and races.
func (s *Service) Guard(next http.Handler) http.Handler {
	routes := http.NewServeMux()
	for pattern, limit := range guarded {
		routes.Handle(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
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
		if err == nil && PlanOf(b) == "" {
			err = errPlanRequired
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
// packs bought this month (in its time zone), none without a plan, and unlimited (-1) when billing is off.
func (s *Service) AITokens(ctx context.Context, q store.Q, workspaceID string) (int64, error) {
	if !s.enabled {
		return Unlimited, nil
	}
	b, err := q.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	plan := PlanOf(b)
	if plan == "" {
		return 0, nil
	}
	monthly := s.plans.of(plan, AITokens)
	if monthly == Unlimited {
		return Unlimited, nil
	}
	w, err := q.AdmissionWorkspace(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	bought, err := q.AITokenPacks(ctx, workspaceID, s.now().In(w.Location()).Format("2006-01"))
	return monthly + bought, err
}

// AllowResource is injected into Store's canonical writes before requests and jobs start.
func (s *Service) AllowResource(ctx context.Context, q store.Q, workspaceID, resource string, add int64) error {
	if !s.enabled {
		return nil
	}
	limit := Limit(resource)
	if !slices.Contains([]Limit{Members, Clients, Invoices, Expenses, Products, Engagements, Signatures, Storage}, limit) {
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
	plan := PlanOf(b)
	if plan == "" {
		return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, errPlanRequired)
	}
	max := s.plans.forBilling(b, limit)
	if max == Unlimited {
		return nil
	}
	now := s.now()
	u, err := q.WorkspaceUsage(ctx, workspaceID, monthStart(now, ws.Location()), now)
	if err != nil {
		return err
	}
	if fits(used(u, limit), add, max) {
		return notifyNear(ctx, q, workspaceID, plan, limit, now, monthStart(now, ws.Location()), used(u, limit)+add, max)
	}
	return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, auth.Error(http.StatusPaymentRequired, "limit_reached", limitMessage(plan, limit, max),
		map[string]any{"limit": limit, "used": used(u, limit), "max": max, "plan": plan}))
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
	plan = PlanOf(b)
	max = s.plans.forBilling(b, limit)
	if max == Unlimited {
		return plan, 0, max, true, nil
	}
	now := s.now()
	u, err := s.db.WorkspaceUsage(ctx, ws.ID, monthStart(now, ws.Location()), now)
	if err != nil {
		return "", 0, 0, false, err
	}
	return plan, used(u, limit), max, fits(used(u, limit), add, max), nil
}

func limitMessage(plan string, limit Limit, max int64) string {
	name := planNames[plan]
	switch limit {
	case Members:
		return fmt.Sprintf("The %s plan includes %d %s besides the owner. Upgrade the workspace to invite more people.", name, max, plural(max, "member", "members"))
	case Clients:
		return fmt.Sprintf("The %s plan includes %d clients. Upgrade the workspace to add more.", name, max)
	case Invoices:
		return fmt.Sprintf("The %s plan includes %d invoices a month. Upgrade the workspace to create more.", name, max)
	case Expenses:
		return fmt.Sprintf("The %s plan includes %d expenses a month. Upgrade the workspace to add more.", name, max)
	case Products:
		return fmt.Sprintf("The %s plan includes %d products and services. Upgrade the workspace or delete some to add more.", name, max)
	case Engagements:
		return fmt.Sprintf("The %s plan includes %d running %s. Upgrade the workspace to add more.", name, max, plural(max, "engagement", "engagements"))
	case Signatures:
		return fmt.Sprintf("The %s plan includes %d signature requests a month. Upgrade the workspace to send more.", name, max)
	case AITokens:
		return fmt.Sprintf("The %s plan includes %d AI tokens a month. Buy an AI token pack or upgrade the workspace to use more.", name, max)
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
	return fmt.Sprintf("%d MB", n>>20)
}
