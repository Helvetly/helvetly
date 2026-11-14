package ledger

import (
	"bytes"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/ledgercalc"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db   *store.Store
	auth Auth
	now  func() time.Time
}

func New(db *store.Store, a Auth) *Service {
	return &Service{db: db, auth: a, now: time.Now}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/ledger", s.report)
	handle("GET /api/v1/ledger/journal", s.journal)
	handle("GET /api/v1/ledger/accounts/{code}", s.statement)
	handle("GET /api/v1/ledger/export", s.export)
	handle("GET /api/v1/ledger/settings", s.settings)
	handle("PUT /api/v1/ledger/settings", s.saveSettings)
}

var (
	errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can do this.", nil)
	errDate      = auth.Error(http.StatusBadRequest, "invalid_request", "from and to must be dates (YYYY-MM-DD).", nil)
	errOrder     = auth.Error(http.StatusBadRequest, "invalid_request", "from must not be after to.", nil)
	errAccount   = auth.Error(http.StatusBadRequest, "invalid_request", "The account code must be 3 to 10 digits.", nil)
	errFormat    = auth.Error(http.StatusBadRequest, "invalid_request", "format must be banana, bexio, abacus or csv.", nil)
	codePattern  = regexp.MustCompile(`^[0-9]{3,10}$`)
)

func data(v any) map[string]any { return map[string]any{"data": v} }

// period reads from and to; the default is the current calendar year in the workspace's time zone.
func (s *Service) period(r *http.Request, sess store.Session) (from, to string, err error) {
	year := sess.Workspace.Today(s.now())[:4]
	from, to = r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from == "" {
		from = year + "-01-01"
	}
	if to == "" {
		to = year + "-12-31"
	}
	for _, d := range []string{from, to} {
		if _, perr := time.Parse(time.DateOnly, d); perr != nil {
			return "", "", errDate
		}
	}
	if from > to {
		return "", "", errOrder
	}
	return from, to, nil
}

// rows posts every source document up to `to`; names label the accounts.
func (s *Service) rows(r *http.Request, sess store.Session, to string) ([]ledgercalc.Row, []store.LedgerUnposted, map[string]string, error) {
	ctx, ws := r.Context(), sess.Workspace.ID
	accounts, err := s.db.LedgerAccounts(ctx, ws)
	if err != nil {
		return nil, nil, nil, err
	}
	src, unposted, err := s.db.LedgerSources(ctx, ws, to)
	if err != nil {
		return nil, nil, nil, err
	}
	names, err := s.db.LedgerAccountNames(ctx, ws)
	if err != nil {
		return nil, nil, nil, err
	}
	return ledgercalc.Post(accounts, src), unposted, names, nil
}

func (s *Service) baseCurrency(r *http.Request, sess store.Session) (string, error) {
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	return d.Currency, err
}

func (s *Service) report(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	from, to, err := s.period(r, sess)
	if err != nil {
		return err
	}
	rows, unposted, names, err := s.rows(r, sess, to)
	if err != nil {
		return err
	}
	base, err := s.baseCurrency(r, sess)
	if err != nil {
		return err
	}
	type unpostedOut struct {
		Ref    string `json:"ref"`
		Reason string `json:"reason"`
	}
	out := []unpostedOut{}
	for _, u := range unposted {
		out = append(out, unpostedOut{u.Ref, u.Reason})
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{
		"from": from, "to": to, "currency": base,
		"balances": ledgercalc.Balances(rows, from, to, names), "unposted": out,
	}))
	return nil
}

func (s *Service) journal(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	from, to, err := s.period(r, sess)
	if err != nil {
		return err
	}
	rows, _, _, err := s.rows(r, sess, to)
	if err != nil {
		return err
	}
	in := ledgercalc.InRange(rows, from, to)
	if in == nil {
		in = []ledgercalc.Row{}
	}
	auth.WriteJSON(w, http.StatusOK, data(in))
	return nil
}

func (s *Service) statement(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	code := r.PathValue("code")
	if !codePattern.MatchString(code) {
		return errAccount
	}
	from, to, err := s.period(r, sess)
	if err != nil {
		return err
	}
	currency := r.URL.Query().Get("currency")
	if currency == "" {
		if currency, err = s.baseCurrency(r, sess); err != nil {
			return err
		}
	}
	rows, _, names, err := s.rows(r, sess, to)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(ledgercalc.AccountStatement(rows, code, currency, from, to, names)))
	return nil
}

func (s *Service) export(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	from, to, err := s.period(r, sess)
	if err != nil {
		return err
	}
	format := r.URL.Query().Get("format")
	name, contentType, ok := ExportFile(format, from, to)
	if !ok {
		return errFormat
	}
	rows, _, _, err := s.rows(r, sess, to)
	if err != nil {
		return err
	}
	base, err := s.baseCurrency(r, sess)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	skipped, err := WriteExport(&buf, format, ledgercalc.InRange(rows, from, to), base)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("X-Skipped-Rows", strconv.Itoa(skipped))
	_, _ = w.Write(buf.Bytes())
	return nil
}

func (s *Service) settings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	a, err := s.db.LedgerAccounts(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(a))
	return nil
}

func (s *Service) saveSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if sess.Role != "owner" && sess.Role != "admin" {
		return errForbidden
	}
	in := ledgercalc.DefaultAccounts() // a field or bank method left out keeps its default
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	fields := map[string]string{}
	check := func(key, code string) {
		if !codePattern.MatchString(code) {
			fields[key] = "Enter an account code of 3 to 10 digits."
		}
	}
	for key, code := range map[string]string{
		"receivables": in.Receivables, "revenue": in.Revenue, "output_vat": in.OutputVAT, "rounding": in.Rounding,
		"payables": in.Payables, "member_payable": in.MemberPayable,
		"input_vat_material": in.InputVATMaterial, "input_vat_other": in.InputVATOther,
	} {
		check(key, code)
	}
	for method, code := range in.Bank {
		check("bank."+method, code)
	}
	check("bank.other", in.Bank["other"]) // "bank": null drops the default; payment rows fall back to "other"
	if len(fields) > 0 {
		return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
			map[string]any{"fields": fields})
	}
	if err := s.db.SaveLedgerAccounts(r.Context(), sess.Workspace.ID, sess.User.ID, in, s.now()); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(in))
	return nil
}
