// Package permissions is the members' scopes (docs/members-contract.md, "Permission scopes"): which scope a
// request needs, whether a membership has it, and the guard that refuses it before the handler runs.
package permissions

import (
	"fmt"
	"net/http"
	"path"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

const maxScopes = 30

var (
	actions   = []string{"read", "write", "*"}
	resources = []string{"clients", "invoices", "expenses", "products", "documents", "engagements", "members",
		"settings", "billing", "*", "employees", "payroll"}
	// hr are the HR resources (docs/planning/2026-11-15-employees.md): employees (records and their documents) and
	// payroll (pay terms, the register, its approval, export and bookings). A "*" resource never reaches them; only an
	// owner holds them without a grant, and only an owner changes them.
	hr = []string{"employees", "payroll"}
	// AdminHR is what an admin holds of HR until the owner sets otherwise: the Accountant level, the payroll register
	// to view, no personnel records and no sealed fields (Art. 328b OR: only what the job needs).
	AdminHR = []string{"read:payroll"}
	ownerHR = []string{"write:employees", "write:payroll"}
)

// EffectiveHR is the HR scopes a membership holds, sorted: every one for an owner, an admin's own list or AdminHR
// when the owner never set one (nil), a member's HR scopes.
func EffectiveHR(role string, scopes []string) []string {
	switch {
	case role == "owner":
		return ownerHR
	case role == "admin" && scopes == nil:
		return AdminHR
	}
	return HRScopes(scopes)
}

// IsHR reports whether scope ("<action>:<resource>") names an HR resource.
func IsHR(scope string) bool {
	_, resource, _ := strings.Cut(scope, ":")
	return slices.Contains(hr, resource)
}

// HRScopes is the HR part of a scope list, sorted, so two lists can be compared.
func HRScopes(scopes []string) []string {
	out := []string{}
	for _, s := range scopes {
		if IsHR(s) {
			out = append(out, s)
		}
	}
	slices.Sort(out)
	return out
}

// Validate checks a member's scope list: non-empty, at most 30, no duplicates, each "<action>:<resource>".
func Validate(scopes []string) error {
	if len(scopes) == 0 || len(scopes) > maxScopes {
		return fmt.Errorf("a member needs 1 to %d scopes", maxScopes)
	}
	for i, s := range scopes {
		action, resource, ok := strings.Cut(s, ":")
		if !ok || !slices.Contains(actions, action) || !slices.Contains(resources, resource) {
			return fmt.Errorf("invalid scope %q", s)
		}
		if slices.Contains(scopes[:i], s) {
			return fmt.Errorf("duplicate scope %q", s)
		}
	}
	return nil
}

// Allows reports whether the membership grants need ("<action>:<resource>"). Owners have every scope, admins every
// scope but the HR ones, which they hold as EffectiveHR; a member holds an HR scope only when named (a "*" resource
// does not reach them); write implies read.
func Allows(role string, scopes []string, need string) bool {
	isHR := IsHR(need)
	switch {
	case role == "owner", role == "admin" && !isHR:
		return true
	case role == "admin":
		scopes = EffectiveHR(role, scopes)
	}
	action, resource, _ := strings.Cut(need, ":")
	for _, s := range scopes {
		a, r, _ := strings.Cut(s, ":")
		if (r == resource || r == "*" && !isHR) && (a == "*" || a == action || a == "write" && action == "read") {
			return true
		}
	}
	return false
}

// AllowsAny is Allows for one of the alternatives in need ("read:employees|read:payroll").
func AllowsAny(role string, scopes []string, need string) bool {
	return slices.ContainsFunc(strings.Split(need, "|"), func(s string) bool { return Allows(role, scopes, s) })
}

// prefixes maps each guarded path (and everything below it) to its resource. Unlisted paths (auth, session,
// account, invitations preview/accept, public signing, creating a new workspace, a person's own notifications)
// are not scope-checked.
// Dashboard, Heidi and imports instead check permissions for each included resource, requested action or kind.
var prefixes = []struct{ path, resource string }{
	{"/api/v1/clients", "clients"},
	{"/api/v1/invoices", "invoices"},
	{"/api/v1/invoice-settings", "settings"},
	{"/api/v1/instalment-plans", "invoices"},
	{"/api/v1/quotes", "invoices"},
	{"/api/v1/periods", "settings"},
	{"/api/v1/audit-log", "settings"},
	{"/api/v1/vat-return", "settings"},
	{"/api/v1/ledger", "settings"},
	{"/api/v1/transmission-channels", "settings"},
	{"/api/v1/expenses", "expenses"},
	{"/api/v1/expense-categories", "expenses"},
	{"/api/v1/products", "products"},
	{"/api/v1/documents", "documents"},
	{"/api/v1/signatures", "documents"},
	{"/api/v1/templates", "documents"},
	{"/api/v1/engagements", "engagements"},
	{"/api/v1/engagement-settings", "settings"},
	{"/api/v1/members", "members"},
	{"/api/v1/workspace", "settings"},
	{"/api/v1/billing", "billing"},
	{"/api/v1/employees", "employees"},
	{"/api/v1/employment", "employees"},
	{"/api/v1/payroll", "payroll"},
}

// also: routes that create in a second resource, as path.Match patterns per method.
var also = []struct{ method, pattern, scope string }{
	{http.MethodPost, "/api/v1/engagements/*/periods/*/invoice", "write:invoices"},
}

// instead: routes whose scopes replace their prefix's read/write scope, as path.Match patterns, for reads (GET, HEAD)
// or writes. Pay terms sit under an employee but are payroll; the bank account, tax id and social-security number
// (protected) need payroll edit; the employee list and the settings also serve payroll, which picks employees by name.
var instead = []struct {
	write   bool
	pattern string
	scopes  []string
}{
	{false, "/api/v1/employees", []string{"read:employees|read:payroll"}},
	{false, "/api/v1/employees/*/pay-terms", []string{"read:payroll"}},
	{true, "/api/v1/employees/*/pay-terms", []string{"write:payroll"}},
	{true, "/api/v1/employees/*/pay-terms/*", []string{"write:payroll"}},
	{false, "/api/v1/employees/*/protected", []string{"write:payroll"}},
	{false, "/api/v1/employment/settings", []string{"read:employees|read:payroll"}},
	{true, "/api/v1/employment/settings", []string{"write:employees", "write:payroll"}},
}

// Required is the scopes a request needs, each one scope or alternatives separated by "|": read:<resource> for GET
// and HEAD, else write:<resource>; nil when the path is not scope-checked.
func Required(method, p string) []string {
	write := method != http.MethodGet && method != http.MethodHead
	for _, in := range instead {
		if ok, _ := path.Match(in.pattern, p); ok && in.write == write {
			return in.scopes
		}
	}
	for _, pre := range prefixes {
		if p != pre.path && !strings.HasPrefix(p, pre.path+"/") {
			continue
		}
		action := "write"
		if method == http.MethodGet || method == http.MethodHead {
			action = "read"
		}
		need := []string{action + ":" + pre.resource}
		for _, a := range also {
			if ok, _ := path.Match(a.pattern, p); ok && method == a.method {
				need = append(need, a.scope)
			}
		}
		return need
	}
	return nil
}

// Auth is what the guard uses of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

// Guard answers 403 forbidden with details.scope to a request the session's live membership has no scope for.
func Guard(a Auth, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		need := Required(r.Method, r.URL.Path)
		if need == nil {
			next.ServeHTTP(w, r)
			return
		}
		a.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			// Anyone may leave a workspace, whatever their scopes.
			if r.Method == http.MethodDelete && r.URL.Path == "/api/v1/members/"+sess.User.ID {
				next.ServeHTTP(w, r)
				return
			}
			for _, scope := range need {
				if !AllowsAny(sess.Role, sess.Scopes, scope) {
					scope, _, _ = strings.Cut(scope, "|")
					a.WriteError(w, r, auth.Error(http.StatusForbidden, "forbidden", "You are not allowed to do that.",
						map[string]any{"scope": scope}))
					return
				}
			}
			next.ServeHTTP(w, r)
		})(w, r)
	})
}

// ErrInvalid is the 422 for a scope list Validate refuses; ErrNotMember the 400 for scopes on an owner.
var (
	ErrInvalid = auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the permission scopes.",
		map[string]any{"fields": map[string]string{"scopes": "invalid"}})
	ErrNotMember = auth.Error(http.StatusBadRequest, "invalid_request", "Owners always have every scope.",
		map[string]any{"fields": map[string]string{"scopes": "invalid"}})
)

// ForRole is the scopes to store for a new membership or invitation: none for an owner (400 when some were given);
// for an admin the given HR scopes (an empty list is no HR access; 422 for any other scope) or nil for AdminHR; for a
// member the given ones (422 when invalid) or full access.
func ForRole(role string, scopes *[]string) ([]string, error) {
	switch {
	case role == "owner" && scopes != nil:
		return nil, ErrNotMember
	case role == "owner", role == "admin" && scopes == nil:
		return nil, nil
	case role == "admin":
		if len(*scopes) > 0 && Validate(*scopes) != nil || slices.ContainsFunc(*scopes, func(s string) bool { return !IsHR(s) }) {
			return nil, ErrInvalid
		}
		return append([]string{}, *scopes...), nil
	case scopes == nil:
		return []string{"*:*"}, nil
	case Validate(*scopes) != nil:
		return nil, ErrInvalid
	}
	return *scopes, nil
}
