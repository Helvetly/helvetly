package customdomains

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const fakeZone = "0123456789abcdef0123456789abcdef"

// fakeHostname is one custom hostname of the fake zone, in Cloudflare's shape.
type fakeHostname struct {
	ID        string    `json:"id"`
	Hostname  string    `json:"hostname"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	SSL       struct {
		Status string `json:"status"`
	} `json:"ssl"`
	Ownership struct {
		Type  string `json:"type"`
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"ownership_verification"`
	VerificationErrors []string `json:"verification_errors"`
}

// fakeCloudflare is Cloudflare's custom hostnames API for one zone over HTTP. Like the real one it pages lists at
// most maxPage at a time whatever per_page asks, and names a hostname elsewhere (another account) a duplicate.
type fakeCloudflare struct {
	t       *testing.T
	srv     *httptest.Server
	mu      sync.Mutex
	hosts   map[string]*fakeHostname
	order   []string
	seq     int
	maxPage int
	// elsewhere are names another account has; down makes every call fail; limited answers 429.
	elsewhere map[string]bool
	down      bool
	limited   bool
	calls     map[string]int // "METHOD" → count
}

func newFakeCloudflare(t *testing.T) *fakeCloudflare {
	f := &fakeCloudflare{t: t, hosts: map[string]*fakeHostname{}, maxPage: 50, elsewhere: map[string]bool{}, calls: map[string]int{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

// client talks to the fake without the production spacing of calls.
func (f *fakeCloudflare) client() *client {
	c := NewCloudflare(f.srv.URL, fakeZone, "tok").(*client)
	c.gap = 0
	return c
}

func answer(w http.ResponseWriter, status int, result any, info map[string]int, errs ...map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if errs == nil {
		errs = []map[string]any{}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"success": status < 300, "errors": errs, "result": result, "result_info": info})
}

func (f *fakeCloudflare) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls[r.Method]++
	base := "/zones/" + fakeZone + "/custom_hostnames"
	switch {
	case r.Header.Get("Authorization") != "Bearer tok":
		answer(w, 403, nil, nil, map[string]any{"code": 10000, "message": "Authentication error"})
		return
	case f.limited:
		w.Header().Set("Retry-After", "1")
		answer(w, 429, nil, nil, map[string]any{"code": 971, "message": "rate limited"})
		return
	case f.down:
		answer(w, 503, nil, nil, map[string]any{"code": 1000, "message": "unavailable"})
		return
	}
	id := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, base), "/")
	switch {
	case r.Method == http.MethodPost && id == "":
		var in struct {
			Hostname string `json:"hostname"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if f.elsewhere[in.Hostname] || f.byName(in.Hostname) != nil {
			answer(w, 409, nil, nil, map[string]any{"code": 1406, "message": "Duplicate custom hostname found."})
			return
		}
		f.seq++
		h := &fakeHostname{ID: fmt.Sprintf("cf-%04d", f.seq), Hostname: in.Hostname, Status: "pending", CreatedAt: time.Now().UTC()}
		h.SSL.Status = "initializing"
		h.Ownership.Type, h.Ownership.Name, h.Ownership.Value = "txt", "_cf-custom-hostname."+in.Hostname, fmt.Sprintf("token-%04d", f.seq)
		f.hosts[h.ID] = h
		f.order = append(f.order, h.ID)
		answer(w, 200, h, nil)
	case r.Method == http.MethodGet && id == "":
		f.list(w, r)
	default:
		h := f.hosts[id]
		if h == nil {
			answer(w, 404, nil, nil, map[string]any{"code": 1436, "message": "Custom hostname not found."})
			return
		}
		if r.Method == http.MethodDelete {
			delete(f.hosts, id)
			f.order = slices.DeleteFunc(f.order, func(o string) bool { return o == id })
			answer(w, 200, map[string]string{"id": id}, nil)
			return
		}
		answer(w, 200, h, nil)
	}
}

func (f *fakeCloudflare) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	per, _ := strconv.Atoi(q.Get("per_page"))
	per = min(max(per, 5), f.maxPage)
	page, _ := strconv.Atoi(q.Get("page"))
	page = max(page, 1)
	var all []*fakeHostname
	for _, id := range f.order {
		if n := q.Get("hostname"); n == "" || f.hosts[id].Hostname == n {
			all = append(all, f.hosts[id])
		}
	}
	pages := (len(all) + per - 1) / per
	from, to := min((page-1)*per, len(all)), min(page*per, len(all))
	answer(w, 200, all[from:to], map[string]int{"page": page, "per_page": per, "count": to - from, "total_count": len(all), "total_pages": pages})
}

func (f *fakeCloudflare) byName(name string) *fakeHostname {
	for _, h := range f.hosts {
		if h.Hostname == name {
			return h
		}
	}
	return nil
}

// set changes the fake's state under its lock.
func (f *fakeCloudflare) set(fn func(*fakeCloudflare)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

// activate: Cloudflare has seen name's CNAME (status active) and, with cert, issued its certificate.
func (f *fakeCloudflare) activate(name string, cert bool) {
	f.set(func(f *fakeCloudflare) {
		h := f.byName(name)
		if h == nil {
			f.t.Fatalf("no custom hostname %s", name)
		}
		h.Status, h.SSL.Status = "active", "pending_validation"
		if cert {
			h.SSL.Status = "active"
		}
	})
}

// add puts a custom hostname into the zone directly, created at.
func (f *fakeCloudflare) add(name string, at time.Time) string {
	var id string
	f.set(func(f *fakeCloudflare) {
		f.seq++
		h := &fakeHostname{ID: fmt.Sprintf("cf-%04d", f.seq), Hostname: name, Status: "active", CreatedAt: at}
		h.SSL.Status = "active"
		f.hosts[h.ID] = h
		f.order = append(f.order, h.ID)
		id = h.ID
	})
	return id
}

func (f *fakeCloudflare) names() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, h := range f.hosts {
		out = append(out, h.Hostname)
	}
	slices.Sort(out)
	return out
}

func (f *fakeCloudflare) hostname(name string) fakeHostname {
	f.mu.Lock()
	defer f.mu.Unlock()
	if h := f.byName(name); h != nil {
		return *h
	}
	return fakeHostname{}
}
