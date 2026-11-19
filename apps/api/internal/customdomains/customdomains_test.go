package customdomains

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
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

const target = "portal.example.com"

// fakeDNS is the public DNS as the checker sees it: which TXT records exist.
type fakeDNS struct {
	mu   sync.Mutex
	txt  map[string]string
	down bool
}

func (f *fakeDNS) HasTXT(_ context.Context, name, value string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		return false, errors.New("dns timeout")
	}
	return f.txt[name] == value, nil
}

func (f *fakeDNS) set(fn func(*fakeDNS)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

type env struct {
	t      *testing.T
	st     *store.Store
	raw    *pgxpool.Pool
	srv    *httptest.Server
	dns    *fakeDNS
	cf     *fakeCloudflare
	svc    *Service
	scopes *portalscope.Resolver
	clock  time.Time
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
	dns := &fakeDNS{txt: map[string]string{}}
	cf := newFakeCloudflare(t)
	scopes := portalscope.New("https://portal.example.com", st.Q)
	scopes.EnableDomains("https://app.example.com")
	svc := New(st, a, cf.client(), dns, target, []string{"https://app.example.com", "https://portal.example.com"}, bytes.Repeat([]byte{9}, 32), scopes, discard)
	e := &env{t: t, st: st, raw: raw, dns: dns, cf: cf, svc: svc, scopes: scopes, clock: time.Now().UTC()}
	svc.now = func() time.Time { return e.clock }
	mux := http.NewServeMux()
	svc.Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
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

func (e *env) add(b *browser, host string) map[string]any {
	e.t.Helper()
	status, out := e.do(b, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": host})
	if status != 201 {
		e.t.Fatalf("add %s: %d %v", host, status, out)
	}
	return domainOf(out)
}

func domainOf(out map[string]any) map[string]any {
	data, _ := out["data"].(map[string]any)
	d, _ := data["domain"].(map[string]any)
	return d
}

func errorOf(out map[string]any) (string, map[string]any) {
	e, _ := out["error"].(map[string]any)
	c, _ := e["code"].(string)
	d, _ := e["details"].(map[string]any)
	return c, d
}

// tick makes every domain's next check due and runs the job once.
func (e *env) tick() {
	e.t.Helper()
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspace_domains SET next_check_at = $1`, e.clock.Add(-time.Second)); err != nil {
		e.t.Fatal(err)
	}
	e.svc.Tick(context.Background())
}

func (e *env) row(ws string) (status, problem string) {
	e.t.Helper()
	_ = e.raw.QueryRow(context.Background(), `SELECT status, problem FROM workspace_domains WHERE workspace_id = $1 ORDER BY created_at DESC, status <> 'removed' DESC LIMIT 1`, ws).
		Scan(&status, &problem)
	return
}

func (e *env) notified(ws, event string) int {
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE workspace_id = $1 AND event = $2`, ws, event).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// prove puts host's ownership record, as Cloudflare names it, into the DNS.
func (e *env) prove(host string) {
	h := e.cf.hostname(host)
	if h.Ownership.Name == "" {
		e.t.Fatalf("no ownership record for %s", host)
	}
	e.dns.set(func(d *fakeDNS) { d.txt[h.Ownership.Name] = h.Ownership.Value })
}

// live makes host an active domain: Cloudflare sees its CNAME and issues the certificate, and its TXT record is in place.
func (e *env) live(host string) {
	e.cf.activate(host, true)
	e.prove(host)
	e.tick()
}

func (e *env) cfID(ws string) string {
	e.t.Helper()
	var id *string
	_ = e.raw.QueryRow(context.Background(), `SELECT cf_hostname_id FROM workspace_domains WHERE workspace_id = $1 AND status <> 'removed'`, ws).Scan(&id)
	if id == nil {
		return ""
	}
	return *id
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

type fakeResolver map[string][]string

func (f fakeResolver) LookupTXT(_ context.Context, name string) ([]string, error) {
	if name == "timeout.example" {
		return nil, &net.DNSError{Err: "timeout", IsTimeout: true}
	}
	if t, ok := f[name]; ok {
		return t, nil
	}
	return nil, &net.DNSError{Err: "no such host", IsNotFound: true}
}

func TestNetChecker(t *testing.T) {
	ctx := context.Background()
	c := netChecker{dns: fakeResolver{"_cf-custom-hostname.portal.firma.ch": {"v=spf1", "token-1"}}}
	for _, tt := range []struct {
		name, value string
		want, err   bool
	}{
		{"_cf-custom-hostname.portal.firma.ch", "token-1", true, false},
		{"_cf-custom-hostname.portal.firma.ch", "token-2", false, false},
		{"_cf-custom-hostname.portal.none.ch", "token-1", false, false},
		{"timeout.example", "x", false, true},
	} {
		if got, err := c.HasTXT(ctx, tt.name, tt.value); got != tt.want || (err != nil) != tt.err {
			t.Errorf("HasTXT(%s, %s) = %v %v", tt.name, tt.value, got, err)
		}
	}
}

// TestClientPages: the list follows result_info over every page, whatever page size Cloudflare grants (the review's
// blocker: 50 a page while 1000 were asked for, so a sweep saw 50 domains), and a page of 1000 fits the size limit.
func TestClientPages(t *testing.T) {
	ctx := context.Background()
	for _, tt := range []struct {
		name        string
		hosts, page int
		padding     int
		wantGets    int
	}{
		{"cloudflare grants 50 a page", 120, 50, 0, 3},
		{"exactly two pages", 100, 50, 0, 2},
		{"one page of 1000, over a megabyte", 1000, 1000, 1500, 1},
		{"empty zone", 0, 50, 0, 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeCloudflare(t)
			f.maxPage = tt.page
			for i := range tt.hosts {
				f.add(fmt.Sprintf("p%04d.firma.ch", i), time.Now())
			}
			f.set(func(f *fakeCloudflare) {
				for _, h := range f.hosts {
					h.VerificationErrors = []string{strings.Repeat("x", tt.padding)}
				}
				f.calls = map[string]int{}
			})
			seen := map[string]bool{}
			if err := f.client().List(ctx, func(hs []Hostname) error {
				for _, h := range hs {
					seen[h.ID] = true
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if len(seen) != tt.hosts || f.calls["GET"] != tt.wantGets {
				t.Fatalf("%d hostnames in %d calls, want %d in %d", len(seen), f.calls["GET"], tt.hosts, tt.wantGets)
			}
		})
	}
}

func TestClient(t *testing.T) {
	ctx := context.Background()
	f := newFakeCloudflare(t)
	c := f.client()
	for i := range 70 {
		f.add(fmt.Sprintf("p%02d.firma.ch", i), time.Now())
	}
	h, err := c.Create(ctx, "portal.firma.ch")
	if err != nil || h.Status != "pending" || h.OwnershipName != "_cf-custom-hostname.portal.firma.ch" || h.OwnershipValue == "" {
		t.Fatalf("create: %+v %v", h, err)
	}
	if _, err := c.Create(ctx, "portal.firma.ch"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second create: %v", err)
	}
	// Found past the first page of 50, by its exact name.
	if got, err := c.Find(ctx, "portal.firma.ch"); err != nil || got.ID != h.ID {
		t.Fatalf("find: %+v %v", got, err)
	}
	if _, err := c.Find(ctx, "firma.ch"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("find a name the zone lacks: %v", err)
	}
	if got, err := c.Refresh(ctx, h.ID); err != nil || got.ID != h.ID {
		t.Fatalf("refresh: %+v %v", got, err)
	}
	if err := c.Delete(ctx, h.ID); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete(ctx, h.ID); err != nil {
		t.Fatalf("delete one gone: %v", err)
	}
	if _, err := c.Get(ctx, h.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get one gone: %v", err)
	}
	f.set(func(f *fakeCloudflare) { f.down = true })
	if _, err := c.Get(ctx, "cf-0001"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("an outage is an error: %v", err)
	}
	// A 429 pauses every call (for Retry-After) without asking Cloudflare again.
	f.set(func(f *fakeCloudflare) { f.down, f.limited = false, true })
	if _, err := c.Get(ctx, "cf-0001"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("429: %v", err)
	}
	f.set(func(f *fakeCloudflare) { f.limited, f.calls = false, map[string]int{} })
	if _, err := c.Get(ctx, "cf-0001"); !errors.Is(err, ErrRateLimited) || f.calls["GET"] != 0 {
		t.Fatalf("while paused: %v after %d calls", err, f.calls["GET"])
	}
	c.mu.Lock()
	c.pausedUntil = time.Now()
	c.mu.Unlock()
	if _, err := c.Get(ctx, "cf-0001"); err != nil {
		t.Fatalf("after the pause: %v", err)
	}
	if _, err := NewCloudflare(f.srv.URL, fakeZone, "wrong").Get(ctx, "cf-0001"); err == nil {
		t.Fatal("a refused token is an error")
	}
}

func TestLifecycle(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.workspace(billing.Business, "owner")
	ctx := context.Background()
	const host = "portal.firma.ch"

	d := e.add(owner, "https://Portal.Firma.ch/")
	records, _ := d["records"].([]any)
	if len(records) != 2 {
		t.Fatalf("added: %v", d)
	}
	cname, _ := records[0].(map[string]any)
	txt, _ := records[1].(map[string]any)
	cf := e.cf.hostname(host)
	if d["hostname"] != host || d["stage"] != "dns" || d["releases_at"] == nil || cname["type"] != "CNAME" || cname["value"] != target ||
		txt["type"] != "TXT" || txt["name"] != "_cf-custom-hostname."+host || txt["value"] != cf.Ownership.Value || e.cfID(ws) != cf.ID {
		t.Fatalf("added: %v", d)
	}

	// Cloudflare activates the hostname and issues the certificate on the CNAME alone (a dangling one, say): that proves
	// nothing, so the domain stays pending and is not served.
	e.cf.activate(host, true)
	e.tick()
	if status, problem := e.row(ws); status != "pending" || problem != ProblemVerification {
		t.Fatalf("cname only: %s %s", status, problem)
	}
	if h, _ := e.scopes.ActiveDomain(ctx, ws); h != "" {
		t.Fatalf("served without proof: %q", h)
	}
	// With the TXT record but the certificate still on its way: proven, waiting.
	e.cf.activate(host, false)
	e.prove(host)
	e.tick()
	if _, out := e.do(owner, "GET", "/api/v1/workspace/portal/domain", nil); domainOf(out)["stage"] != "certificate" || domainOf(out)["verified_at"] == nil {
		t.Fatalf("certificate stage: %v", out)
	}
	e.cf.activate(host, true)
	e.clock = e.clock.Add(time.Minute) // past the re-check gap
	if status, out := e.do(owner, "POST", "/api/v1/workspace/portal/domain/check", nil); status != 200 || domainOf(out)["status"] != "active" || domainOf(out)["releases_at"] != nil {
		t.Fatalf("re-check: %d %v", status, out)
	}
	if u, _ := e.scopes.CanonicalURL(ctx, store.Workspace{ID: ws, Name: "Firma"}); u != "https://"+host+"/" {
		t.Fatalf("canonical: %q", u)
	}
	if e.notified(ws, "portal.domain_active") != 1 {
		t.Fatal("no notice of the active domain")
	}

	// The TXT record may go once proven; the CNAME may not: then the domain fails, falls back and the owners hear.
	e.dns.set(func(d *fakeDNS) { d.txt = map[string]string{} })
	e.tick()
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("after the TXT record went: %s", status)
	}
	e.cf.set(func(f *fakeCloudflare) { f.byName(host).Status = "moved" })
	e.tick()
	if status, problem := e.row(ws); status != "failed" || problem != ProblemDNS || e.notified(ws, "portal.domain_failed") != 1 {
		t.Fatalf("broken: %s %s", status, problem)
	}
	if u, _ := e.scopes.CanonicalURL(ctx, store.Workspace{ID: ws, Name: "Firma"}); !strings.HasPrefix(u, "https://portal.example.com/w/") {
		t.Fatalf("canonical after the domain broke: %q", u)
	}
	e.cf.activate(host, true)
	e.tick()
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("fixed: %s", status)
	}

	// Cloudflare not answering changes nothing.
	e.cf.set(func(f *fakeCloudflare) { f.down = true })
	e.tick()
	e.cf.set(func(f *fakeCloudflare) { f.down = false })
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("cloudflare down: %s", status)
	}

	if status, _ := e.do(owner, "DELETE", "/api/v1/workspace/portal/domain", nil); status != 204 {
		t.Fatalf("remove: %d", status)
	}
	if h, _ := e.scopes.ActiveDomain(ctx, ws); h != "" || len(e.cf.names()) != 0 {
		t.Fatalf("removed domain still resolves (%q) or is on Cloudflare: %v", h, e.cf.names())
	}
	var events int
	_ = e.raw.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind LIKE 'workspace.portal_domain_%'`, ws).Scan(&events)
	if events != 2 {
		t.Fatalf("%d audit events, want added and removed", events)
	}
	e.add(owner, host) // free again
}

// TestDailyCheckOfManyDomains: active domains are each asked about by id, never matched against a list of the zone,
// so none of them is taken for gone and created again (the review's blocker turned them failed past 50).
func TestDailyCheckOfManyDomains(t *testing.T) {
	e := newEnv(t)
	var wss []string
	for i := range 60 {
		b, ws := e.workspace(billing.Business, "owner")
		host := fmt.Sprintf("portal.f%02d.ch", i)
		e.add(b, host)
		e.cf.activate(host, true)
		e.prove(host)
		wss = append(wss, ws)
	}
	e.tick()
	e.cf.set(func(f *fakeCloudflare) { f.calls = map[string]int{} })
	e.clock = e.clock.Add(daily)
	e.tick()
	for _, ws := range wss {
		if status, problem := e.row(ws); status != "active" {
			t.Fatalf("%s after the daily check: %s %s", ws, status, problem)
		}
	}
	if e.cf.calls["GET"] != 60 || e.cf.calls["POST"]+e.cf.calls["PATCH"]+e.cf.calls["DELETE"] != 0 {
		t.Fatalf("daily check calls: %v", e.cf.calls)
	}
}

// TestDuplicate: Cloudflare already has the name. The zone's own leftover is adopted or made afresh; another
// account's is "taken"; an active domain never fails over its own hostname.
func TestDuplicate(t *testing.T) {
	ctx := context.Background()
	t.Run("a leftover no domain held is adopted", func(t *testing.T) {
		e := newEnv(t)
		owner, ws := e.workspace(billing.Business, "owner")
		id := e.cf.add("portal.left.ch", time.Now())
		e.add(owner, "portal.left.ch")
		if e.cfID(ws) != id || len(e.cf.names()) != 1 {
			t.Fatalf("adopted %q, want %q: %v", e.cfID(ws), id, e.cf.names())
		}
	})
	t.Run("a removed domain's hostname is made afresh", func(t *testing.T) {
		e := newEnv(t)
		first, firstWS := e.workspace(billing.Business, "owner")
		e.add(first, "portal.old.ch")
		old := e.cf.hostname("portal.old.ch")
		e.prove("portal.old.ch") // the former customer's record stays in the DNS
		// Removed, but Cloudflare's delete failed: the hostname stays behind.
		if _, err := e.raw.Exec(ctx, `UPDATE workspace_domains SET status = 'removed' WHERE workspace_id = $1`, firstWS); err != nil {
			t.Fatal(err)
		}
		second, ws := e.workspace(billing.Business, "owner")
		d := e.add(second, "portal.old.ch")
		fresh := e.cf.hostname("portal.old.ch")
		if fresh.ID == old.ID || fresh.Ownership.Value == old.Ownership.Value || e.cfID(ws) != fresh.ID {
			t.Fatalf("leftover reused: %v", d)
		}
		e.cf.activate("portal.old.ch", true)
		e.tick()
		if status, problem := e.row(ws); status != "pending" || problem != ProblemVerification {
			t.Fatalf("the former customer's record proved it: %s %s", status, problem)
		}
	})
	t.Run("another account's name is taken", func(t *testing.T) {
		e := newEnv(t)
		owner, ws := e.workspace(billing.Business, "owner")
		e.cf.set(func(f *fakeCloudflare) { f.elsewhere["portal.saas.ch"] = true })
		status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.saas.ch"})
		if code, _ := errorOf(out); status != 409 || code != "domain_elsewhere" {
			t.Fatalf("%d %v", status, out)
		}
		if status, _ := e.row(ws); status != "removed" {
			t.Fatalf("row after the refusal: %s", status)
		}
	})
	t.Run("an active domain whose hostname was made again keeps working", func(t *testing.T) {
		e := newEnv(t)
		owner, ws := e.workspace(billing.Business, "owner")
		e.add(owner, "portal.firm.ch")
		e.live("portal.firm.ch")
		// Cloudflare lost the id the domain has, and the zone has the name under another one.
		e.cf.set(func(f *fakeCloudflare) {
			h := f.byName("portal.firm.ch")
			delete(f.hosts, h.ID)
			f.order = nil
		})
		other := e.cf.add("portal.firm.ch", time.Now())
		e.clock = e.clock.Add(daily)
		e.tick()
		if status, problem := e.row(ws); status != "active" || e.cfID(ws) != other || e.notified(ws, "portal.domain_failed") != 0 {
			t.Fatalf("after its hostname changed: %s %s, %q", status, problem, e.cfID(ws))
		}
	})
	t.Run("an active domain moved to another account fails as taken", func(t *testing.T) {
		e := newEnv(t)
		owner, ws := e.workspace(billing.Business, "owner")
		e.add(owner, "portal.moved.ch")
		e.live("portal.moved.ch")
		e.cf.set(func(f *fakeCloudflare) {
			delete(f.hosts, f.byName("portal.moved.ch").ID)
			f.order = nil
			f.elsewhere["portal.moved.ch"] = true
		})
		e.tick()
		if status, problem := e.row(ws); status != "failed" || problem != ProblemTaken || e.notified(ws, "portal.domain_failed") != 1 {
			t.Fatalf("%s %s", status, problem)
		}
	})
}

// TestAttach: the custom hostname is made even when the request ends meanwhile, and deleted again when its row cannot
// be stored; Cloudflare refusing frees the name.
func TestAttach(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	owner, ws := e.workspace(billing.Business, "owner")
	now := e.clock
	row := func(host string) store.WorkspaceDomain {
		d := store.WorkspaceDomain{ID: auth.NewID("dom"), WorkspaceID: ws, Hostname: host, Status: store.DomainPending,
			NextCheckAt: now.Add(time.Hour), StatusSince: now, CreatedBy: "usr", CreatedAt: now}
		if err := e.st.CreateWorkspaceDomain(ctx, d); err != nil {
			t.Fatal(err)
		}
		return d
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	d := row("portal.cancel.ch")
	if err := e.svc.attach(cancelled, &d, now); err != nil || e.cfID(ws) != e.cf.hostname("portal.cancel.ch").ID {
		t.Fatalf("attach after the request ended: %v", err)
	}
	if err := e.st.RemoveWorkspaceDomain(ctx, d.ID, now); err != nil {
		t.Fatal(err)
	}

	d = row("portal.unsaved.ch")
	if err := e.st.RemoveWorkspaceDomain(ctx, d.ID, now); err != nil { // the row is gone before Cloudflare answers
		t.Fatal(err)
	}
	if err := e.svc.attach(ctx, &d, now); err == nil || e.cf.hostname("portal.unsaved.ch").ID != "" {
		t.Fatalf("hostname left without a row: %v", err)
	}

	e.cf.set(func(f *fakeCloudflare) { f.down = true })
	status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.down.ch"})
	if code, _ := errorOf(out); status != 502 || code != "domain_unavailable" {
		t.Fatalf("cloudflare down: %d %v", status, out)
	}
	e.cf.set(func(f *fakeCloudflare) { f.down = false })
	e.add(owner, "portal.down.ch") // free to try again
}

func TestAddRefused(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.workspace(billing.Business, "owner")
	admin, _ := e.workspace(billing.Business, "admin")
	member, _ := e.workspace(billing.Business, "member")
	pro, _ := e.workspace(billing.Pro, "owner")
	other, _ := e.workspace(billing.Business, "owner")
	e.add(owner, "portal.firma.ch")
	e.live("portal.firma.ch") // proven: no longer anyone else's to claim
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
		{"the target", admin, target, 422, "domain_reserved"},
		{"under the portal's domain", admin, "acme.example.com", 422, "domain_reserved"},
		{"ip", admin, "10.1.2.3", 422, "domain_reserved"},
		{"garbage", admin, "not a domain", 422, "domain_invalid"},
		{"a proven domain of another workspace", other, "PORTAL.firma.ch", 409, "domain_taken"},
		{"a second domain", owner, "other.firma.ch", 409, "domain_exists"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			status, out := e.do(tt.who, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": tt.host})
			code, details := errorOf(out)
			if status != tt.status || code != tt.code || details["verify"] != nil {
				t.Fatalf("%d %s, want %d %s: %v", status, code, tt.status, tt.code, out)
			}
		})
	}
	// Even with the claimant's take-over record in place, a proven domain is not taken over.
	_, otherWS := e.workspace(billing.Business, "owner")
	e.dns.set(func(d *fakeDNS) { d.txt[TXTPrefix+"portal.firma.ch"] = e.svc.Token(otherWS, "portal.firma.ch") })
	if status, _ := e.do(other, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.firma.ch"}); status != 409 {
		t.Fatalf("proven domain taken over: %d", status)
	}
	if len(e.cf.names()) != 1 {
		t.Fatalf("refusals left custom hostnames: %v", e.cf.names())
	}
}

// TestTakeOver: a name held without proof goes to the workspace that proves it owns it with its take-over record;
// the holder is told, and the claimant takes the custom hostname over, proven.
func TestTakeOver(t *testing.T) {
	e := newEnv(t)
	squatter, sq := e.workspace(billing.Business, "owner")
	owner, ws := e.workspace(billing.Business, "owner")
	const host = "portal.real.ch"
	e.add(squatter, host)
	held := e.cfID(sq)
	e.cf.activate(host, true) // the real owner's CNAME: still no proof for the squatter
	e.tick()

	status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": host})
	code, details := errorOf(out)
	verify, _ := details["verify"].(map[string]any)
	if status != 409 || code != "domain_taken" || verify["name"] != TXTPrefix+host || verify["value"] != e.svc.Token(ws, host) {
		t.Fatalf("claim without proof: %d %v", status, out)
	}
	e.dns.set(func(d *fakeDNS) { d.txt[TXTPrefix+host] = e.svc.Token(ws, host) })
	if d := e.add(owner, host); d["hostname"] != host || d["verified_at"] == nil || e.cfID(ws) != held {
		t.Fatalf("claim: %v", d)
	}
	if status, _ := e.row(sq); status != "removed" || e.notified(sq, "portal.domain_released") != 1 {
		t.Fatalf("squatter after the claim: %s", status)
	}
	var data string
	_ = e.raw.QueryRow(context.Background(), `SELECT data::text FROM notifications WHERE workspace_id = $1 AND event = 'portal.domain_released'`, sq).Scan(&data)
	if !strings.Contains(data, `"claimed"`) {
		t.Fatalf("release reason: %s", data)
	}
	e.tick()
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("claimed domain: %s", status)
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
	var rows int
	_ = e.raw.QueryRow(context.Background(), `SELECT count(*) FROM workspace_domains WHERE hostname = 'portal.race.ch' AND status <> 'removed'`).Scan(&rows)
	if won != 1 || rows != 1 || len(e.cf.names()) != 1 {
		t.Fatalf("%d workspaces got the hostname, %d rows, %v on Cloudflare", won, rows, e.cf.names())
	}
}

// TestConcurrentTicks: instances claim due domains with SKIP LOCKED, so each is checked once and its owners hear once.
func TestConcurrentTicks(t *testing.T) {
	e := newEnv(t)
	var wss []string
	for i := range 12 {
		b, ws := e.workspace(billing.Business, "owner")
		host := fmt.Sprintf("portal.c%02d.ch", i)
		e.add(b, host)
		e.cf.activate(host, true)
		e.prove(host)
		wss = append(wss, ws)
	}
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspace_domains SET next_check_at = $1`, e.clock.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	e.cf.set(func(f *fakeCloudflare) { f.calls = map[string]int{} })
	var wg sync.WaitGroup
	for range 3 {
		wg.Go(func() { e.svc.Tick(context.Background()) })
	}
	wg.Wait()
	for _, ws := range wss {
		if status, _ := e.row(ws); status != "active" || e.notified(ws, "portal.domain_active") != 1 {
			t.Fatalf("%s: %s, %d notices", ws, status, e.notified(ws, "portal.domain_active"))
		}
	}
	if n := e.cf.calls["PATCH"]; n != 12 {
		t.Fatalf("%d checks of 12 domains", n)
	}
}

func TestJob(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()

	// Pending: backoff grows; after 14 days unfinished it is released, its custom hostname deleted, the owners told.
	b, slow := e.workspace(billing.Business, "owner")
	e.add(b, "portal.slow.ch")
	e.tick()
	e.tick()
	var wait time.Duration
	_ = e.raw.QueryRow(ctx, `SELECT extract(epoch FROM next_check_at - last_checked_at)::bigint * interval '1 second' FROM workspace_domains WHERE workspace_id = $1`, slow).Scan(&wait)
	if wait != 4*time.Minute {
		t.Fatalf("backoff after 2 checks: %v", wait)
	}
	e.clock = e.clock.Add(releaseAfter)
	e.tick()
	if status, _ := e.row(slow); status != "removed" || e.notified(slow, "portal.domain_released") != 1 || e.cf.hostname("portal.slow.ch").ID != "" {
		t.Fatalf("after 14 days pending: %s", status)
	}

	// The plan loses the feature: off at once, kept past 14 days since it was proven, back with the plan.
	b, down := e.workspace(billing.Business, "owner")
	e.add(b, "portal.down.ch")
	e.live("portal.down.ch")
	if status, _ := e.row(down); status != "active" {
		t.Fatalf("before the downgrade: %s", status)
	}
	billingtest.On(t, e.st, down, billing.Pro)
	e.scopes.Forget()
	if host, _ := e.scopes.ActiveDomain(ctx, down); host != "" {
		t.Fatalf("resolves after the downgrade: %q", host)
	}
	e.tick()
	if status, problem := e.row(down); status != "failed" || problem != ProblemPlan {
		t.Fatalf("after the downgrade: %s %s", status, problem)
	}
	if _, out := e.do(b, "GET", "/api/v1/workspace/portal/domain", nil); domainOf(out)["releases_at"] != nil {
		t.Fatalf("a proven domain off for the plan shows a release date: %v", out)
	}
	e.clock = e.clock.Add(releaseAfter + daily)
	e.tick()
	if status, problem := e.row(down); status != "failed" || problem != ProblemPlan || e.cf.hostname("portal.down.ch").ID == "" {
		t.Fatalf("20 days after the downgrade: %s %s", status, problem)
	}
	billingtest.On(t, e.st, down, billing.Business)
	e.tick()
	if status, _ := e.row(down); status != "active" {
		t.Fatalf("after the upgrade: %s", status)
	}

	// A deleted workspace keeps its domain while it may be restored, and has it back when it is; then it goes.
	b, gone := e.workspace(billing.Business, "owner")
	e.add(b, "portal.gone.ch")
	e.live("portal.gone.ch")
	deleteWS := func() {
		if _, err := e.raw.Exec(ctx, `UPDATE workspaces SET deleted_at = $2 WHERE id = $1`, gone, e.clock); err != nil {
			t.Fatal(err)
		}
		e.scopes.Forget()
	}
	deleteWS()
	if h, _ := e.scopes.ActiveDomain(ctx, gone); h != "" {
		t.Fatalf("a deleted workspace's domain resolves: %q", h)
	}
	e.clock = e.clock.Add(restoreFor - time.Hour)
	if _, err := e.raw.Exec(ctx, `UPDATE workspace_domains SET status_since = $2 WHERE workspace_id <> $1`, gone, e.clock); err != nil {
		t.Fatal(err)
	}
	e.tick()
	if status, _ := e.row(gone); status != "active" {
		t.Fatalf("deleted workspace within 30 days: %s", status)
	}
	if _, err := e.raw.Exec(ctx, `UPDATE workspaces SET deleted_at = NULL WHERE id = $1`, gone); err != nil {
		t.Fatal(err)
	}
	e.scopes.Forget()
	if h, _ := e.scopes.ActiveDomain(ctx, gone); h != "portal.gone.ch" {
		t.Fatalf("restored workspace's domain: %q", h)
	}
	deleteWS()
	e.clock = e.clock.Add(restoreFor + time.Hour)
	if _, err := e.raw.Exec(ctx, `UPDATE workspace_domains SET status_since = $1 WHERE status = 'pending'`, e.clock); err != nil {
		t.Fatal(err)
	}
	e.tick()
	if status, _ := e.row(gone); status != "removed" || e.cf.hostname("portal.gone.ch").ID != "" {
		t.Fatalf("deleted workspace after 30 days: %s", status)
	}

	// Cloudflare's rate limit: the tick stops asking; nothing changes.
	b, limited := e.workspace(billing.Business, "owner")
	e.add(b, "portal.limited.ch")
	e.cf.set(func(f *fakeCloudflare) { f.limited = true })
	e.tick()
	if status, _ := e.row(limited); status != "pending" {
		t.Fatalf("rate limited: %s", status)
	}
}

// TestCleanup: the zone's custom hostnames no domain holds any more are deleted, over every page; names the app never
// had, young ones and one a domain is still being given stay.
func TestCleanup(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	old := time.Now().Add(-2 * time.Hour)
	b, ws := e.workspace(billing.Business, "owner")
	e.add(b, "portal.live.ch")
	liveID := e.cfID(ws)
	// Others' (Terraform's, say): never a domain's name.
	for i := range 70 {
		e.cf.add(fmt.Sprintf("x%02d.other.ch", i), old)
	}
	// A removed domain whose delete failed, and a later domain of the same name.
	_, ws2 := e.workspace(billing.Business, "owner")
	removed := func(host string) {
		if _, err := e.raw.Exec(ctx, `INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, status_since, created_by, created_at, updated_at)
			VALUES ($1, $2, $3, 'removed', now(), now(), 'usr', now(), now())`, auth.NewID("dom"), ws2, host); err != nil {
			t.Fatal(err)
		}
	}
	removed("portal.orphan.ch")
	orphan := e.cf.add("portal.orphan.ch", old)
	removed("portal.young.ch")
	e.cf.add("portal.young.ch", time.Now())
	// A second hostname of the live domain's name cannot exist on Cloudflare; a stale id of one that is held can.
	if _, err := e.raw.Exec(ctx, `INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, status_since, created_by, created_at, updated_at)
		VALUES ($1, $2, 'portal.inflight.ch', 'pending', now(), now(), 'usr', now(), now())`, auth.NewID("dom"), ws2); err != nil {
		t.Fatal(err)
	}
	e.cf.add("portal.inflight.ch", old)
	e.cf.set(func(f *fakeCloudflare) { f.calls = map[string]int{} })

	if err := e.svc.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	names := e.cf.names()
	if len(names) != 73 || e.cf.hostname("portal.orphan.ch").ID != "" || e.cf.hostname("portal.live.ch").ID != liveID ||
		e.cf.hostname("portal.young.ch").ID == "" || e.cf.hostname("portal.inflight.ch").ID == "" || e.cf.calls["DELETE"] != 1 || e.cf.calls["GET"] != 2 {
		t.Fatalf("after the cleanup (%v): %v", e.cf.calls, names)
	}
	_ = orphan
}
