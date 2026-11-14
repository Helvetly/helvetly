package auth

import (
	"cmp"
	"net/http"
	"slices"
	"strings"

	"helvetly.com/api/internal/store"
)

// API token scopes (docs/api-tokens-contract.md): "read:<resource>" or "write:<resource>", where a resource is an
// operation tag of the public catalogue in lower case and "*" is every resource. Write implies read.

const everyResource = "*"

// canonicalScopes validates scopes against the known resources and returns them in one stored form: each write
// with its read, nothing a wildcard already covers, reads before writes, the wildcard first. ok is false for an
// unknown or empty list.
func canonicalScopes(scopes []string, resources []string) ([]string, bool) {
	granted := map[string]map[string]bool{"read": {}, "write": {}}
	for _, scope := range scopes {
		action, resource, found := strings.Cut(scope, ":")
		if !found || granted[action] == nil || (resource != everyResource && !slices.Contains(resources, resource)) {
			return nil, false
		}
		granted[action][resource] = true
		if action == "write" {
			granted["read"][resource] = true
		}
	}
	var out []string
	for _, action := range []string{"read", "write"} {
		names := make([]string, 0, len(granted[action]))
		for resource := range granted[action] {
			if resource == everyResource || !granted[action][everyResource] {
				names = append(names, resource)
			}
		}
		slices.SortFunc(names, func(a, b string) int {
			return cmp.Or(-cmp.Compare(boolInt(a == everyResource), boolInt(b == everyResource)), cmp.Compare(a, b))
		})
		for _, resource := range names {
			out = append(out, action+":"+resource)
		}
	}
	return out, len(out) > 0
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// scopesAllow: reading a resource needs a read or write scope on it (or on "*"), writing needs a write scope.
func scopesAllow(scopes []string, resource string, write bool) bool {
	actions := []string{"write"}
	if !write {
		actions = append(actions, "read")
	}
	for _, action := range actions {
		if slices.Contains(scopes, action+":"+resource) || slices.Contains(scopes, action+":"+everyResource) {
			return true
		}
	}
	return false
}

// TokenAllows reports whether the request's API token may read (or write) resource; always true for a cookie
// session, whose limits are the member's role and permissions alone.
func TokenAllows(r *http.Request, resource string, write bool) bool {
	ts, ok := r.Context().Value(bearerKey{}).(store.TokenSession)
	return !ok || scopesAllow(ts.TokenScopes, resource, write)
}
