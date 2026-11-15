package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
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

const whsec = "whsec_test"

// priceIDs are the fake Stripe's prices by lookup key (the catalogue tool makes them).
var priceIDs = map[string]string{"helvetly_basic_month": "price_bm", "helvetly_basic_year": "price_by", "helvetly_pro_month": "price_pm",
	"helvetly_pro_year": "price_py", "helvetly_business_month": "price_xm", "helvetly_business_year": "price_xy"}

func lookupKeyOf(id string) string {
	for k, v := range priceIDs {
		if v == id {
			return k
		}
	}
	return ""
}

func catalog() map[string]map[string]any {
	out := map[string]map[string]any{}
	for key, id := range priceIDs {
		plan, interval := planOfKey(key)
		out[key] = map[string]any{"id": id, "lookup_key": key, "currency": "chf", "unit_amount": PlanAmount(plan, interval), "product": "prod_" + plan,
			"currency_options": options(PlanAmount(plan, interval))}
	}
	return out
}

// options are a price's EUR and USD currency options at the same figure, as the catalogue tool makes them.
func options(amount int64) map[string]any {
	return map[string]any{EUR: map[string]any{"unit_amount": amount}, USD: map[string]any{"unit_amount": amount}}
}

// expanded is p as Stripe answers: currency_options only when the request expanded them.
func expanded(r *http.Request, p map[string]any) map[string]any {
	if slices.Contains(r.Form["expand[]"], "data.currency_options") {
		return p
	}
	out := maps.Clone(p)
	delete(out, "currency_options")
	return out
}

// fakeStripe answers the calls billing makes, keeping subscriptions in memory.
type fakeStripe struct {
	mu        sync.Mutex
	subs      map[string]map[string]any
	calls     []string
	forms     map[string]url.Values // last form per "METHOD path"
	keys      map[string]string     // last Idempotency-Key per "METHOD path"
	customers int
	currency  map[string]string // the currency Stripe fixed for a customer id; none until set
	noOptions bool              // the prices have no currency options (a catalogue from before them)
	fail      bool
	catalog   map[string]map[string]any // prices by lookup key
	perSeat   bool                      // the catalogue's prices are per seat (setPerSeat)
	promos    map[string]map[string]any // promotion codes by code
	coupons   map[string]map[string]any
	charges   map[string]map[string]any // by id
	invoiced  map[string]string         // the subscription whose invoice a payment intent paid
	disputes  map[string]map[string]any // by id, charge is the charge's id
	sessions  []map[string]any          // Checkout Sessions, found by payment_intent or by customer and status
	declines  bool                      // a change that waits for its payment (pending_if_incomplete) is declined
	invoices  map[string]map[string]any // by id, beyond the customer's listed ones
	voided    []string                  // the invoices voided, in order
	// held, when set, pauses the first request to that "METHOD path" (reached closes) until resume closes
	held            string
	reached, resume chan struct{}
}

// promo adds a promotion code; products (when set) is the coupon's applies_to.
func (f *fakeStripe) promo(code string, active bool, expiresAt int64, max, redeemed int, products ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	coupon := map[string]any{"id": "co_" + code, "percent_off": 20.0, "duration": "repeating", "duration_in_months": 3, "valid": true}
	if len(products) > 0 {
		coupon["applies_to"] = map[string]any{"products": products}
	}
	f.coupons[coupon["id"].(string)] = coupon
	p := map[string]any{"id": "promo_" + code, "code": code, "active": active, "max_redemptions": max, "times_redeemed": redeemed,
		"promotion": map[string]any{"type": "coupon", "coupon": coupon["id"]}}
	if expiresAt != 0 {
		p["expires_at"] = expiresAt
	}
	f.promos[code] = p
}

func (f *fakeStripe) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	if f.held != "" && f.held == r.Method+" "+r.URL.Path {
		f.held = ""
		f.mu.Unlock()
		close(f.reached)
		<-f.resume
		f.mu.Lock()
	}
	defer f.mu.Unlock()
	_ = r.ParseForm()
	key := r.Method + " " + r.URL.Path
	f.calls = append(f.calls, key)
	f.forms[key] = r.Form
	f.keys[key] = r.Header.Get("Idempotency-Key")
	if f.fail {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such thing"}}`)
		return
	}
	reply := func(v any) { _ = json.NewEncoder(w).Encode(v) }
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/"), "/")
	switch {
	case key == "POST /v1/customers":
		f.customers++
		reply(map[string]string{"id": fmt.Sprintf("cus_%d", f.customers)})
	case parts[0] == "customers" && len(parts) == 2 && r.Method == http.MethodGet:
		c := map[string]any{"id": parts[1], "currency": nil}
		if cur := f.currency[parts[1]]; cur != "" {
			c["currency"] = cur
		}
		reply(c)
	case key == "GET /v1/checkout/sessions":
		data := []map[string]any{}
		for _, cs := range f.sessions {
			byIntent := r.Form.Has("payment_intent") && cs["payment_intent"] == r.Form.Get("payment_intent")
			byCustomer := r.Form.Has("customer") && cs["customer"] == r.Form.Get("customer") && cs["status"] == r.Form.Get("status")
			if byIntent || byCustomer {
				data = append(data, cs)
			}
		}
		reply(map[string]any{"data": data})
	case parts[0] == "checkout" && len(parts) == 3 && r.Method == http.MethodGet:
		for _, cs := range f.sessions {
			if cs["id"] == parts[2] {
				reply(cs)
				return
			}
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such session"}}`)
	case parts[0] == "checkout" && len(parts) == 4 && parts[3] == "expire":
		for _, cs := range f.sessions {
			if cs["id"] == parts[2] {
				cs["status"] = "expired"
			}
		}
		reply(map[string]any{"id": parts[2], "status": "expired"})
	case key == "GET /v1/invoice_payments" && r.Form.Has("invoice"):
		reply(map[string]any{"data": []map[string]any{{"is_default": true,
			"payment": map[string]any{"type": "payment_intent", "payment_intent": "pi_" + r.Form.Get("invoice")}}}})
	case parts[0] == "payment_intents" && len(parts) == 2:
		reply(map[string]any{"id": parts[1], "status": "requires_payment_method",
			"last_payment_error": map[string]any{"code": "card_declined", "decline_code": "insufficient_funds"}})
	case parts[0] == "invoices" && len(parts) == 2 && r.Method == http.MethodGet:
		reply(f.invoices[parts[1]])
	case parts[0] == "invoices" && len(parts) == 3 && parts[2] == "void":
		f.voided = append(f.voided, parts[1])
		f.invoices[parts[1]]["status"] = "void"
		reply(f.invoices[parts[1]])
	case key == "GET /v1/invoices" && r.Form.Has("subscription"):
		data := []map[string]any{}
		for _, inv := range f.invoices {
			if inv["subscription"] == r.Form.Get("subscription") && inv["status"] == r.Form.Get("status") {
				data = append(data, inv)
			}
		}
		reply(map[string]any{"data": data})
	case key == "GET /v1/invoice_payments":
		data := []map[string]any{}
		if r.Form.Get("payment[type]") == "payment_intent" {
			if sub, ok := f.invoiced[r.Form.Get("payment[payment_intent]")]; ok {
				data = append(data, map[string]any{"invoice": map[string]any{"id": "in_" + sub, "parent": map[string]any{
					"type": "subscription_details", "subscription_details": map[string]any{"subscription": sub}}}})
			}
		}
		reply(map[string]any{"data": data})
	case parts[0] == "charges" && len(parts) == 2:
		reply(f.charges[parts[1]])
	case parts[0] == "disputes" && len(parts) == 2:
		d := maps.Clone(f.disputes[parts[1]])
		d["charge"] = f.charges[d["charge"].(string)]
		reply(d)
	case key == "POST /v1/checkout/sessions":
		reply(map[string]string{"url": "https://checkout.stripe.test/c"})
	case key == "POST /v1/billing_portal/sessions":
		reply(map[string]string{"url": "https://billing.stripe.test/p"})
	case key == "GET /v1/invoices":
		reply(map[string]any{"data": []map[string]any{
			{"id": "in_1", "number": "HX-0001", "created": 1767225600, "total": 1900, "currency": "chf", "status": "paid",
				"hosted_invoice_url": "https://invoice.stripe.test/1", "invoice_pdf": "https://invoice.stripe.test/1.pdf"},
			{"id": "in_2", "status": "draft"},
		}})
	case key == "GET /v1/payment_methods":
		reply(map[string]any{"data": []map[string]any{{"card": map[string]any{"brand": "visa", "last4": "4242", "exp_month": 12, "exp_year": 2030}}}})
	case key == "GET /v1/prices":
		data := []map[string]any{}
		for _, k := range r.Form["lookup_keys[]"] {
			if p, ok := f.catalog[k]; ok {
				data = append(data, expanded(r, p))
			}
		}
		if r.Form.Get("product") == AITokensProduct && r.Form.Get("type") == "one_time" {
			for tokens, amount := range map[string]int64{"1000000": 1000, "5000000": 4000} {
				data = append(data, expanded(r, map[string]any{"id": "price_ai_" + tokens, "currency": "chf", "unit_amount": amount,
					"product": AITokensProduct, "metadata": map[string]string{AITokensKey: tokens}, "currency_options": options(amount)}))
			}
		}
		if f.noOptions {
			for i, p := range data {
				data[i] = maps.Clone(p)
				delete(data[i], "currency_options")
			}
		}
		reply(map[string]any{"data": data})
	case key == "GET /v1/promotion_codes":
		data := []map[string]any{}
		if p, ok := f.promos[strings.ToUpper(r.Form.Get("code"))]; ok && (p["active"] == true || r.Form.Get("active") != "true") {
			data = append(data, p) // Stripe matches the code in any case
		}
		reply(map[string]any{"data": data})
	case parts[0] == "coupons" && len(parts) == 2:
		reply(f.coupons[parts[1]])
	case key == "GET /v1/subscriptions":
		var out []map[string]any
		for _, s := range f.subs { // without status=all Stripe leaves out the cancelled ones
			if s["customer"] == r.Form.Get("customer") && (r.Form.Get("status") == "all" || s["status"] != "canceled") {
				out = append(out, s)
			}
		}
		reply(map[string]any{"data": out})
	case parts[0] == "subscriptions" && len(parts) == 2:
		s, ok := f.subs[parts[1]]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription"}}`)
			return
		}
		if r.Method == http.MethodPost && r.Form.Get("payment_behavior") == "pending_if_incomplete" && f.declines {
			// Stripe keeps the change as a pending update and its invoice open until it is paid.
			s = maps.Clone(s)
			s["pending_update"] = map[string]any{"expires_at": time.Now().Add(23 * time.Hour).Unix(),
				"subscription_items": []map[string]any{{"price": map[string]any{"id": r.Form.Get("items[0][price]"),
					"lookup_key": lookupKeyOf(r.Form.Get("items[0][price]"))}}}}
			s["latest_invoice"] = map[string]any{"id": "in_pending", "status": "open", "billing_reason": "subscription_update",
				"hosted_invoice_url": "https://invoice.stripe.com/i/pending"}
			reply(s)
			return
		}
		switch r.Method {
		case http.MethodPost:
			item := s["items"].(map[string]any)["data"].([]map[string]any)[0]
			qty := item["quantity"].(int64)
			if q := r.Form.Get("items[0][quantity]"); q != "" {
				qty, _ = strconv.ParseInt(q, 10, 64)
			}
			if p := r.Form.Get("items[0][price]"); p != "" {
				s["items"] = items(p, f.perSeat, qty)
			} else {
				item["quantity"] = qty
			}
		case http.MethodDelete:
			s["status"] = "canceled"
		}
		reply(s)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// session adds a Checkout Session, or updates the one with its id.
func (f *fakeStripe) session(cs map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, known := range f.sessions {
		if known["id"] == cs["id"] {
			maps.Copy(known, cs)
			return
		}
	}
	f.sessions = append(f.sessions, maps.Clone(cs))
}

func (f *fakeStripe) setFail(fail bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = fail
}

func (f *fakeStripe) called(key string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c == key {
			n++
		}
	}
	return n
}

func (f *fakeStripe) form(key string) url.Values {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.forms[key]
}

func (f *fakeStripe) put(id, ws, customer, status, price string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subs[id] = map[string]any{"id": id, "status": status, "customer": customer, "current_period_end": periodEnd,
		"cancel_at_period_end": false, "metadata": map[string]string{"workspace_id": ws}, "items": items(price, f.perSeat, 1)}
	if status == "trialing" {
		f.subs[id]["trial_end"] = periodEnd
	}
}

// items is a subscription's one item: a price (per seat, or an earlier flat one) and its quantity.
func items(price string, perSeat bool, quantity int64) map[string]any {
	p := map[string]any{"id": price, "lookup_key": lookupKeyOf(price)}
	if perSeat {
		p["metadata"] = map[string]string{PricingKey: PerSeat}
	}
	return map[string]any{"data": []map[string]any{{"id": "si_1", "price": p, "quantity": quantity, "current_period_start": periodStart}}}
}

// periodStart and periodEnd are the fake subscriptions' current period: begun yesterday, ending in a month.
var (
	periodStart = time.Now().Add(-24 * time.Hour).Unix()
	periodEnd   = time.Now().Add(30 * 24 * time.Hour).Unix()
)

// setPerSeat makes the catalogue's prices per seat, as the catalogue tool does; subscriptions made before
// keep their flat price.
func (f *fakeStripe) setPerSeat() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.perSeat = true
	for _, p := range f.catalog {
		p["metadata"] = map[string]string{PricingKey: PerSeat}
	}
}

// subscribe puts the workspace on a live subscription to a price, as the webhook would.
func (e *env) subscribe(ws, price string) {
	e.t.Helper()
	e.stripe.put("sub_"+ws, ws, "cus_"+ws, "active", price)
	if code := e.event(auth.NewID("evt"), "customer.subscription.updated", map[string]any{"id": "sub_" + ws}); code != http.StatusOK {
		e.t.Fatalf("subscribe: %d", code)
	}
}

type env struct {
	t      *testing.T
	st     *store.Store
	raw    *pgxpool.Pool
	stripe *fakeStripe
	svc    *Service
	srv    *httptest.Server
}

func newEnv(t *testing.T, enabled bool) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	fake := &fakeStripe{subs: map[string]map[string]any{}, forms: map[string]url.Values{}, keys: map[string]string{}, catalog: catalog(), currency: map[string]string{},
		promos: map[string]map[string]any{}, coupons: map[string]map[string]any{},
		charges: map[string]map[string]any{}, invoiced: map[string]string{}, disputes: map[string]map[string]any{},
		invoices: map[string]map[string]any{}}
	stripeSrv := httptest.NewServer(fake)
	t.Cleanup(stripeSrv.Close)
	cfg := config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32), SessionTTL: time.Hour}
	if enabled {
		cfg.Stripe = config.Stripe{SecretKey: "sk_test_x", WebhookSecret: whsec, AutomaticTax: true, APIBase: stripeSrv.URL}
	}
	a, err := auth.New(cfg, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := New(context.Background(), st, a, cfg, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	// Stands in for the guarded handlers: 201 means the request got past the guard.
	mux.HandleFunc("POST /api/v1/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	for _, m := range []string{"GET", "PATCH", "PUT", "DELETE"} {
		mux.HandleFunc(m+" /api/v1/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	}
	// As in production: the client address and CF-IPCountry are believed only from a trusted proxy that Cloudflare
	// handed the request to (the test client is that proxy, 127.0.0.1).
	trusted := append([]netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("::1/128")}, config.CloudflareIPs...)
	srv := httptest.NewServer(auth.ForwardedFor(trusted, svc.Guard(mux)))
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, stripe: fake, svc: svc, srv: srv}
}

type browser struct {
	token, csrf, workspace string
	header                 http.Header // sent with every request, such as CF-IPCountry and X-Forwarded-For
}

// viaCloudflare makes b's requests come from a visitor in country through Cloudflare's edge (104.16.0.1).
func (b *browser) viaCloudflare(country string) *browser {
	b.header = http.Header{auth.CountryHeader: {country}, "X-Forwarded-For": {"203.0.113.9, 104.16.0.1"}}
	return b
}

func (e *env) workspace() *browser {
	e.t.Helper()
	return e.workspaceIn("UTC")
}

// workspaceIn makes a workspace in the IANA time zone tz, with its owner.
func (e *env) workspaceIn(tz string) *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, tz, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
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

func (e *env) do(b *browser, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	for k, v := range b.header {
		req.Header[k] = v
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func sign(payload []byte, secret string, at time.Time) string {
	ts := fmt.Sprint(at.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(payload)))
	return "t=" + ts + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

// event posts a signed Stripe event; a Checkout Session in it is what Stripe then has (billing reads it again).
func (e *env) event(id, typ string, object map[string]any) int {
	e.t.Helper()
	if strings.HasPrefix(typ, "checkout.session.") {
		e.stripe.session(object)
	}
	return e.eventSigned(id, typ, object, whsec)
}

func (e *env) eventSigned(id, typ string, object map[string]any, secret string) int {
	e.t.Helper()
	payload, _ := json.Marshal(map[string]any{"id": id, "type": typ, "data": map[string]any{"object": object}})
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/webhooks/stripe", bytes.NewReader(payload))
	req.Header.Set("Stripe-Signature", sign(payload, secret, time.Now()))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func (e *env) billing(ws string) store.Billing {
	e.t.Helper()
	b, err := e.st.WorkspaceBilling(context.Background(), ws)
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.raw.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatal(err)
	}
}

func TestVerifySignature(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	payload := []byte(`{"id":"evt_1"}`)
	good := sign(payload, whsec, now)
	for _, tc := range []struct {
		name, header string
		payload      []byte
		want         bool
	}{
		{"valid", good, payload, true},
		{"one of several v1 matches", good + ",v1=00ff", payload, true},
		{"v0 ignored", strings.Replace(good, "v1=", "v0=", 1), payload, false},
		{"wrong secret", sign(payload, "whsec_other", now), payload, false},
		{"tampered payload", good, []byte(`{"id":"evt_2"}`), false},
		{"too old", sign(payload, whsec, now.Add(-6*time.Minute)), payload, false},
		{"from the future", sign(payload, whsec, now.Add(6*time.Minute)), payload, false},
		{"no timestamp", "v1=" + strings.SplitN(good, "v1=", 2)[1], payload, false},
		{"empty", "", payload, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := verifySignature(tc.payload, tc.header, whsec, now); got != tc.want {
				t.Fatalf("verifySignature = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestWebhookRefusesBadSignature(t *testing.T) {
	e := newEnv(t, true)
	payload := []byte(`{"id":"evt_1","type":"customer.subscription.updated","data":{"object":{"id":"sub_1"}}}`)
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/webhooks/stripe", bytes.NewReader(payload))
	req.Header.Set("Stripe-Signature", sign(payload, "whsec_wrong", time.Now()))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest || e.stripe.called("GET /v1/subscriptions/sub_1") != 0 {
		t.Fatalf("status %d, stripe calls %v", res.StatusCode, e.stripe.calls)
	}
}

func TestWebhookStateTransitions(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	ctx := context.Background()
	if err := e.st.SetStripeCustomer(ctx, ws, "cus_1", time.Now()); err != nil {
		t.Fatal(err)
	}
	steps := []struct {
		name, event, typ, status, price string
		object                          map[string]any
		plan, interval                  string
	}{
		{"checkout completes", "evt_1", "checkout.session.completed", "trialing", "price_bm",
			map[string]any{"id": "cs_1", "mode": "subscription", "subscription": "sub_1"}, Basic, "month"},
		{"trial ends", "evt_2", "customer.subscription.updated", "active", "price_bm", map[string]any{"id": "sub_1"}, Basic, "month"},
		{"upgrade in the portal", "evt_3", "customer.subscription.updated", "active", "price_py", map[string]any{"id": "sub_1"}, Pro, "year"},
		{"card fails: the plan stays", "evt_4", "customer.subscription.updated", "past_due", "price_py", map[string]any{"id": "sub_1"}, Pro, "year"},
		{"cancelled", "evt_5", "customer.subscription.deleted", "canceled", "price_py", map[string]any{"id": "sub_1"}, "", ""},
	}
	for _, s := range steps {
		e.stripe.put("sub_1", ws, "cus_1", s.status, s.price)
		if code := e.event(s.event, s.typ, s.object); code != http.StatusOK {
			t.Fatalf("%s: status %d", s.name, code)
		}
		b := e.billing(ws)
		if PlanOf(b, time.Now()) != s.plan || (s.interval != "" && b.Interval != s.interval) || b.Status != s.status {
			t.Fatalf("%s: billing %+v, want plan %s", s.name, b, s.plan)
		}
	}
	if b := e.billing(ws); !b.TrialUsed || b.CurrentPeriodEnd == nil || b.CurrentPeriodEnd.Unix() != periodEnd {
		t.Fatalf("billing %+v", b)
	}
}

func TestWebhookIsIdempotent(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	if code := e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"}); code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	// The same event again, after the subscription moved on: it is not applied a second time.
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_pm")
	if code := e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"}); code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if b := e.billing(ws); b.Plan != Basic {
		t.Fatalf("replayed event applied: %+v", b)
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM stripe_events WHERE id = 'evt_1'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("events %d, %v", n, err)
	}
}

func TestWebhookIgnores(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	ctx := context.Background()
	if err := e.st.SetStripeCustomer(ctx, ws, "cus_1", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.stripe.put("sub_live", ws, "cus_1", "active", "price_pm")
	if code := e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_live"}); code != http.StatusOK {
		t.Fatal(code)
	}
	for _, tc := range []struct {
		name, sub, ws, customer, status string
	}{
		{"another customer", "sub_x", ws, "cus_other", "active"},
		{"an older subscription ending", "sub_old", ws, "cus_1", "canceled"},
		{"an unknown workspace", "sub_y", "wsp_gone", "cus_1", "active"},
		{"no workspace", "sub_z", "", "cus_1", "active"},
	} {
		e.stripe.put(tc.sub, tc.ws, tc.customer, tc.status, "price_bm")
		if code := e.event("evt_"+tc.sub, "customer.subscription.updated", map[string]any{"id": tc.sub}); code != http.StatusOK {
			t.Fatalf("%s: status %d", tc.name, code)
		}
		if b := e.billing(ws); b.SubscriptionID != "sub_live" || b.Plan != Pro {
			t.Fatalf("%s changed billing: %+v", tc.name, b)
		}
	}
	if code := e.event("evt_other", "invoice.paid", map[string]any{"id": "in_1"}); code != http.StatusOK {
		t.Fatalf("unfollowed event: %d", code)
	}
}

// A second live subscription (two checkouts, both paid) is cancelled with its unused time credited; the one on record
// stays. When the one on record has ended at Stripe (its event lost), it is applied and the newcomer takes its place.
func TestWebhookSettlesASecondLiveSubscription(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	e.stripe.put("sub_2", ws, "cus_1", "active", "price_pm")
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	e.event("evt_2", "customer.subscription.created", map[string]any{"id": "sub_2"})
	f := e.stripe.form("DELETE /v1/subscriptions/sub_2")
	if b := e.billing(ws); b.SubscriptionID != "sub_1" || b.Plan != Basic || e.stripe.called("DELETE /v1/subscriptions/sub_1") != 0 ||
		f.Get("prorate") != "true" || f.Get("invoice_now") != "true" {
		t.Fatalf("billing %+v, calls %v, form %v", b, e.stripe.calls, f)
	}
	// The newcomer's own cancellation event leaves the one on record.
	e.event("evt_3", "customer.subscription.deleted", map[string]any{"id": "sub_2"})
	if b := e.billing(ws); b.SubscriptionID != "sub_1" || b.Status != "active" {
		t.Fatalf("after the newcomer ended: %+v", b)
	}

	// sub_1 ended at Stripe without its event: a third live one takes its place.
	e.stripe.put("sub_1", ws, "cus_1", "canceled", "price_bm")
	e.stripe.put("sub_4", ws, "cus_1", "active", "price_xm")
	e.event("evt_4", "customer.subscription.created", map[string]any{"id": "sub_4"})
	if b := e.billing(ws); b.SubscriptionID != "sub_4" || b.Plan != Business || e.stripe.called("DELETE /v1/subscriptions/sub_4") != 0 {
		t.Fatalf("billing %+v, calls %v", b, e.stripe.calls)
	}
}

func TestWebhookStripeDownIsRetried(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	e.stripe.setFail(true)
	if code := e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"}); code != http.StatusBadGateway {
		t.Fatalf("status %d, want 502 so Stripe retries", code)
	}
	e.stripe.setFail(false)
	if code := e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"}); code != http.StatusOK || e.billing(ws).Plan != Basic {
		t.Fatalf("retry: %d %+v", code, e.billing(ws))
	}
}

func TestGuard(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	now := time.Now()
	// Fill the Basic plan: 2 members besides the owner (3 self-service seats on this flat price), 250 clients, 100
	// invoices and 250 expenses this month, 1 GB of files.
	e.join(ws, "member")
	e.join(ws, "member")
	e.subscribe(ws, "price_bm")
	e.setPlanValue(Basic, MaxSeats, StateLimited, n64(3))
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		SELECT 'cli_' || i, $1, i + 1, 'C', $2, $2 FROM generate_series(0, 249) i`, ws, now)
	e.exec(`INSERT INTO expenses (id, workspace_id, number, status, currency, amount_mode, input_tax, deductible_percent,
			net_total, vat_total, total, deductible_vat, vat_breakdown, exchange_rate, base_currency, base_net_total,
			base_vat_total, base_total, base_deductible_vat, payment_status, created_at, updated_at)
		SELECT 'exp_' || i, $1, i + 1, 'draft', 'CHF', 'gross', 'full', 10000, 0, 0, 0, 0, '[]', 1, 'CHF', 0, 0, 0, 0, 'unpaid', $2, $2
		FROM generate_series(0, 249) i`, ws, now)
	e.exec(`INSERT INTO invoices (id, workspace_id, kind, status, client_id, issue_date, due_date, currency, language, vat_mode,
			discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, created_at, updated_at)
		SELECT 'inv_' || i, $1, 'invoice', 'draft', 'cli_0', $2::timestamptz::date, $2::timestamptz::date, 'CHF', 'de', 'exclusive',
			0, 0, 0, 0, 0, 0, 0, '[]', $2::timestamptz, $2::timestamptz FROM generate_series(0, 99) i`, ws, now)
	e.exec(`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
		VALUES ('doc_1', $1, 'big.pdf', $2, 'application/pdf', 'k1', $3, $3)`, ws, int64(gb), now)

	routes := []struct {
		path  string
		limit Limit
	}{
		{"/api/v1/members/invitations", Members},
		{"/api/v1/clients", Clients},
		{"/api/v1/invoices", Invoices},
		{"/api/v1/invoices/inv_1/duplicate", Invoices},
		{"/api/v1/expenses", Expenses},
		{"/api/v1/expenses/exp_1/duplicate", Expenses},
		{"/api/v1/documents", Storage},
		{"/api/v1/documents/doc_1/copy", Storage},
		{"/api/v1/expenses/exp_1/receipts", Storage},
		{"/api/v1/clients/cli_1/files", Storage},
	}
	for _, r := range routes {
		code, body := e.do(owner, http.MethodPost, r.path, map[string]string{"x": "y"})
		if r.limit == Invoices || (r.limit == Storage && !strings.HasSuffix(r.path, "/copy")) {
			if code != http.StatusCreated {
				t.Fatalf("write must reach kind-aware or exact-byte transactional admission: %s %d %v", r.path, code, body)
			}
			continue
		}
		details, _ := body["error"].(map[string]any)["details"].(map[string]any)
		if code != http.StatusPaymentRequired || details["limit"] != string(r.limit) || details["plan"] != Basic {
			t.Fatalf("%s on a full Basic plan: %d %v", r.path, code, body)
		}
	}
	// Not guarded: resending an invitation, a credit note, other methods.
	for _, path := range []string{"/api/v1/members/invitations/inv_1/resend", "/api/v1/invoices/inv_1/credit-note"} {
		if code, _ := e.do(owner, http.MethodPost, path, nil); code != http.StatusCreated {
			t.Fatalf("%s: %d", path, code)
		}
	}

	if code, _ := e.do(owner, http.MethodGet, "/api/v1/clients", nil); code == http.StatusPaymentRequired {
		t.Fatal("a read was limited")
	}

	// On Pro everything fits (15 members; storage 100 GB).
	e.subscribe(ws, "price_pm")
	for _, r := range routes {
		if code, body := e.do(owner, http.MethodPost, r.path, map[string]string{"x": "y"}); code != http.StatusCreated {
			t.Fatalf("%s on Pro: %d %v", r.path, code, body)
		}
	}
}

func TestGuardDoesNotChargeRequestFramingBeforeHashDeduplication(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_bm")
	e.exec(`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
		VALUES ('doc_1', $1, 'a.pdf', $2, 'application/pdf', 'k1', now(), now())`, owner.workspace, int64(5*gb)-100) // Basic holds 5 GB
	small, big := strings.Repeat("x", 50), strings.Repeat("x", 200)
	for _, tc := range []struct {
		body string
		want int
	}{{small, http.StatusCreated}, {big, http.StatusCreated}} {
		req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/documents", strings.NewReader(tc.body))
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: owner.token})
		req.Header.Set("X-CSRF-Token", owner.csrf)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("%d bytes: %d, want %d", len(tc.body), res.StatusCode, tc.want)
		}
	}
}

func TestGuardWithoutBilling(t *testing.T) {
	e := newEnv(t, false)
	owner := e.workspace()
	e.exec(`INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, created_at, expires_at)
		VALUES ('inv_1', $1, 'b@example.com', 'member', 'h', now(), now() + interval '1 day')`, owner.workspace)
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/members/invitations", nil); code != http.StatusCreated {
		t.Fatalf("billing off still limits: %d", code)
	}
	code, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	if code != http.StatusOK || data["enabled"] != false || data["locked"] != false || data["plan"] != "" {
		t.Fatalf("overview: %d %v", code, body)
	}
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusServiceUnavailable {
		t.Fatalf("checkout without billing: %d", code)
	}
}

func TestOverview(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.exec(`INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, created_at, expires_at)
		VALUES ('inv_1', $1, 'b@example.com', 'member', 'h1', now(), now() + interval '1 day'),
		       ('inv_2', $1, 'c@example.com', 'member', 'h2', now(), now() - interval '1 day')`, owner.workspace)
	code, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	usage, _ := data["usage"].([]any)
	members, _ := usage[0].(map[string]any)
	plansList, _ := data["plans"].([]any)
	pro, _ := plansList[1].(map[string]any)
	proPrices, _ := pro["prices"].(map[string]any)
	proLimits, _ := pro["limits"].(map[string]any)
	if code != http.StatusOK || data["plan"] != "" || data["locked"] != true || data["trial_available"] != true || data["trial_plan"] != Basic ||
		data["trial_days"] != 7.0 || data["discount"] != nil || data["can_manage"] != true ||
		members["used"] != 0.0 || members["max"] != nil || proLimits["clients"] != 300.0 || proPrices["month"] == nil {
		t.Fatalf("overview: %d %v", code, body)
	}
}

func TestCheckout(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")

	if code, _ := e.do(member, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusForbidden {
		t.Fatalf("a member started Checkout: %d", code)
	}
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": "enterprise", "interval": "month"}); code != http.StatusBadRequest {
		t.Fatalf("unknown plan: %d", code)
	}
	for range 2 {
		code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "year"})
		if code != http.StatusOK || body["url"] != "https://checkout.stripe.test/c" {
			t.Fatalf("checkout: %d %v", code, body)
		}
	}
	f := e.stripe.form("POST /v1/checkout/sessions")
	for k, want := range map[string]string{
		"mode": "subscription", "customer": "cus_1", "line_items[0][price]": "price_by", "automatic_tax[enabled]": "true",
		"subscription_data[metadata][workspace_id]": owner.workspace, "subscription_data[trial_period_days]": "7",
		"tax_id_collection[enabled]": "true", "success_url": "https://helvetly.example.com/settings/billing?checkout=success",
		"cancel_url": "https://helvetly.example.com/choose-plan?checkout=canceled",
	} {
		if f.Get(k) != want {
			t.Errorf("checkout %s = %q, want %q", k, f.Get(k), want)
		}
	}
	if n := e.stripe.called("POST /v1/customers"); n != 1 {
		t.Fatalf("customers created: %d, want 1", n)
	}

	// With a live subscription, choosing a plan changes it in place.
	e.stripe.put("sub_1", owner.workspace, "cus_1", "active", "price_by")
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "year"}); code != http.StatusConflict {
		t.Fatalf("same plan: %d", code)
	}
	code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "year"})
	if code != http.StatusOK || body["url"] != "https://helvetly.example.com/settings/billing?checkout=switched" || e.billing(owner.workspace).Plan != Pro {
		t.Fatalf("upgrade: %d %v %+v", code, body, e.billing(owner.workspace))
	}
	if f := e.stripe.form("POST /v1/subscriptions/sub_1"); f.Get("items[0][price]") != "price_py" || f.Get("proration_behavior") != "always_invoice" ||
		f.Get("payment_behavior") != "pending_if_incomplete" {
		t.Fatalf("update form %v", f)
	}

	// A smaller plan must fit: 3 members besides the owner are more than Basic's 2 on an offer with 3 seats.
	e.setPlanValue(Basic, MaxSeats, StateLimited, n64(3))
	e.join(owner.workspace, "member")
	e.join(owner.workspace, "member")
	code, body = e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "year"})
	if errBody, _ := body["error"].(map[string]any); code != http.StatusConflict || errBody["code"] != "plan_limits_exceeded" ||
		errBody["message"] != "Basic allows 2 members besides the owner; this workspace has 3. Remove 1 member first." {
		t.Fatalf("downgrade over the limits: %d %v", code, body)
	}
}

func TestPortalSyncAndDetails(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/portal", nil); code != http.StatusConflict {
		t.Fatalf("portal without a customer: %d", code)
	}
	if err := e.st.SetStripeCustomer(context.Background(), owner.workspace, "cus_1", time.Now()); err != nil {
		t.Fatal(err)
	}
	if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/portal", nil); code != http.StatusOK || body["url"] != "https://billing.stripe.test/p" {
		t.Fatalf("portal: %d %v", code, body)
	}
	if code, _ := e.do(member, http.MethodGet, "/api/v1/billing/details", nil); code != http.StatusForbidden {
		t.Fatalf("a member read billing details: %d", code)
	}

	// Back from Checkout before the webhook: sync reads the subscription.
	e.stripe.put("sub_1", owner.workspace, "cus_1", "trialing", "price_pm")
	code, body := e.do(owner, http.MethodPost, "/api/v1/billing/sync", nil)
	if data, _ := body["data"].(map[string]any); code != http.StatusOK || data["plan"] != Pro {
		t.Fatalf("sync: %d %v", code, body)
	}

	code, body = e.do(owner, http.MethodGet, "/api/v1/billing/details", nil)
	data, _ := body["data"].(map[string]any)
	invoices, _ := data["invoices"].([]any)
	card, _ := data["payment_method"].(map[string]any)
	if code != http.StatusOK || len(invoices) != 1 || card["last4"] != "4242" {
		t.Fatalf("details: %d %v", code, body)
	}
}

func TestEndSubscription(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	ctx := context.Background()
	if err := e.svc.EndSubscription(ctx, ws); err != nil || len(e.stripe.calls) != 0 {
		t.Fatalf("no customer: %v %v", err, e.stripe.calls)
	}
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	// A second subscription that was paid, an unpaid one, one over for good, and open Checkouts of a plan and a pack.
	e.stripe.put("sub_2", ws, "cus_1", "trialing", "price_pm")
	e.stripe.put("sub_3", ws, "cus_1", "incomplete", "price_pm")
	e.stripe.put("sub_4", ws, "cus_1", "canceled", "price_pm")
	e.stripe.mu.Lock()
	e.stripe.sessions = append(e.stripe.sessions,
		map[string]any{"id": "cs_plan", "mode": "subscription", "customer": "cus_1", "status": "open"},
		map[string]any{"id": "cs_pack", "mode": "payment", "customer": "cus_1", "status": "open"})
	e.stripe.mu.Unlock()
	if err := e.svc.EndSubscription(ctx, ws); err != nil || PlanOf(e.billing(ws), time.Now()) != "" {
		t.Fatalf("end: %v %+v", err, e.billing(ws))
	}
	for path, want := range map[string]int{
		"DELETE /v1/subscriptions/sub_1": 1, "DELETE /v1/subscriptions/sub_2": 1, "DELETE /v1/subscriptions/sub_3": 1,
		"DELETE /v1/subscriptions/sub_4": 0, "POST /v1/checkout/sessions/cs_plan/expire": 1, "POST /v1/checkout/sessions/cs_pack/expire": 0,
	} {
		if n := e.stripe.called(path); n != want {
			t.Errorf("%s: %d calls, want %d", path, n, want)
		}
	}
}

func TestCheckoutExpiresTheCustomersOpenPlanCheckouts(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	checkout := func() {
		t.Helper()
		if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
			t.Fatalf("checkout: %d %v", code, body)
		}
	}
	checkout() // a new customer has no open Checkout
	if n := e.stripe.called("GET /v1/checkout/sessions"); n != 0 {
		t.Fatalf("listed sessions of a new customer: %d", n)
	}
	e.stripe.mu.Lock()
	e.stripe.sessions = append(e.stripe.sessions,
		map[string]any{"id": "cs_tab", "mode": "subscription", "customer": "cus_1", "status": "open"},
		map[string]any{"id": "cs_pack", "mode": "payment", "customer": "cus_1", "status": "open"},
		map[string]any{"id": "cs_old", "mode": "subscription", "customer": "cus_1", "status": "expired"})
	e.stripe.mu.Unlock()
	checkout()
	if e.stripe.called("POST /v1/checkout/sessions/cs_tab/expire") != 1 || e.stripe.called("POST /v1/checkout/sessions/cs_pack/expire") != 0 ||
		e.stripe.called("POST /v1/checkout/sessions/cs_old/expire") != 0 {
		t.Fatalf("calls %v", e.stripe.calls)
	}
}

func TestCustomerIdempotencyKeyCoversItsParameters(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("checkout: %d", code)
	}
	f := e.stripe.form("POST /v1/customers")
	sent := url.Values{}
	for _, k := range []string{"email", "name", "description", "metadata[workspace_id]"} {
		sent.Set(k, f.Get(k))
	}
	sum := sha256.Sum256([]byte(sent.Encode()))
	if want := "helvetly-customer-" + owner.workspace + "-" + hex.EncodeToString(sum[:8]); e.stripe.keys["POST /v1/customers"] != want {
		t.Fatalf("key %q, want %q", e.stripe.keys["POST /v1/customers"], want)
	}
}

func TestMonthStart(t *testing.T) {
	for _, tc := range []struct{ zone, now, want string }{
		{"Europe/Zurich", "2026-11-15T12:00:00Z", "2026-10-31T23:00:00Z"},
		{"Europe/Zurich", "2026-10-31T23:30:00Z", "2026-10-31T23:00:00Z"}, // already 1 November in Zurich
		{"Europe/Zurich", "2026-07-01T00:30:00Z", "2026-06-30T22:00:00Z"},
		{"America/New_York", "2026-11-01T03:00:00Z", "2026-10-01T04:00:00Z"}, // still 31 October in New York
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		if got := monthStart(now, store.Workspace{Timezone: tc.zone}.Location()).UTC().Format(time.RFC3339); got != tc.want {
			t.Errorf("monthStart(%s) = %s, want %s", tc.now, got, tc.want)
		}
	}
}

func TestCheckoutRefusesAPlanTheWorkspaceIsOver(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.setPlanValue(Basic, MaxSeats, StateLimited, n64(3))
	for range 3 { // three members besides the owner are more than Basic's 2 on an offer with 3 seats
		e.join(owner.workspace, "member")
	}
	code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "month"})
	errBody, _ := body["error"].(map[string]any)
	details, _ := errBody["details"].(map[string]any)
	if code != http.StatusConflict || errBody["code"] != "plan_limits_exceeded" || details["plan"] != Basic || details["overages"] == nil {
		t.Fatalf("checkout over the limits: %d %v", code, body)
	}
	if n := e.stripe.called("POST /v1/checkout/sessions") + e.stripe.called("POST /v1/customers"); n != 0 {
		t.Fatalf("Stripe called %d times for a refused checkout", n)
	}
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("checkout of a plan that fits: %d", code)
	}
}
