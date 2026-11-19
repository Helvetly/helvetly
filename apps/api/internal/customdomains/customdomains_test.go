package customdomains

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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

const target = "domains.example.com"

// fakeWorld is the internet as the checker sees it: which hosts point at the target, which TXT records exist, which
// hosts answer over HTTPS.
type fakeWorld struct {
	mu      sync.Mutex
	points  map[string]bool
	txt     map[string]string
	serves  map[string]bool
	dnsDown bool
}

func (f *fakeWorld) PointsAt(_ context.Context, host, to string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.dnsDown {
		return false, errors.New("dns timeout")
	}
	return to == target && f.points[host], nil
}

func (f *fakeWorld) HasTXT(_ context.Context, name, value string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.dnsDown {
		return false, errors.New("dns timeout")
	}
	return f.txt[name] == value, nil
}

func (f *fakeWorld) Serves(_ context.Context, host string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.serves[host] {
		return errors.New("tls: no certificate yet")
	}
	return nil
}

func (f *fakeWorld) set(fn func(*fakeWorld)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

type env struct {
	t      *testing.T
	st     *store.Store
	raw    *pgxpool.Pool
	srv    *httptest.Server
	world  *fakeWorld
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
	world := &fakeWorld{points: map[string]bool{}, txt: map[string]string{}, serves: map[string]bool{}}
	scopes := portalscope.New("https://portal.example.com", st.Q)
	scopes.EnableDomains("https://app.example.com")
	svc := New(st, a, world, target, []string{"https://app.example.com", "https://portal.example.com"}, bytes.Repeat([]byte{9}, 32), scopes, discard)
	e := &env{t: t, st: st, raw: raw, world: world, svc: svc, scopes: scopes, clock: time.Now().UTC()}
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

// prove gives host both records of workspace ws.
func (e *env) prove(ws, host string) {
	e.world.set(func(w *fakeWorld) {
		w.points[host] = true
		w.txt[TXTPrefix+host] = e.svc.Token(ws, host)
	})
}

func (e *env) certifiable(host string) int {
	e.t.Helper()
	res, err := http.Get(e.srv.URL + "/api/v1/public/portal/domain-check?domain=" + url.QueryEscape(host))
	if err != nil {
		e.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
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

// fakeResolver answers like DNS: cnames and addrs per name, txt per name; anything else does not exist.
type fakeResolver struct {
	cnames map[string]string
	addrs  map[string][]string
	txt    map[string][]string
	fail   bool
}

var errNXDomain = &net.DNSError{Err: "no such host", IsNotFound: true}

func (f fakeResolver) LookupCNAME(_ context.Context, host string) (string, error) {
	if f.fail {
		return "", &net.DNSError{Err: "timeout", IsTimeout: true}
	}
	if c, ok := f.cnames[host]; ok {
		return c, nil
	}
	if _, ok := f.addrs[host]; ok {
		return host + ".", nil
	}
	return "", errNXDomain
}

func (f fakeResolver) LookupHost(_ context.Context, host string) ([]string, error) {
	if a, ok := f.addrs[host]; ok {
		return a, nil
	}
	return nil, errNXDomain
}

func (f fakeResolver) LookupTXT(_ context.Context, name string) ([]string, error) {
	if t, ok := f.txt[name]; ok {
		return t, nil
	}
	return nil, errNXDomain
}

func TestNetChecker(t *testing.T) {
	ctx := context.Background()
	c := netChecker{dns: fakeResolver{
		cnames: map[string]string{"portal.firma.ch": "Domains.Example.com.", "portal.elsewhere.ch": "other.example.net."},
		addrs: map[string][]string{"domains.example.com": {"203.0.113.7", "2001:db8::7"}, "portal.flat.ch": {"203.0.113.7"},
			"portal.wrongip.ch": {"198.51.100.1"}, "other.example.net": {"198.51.100.2"}},
		txt: map[string][]string{TXTPrefix + "portal.firma.ch": {"v=spf1", "helvetly-abc"}},
	}}
	for host, want := range map[string]bool{"portal.firma.ch": true, "portal.flat.ch": true, "portal.wrongip.ch": false,
		"portal.elsewhere.ch": false, "portal.nowhere.ch": false} {
		if got, err := c.PointsAt(ctx, host, target); got != want || err != nil {
			t.Errorf("PointsAt(%s) = %v %v, want %v", host, got, err, want)
		}
	}
	if ok, err := c.HasTXT(ctx, TXTPrefix+"portal.firma.ch", "helvetly-abc"); !ok || err != nil {
		t.Fatalf("txt present: %v %v", ok, err)
	}
	if ok, err := c.HasTXT(ctx, TXTPrefix+"portal.firma.ch", "helvetly-other"); ok || err != nil {
		t.Fatalf("other txt: %v %v", ok, err)
	}
	if ok, err := c.HasTXT(ctx, TXTPrefix+"portal.none.ch", "x"); ok || err != nil {
		t.Fatalf("no txt: %v %v", ok, err)
	}
	if _, err := (netChecker{dns: fakeResolver{fail: true}}).PointsAt(ctx, "portal.firma.ch", target); err == nil {
		t.Fatal("a DNS timeout is no answer")
	}
}

func TestLifecycle(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.workspace(billing.Business, "owner")
	ctx := context.Background()
	const host = "portal.firma.ch"

	d := e.add(owner, "https://Portal.Firma.ch/")
	records, _ := d["records"].([]any)
	cname, _ := records[0].(map[string]any)
	txt, _ := records[1].(map[string]any)
	if d["hostname"] != host || d["stage"] != "dns" || d["releases_at"] == nil || len(records) != 2 ||
		cname["type"] != "CNAME" || cname["value"] != target || txt["type"] != "TXT" || txt["name"] != TXTPrefix+host || txt["value"] != e.svc.Token(ws, host) {
		t.Fatalf("added: %v", d)
	}
	if e.certifiable(host) != 404 {
		t.Fatal("certificate for an unproven domain")
	}

	// The CNAME alone (a dangling one, say) proves nothing: no certificate, not active.
	e.world.set(func(w *fakeWorld) { w.points[host] = true; w.serves[host] = true })
	e.tick()
	if status, problem := e.row(ws); status != "pending" || problem != ProblemVerification || e.certifiable(host) != 404 {
		t.Fatalf("cname only: %s %s", status, problem)
	}
	// With the TXT record: proven, certifiable; waiting for the certificate until HTTPS answers.
	e.world.set(func(w *fakeWorld) { w.serves[host] = false })
	e.prove(ws, host)
	e.tick()
	if _, out := e.do(owner, "GET", "/api/v1/workspace/portal/domain", nil); domainOf(out)["stage"] != "certificate" || domainOf(out)["verified_at"] == nil {
		t.Fatalf("certificate stage: %v", out)
	}
	if e.certifiable(host) != 200 || e.certifiable("PORTAL.FIRMA.CH") != 200 {
		t.Fatal("proven domain not certifiable")
	}
	e.world.set(func(w *fakeWorld) { w.serves[host] = true })
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
	e.world.set(func(w *fakeWorld) { delete(w.txt, TXTPrefix+host) })
	e.tick()
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("after the TXT record went: %s", status)
	}
	e.world.set(func(w *fakeWorld) { w.points[host] = false })
	e.tick()
	if status, problem := e.row(ws); status != "failed" || problem != ProblemDNS || e.notified(ws, "portal.domain_failed") != 1 {
		t.Fatalf("broken: %s %s", status, problem)
	}
	if u, _ := e.scopes.CanonicalURL(ctx, store.Workspace{ID: ws, Name: "Firma"}); !strings.HasPrefix(u, "https://portal.example.com/w/") {
		t.Fatalf("canonical after the domain broke: %q", u)
	}
	e.world.set(func(w *fakeWorld) { w.points[host] = true })
	e.tick()
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("fixed: %s", status)
	}

	// The DNS not answering changes nothing.
	e.world.set(func(w *fakeWorld) { w.dnsDown = true })
	e.tick()
	e.world.set(func(w *fakeWorld) { w.dnsDown = false })
	if status, _ := e.row(ws); status != "active" {
		t.Fatalf("dns down: %s", status)
	}

	if status, _ := e.do(owner, "DELETE", "/api/v1/workspace/portal/domain", nil); status != 204 {
		t.Fatalf("remove: %d", status)
	}
	if host, _ := e.scopes.ActiveDomain(ctx, ws); host != "" || e.certifiable("portal.firma.ch") != 404 {
		t.Fatalf("removed domain still resolves or certifies: %q", host)
	}
	var events int
	_ = e.raw.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind LIKE 'workspace.portal_domain_%'`, ws).Scan(&events)
	if events != 2 {
		t.Fatalf("%d audit events, want added and removed", events)
	}
	e.add(owner, host) // free again
}

func TestAddRefused(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.workspace(billing.Business, "owner")
	admin, _ := e.workspace(billing.Business, "admin")
	member, _ := e.workspace(billing.Business, "member")
	pro, _ := e.workspace(billing.Pro, "owner")
	other, _ := e.workspace(billing.Business, "owner")
	e.add(owner, "portal.firma.ch")
	e.prove(ws, "portal.firma.ch")
	e.tick() // proven: no longer anyone else's to claim
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
	// Even with the claimant's TXT record in place, a proven domain is not taken over.
	_, otherWS := e.workspace(billing.Business, "owner")
	e.world.set(func(w *fakeWorld) { w.txt[TXTPrefix+"portal.firma.ch"] = e.svc.Token(otherWS, "portal.firma.ch") })
	if status, _ := e.do(other, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": "portal.firma.ch"}); status != 409 {
		t.Fatalf("proven domain taken over: %d", status)
	}
}

// TestTakeOver: a name held without proof goes to the workspace that proves it owns it; the holder is told.
func TestTakeOver(t *testing.T) {
	e := newEnv(t)
	squatter, sq := e.workspace(billing.Business, "owner")
	owner, ws := e.workspace(billing.Business, "owner")
	const host = "portal.real.ch"
	e.add(squatter, host)
	e.world.set(func(w *fakeWorld) { w.points[host] = true }) // the real owner's CNAME: still no proof for the squatter
	e.tick()

	status, out := e.do(owner, "PUT", "/api/v1/workspace/portal/domain", map[string]string{"hostname": host})
	code, details := errorOf(out)
	verify, _ := details["verify"].(map[string]any)
	if status != 409 || code != "domain_taken" || verify["name"] != TXTPrefix+host || verify["value"] != e.svc.Token(ws, host) {
		t.Fatalf("claim without proof: %d %v", status, out)
	}
	e.prove(ws, host)
	if d := e.add(owner, host); d["hostname"] != host {
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
	_ = squatter
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
	if won != 1 || rows != 1 {
		t.Fatalf("%d workspaces got the hostname, %d rows", won, rows)
	}
}

func TestJob(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()

	// Pending: backoff grows; after 14 days unfinished it is released and the owners hear.
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
	if status, _ := e.row(slow); status != "removed" || e.notified(slow, "portal.domain_released") != 1 {
		t.Fatalf("after 14 days pending: %s", status)
	}

	// The plan loses the feature: off at once (not served, no certificate), back with the plan.
	b, down := e.workspace(billing.Business, "owner")
	e.add(b, "portal.down.ch")
	e.prove(down, "portal.down.ch")
	e.world.set(func(w *fakeWorld) { w.serves["portal.down.ch"] = true })
	e.tick()
	if status, _ := e.row(down); status != "active" {
		t.Fatalf("before the downgrade: %s", status)
	}
	billingtest.On(t, e.st, down, billing.Pro)
	e.scopes.Forget()
	if host, _ := e.scopes.ActiveDomain(ctx, down); host != "" {
		t.Fatalf("resolves after the downgrade: %q", host)
	}
	e.tick()
	if status, problem := e.row(down); status != "failed" || problem != ProblemPlan || e.certifiable("portal.down.ch") != 404 {
		t.Fatalf("after the downgrade: %s %s", status, problem)
	}
	billingtest.On(t, e.st, down, billing.Business)
	e.tick()
	if status, _ := e.row(down); status != "active" {
		t.Fatalf("after the upgrade: %s", status)
	}

	// A deleted workspace keeps its domain while it may be restored, then it goes.
	b, gone := e.workspace(billing.Business, "owner")
	e.add(b, "portal.gone.ch")
	if _, err := e.raw.Exec(ctx, `UPDATE workspaces SET deleted_at = $2 WHERE id = $1`, gone, e.clock); err != nil {
		t.Fatal(err)
	}
	e.clock = e.clock.Add(restoreFor - time.Hour)
	if _, err := e.raw.Exec(ctx, `UPDATE workspace_domains SET status_since = $2 WHERE workspace_id <> $1`, gone, e.clock); err != nil {
		t.Fatal(err)
	}
	e.tick()
	if status, _ := e.row(gone); status != "pending" {
		t.Fatalf("deleted workspace within 30 days: %s", status)
	}
	e.clock = e.clock.Add(2 * time.Hour)
	e.tick()
	if status, _ := e.row(gone); status != "removed" {
		t.Fatalf("deleted workspace after 30 days: %s", status)
	}
}
