package engagements

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Invoices is what the engagements use of invoices.Service: drafts made inside the caller's transaction,
// and the seller block, logo and language for the service report.
type Invoices interface {
	CreateDraft(ctx context.Context, q store.Q, sess store.Session, clientID string, fill func(*store.Invoice)) (string, error)
	Seller(ctx context.Context, q store.Q, workspaceID string) (store.Party, []byte, string, error)
}

type Service struct {
	db   *store.Store
	auth Auth
	inv  Invoices
	log  *slog.Logger
	now  func() time.Time

	mailer    Mailer
	publicURL string
	sources   []DigestSource
}

// Mailer sends the digest and the service report (internal/mail.Sender).
type Mailer interface {
	Send(ctx context.Context, m mail.Message) error
}

// SetMailer enables the e-mails; publicURL is the platform origin the digest links to.
func (s *Service) SetMailer(m Mailer, publicURL string) { s.mailer, s.publicURL = m, publicURL }

func New(db *store.Store, a Auth, inv Invoices, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, inv: inv, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// today is the civil date in the workspace's time zone.
func (s *Service) today(ws store.Workspace) string { return ws.Today(s.now()) }

var (
	errForbidden      = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can delete, cancel or resume engagements.", nil)
	errLocked         = auth.Error(http.StatusConflict, "engagement_locked", "The schedule and the client cannot change once there are entries or invoices.", nil)
	errEngInvoiced    = auth.Error(http.StatusConflict, "engagement_invoiced", "This engagement has invoices: void them first.", nil)
	errPeriodInvoiced = auth.Error(http.StatusConflict, "period_invoiced", "This period has an advance invoice.", nil)
	errNotResumable   = auth.Error(http.StatusConflict, "not_resumable", "Only an engagement cancelled for a later day can be resumed.", nil)
	errNotRenewable   = auth.Error(http.StatusConflict, "not_renewable", "Only one-off engagements can be renewed.", nil)
)

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/engagements", s.list)
	handle("POST /api/v1/engagements", s.create)
	handle("GET /api/v1/engagements/summary", s.summary)
	handle("GET /api/v1/engagements/{id}", s.get)
	handle("PATCH /api/v1/engagements/{id}", s.update)
	handle("DELETE /api/v1/engagements/{id}", s.delete)
	handle("POST /api/v1/engagements/{id}/cancel", s.cancel)
	handle("POST /api/v1/engagements/{id}/resume", s.resume)
	handle("POST /api/v1/engagements/{id}/renew", s.renew)
	handle("GET /api/v1/engagements/{id}/periods", s.periods)
	handle("PATCH /api/v1/engagements/{id}/periods/{period_id}", s.patchPeriod)
	s.registerEntries(mux)
	s.registerSettings(mux)
	s.registerReports(mux)
}

func canManage(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

// ---- views ----

// PeriodSummary is a stored period measured against today.
type PeriodSummary struct {
	store.EngagementPeriod
	Unearned           invoicecalc.Quantity `json:"unearned"`
	CarriedIn          invoicecalc.Quantity `json:"carried_in"`
	Available          invoicecalc.Quantity `json:"available"`
	Remaining          invoicecalc.Quantity `json:"remaining"`
	Overage            invoicecalc.Quantity `json:"overage"`
	Expected           invoicecalc.Quantity `json:"expected"`
	State              string               `json:"state"`
	UninvoicedQuantity invoicecalc.Quantity `json:"uninvoiced_quantity"`
	stats              Stats
}

// Period adds the invoices made from the period.
type Period struct {
	PeriodSummary
	Invoices []store.EngagementInvoice `json:"invoices"`
}

type EngagementView struct {
	store.Engagement
	UnitPriceNet   invoicecalc.Money `json:"unit_price_net"`
	UnitPriceGross invoicecalc.Money `json:"unit_price_gross"`
	Status         string            `json:"status"`
	CurrentPeriod  *PeriodSummary    `json:"current_period"`
	Attention      []string          `json:"attention"`
	periods        []PeriodSummary
}

// lastDay is the last day the engagement runs: the earlier of end_date and cancelled_on ("" = open-ended).
func lastDay(e store.Engagement) string {
	last := ""
	for _, d := range []*string{e.EndDate, e.CancelledOn} {
		if d != nil && (last == "" || *d < last) {
			last = *d
		}
	}
	return last
}

// Status is the engagement's lifecycle state on today: scheduled, active, ended or cancelled.
func Status(e store.Engagement, today string) string {
	cancelled, ended := e.CancelledOn != nil && *e.CancelledOn < today, e.EndDate != nil && *e.EndDate < today
	switch {
	case cancelled && (!ended || *e.CancelledOn <= *e.EndDate): // both past: whichever came first
		return "cancelled"
	case ended:
		return "ended"
	case e.StartDate > today:
		return "scheduled"
	}
	return "active"
}

// overagePrice is what a period stores: the overage price, or the unit price when none is set.
func overagePrice(e store.Engagement) invoicecalc.Money {
	if e.OverageUnitPrice != nil {
		return *e.OverageUnitPrice
	}
	return e.UnitPrice
}

// carries is the quantity each period takes over from the one before it (rollover only); periods are newest first.
func carries(e store.Engagement, periods []store.EngagementPeriod) map[string]invoicecalc.Quantity {
	out := map[string]invoicecalc.Quantity{}
	if !e.Rollover {
		return out
	}
	asc := slices.Clone(periods)
	slices.Reverse(asc)
	in := make([]CarryPeriod, len(asc))
	for i, p := range asc {
		in[i] = CarryPeriod{Quantity: p.Quantity, Used: p.Used}
	}
	for i, c := range CarryIn(in) {
		out[asc[i].ID] = c
	}
	return out
}

// reprorate sets every period's committed quantity to its share of the full one for its (cut or restored) end.
// Hand-set quantities and advance-invoiced periods keep theirs.
func reprorate(ctx context.Context, q store.Q, engagementID string) error {
	periods, err := q.EngagementPeriods(ctx, engagementID)
	if err != nil {
		return err
	}
	for _, p := range periods {
		if p.QuantityManual || p.AdvanceInvoice != nil {
			continue
		}
		if want := Prorate(p.FullQuantity, p.StartsOn, p.EndsOn, p.NaturalEndsOn); want != p.Quantity {
			if err := q.SetPeriodQuantityProrated(ctx, p.ID, want); err != nil {
				return err
			}
		}
	}
	return nil
}

func summarize(p store.EngagementPeriod, e store.Engagement, today string, carried invoicecalc.Quantity) PeriodSummary {
	if last := lastDay(e); last != "" && p.EndsOn > last && last >= p.StartsOn {
		p.EndsOn = last
	}
	available := p.Quantity + carried
	var unearned invoicecalc.Quantity // an advance-invoiced period cut short keeps its quantity: the rest is a credit note away
	if p.AdvanceInvoice != nil && p.EndsOn < p.NaturalEndsOn {
		unearned = max(0, p.Quantity-Prorate(p.FullQuantity, p.StartsOn, p.EndsOn, p.NaturalEndsOn))
	}
	st := Measure(available, p.Used, p.StartsOn, p.EndsOn, today)
	uninvoiced := max(0, p.Used-p.InvoicedQuantity)
	if e.Billing == "advance" { // only what exceeds the committed quantity is billed after the fact
		uninvoiced = max(0, st.Overage-p.InvoicedQuantity)
	}
	return PeriodSummary{EngagementPeriod: p, Unearned: unearned, CarriedIn: carried, Available: available, Remaining: st.Remaining, Overage: st.Overage, Expected: st.Expected,
		State: st.State, UninvoicedQuantity: uninvoiced, stats: st}
}

// ensurePeriods opens every period that has started by today (the first one always) and returns all of them, newest first.
// Safe to repeat and to race: a period that exists is left alone.
func ensurePeriods(ctx context.Context, q store.Q, e store.Engagement, today string) ([]store.EngagementPeriod, error) {
	existing, err := q.EngagementPeriods(ctx, e.ID)
	if err != nil {
		return nil, err
	}
	return openPeriods(ctx, q, e, today, existing)
}

// openPeriods is ensurePeriods with the periods already read; it writes only when a period is due or a cut was lifted.
func openPeriods(ctx context.Context, q store.Q, e store.Engagement, today string, existing []store.EngagementPeriod) ([]store.EngagementPeriod, error) {
	have := map[int]store.EngagementPeriod{}
	for _, p := range existing {
		have[p.Index] = p
	}
	last, opened, restored := lastDay(e), false, false
	overage := overagePrice(e)
	for n := 1; n <= 5000; n++ {
		from, to, ok := PeriodBounds(e.StartDate, e.Recurrence, e.Interval, last, n)
		if !ok || (n > 1 && from > today) {
			break
		}
		if p, ok := have[n]; ok {
			if p.EndsOn < to { // the cut was lifted (resume, later end): back to the natural end
				if err := q.SetPeriodEnd(ctx, p.ID, to); err != nil {
					return nil, err
				}
				opened, restored = true, true
			}
			continue
		}
		natural := to
		if e.Recurrence == "none" && e.EndDate != nil {
			natural = *e.EndDate
		} else if _, nat, ok := PeriodBounds(e.StartDate, e.Recurrence, e.Interval, "", n); ok {
			natural = nat
		}
		added, err := q.InsertPeriod(ctx, store.EngagementPeriod{ID: auth.NewID("epr"), EngagementID: e.ID, Index: n,
			StartsOn: from, EndsOn: to, NaturalEndsOn: natural, FullQuantity: e.Quantity,
			Quantity: Prorate(e.Quantity, from, to, natural), UnitPrice: e.UnitPrice, OverageUnitPrice: overage})
		if err != nil {
			return nil, err
		}
		opened = opened || added
	}
	if !opened {
		return existing, nil
	}
	if restored {
		if err := reprorate(ctx, q, e.ID); err != nil {
			return nil, err
		}
	}
	return q.EngagementPeriods(ctx, e.ID)
}

// view derives status, current period and attention. It opens due periods, so call it inside a transaction.
func (s *Service) view(ctx context.Context, q store.Q, e store.Engagement, today string) (EngagementView, error) {
	periods, err := ensurePeriods(ctx, q, e, today)
	if err != nil {
		return EngagementView{}, err
	}
	return derive(e, periods, today), nil
}

func derive(e store.Engagement, periods []store.EngagementPeriod, today string) EngagementView {
	v := EngagementView{Engagement: e, Status: Status(e, today), Attention: []string{}}
	t := store.Product{PriceBasis: e.PriceBasis, UnitPrice: e.UnitPrice, VATCategory: e.VATCategory, VATRate: e.VATRate}
	t.Derive()
	v.UnitPriceNet, v.UnitPriceGross = t.UnitPriceNet, t.UnitPriceGross
	last, carried := lastDay(e), carries(e, periods)
	for _, p := range periods {
		if last != "" && p.StartsOn > last && p.Index > 1 { // cut away by a cancellation or an earlier end
			continue
		}
		v.periods = append(v.periods, summarize(p, e, today, carried[p.ID]))
	}
	for i := range v.periods {
		if v.periods[i].State == "open" {
			v.CurrentPeriod = &v.periods[i]
		}
	}
	if v.CurrentPeriod == nil && len(v.periods) > 0 && v.periods[0].State != "upcoming" {
		v.CurrentPeriod = &v.periods[0]
	}
	v.Attention = attention(e, v)
	return v
}

func attention(e store.Engagement, v EngagementView) []string {
	out := []string{}
	if c := v.CurrentPeriod; c != nil {
		if c.stats.UnderPace {
			out = append(out, "under_pace")
		}
		if c.stats.EndingSoon {
			out = append(out, "ending_soon")
		}
	}
	if slices.ContainsFunc(v.periods, func(p PeriodSummary) bool { return p.Overage > 0 && p.UninvoicedQuantity > 0 }) {
		out = append(out, "overage")
	}
	// Without a price the work was paid elsewhere: nothing here is to invoice.
	if e.UnitPrice > 0 && slices.ContainsFunc(v.periods, func(p PeriodSummary) bool {
		return (e.Billing == "advance" && p.State != "upcoming" && p.AdvanceInvoice == nil) ||
			(p.State == "closed" && p.UninvoicedQuantity > 0)
	}) {
		out = append(out, "to_invoice")
	}
	return out
}

// periodView adds the invoices of a period.
func periodView(ctx context.Context, q store.Q, p PeriodSummary) (Period, error) {
	inv, err := q.PeriodInvoices(ctx, p.ID)
	return Period{PeriodSummary: p, Invoices: inv}, err
}

// load reads one engagement as its view, opening due periods.
func (s *Service) load(ctx context.Context, ws store.Workspace, id string) (EngagementView, error) {
	var v EngagementView
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws.ID, id, false)
		if err != nil {
			return err
		}
		v, err = s.view(ctx, q, e, s.today(ws))
		return err
	})
	return v, err
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, code int, id string) error {
	v, err := s.load(r.Context(), sess.Workspace, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, code, data(v))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

// ---- list and summary ----

func intParam(q url.Values, key string, fallback, lo, hi int) (int, error) {
	v := q.Get(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		return 0, badRequest(key + " must be a whole number from " + strconv.Itoa(lo) + " to " + strconv.Itoa(hi) + ".")
	}
	return n, nil
}

var allStatuses = []string{"scheduled", "active", "ended", "cancelled"}

// views reads the engagements matching f and all their periods in two queries.
func (s *Service) views(ctx context.Context, ws string, f store.EngagementFilter) ([]EngagementView, error) {
	var out []EngagementView
	err := s.db.Tx(ctx, func(q store.Q) error {
		out = out[:0]
		list, err := q.ListEngagements(ctx, ws, f)
		if err != nil {
			return err
		}
		ids := make([]string, len(list))
		for i, e := range list {
			ids[i] = e.ID
		}
		periods, err := q.EngagementPeriodsOf(ctx, ids)
		if err != nil {
			return err
		}
		for _, e := range list {
			p, err := openPeriods(ctx, q, e, f.Today, periods[e.ID])
			if err != nil {
				return err
			}
			out = append(out, derive(e, p, f.Today))
		}
		return nil
	})
	return out, err
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f := store.EngagementFilter{Q: q.Get("q"), ClientID: q.Get("client_id"), Today: s.today(sess.Workspace)}
	f.Statuses = []string{"scheduled", "active"}
	if v := q.Get("status"); v != "" {
		f.Statuses = nil
		for part := range strings.SplitSeq(v, ",") {
			if !slices.Contains(allStatuses, part) {
				return badRequest("status must be a comma list of scheduled, active, ended, cancelled.")
			}
			f.Statuses = append(f.Statuses, part)
		}
	}
	att := q.Get("attention")
	if att != "" && !slices.Contains([]string{"under_pace", "ending_soon", "overage", "to_invoice"}, att) {
		return badRequest("attention must be under_pace, ending_soon, overage or to_invoice.")
	}
	sort := q.Get("sort")
	if sort == "" {
		sort = "ends"
	}
	if !slices.Contains([]string{"ends", "-created_at", "title", "client"}, sort) {
		return badRequest("sort must be one of ends, -created_at, title, client.")
	}
	page, err := intParam(q, "page", 1, 1, 1_000_000)
	if err != nil {
		return err
	}
	size, err := intParam(q, "page_size", 50, 1, 200)
	if err != nil {
		return err
	}
	list, total, err := s.page(r.Context(), sess.Workspace.ID, f, att, sort, page, size)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": list,
		"meta": map[string]int{"page": page, "page_size": size, "total": total, "total_pages": (total + size - 1) / size}})
	return nil
}

// page pages in SQL when the order and filter are stored columns; "ends" and attention are derived, so those page in memory.
func (s *Service) page(ctx context.Context, ws string, f store.EngagementFilter, att, sort string, page, size int) ([]EngagementView, int, error) {
	if att == "" && sort != "ends" {
		f.Sort, f.Limit, f.Offset = sort, size, (page-1)*size
		total, err := s.db.CountEngagements(ctx, ws, f)
		if err != nil {
			return nil, 0, err
		}
		list, err := s.views(ctx, ws, f)
		return list, total, err
	}
	list, err := s.views(ctx, ws, f)
	if err != nil {
		return nil, 0, err
	}
	if att != "" {
		list = slices.DeleteFunc(list, func(v EngagementView) bool { return !slices.Contains(v.Attention, att) })
	}
	slices.SortStableFunc(list, func(a, b EngagementView) int { return compare(sort, a, b) })
	total := len(list)
	from := min((page-1)*size, total)
	return list[from:min(from+size, total)], total, nil
}

func compare(sort string, a, b EngagementView) int {
	switch sort {
	case "-created_at":
		return b.CreatedAt.Compare(a.CreatedAt)
	case "title":
		return strings.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title))
	case "client":
		return strings.Compare(strings.ToLower(a.Client.Name), strings.ToLower(b.Client.Name))
	}
	end := func(v EngagementView) string { // engagements without a current period go last
		if v.CurrentPeriod == nil {
			return "9999-99-99"
		}
		return v.CurrentPeriod.EndsOn
	}
	// Running ones first, soonest end on top; finished ones after them, most recently ended first.
	finished := func(v EngagementView) bool { return v.Status == "ended" || v.Status == "cancelled" }
	if fa, fb := finished(a), finished(b); fa != fb {
		if fa {
			return 1
		}
		return -1
	} else if fa {
		return strings.Compare(end(b), end(a))
	}
	return strings.Compare(end(a), end(b))
}

type summaryBody struct {
	Active     int `json:"active"`
	EndingSoon int `json:"ending_soon"`
	UnderPace  int `json:"under_pace"`
	Overage    int `json:"overage"`
	ToInvoice  int `json:"to_invoice"`
}

func (s *Service) summary(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.views(r.Context(), sess.Workspace.ID, store.EngagementFilter{ClientID: r.URL.Query().Get("client_id"),
		Statuses: []string{"scheduled", "active", "ended"}, Today: s.today(sess.Workspace)})
	if err != nil {
		return err
	}
	var sum summaryBody
	for _, v := range list {
		if v.Status == "ended" { // an ended engagement only counts while something is left to invoice
			if slices.Contains(v.Attention, "to_invoice") {
				sum.ToInvoice++
			}
			continue
		}
		if v.Status == "active" {
			sum.Active++
		}
		for _, a := range v.Attention {
			switch a {
			case "ending_soon":
				sum.EndingSoon++
			case "under_pace":
				sum.UnderPace++
			case "overage":
				sum.Overage++
			case "to_invoice":
				sum.ToInvoice++
			}
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(sum))
	return nil
}

// ---- create, update, delete ----

// checkRefs refuses a client, catalogue item or document that is not in the workspace.
func checkRefs(ctx context.Context, q store.Q, ws string, e store.Engagement) error {
	gone, err := missingRef(ctx, q, ws, e)
	if err != nil || gone == nil {
		return err
	}
	return validationFailed(gone)
}

// missingRef: the message for the first of the client, catalogue item and document that is not in the workspace.
func missingRef(ctx context.Context, q store.Q, ws string, e store.Engagement) (map[string]string, error) {
	if _, err := q.Client(ctx, ws, e.ClientID); err != nil {
		return refErr(err, "client_id", "Choose an existing client.")
	}
	if e.ProductID != nil {
		if _, err := q.Product(ctx, ws, *e.ProductID); err != nil {
			return refErr(err, "product_id", "Choose an existing item.")
		}
	}
	if e.DocumentID != nil {
		if _, err := q.Document(ctx, ws, *e.DocumentID); err != nil {
			return refErr(err, "document_id", "Choose an existing document.")
		}
	}
	return nil, nil
}

func refErr(err error, field, msg string) (map[string]string, error) {
	if errors.Is(err, store.ErrNotFound) {
		return map[string]string{field: msg}, nil
	}
	return nil, err
}

// CheckCreate applies the rules of POST /engagements to a body of known fields on a new engagement in ws on the civil
// date today: the engagement, and a message per invalid field (a client, item or document outside ws included). AI
// import uses it to review a record before creating it.
func CheckCreate(ctx context.Context, q store.Q, ws string, body map[string]json.RawMessage, today string) (store.Engagement, map[string]string, error) {
	d, err := q.Defaults(ctx, ws)
	if err != nil {
		return store.Engagement{}, nil, err
	}
	var clientID string
	_ = json.Unmarshal(body["client_id"], &clientID) // a bad value is reported by applyFields
	c, err := q.Client(ctx, ws, clientID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return store.Engagement{}, nil, err
	}
	e := newEngagement(d, c, today)
	if invalid := applyFields(&e, body, d, true); len(invalid) > 0 {
		return e, invalid, nil
	}
	gone, err := missingRef(ctx, q, ws, e)
	return e, gone, err
}

// Create stores an engagement CheckCreate accepted and opens its due periods, in the caller's transaction.
func Create(ctx context.Context, q store.Q, ws string, e store.Engagement, today string, now time.Time) (string, error) {
	if e.AutoInvoice {
		if err := q.RequireFeature(ctx, ws, store.FeatureEngagementAutomation); err != nil {
			return "", err
		}
	}
	e.ID = auth.NewID("eng")
	if err := q.CreateEngagement(ctx, ws, &e, now); err != nil {
		return "", err
	}
	saved, err := q.Engagement(ctx, ws, e.ID, false)
	if err != nil {
		return "", err
	}
	_, err = ensurePeriods(ctx, q, saved, today)
	return e.ID, err
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := knownKeys(body); err != nil {
		return err
	}
	ctx, ws, now := r.Context(), sess.Workspace.ID, s.now()
	today := s.today(sess.Workspace)
	var id string
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, invalid, err := CheckCreate(ctx, q, ws, body, today)
		if err != nil {
			return err
		}
		if len(invalid) > 0 {
			return validationFailed(invalid)
		}
		id, err = Create(ctx, q, ws, e, today, now)
		return err
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}

// locked: an entry or a non-void invoice exists, so the schedule and the client are fixed.
func locked(ctx context.Context, q store.Q, e store.Engagement, periods []store.EngagementPeriod) (bool, string, error) {
	latest, err := q.LatestEntryDate(ctx, e.ID)
	if err != nil {
		return false, "", err
	}
	return latest != "" || slices.ContainsFunc(periods, func(p store.EngagementPeriod) bool { return p.AdvanceInvoice != nil }), latest, nil
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, ws, id, today := r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace)
	err := s.db.Tx(ctx, func(q store.Q) error {
		old, err := q.Engagement(ctx, ws, id, true)
		if err != nil {
			return err
		}
		d, err := q.Defaults(ctx, ws)
		if err != nil {
			return err
		}
		e := old
		if err := apply(&e, body, d, false); err != nil {
			return err
		}
		if err := checkRefs(ctx, q, ws, e); err != nil {
			return err
		}
		if e.AutoInvoice && !old.AutoInvoice {
			if err := q.RequireFeature(ctx, ws, store.FeatureEngagementAutomation); err != nil {
				return err
			}
		}
		periods, err := ensurePeriods(ctx, q, old, today)
		if err != nil {
			return err
		}
		isLocked, latest, err := locked(ctx, q, old, periods)
		if err != nil {
			return err
		}
		if isLocked && (e.ClientID != old.ClientID || e.StartDate != old.StartDate || e.Recurrence != old.Recurrence ||
			e.Interval != old.Interval) {
			return errLocked
		}
		if e.EndDate != nil && latest != "" && *e.EndDate < latest {
			return validationFailed(map[string]string{"end_date": "The end cannot be before the latest entry."})
		}
		if err := q.SaveEngagement(ctx, ws, e, s.now()); err != nil {
			return err
		}
		switch {
		case e.StartDate != old.StartDate || e.Recurrence != old.Recurrence || e.Interval != old.Interval:
			// not locked, so nothing hangs on the periods: ensurePeriods below opens them anew
			if err := q.DeletePeriods(ctx, e.ID); err != nil {
				return err
			}
		default:
			// the open and the upcoming period follow, unless invoiced in advance
			for _, p := range periods {
				if st := summarize(p, old, today, 0).State; st == "closed" || p.AdvanceInvoice != nil {
					continue
				}
				if e.Quantity != old.Quantity && !p.QuantityManual { // a hand-set quantity is a deliberate decision: the engagement's new one does not overwrite it
					if err := q.SetPeriodFullQuantity(ctx, p.ID, e.Quantity); err != nil {
						return err
					}
				}
				if o := overagePrice(e); (e.UnitPrice != old.UnitPrice || o != overagePrice(old)) && (p.UnitPrice != e.UnitPrice || p.OverageUnitPrice != o) {
					if err := q.SetPeriodPrices(ctx, p.ID, e.UnitPrice, o); err != nil {
						return err
					}
				}
			}
			if last := lastDay(e); last != "" {
				if err := q.CutPeriods(ctx, e.ID, last); err != nil {
					return err
				}
			}
			if err := reprorate(ctx, q, e.ID); err != nil {
				return err
			}
		}
		saved, err := q.Engagement(ctx, ws, id, false)
		if err != nil {
			return err
		}
		_, err = ensurePeriods(ctx, q, saved, today)
		return err
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws, r.PathValue("id"), true)
		if err != nil {
			return err
		}
		periods, err := q.EngagementPeriods(ctx, e.ID)
		if err != nil {
			return err
		}
		if slices.ContainsFunc(periods, func(p store.EngagementPeriod) bool {
			return p.AdvanceInvoice != nil || p.InvoicedQuantity > 0
		}) {
			return errEngInvoiced
		}
		return q.DeleteEngagement(ctx, ws, e.ID, s.now())
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- cancel, resume, renew ----

// optionalBody decodes a JSON object body that may be left out.
func (s *Service) optionalBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	body := map[string]json.RawMessage{}
	if r.ContentLength == 0 {
		return body, true
	}
	return body, s.auth.Decode(w, r, &body)
}

func (s *Service) cancel(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	body, ok := s.optionalBody(w, r)
	if !ok {
		return nil
	}
	for k := range body {
		if k != "cancelled_on" {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	ctx, ws, id, today := r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace)
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws, id, true)
		if err != nil {
			return err
		}
		v, err := s.view(ctx, q, e, today)
		if err != nil {
			return err
		}
		var on string // default: the end of the current period
		switch {
		case v.CurrentPeriod != nil:
			on = v.CurrentPeriod.EndsOn
		case len(v.periods) > 0:
			on = v.periods[len(v.periods)-1].EndsOn
		}
		if raw, set := body["cancelled_on"]; set && string(raw) != "null" {
			fail := func(_, msg string) { err = validationFailed(map[string]string{"cancelled_on": msg}) }
			p := date("cancelled_on", raw, fail)
			if err != nil {
				return err
			}
			on = *p
		}
		latest, err := q.LatestEntryDate(ctx, e.ID)
		if err != nil {
			return err
		}
		switch {
		case on < today:
			return validationFailed(map[string]string{"cancelled_on": "Choose today or a later day."})
		case on < latest:
			return validationFailed(map[string]string{"cancelled_on": "The last day cannot be before the latest entry."})
		}
		e.CancelledOn = &on
		if err := q.SaveEngagement(ctx, ws, e, s.now()); err != nil {
			return err
		}
		if err := q.CutPeriods(ctx, e.ID, lastDay(e)); err != nil {
			return err
		}
		return reprorate(ctx, q, e.ID)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

func (s *Service) resume(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	ctx, ws, id := r.Context(), sess.Workspace.ID, r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws, id, true)
		if err != nil {
			return err
		}
		if e.CancelledOn == nil || *e.CancelledOn < s.today(sess.Workspace) {
			return errNotResumable
		}
		e.CancelledOn = nil
		return q.SaveEngagement(ctx, ws, e, s.now())
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

func (s *Service) renew(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok := s.optionalBody(w, r)
	if !ok {
		return nil
	}
	for k := range body {
		if k != "start_date" {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	ctx, ws, now := r.Context(), sess.Workspace.ID, s.now()
	var newID string
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws, r.PathValue("id"), false)
		if err != nil {
			return err
		}
		if e.Recurrence != "none" || e.EndDate == nil {
			return errNotRenewable
		}
		from, _ := parseDate(e.StartDate)
		to, _ := parseDate(*e.EndDate)
		start := to.AddDate(0, 0, 1).Format(dateLayout)
		if raw, set := body["start_date"]; set && string(raw) != "null" {
			var bad error
			p := date("start_date", raw, func(_, msg string) { bad = validationFailed(map[string]string{"start_date": msg}) })
			if bad != nil {
				return bad
			}
			start = *p
		}
		s0, _ := parseDate(start)
		end := s0.AddDate(0, 0, int(to.Sub(from).Hours()/24)).Format(dateLayout)
		e.ID, e.StartDate, e.EndDate, e.CancelledOn, e.DocumentID = auth.NewID("eng"), start, &end, nil, nil
		if err := checkRefs(ctx, q, ws, e); err != nil {
			return err
		}
		if err := q.CreateEngagement(ctx, ws, &e, now); err != nil {
			return err
		}
		newID = e.ID
		e, err = q.Engagement(ctx, ws, newID, false)
		if err != nil {
			return err
		}
		_, err = ensurePeriods(ctx, q, e, s.today(sess.Workspace))
		return err
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, newID)
}

// ---- periods ----

func (s *Service) periods(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, ws := r.Context(), sess.Workspace.ID
	out := []Period{}
	err := s.db.Tx(ctx, func(q store.Q) error {
		out = out[:0]
		e, err := q.Engagement(ctx, ws, r.PathValue("id"), false)
		if err != nil {
			return err
		}
		v, err := s.view(ctx, q, e, s.today(sess.Workspace))
		if err != nil {
			return err
		}
		for _, p := range v.periods {
			pv, err := periodView(ctx, q, p)
			if err != nil {
				return err
			}
			out = append(out, pv)
		}
		return nil
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) patchPeriod(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	for k := range body {
		if k != "quantity" {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	n, ok := invoicecalc.ParseQuantity(literal(body["quantity"]))
	if !ok || n <= 0 || n > maxQuantity {
		return validationFailed(map[string]string{"quantity": "Enter a quantity above 0 and up to 1'000'000 with at most three decimals."})
	}
	ctx, ws, id, today := r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace)
	var out Period
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws, id, true)
		if err != nil {
			return err
		}
		periods, err := ensurePeriods(ctx, q, e, today)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(periods, func(p store.EngagementPeriod) bool { return p.ID == r.PathValue("period_id") })
		if i < 0 {
			return store.ErrNotFound
		}
		if periods[i].AdvanceInvoice != nil {
			return errPeriodInvoiced
		}
		if err := q.SetPeriodQuantity(ctx, periods[i].ID, n); err != nil {
			return err
		}
		if err := q.SetPeriodFullQuantity(ctx, periods[i].ID, n); err != nil {
			return err
		}
		periods[i].Quantity, periods[i].FullQuantity, periods[i].QuantityManual = n, n, true
		out, err = periodView(ctx, q, summarize(periods[i], e, today, carries(e, periods)[periods[i].ID]))
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}
