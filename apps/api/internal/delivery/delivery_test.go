package delivery

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
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// fakeIntermediary stands in for a Peppol provider: it records what it was given and answers with fail, if set.
type fakeIntermediary struct {
	mu        sync.Mutex
	sent      []Document
	creds     [][]byte
	fail      error
	answer    string      // the status it answers; accepted when empty
	reason    string      // the reason it gives with a rejection
	deadlines []time.Time // each Send's context deadline (zero: none)
}

func (*fakeIntermediary) Name() string           { return "fake-peppol" }
func (*fakeIntermediary) Kind() Kind             { return Intermediary }
func (*fakeIntermediary) Formats() []string      { return []string{"peppol"} }
func (*fakeIntermediary) NeedsCredentials() bool { return true }
func (f *fakeIntermediary) Send(ctx context.Context, doc Document, creds []byte) (Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	deadline, _ := ctx.Deadline()
	f.deadlines = append(f.deadlines, deadline)
	if f.fail != nil {
		err := f.fail
		f.fail = nil
		return Result{}, err
	}
	f.sent = append(f.sent, doc)
	f.creds = append(f.creds, creds)
	if f.answer != "" {
		return Result{Status: f.answer, Reason: f.reason}, nil
	}
	return Result{Status: "accepted", ExternalID: "msg-" + doc.InvoiceID}, nil
}

type env struct {
	t    *testing.T
	st   *store.Store
	pool *pgxpool.Pool
	srv  *httptest.Server
	svc  *Service
	peer *fakeIntermediary
	logs *bytes.Buffer
}

var secret = bytes.Repeat([]byte{7}, 32)

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, pool := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: secret, SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	logs := &bytes.Buffer{}
	peer := &fakeIntermediary{}
	export := func(_ context.Context, _ store.Session, inv store.Invoice, format string) (string, []byte, error) {
		return *inv.Number + ".xml", []byte("<Invoice>" + format + "</Invoice>"), nil
	}
	svc, err := New(st, a, export, secret, slog.New(slog.NewTextHandler(logs, nil)), FileExport{}, peer)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, pool: pool, srv: srv, svc: svc, peer: peer, logs: logs}
}

type browser struct{ token, csrf, workspace string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Muster GmbH"}, "Europe/Zurich", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	e.exec(`INSERT INTO clients (id,workspace_id,number,name,is_company,country,created_at,updated_at)
		VALUES ($1||'-client',$1,1,'Buyer',true,'CH',now(),now())`, ws)
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatal(err)
	}
}

// issued inserts an issued invoice of the workspace.
func (e *env) issued(ws, id string) {
	e.t.Helper()
	e.exec(`INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,issue_date,due_date,currency,language,vat_mode,
		discount_percent,subtotal,discount_amount,net_total,vat_total,total,rounding_amount,vat_breakdown,amount_paid,
		amount_credited,created_at,updated_at)
		VALUES ($1,$2,'invoice','open',$1,$2||'-client','2026-11-01','2026-12-01','CHF','de','none',0,100,0,100,0,100,0,'[]',0,0,now(),now())`,
		id, ws)
}

func (e *env) send(b *browser, method, path string, body any) (int, []byte) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

func (e *env) transmissions(b *browser, invoice string) []store.Transmission {
	e.t.Helper()
	code, raw := e.send(b, "GET", "/api/v1/invoices/"+invoice+"/transmissions", nil)
	var out struct{ Data []store.Transmission }
	if code != http.StatusOK || json.Unmarshal(raw, &out) != nil {
		e.t.Fatalf("list: %d %s", code, raw)
	}
	return out.Data
}

func TestExportChannelQueuesAndSends(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.issued(b.workspace, "inv_1")
	if code, raw := e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "export", "format": "xrechnung-ubl"}); code != http.StatusAccepted {
		t.Fatalf("queue: %d %s", code, raw)
	}
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	got := e.transmissions(b, "inv_1")
	if len(got) != 1 || got[0].Status != "sent" || got[0].ExternalID == nil || *got[0].ExternalID != "inv_1.xml" {
		t.Fatalf("transmissions: %+v", got)
	}
	// queueing it again changes nothing: one transmission per invoice, channel and format
	e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "export", "format": "xrechnung-ubl"})
	if got := e.transmissions(b, "inv_1"); len(got) != 1 || got[0].Status != "sent" {
		t.Fatalf("after a second queue: %+v", got)
	}
}

func TestQueueRefusals(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	other := e.workspace()
	e.issued(b.workspace, "inv_1")
	e.issued(other.workspace, "inv_2")
	for _, c := range []struct {
		name, invoice, channel, format string
		want                           int
	}{
		{"unknown channel", "inv_1", "carrier-pigeon", "peppol", http.StatusUnprocessableEntity},
		{"format the channel does not take", "inv_1", "fake-peppol", "xrechnung-cii", http.StatusUnprocessableEntity},
		{"channel without credentials", "inv_1", "fake-peppol", "peppol", http.StatusConflict},
		{"another workspace's invoice", "inv_2", "export", "peppol", http.StatusNotFound},
	} {
		if code, raw := e.send(b, "POST", "/api/v1/invoices/"+c.invoice+"/transmissions", map[string]string{"channel": c.channel, "format": c.format}); code != c.want {
			t.Errorf("%s: %d %s, want %d", c.name, code, raw, c.want)
		}
	}
}

func TestIntermediaryGetsSealedCredentialsAndRetries(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	member := e.join(b.workspace, "member")
	e.issued(b.workspace, "inv_1")
	creds := map[string]any{"credentials": map[string]string{"api_key": "sk_live_SECRET123"}}
	if code, _ := e.send(member, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", creds); code != http.StatusForbidden {
		t.Fatalf("member set credentials: %d", code)
	}
	if code, raw := e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", creds); code != http.StatusNoContent {
		t.Fatalf("set credentials: %d %s", code, raw)
	}
	// never stored or answered in clear
	var sealed []byte
	if err := e.pool.QueryRow(context.Background(), `SELECT sealed FROM transmission_credentials WHERE workspace_id=$1`, b.workspace).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("SECRET123")) {
		t.Fatal("credentials stored in clear")
	}
	if _, raw := e.send(b, "GET", "/api/v1/transmission-channels", nil); bytes.Contains(raw, []byte("SECRET123")) ||
		!bytes.Contains(raw, []byte(`"name":"fake-peppol","kind":"intermediary","formats":["peppol"],"needs_credentials":true,"configured":true`)) {
		t.Fatalf("channels: %s", raw)
	}

	e.peer.fail = errors.New("provider unavailable")
	e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "fake-peppol", "format": "peppol"})
	now := time.Now()
	if err := e.svc.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if got := e.transmissions(b, "inv_1"); got[0].Status != "queued" || got[0].LastError == nil || got[0].Attempts != 1 {
		t.Fatalf("after a failure: %+v", got[0])
	}
	if err := e.svc.Tick(context.Background(), now.Add(30*time.Second)); err != nil || len(e.peer.sent) != 0 {
		t.Fatalf("retried before its backoff: %v %d", err, len(e.peer.sent))
	}
	if err := e.svc.Tick(context.Background(), now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	got := e.transmissions(b, "inv_1")
	if got[0].Status != "accepted" || *got[0].ExternalID != "msg-inv_1" || got[0].LastError != nil {
		t.Fatalf("after the retry: %+v", got[0])
	}
	// A failure with a retry left tells nobody; the delivery does.
	if ev := e.events(b.workspace); !slices.Equal(ev["owner"], []string{"einvoice.delivered"}) {
		t.Fatalf("notifications: %v", ev)
	}
	if string(e.peer.creds[0]) != `{"api_key":"sk_live_SECRET123"}` || strings.Contains(e.logs.String(), "SECRET123") {
		t.Fatalf("channel got %q; logs %s", e.peer.creds, e.logs)
	}
}

// events: each role's notifications in the workspace, newest first (one person per role).
func (e *env) events(ws string) map[string][]string {
	e.t.Helper()
	ctx := context.Background()
	members, err := e.st.ListMembers(ctx, ws)
	if err != nil {
		e.t.Fatal(err)
	}
	out := map[string][]string{}
	for _, m := range members {
		got, err := e.st.Notifications(ctx, ws, m.UserID, store.NotificationFilter{Limit: 50})
		if err != nil {
			e.t.Fatal(err)
		}
		for _, n := range got {
			out[m.Role] = append(out[m.Role], n.Event)
		}
	}
	return out
}

func TestPermanentFailureAndManualRetry(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.join(b.workspace, "member")
	other := e.workspace()
	e.issued(b.workspace, "inv_1")
	e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}})
	e.peer.fail = Permanent{errors.New("recipient not registered on Peppol")}
	_, raw := e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "fake-peppol", "format": "peppol"})
	var queued struct{ Data store.Transmission }
	_ = json.Unmarshal(raw, &queued)
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := e.transmissions(b, "inv_1"); got[0].Status != "failed" || got[0].NextAttempt != nil {
		t.Fatalf("permanent failure: %+v", got[0])
	}
	if got := e.events(b.workspace); !slices.Equal(got["owner"], []string{"einvoice.delivery_failed"}) || len(got["member"]) != 0 {
		t.Fatalf("after the failure: %v", got)
	}
	retry := "/api/v1/invoices/inv_1/transmissions/" + queued.Data.ID + "/retry"
	if code, raw := e.send(b, "POST", retry, nil); code != http.StatusAccepted {
		t.Fatalf("retry: %d %s", code, raw)
	}
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := e.transmissions(b, "inv_1"); got[0].Status != "accepted" {
		t.Fatalf("after a manual retry: %+v", got[0])
	}
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := e.events(b.workspace); !slices.Equal(got["owner"], []string{"einvoice.delivered", "einvoice.delivery_failed"}) ||
		len(got["member"]) != 0 || len(e.events(other.workspace)) != 0 {
		t.Fatalf("after the retry: %v", got)
	}
	if code, _ := e.send(b, "POST", retry, nil); code != http.StatusConflict {
		t.Fatalf("retry of an accepted transmission: %d", code)
	}
}

func TestConcurrentJobsSendEachTransmissionOnce(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}})
	const n = 120
	now := time.Now()
	for i := range n {
		id := "inv_" + string(rune('a'+i/26)) + string(rune('a'+i%26))
		e.issued(b.workspace, id)
		if _, _, err := e.st.QueueTransmission(context.Background(), store.Transmission{ID: auth.NewID("trn"),
			WorkspaceID: b.workspace, InvoiceID: id, Channel: "fake-peppol", Format: "peppol"}, now); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if err := e.svc.Tick(context.Background(), now); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	seen := map[string]int{}
	for _, d := range e.peer.sent {
		seen[d.InvoiceID]++
	}
	if len(e.peer.sent) != n || len(seen) != n {
		t.Fatalf("sent %d documents for %d invoices, want %d once each", len(e.peer.sent), len(seen), n)
	}
}

func TestSealRoundTripIsBoundToWorkspaceAndChannel(t *testing.T) {
	s, err := newSealer(secret)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := s.seal("wsp_a", "storecove", []byte(`{"api_key":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if plain, err := s.open("wsp_a", "storecove", sealed); err != nil || string(plain) != `{"api_key":"x"}` {
		t.Fatalf("round trip: %q %v", plain, err)
	}
	for _, c := range [][2]string{{"wsp_b", "storecove"}, {"wsp_a", "b2brouter"}} {
		if _, err := s.open(c[0], c[1], sealed); err == nil {
			t.Errorf("credentials of wsp_a/storecove opened as %v", c)
		}
	}
	other, _ := newSealer(bytes.Repeat([]byte{8}, 32))
	if _, err := other.open("wsp_a", "storecove", sealed); err == nil {
		t.Error("opened with another SECRET_KEY")
	}
	if _, err := newSealer([]byte("short")); err == nil {
		t.Error("accepted a short secret")
	}
}

// A channel that refuses the document (status rejected) is a failed delivery for the managers, not a delivered one.
func TestRejectedTransmissionIsNotNotifiedAsDelivered(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.issued(b.workspace, "inv_1")
	e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}})
	e.peer.answer = "rejected"
	e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "fake-peppol", "format": "peppol"})
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := e.transmissions(b, "inv_1"); got[0].Status != "rejected" {
		t.Fatalf("transmission: %+v", got[0])
	}
	if got := e.events(b.workspace); !slices.Equal(got["owner"], []string{"einvoice.delivery_failed"}) {
		t.Fatalf("notifications: %v", got)
	}
}

// A claim is a lease: the job must not hand a transmission to its channel once (or for longer than) the lease
// can have ended, or another instance that reclaimed it would send the same document again. Each Send gets the
// transmission's id as an idempotency key, so a channel can recognise a retry after an unknown outcome.
func TestSendsStayWithinTheirLease(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}})
	ctx := context.Background()
	queue := func(invoice string, at time.Time) string {
		e.issued(b.workspace, invoice)
		got, _, err := e.st.QueueTransmission(ctx, store.Transmission{ID: auth.NewID("trn"), WorkspaceID: b.workspace,
			InvoiceID: invoice, Channel: "fake-peppol", Format: "peppol"}, at)
		if err != nil {
			t.Fatal(err)
		}
		return got.ID
	}

	// a run whose lease would already have ended (a stalled instance): nothing is sent, the row stays queued
	stale := time.Now().Add(-lease - time.Minute)
	queue("inv_stale", stale)
	if err := e.svc.Tick(ctx, stale); err != nil {
		t.Fatal(err)
	}
	if len(e.peer.sent) != 0 {
		t.Fatalf("sent %d documents after their lease ended", len(e.peer.sent))
	}
	if got := e.transmissions(b, "inv_stale"); got[0].Status != "queued" {
		t.Fatalf("stale claim: %+v", got[0])
	}

	now := time.Now()
	id := queue("inv_1", now)
	if err := e.svc.Tick(ctx, now); err != nil {
		t.Fatal(err)
	}
	var sent []string
	for i, d := range e.peer.sent {
		sent = append(sent, d.InvoiceID)
		if dl := e.peer.deadlines[i]; dl.IsZero() || !dl.Before(now.Add(lease)) {
			t.Errorf("%s sent with deadline %v, want before the lease end %v", d.InvoiceID, dl, now.Add(lease))
		}
		if d.InvoiceID == "inv_1" && d.TransmissionID != id {
			t.Errorf("idempotency key %q, want the transmission id %q", d.TransmissionID, id)
		}
	}
	// the stale row's lease ended, so this run reclaims and sends it as well, once
	if slices.Sort(sent); !slices.Equal(sent, []string{"inv_1", "inv_stale"}) {
		t.Fatalf("sent %v", sent)
	}
}

// Only the XML's own refusals (the API's 4xx answers: invalid_state, einvoice_*) fail a transmission at once; a
// database or archive outage while producing it is retried like a channel outage.
func TestExportErrorsFailOnlyWhenPermanent(t *testing.T) {
	for _, c := range []struct {
		name   string
		err    error
		status string
	}{
		{"outage", errors.New("load invoice: connection reset"), "queued"},
		{"archive unavailable", auth.Error(http.StatusServiceUnavailable, "einvoice_archive_unavailable", "later", nil), "queued"},
		{"XML refused", auth.Error(http.StatusConflict, "einvoice_endpoint_missing", "no endpoint", nil), "failed"},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			e.issued(b.workspace, "inv_1")
			// queueing checks the XML too; it fails only when the job produces it
			e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "export", "format": "peppol"})
			e.svc.export = func(context.Context, store.Session, store.Invoice, string) (string, []byte, error) {
				return "", nil, c.err
			}
			if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
				t.Fatal(err)
			}
			if got := e.transmissions(b, "inv_1"); got[0].Status != c.status {
				t.Fatalf("status %q, want %q: %+v", got[0].Status, c.status, got[0])
			}
		})
	}
}
