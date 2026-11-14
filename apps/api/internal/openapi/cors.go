package openapi

import (
	"net/http"
	"slices"
	"strings"
)

// CORS lets the developer docs' playground (origin, DOCS_URL) call the catalogue's operations from the reader's
// browser with a pasted API token. Only that exact origin, only documented routes, and never with credentials: the
// browser sends no cookies, so a request authenticates by its bearer token alone and CSRF does not apply. An empty
// origin turns it off. It wraps the guards, so their answers (401, 403, 402) reach the playground too.
func CORS(origin string, next http.Handler) http.Handler {
	if origin == "" {
		return next
	}
	mux := http.NewServeMux()
	nop := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	var verbs []string
	for _, op := range Operations {
		mux.Handle(op.Method+" "+op.Path, nop)
		if !slices.Contains(verbs, op.Method) {
			verbs = append(verbs, op.Method)
		}
	}
	allowMethods := strings.Join(verbs, ", ")
	documented := func(method string, r *http.Request) bool {
		probe := r.Clone(r.Context())
		probe.Method = method
		_, pattern := mux.Handler(probe)
		return pattern != ""
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
		method := r.Method
		if preflight {
			method = r.Header.Get("Access-Control-Request-Method")
		}
		if !documented(method, r) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Origin")
		if r.Header.Get("Origin") != origin {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		if !preflight {
			h.Set("Access-Control-Expose-Headers", "Retry-After, Content-Disposition")
			next.ServeHTTP(w, r)
			return
		}
		h.Add("Vary", "Access-Control-Request-Method")
		h.Add("Vary", "Access-Control-Request-Headers")
		h.Set("Access-Control-Allow-Methods", allowMethods)
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		h.Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
	})
}
