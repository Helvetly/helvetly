package customdomains

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

const zone = "0123456789abcdef0123456789abcdef"

// fakeCloudflare is the custom hostnames API of one zone: Set changes what Cloudflare says of a hostname.
type fakeCloudflare struct {
	mu        sync.Mutex
	hosts     map[string]map[string]any // id → result
	elsewhere map[string]bool           // hostnames another account has
	down      bool
	limited   bool     // answer 429
	calls     []string // method and path of every call
	srv       *httptest.Server
}

func newFakeCloudflare(t *testing.T) *fakeCloudflare {
	f := &fakeCloudflare{hosts: map[string]map[string]any{}, elsewhere: map[string]bool{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func answer(w http.ResponseWriter, status int, result any, errs ...map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if errs == nil {
		errs = []map[string]any{}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"success": status < 300, "errors": errs, "result": result})
}

func (f *fakeCloudflare) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, r.Method+" "+r.URL.RequestURI())
	base := "/zones/" + zone + "/custom_hostnames"
	switch {
	case f.limited:
		w.Header().Set("Retry-After", "300")
		answer(w, http.StatusTooManyRequests, nil, map[string]any{"code": 10000, "message": "rate limited"})
	case r.Method == http.MethodGet && r.URL.Path == base:
		if r.URL.Query().Get("per_page") != "1000" || r.URL.Query().Get("page") != "1" {
			answer(w, http.StatusOK, []any{}) // every host fits the first page here
			return
		}
		list := []any{}
		for _, h := range f.hosts {
			list = append(list, h)
		}
		answer(w, http.StatusOK, list)
	case r.Header.Get("Authorization") != "Bearer cf-token":
		answer(w, http.StatusForbidden, nil, map[string]any{"code": 9109, "message": "Invalid access token"})
	case f.down:
		answer(w, http.StatusInternalServerError, nil, map[string]any{"code": 1000, "message": "internal"})
	case r.Method == http.MethodPost && r.URL.Path == base:
		var in struct {
			Hostname string `json:"hostname"`
			SSL      struct{ Method, Type string }
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in.SSL.Method != "http" || in.SSL.Type != "dv" {
			answer(w, http.StatusBadRequest, nil, map[string]any{"code": 1400, "message": "bad ssl"})
			return
		}
		if f.elsewhere[in.Hostname] {
			answer(w, http.StatusConflict, nil, map[string]any{"code": 1406, "message": "Duplicate custom hostname found."})
			return
		}
		id := "cf_" + strings.ReplaceAll(in.Hostname, ".", "_") + fmt.Sprint(len(f.calls))
		f.hosts[id] = map[string]any{"id": id, "hostname": in.Hostname, "status": "pending",
			"ssl":                    map[string]any{"status": "initializing", "validation_records": []any{}},
			"ownership_verification": map[string]any{"type": "txt", "name": "_cf-custom-hostname." + in.Hostname, "value": "token-" + id},
			"verification_errors":    []string{"custom hostname does not CNAME to this zone."}}
		answer(w, http.StatusOK, f.hosts[id])
	case strings.HasPrefix(r.URL.Path, base+"/"):
		id := strings.TrimPrefix(r.URL.Path, base+"/")
		h, ok := f.hosts[id]
		if !ok {
			answer(w, http.StatusNotFound, nil, map[string]any{"code": 1436, "message": "not found"})
			return
		}
		if r.Method == http.MethodDelete {
			delete(f.hosts, id)
			answer(w, http.StatusOK, map[string]any{"id": id})
			return
		}
		answer(w, http.StatusOK, h)
	default:
		answer(w, http.StatusNotFound, nil)
	}
}

// set makes Cloudflare say status and sslStatus of hostname.
func (f *fakeCloudflare) set(hostname, status, sslStatus string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, h := range f.hosts {
		if h["hostname"] == hostname {
			h["status"] = status
			h["ssl"] = map[string]any{"status": sslStatus}
			if status == "active" {
				h["verification_errors"] = []string{}
			}
		}
	}
}

// asked counts the calls whose "METHOD /path?query" starts with prefix, after resetting nothing.
func (f *fakeCloudflare) asked(prefix string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func (f *fakeCloudflare) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.hosts)
}

type env struct {
	t      *testing.T
	st     *store.Store
	raw    *pgxpool.Pool
	srv    *httptest.Server
	cf     *fakeCloudflare
	svc    *Service
	scopes *portalscope.Resolver
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	billingtest.Wire(t, st)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://app.example.com", SecretKey: bytes.Repeat([]byte{7}, 32), SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	cf := newFakeCloudflare(t)
	scopes := portalscope.New("https://portal.example.com", st.Q)
	scopes.EnableDomains("https://app.example.com")
	svc := New(st, a, NewCloudflare(cf.srv.URL, zone, "cf-token"), "portal.example.com",
		[]string{"https://app.example.com", "https://portal.example.com"}, scopes, discard)
	mux := http.NewServeMux()
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv, cf: cf, svc: svc, scopes: scopes}
}

type browser struct {
	c    *http.Client
	csrf string
}

// workspace makes a workspace on plan with one person of role in it.
func (e *env) workspace(plan, role string) (*browser, string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	ws := auth.NewID("wsp")
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
	token, csrf := rand.Text(), rand.Text()
	sum := sha256.Sum256([]byte(token))
	for _, err := range []error{
		e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Firma " + ws}, "UTC", now),
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	billingtest.On(e.t, e.st, ws, plan)
	jar, _ := cookiejar.New(nil)
	base, _ := url.Parse(e.srv.URL)
	jar.SetCookies(base, []*http.Cookie{{Name: "helvetly_session", Value: token, Path: "/"}})
	return &browser{c: &http.Client{Jar: jar}, csrf: csrf}, ws
}

func (e *env) do(b *browser, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	res, err := b.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func domainOf(out map[string]any) map[string]any {
	data, _ := out["data"].(map[string]any)
	d, _ := data["domain"].(map[string]any)
	return d
}

func errorCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

// due makes every domain's next check due and runs the job once.
func (e *env) tick() {
	e.t.Helper()
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspace_domains SET next_check_at = now() - interval '1 second'`); err != nil {
		e.t.Fatal(err)
	}
	e.svc.Tick(context.Background())
}

func (e *env) notified(ws, event string) int {
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE workspace_id = $1 AND event = $2`, ws, event).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestNormalise(t *testing.T) {
	own := []string{"app.helvetly.example", "portal.example.com", "portal.example.com"}
	for _, tt := range []struct{ in, want, problem string }{
		{"portal.firma.ch", "portal.firma.ch", ""},
		{"  Portal.Firma.CH. ", "portal.firma.ch", ""},
		{"https://portal.firma.ch/login", "portal.firma.ch", ""},
		{"kunden.müller.ch", "kunden.xn--mller-kva.ch", ""},
		{"portal.firma.co.uk", "portal.firma.co.uk", ""},
		{"firma.ch", "", Apex},
		{"firma.co.uk", "", Apex},
		{"", "", Invalid},
		{"portal firma.ch", "", Invalid},
		{"portal.firma.ch:8443", "", Invalid},
		{"-portal.firma.ch", "", Invalid},
		{"portal..firma.ch", "", Invalid},
		{strings.Repeat("a", 64) + ".firma.ch", "", Invalid},
		{strings.Repeat("abcdefghi.", 26) + "ch", "", Invalid}, // 262 characters
		{"portal.firma.123", "", Invalid},
		{"192.168.1.10", "", Reserved},
		{"[::1]", "", Reserved},
		{"localhost", "", Reserved},
		{"portal.localhost", "", Reserved},
		{"portal.firma.test", "", Reserved},
		{"evil.helvetly.com", "", Reserved},
		{"helvetly.com", "", Reserved},
		{"x.portal.example.com", "", Reserved}, // under one of our own registrable domains
		{"portal.example.com", "", Reserved},
	} {
		t.Run(tt.in, func(t *testing.T) {
			got, problem := Normalise(tt.in, own)
			if got != tt.want || problem != tt.problem {
				t.Fatalf("Normalise(%q) = %q, %q; want %q, %q", tt.in, got, problem, tt.want, tt.problem)
			}
		})
	}
}

func TestCloudflareClient(t *testing.T) {
	t.Parallel()
	f := newFakeCloudflare(t)
	ctx := context.Background()
	c := NewCloudflare(f.srv.URL+"/", zone, "cf-token")
	h, err := c.Create(ctx, "portal.firma.ch")
	if err != nil || h.ID == "" || h.Status != "pending" || len(h.Records) != 1 || h.Records[0].Type != "TXT" ||
		h.Records[0].Name != "_cf-custom-hostname.portal.firma.ch" || len(h.Errors) != 1 {
		t.Fatalf("create: %+v %v", h, err)
	}
	f.set("portal.firma.ch", "active", "active")
	if got, err := c.Get(ctx, h.ID); err != nil || got.Status != "active" || got.SSL != "active" {
		t.Fatalf("get: %+v %v", got, err)
	}
	if err := c.Delete(ctx, h.ID); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete(ctx, h.ID); err != nil {
		t.Fatalf("deleting a deleted hostname: %v", err)
	}
	if _, err := c.Get(ctx, h.ID); err != ErrNotFound {
		t.Fatalf("get a deleted hostname: %v", err)
	}
	f.elsewhere["taken.firma.ch"] = true
	if _, err := c.Create(ctx, "taken.firma.ch"); err != ErrDuplicate {
		t.Fatalf("duplicate: %v", err)
	}
	f.down = true
	if _, err := c.Create(ctx, "down.firma.ch"); err == nil || !strings.Contains(err.Error(), "HTTP 500") || strings.Contains(err.Error(), "cf-token") {
		t.Fatalf("cloudflare down: %v", err)
	}
	if _, err := NewCloudflare(f.srv.URL, zone, "wrong").Get(ctx, "x"); err == nil || strings.Contains(err.Error(), "wrong") {
		t.Fatalf("bad token: %v", err)
	}
}

func TestClassify(t *testing.T) {
	for _, tt := range []struct{ status, ssl, want, problem string }{
		{"pending", "initializing", store.DomainPending, ""},
		{"active", "pending_validation", store.DomainPending, ""},
		{"active", "active", store.DomainActive, ""},
		{"moved", "active", store.DomainFailed, ProblemDNS},
		{"blocked", "", store.DomainFailed, ProblemBlocked},
		{"pending", "validation_timed_out", store.DomainFailed, ProblemCertificate},
		{"active", "expired", store.DomainFailed, ProblemCertificate},
	} {
		if got, problem := classify(Hostname{Status: tt.status, SSL: tt.ssl}); got != tt.want || problem != tt.problem {
			t.Errorf("classify(%s, %s) = %s %s, want %s %s", tt.status, tt.ssl, got, problem, tt.want, tt.problem)
		}
	}
}

func TestAddCheckRemove(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.workspace(billing.Business, "owner")
	ctx := context.Background()

	if status, out := e.do(owner, "GET", "/api/v1/workspace/portal/domain", nil); status != 200 || domainOf(out) != nil ||
		out["data"].(map[string]any)["enabled"] != true || out["data"].(map[string]any)["target"] != "portal.example.com" {
		t.Fatalf("no domain yet: %d %v", status, out)
	}
	status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "https://Portal.Firma.ch/"})
	d := domainOf(out)
	if status != 201 || d["hostname"] != "portal.firma.ch" || d["status"] != "pending" || d["stage"] != "dns" || d["detail"] == nil {
		t.Fatalf("add: %d %v", status, out)
	}
	records, _ := d["records"].([]any)
	first, _ := records[0].(map[string]any)
	if len(records) != 2 || first["type"] != "CNAME" || first["name"] != "portal.firma.ch" || first["value"] != "portal.example.com" {
		t.Fatalf("records: %v", records)
	}
	if status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "other.firma.ch"}); status != 409 || errorCode(out) != "domain_exists" {
		t.Fatalf("second domain: %d %v", status, out)
	}
	if host, _ := e.scopes.ActiveDomain(ctx, ws); host != "" {
		t.Fatalf("pending domain resolves: %q", host)
	}

	// Waiting for the certificate, then active: the resolver serves it and the owners hear of it.
	e.cf.set("portal.firma.ch", "active", "pending_validation")
	e.tick()
	if _, out := e.do(owner, "GET", "/api/v1/workspace/portal/domain", nil); domainOf(out)["stage"] != "certificate" {
		t.Fatalf("certificate stage: %v", out)
	}
	e.cf.set("portal.firma.ch", "active", "active")
	e.tick()
	if _, out := e.do(owner, "GET", "/api/v1/workspace/portal/domain", nil); domainOf(out)["status"] != "active" || domainOf(out)["detail"] != nil {
		t.Fatalf("active: %v", out)
	}
	if u, err := e.scopes.CanonicalURL(ctx, store.Workspace{ID: ws, Name: "Firma"}); err != nil || u != "https://portal.firma.ch/" {
		t.Fatalf("canonical: %q %v", u, err)
	}
	if e.notified(ws, "portal.domain_active") != 1 {
		t.Fatal("no notice of the active domain")
	}
	var next time.Time
	_ = e.raw.QueryRow(ctx, `SELECT next_check_at FROM workspace_domains WHERE workspace_id = $1`, ws).Scan(&next)
	if time.Until(next) < 23*time.Hour {
		t.Fatalf("active domain checked again at %v, want daily", next)
	}

	// The CNAME is gone: the domain fails, the portal falls back to its slug, the owners are told.
	e.cf.set("portal.firma.ch", "moved", "active")
	e.tick()
	if _, out := e.do(owner, "GET", "/api/v1/workspace/portal/domain", nil); domainOf(out)["stage"] != "problem" || domainOf(out)["problem"] != "dns" {
		t.Fatalf("broken: %v", out)
	}
	if u, _ := e.scopes.CanonicalURL(ctx, store.Workspace{ID: ws, Name: "Firma"}); !strings.HasPrefix(u, "https://portal.example.com/w/") {
		t.Fatalf("canonical after the domain broke: %q", u)
	}
	if e.notified(ws, "portal.domain_failed") != 1 {
		t.Fatal("no notice of the broken domain")
	}
	// Fixed again: "Re-check" makes it active at once.
	e.cf.set("portal.firma.ch", "active", "active")
	if _, err := e.raw.Exec(ctx, `UPDATE workspace_domains SET last_checked_at = now() - interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	if status, out := e.do(owner, "POST", "/api/v1/workspace/portal/domain/check", nil); status != 200 || domainOf(out)["status"] != "active" {
		t.Fatalf("re-check: %d %v", status, out)
	}

	if status, _ := e.do(owner, "DELETE", "/api/v1/workspace/portal/domain", nil); status != 204 {
		t.Fatalf("remove: %d", status)
	}
	if e.cf.count() != 0 {
		t.Fatal("the cloudflare hostname stayed")
	}
	if host, _ := e.scopes.ActiveDomain(ctx, ws); host != "" {
		t.Fatalf("removed domain resolves: %q", host)
	}
	var events int
	_ = e.raw.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind LIKE 'workspace.portal_domain_%'`, ws).Scan(&events)
	if events != 2 {
		t.Fatalf("%d audit events, want added and removed", events)
	}
	// The hostname is free again, for this workspace or another.
	if status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.firma.ch"}); status != 201 {
		t.Fatalf("add again: %d %v", status, out)
	}
}

func TestAddRefused(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.workspace(billing.Business, "owner")
	admin, _ := e.workspace(billing.Business, "admin")
	member, _ := e.workspace(billing.Business, "member")
	pro, _ := e.workspace(billing.Pro, "owner")
	other, _ := e.workspace(billing.Business, "owner")
	if status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.firma.ch"}); status != 201 {
		t.Fatalf("add: %d %v", status, out)
	}
	e.cf.elsewhere["cloudflare.taken.ch"] = true
	for _, tt := range []struct {
		name   string
		who    *browser
		host   string
		status int
		code   string
	}{
		{"member", member, "portal.member.ch", 403, "forbidden"},
		{"plan without the feature", pro, "portal.pro.ch", 403, "feature_not_in_plan"},
		{"apex", admin, "firma.ch", 422, "domain_apex"},
		{"ours", admin, "x.helvetly.com", 422, "domain_reserved"},
		{"ip", admin, "10.1.2.3", 422, "domain_reserved"},
		{"under the portal's domain", admin, "acme.example.com", 422, "domain_reserved"},
		{"garbage", admin, "not a domain", 422, "domain_invalid"},
		{"another workspace's", other, "PORTAL.firma.ch", 409, "domain_taken"},
		{"another cloudflare account's", other, "cloudflare.taken.ch", 409, "domain_taken"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			status, out := e.do(tt.who, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": tt.host})
			if status != tt.status || errorCode(out) != tt.code {
				t.Fatalf("%d %s, want %d %s: %v", status, errorCode(out), tt.status, tt.code, out)
			}
		})
	}
	// Refused by Cloudflare: nothing is kept, so the workspace may add another.
	if status, out := e.do(other, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.other.ch"}); status != 201 {
		t.Fatalf("after a refusal: %d %v", status, out)
	}
	e.cf.down = true
	admin2, _ := e.workspace(billing.Business, "owner")
	if status, out := e.do(admin2, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.down.ch"}); status != 502 || errorCode(out) != "domain_unavailable" {
		t.Fatalf("cloudflare down: %d %v", status, out)
	}
	e.cf.down = false
	if status, _ := e.do(admin2, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.down.ch"}); status != 201 {
		t.Fatal("the hostname stayed taken after cloudflare failed")
	}
}

func TestRaceForOneHostname(t *testing.T) {
	e := newEnv(t)
	var who []*browser
	for range 6 {
		b, _ := e.workspace(billing.Business, "owner")
		who = append(who, b)
	}
	var wg sync.WaitGroup
	statuses := make(chan int, len(who))
	for _, b := range who {
		wg.Go(func() {
			status, _ := e.do(b, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.race.ch"})
			statuses <- status
		})
	}
	wg.Wait()
	close(statuses)
	won := 0
	for s := range statuses {
		switch s {
		case 201:
			won++
		case 409:
		default:
			t.Fatalf("status %d", s)
		}
	}
	if won != 1 || e.cf.count() != 1 {
		t.Fatalf("%d workspaces got the hostname, cloudflare has %d", won, e.cf.count())
	}
}

func TestJob(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	add := func(plan, host string) string {
		b, ws := e.workspace(plan, "owner")
		if status, out := e.do(b, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": host}); status != 201 {
			t.Fatalf("add %s: %d %v", host, status, out)
		}
		return ws
	}
	statusOf := func(ws string) (status, problem string, checks int) {
		_ = e.raw.QueryRow(ctx, `SELECT status, problem, checks FROM workspace_domains WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`, ws).
			Scan(&status, &problem, &checks)
		return
	}

	// Pending, not due yet: the job leaves it alone; due: backoff grows.
	slow := add(billing.Business, "portal.slow.ch")
	e.svc.Tick(ctx)
	if _, _, checks := statusOf(slow); checks != 1 {
		t.Fatalf("checked before it was due: %d", checks)
	}
	e.tick()
	var wait time.Duration
	_ = e.raw.QueryRow(ctx, `SELECT extract(epoch FROM next_check_at - last_checked_at)::bigint * interval '1 second' FROM workspace_domains WHERE workspace_id = $1`, slow).Scan(&wait)
	if wait != 4*time.Minute {
		t.Fatalf("backoff after 2 checks: %v", wait)
	}
	// A week without the CNAME: it fails.
	if _, err := e.raw.Exec(ctx, `UPDATE workspace_domains SET created_at = now() - interval '8 days' WHERE workspace_id = $1`, slow); err != nil {
		t.Fatal(err)
	}
	e.tick()
	if status, problem, _ := statusOf(slow); status != "failed" || problem != "timeout" {
		t.Fatalf("timeout: %s %s", status, problem)
	}

	// Cloudflare lost the hostname: it is added again.
	lost := add(billing.Business, "portal.lost.ch")
	e.cf.mu.Lock()
	clear(e.cf.hosts)
	e.cf.mu.Unlock()
	e.tick()
	if status, _, _ := statusOf(lost); status != "pending" || e.cf.count() != 2 { // lost's again, slow's again
		t.Fatalf("lost: %s, cloudflare has %d", status, e.cf.count())
	}

	// The plan lost the feature: the domain stops resolving at once and the job removes it.
	down := add(billing.Business, "portal.down.ch")
	e.cf.set("portal.down.ch", "active", "active")
	e.tick()
	if host, _ := e.scopes.ActiveDomain(ctx, down); host != "portal.down.ch" {
		t.Fatalf("active before the downgrade: %q", host)
	}
	billingtest.On(t, e.st, down, billing.Pro)
	e.scopes.Forget()
	if host, _ := e.scopes.ActiveDomain(ctx, down); host != "" {
		t.Fatalf("resolves after the downgrade: %q", host)
	}
	e.tick()
	if status, _, _ := statusOf(down); status != "removed" {
		t.Fatalf("after the downgrade: %s", status)
	}

	// Cloudflare down: the domain stays as it was and is tried again soon.
	flaky := add(billing.Business, "portal.flaky.ch")
	e.cf.down = true
	e.tick()
	e.cf.down = false
	if status, _, _ := statusOf(flaky); status != "pending" {
		t.Fatalf("cloudflare down: %s", status)
	}

	// A deleted workspace's domain goes.
	gone := add(billing.Business, "portal.gone.ch")
	if _, err := e.raw.Exec(ctx, `UPDATE workspaces SET deleted_at = now() WHERE id = $1`, gone); err != nil {
		t.Fatal(err)
	}
	e.tick()
	if status, _, _ := statusOf(gone); status != "removed" {
		t.Fatalf("deleted workspace: %s", status)
	}
}

func TestDomainCheck(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.workspace(billing.Business, "owner")
	e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.firma.ch"})
	for host, want := range map[string]int{"portal.firma.ch": 200, "PORTAL.FIRMA.CH": 200, "other.firma.ch": 404, "app.example.com": 404, "": 404} {
		res, err := http.Get(e.srv.URL + "/api/v1/public/portal/domain-check?domain=" + url.QueryEscape(host))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("domain-check %q: %d, want %d", host, res.StatusCode, want)
		}
	}
}

// TestSweep: active domains are checked from one listing of the zone, however many there are; a 429 pauses the job.
func TestSweep(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	var wss []string
	for i := range 3 {
		b, ws := e.workspace(billing.Business, "owner")
		host := fmt.Sprintf("portal.sweep%d.ch", i)
		if status, _ := e.do(b, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": host}); status != 201 {
			t.Fatal("add")
		}
		e.cf.set(host, "active", "active")
		wss = append(wss, ws)
	}
	e.tick() // pending → active, one by one
	list := "GET /zones/" + zone + "/custom_hostnames?page="
	gets, lists := e.cf.asked("GET /zones/"+zone+"/custom_hostnames/"), e.cf.asked(list)
	e.cf.set("portal.sweep1.ch", "moved", "active")
	e.tick() // all three due: one listing, no single reads
	if got := e.cf.asked("GET /zones/" + zone + "/custom_hostnames/"); got != gets {
		t.Fatalf("%d single reads for active domains", got-gets)
	}
	if got := e.cf.asked(list); got != lists+1 {
		t.Fatalf("%d listings, want 1", got-lists)
	}
	var status string
	_ = e.raw.QueryRow(ctx, `SELECT status FROM workspace_domains WHERE workspace_id = $1`, wss[1]).Scan(&status)
	if status != "failed" || e.notified(wss[1], "portal.domain_failed") != 1 {
		t.Fatalf("broken domain in the sweep: %s", status)
	}
	var due int
	_ = e.raw.QueryRow(ctx, `SELECT count(*) FROM workspace_domains WHERE status = 'active' AND next_check_at < now() + interval '23 hours'`).Scan(&due)
	if due != 0 {
		t.Fatalf("%d active domains due before tomorrow's sweep", due)
	}

	e.cf.limited = true
	before := len(e.cf.calls)
	e.tick()
	e.tick()
	if n := len(e.cf.calls) - before; n != 1 {
		t.Fatalf("%d calls after a 429, want the job paused after the first", n)
	}
	e.cf.limited = false
}
