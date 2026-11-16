// Package vatreturn serves the figures of the Swiss VAT return (MWST-Abrechnung) for a tax period, as JSON, CSV and
// a PDF summary, and the workspace's VAT settlement settings (docs/vat-return-contract.md). The figures come only
// from internal/vatcalc; filing stays with the person, in the ESTV ePortal.
package vatreturn

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/vatcalc"
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
	handle("GET /api/v1/vat-return", s.report)
	handle("GET /api/v1/vat-return/settings", s.settings)
	handle("PUT /api/v1/vat-return/settings", s.saveSettings)
}

const maxNetRates = 10

var (
	errPeriod = auth.Error(http.StatusBadRequest, "invalid_request",
		"period must be a year (2026), a half-year (2026-H1), a quarter (2026-Q3) or a month (2026-07).", nil)
)

func data(v any) map[string]any { return map[string]any{"data": v} }

func (s *Service) settings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	set, err := s.db.VATReturnSettings(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(set))
	return nil
}

type settingsInput struct {
	Method   string `json:"method"`
	Period   string `json:"period"`
	Basis    string `json:"basis"`
	NetRates []struct {
		Label string `json:"label"`
		Rate  string `json:"rate"`
	} `json:"net_rates"`
}

func (s *Service) saveSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in settingsInput
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	set, err := in.validate()
	if err != nil {
		return err
	}
	if err := s.db.SaveVATReturnSettings(r.Context(), sess.Workspace.ID, sess.User.ID, set, s.now()); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(set))
	return nil
}

func (in settingsInput) validate() (store.VATReturnSettings, error) {
	fields := map[string]string{}
	oneOf := func(key, v string, allowed ...string) {
		for _, a := range allowed {
			if v == a {
				return
			}
		}
		fields[key] = "Choose one of " + strings.Join(allowed, ", ") + "."
	}
	oneOf("method", in.Method, vatcalc.Effective, vatcalc.NetTaxRate)
	oneOf("period", in.Period, "monthly", "quarterly", "half_yearly", "yearly")
	oneOf("basis", in.Basis, "agreed", "received")
	set := store.VATReturnSettings{Method: in.Method, Period: in.Period, Basis: in.Basis, NetRates: []vatcalc.NetRate{}}
	if len(in.NetRates) > maxNetRates {
		fields["net_rates"] = "Enter at most 10 net tax rates."
	}
	for _, nr := range in.NetRates {
		label := strings.TrimSpace(nr.Label)
		rate, ok := invoicecalc.ParsePercent(strings.TrimSpace(nr.Rate))
		switch {
		case label == "" || utf8.RuneCountInString(label) > 80:
			fields["net_rates"] = "Name each net tax rate's activity, in at most 80 characters."
		case !ok || rate <= 0 || rate > 1000:
			fields["net_rates"] = "Enter each net tax rate as a percentage above 0 and at most 10, with at most two decimals."
		}
		set.NetRates = append(set.NetRates, vatcalc.NetRate{Label: label, Rate: rate})
	}
	if in.Method == vatcalc.NetTaxRate && len(in.NetRates) == 0 && fields["net_rates"] == "" {
		fields["net_rates"] = "The net tax rate method needs the rate the ESTV approved."
	}
	if len(fields) > 0 {
		return set, auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
			map[string]any{"fields": fields})
	}
	if in.Method == vatcalc.Effective {
		set.NetRates = []vatcalc.NetRate{} // rates mean nothing under the effective method
	}
	return set, nil
}

// Report is one period's return.
type Report struct {
	Period       string            `json:"period"`
	From         string            `json:"from"`
	To           string            `json:"to"` // the period's last day
	Method       string            `json:"method"`
	Basis        string            `json:"basis"`
	Currency     string            `json:"currency"`
	Months       int               `json:"months"`
	ClosedMonths int               `json:"closed_months"`
	NetRates     []vatcalc.NetRate `json:"net_rates"`
	Lines        []vatcalc.Line    `json:"lines"`
	Warnings     []vatcalc.Warning `json:"warnings"`
}

func (s *Service) report(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	set, err := s.db.VATReturnSettings(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	name := r.URL.Query().Get("period")
	if name == "" {
		name = lastEnded(set.Period, sess.Workspace.Today(s.now()))
	}
	p, ok := parsePeriod(name)
	if !ok {
		return errPeriod
	}
	rep, err := s.build(ctx, sess.Workspace.ID, set, p)
	if err != nil {
		return err
	}
	switch r.URL.Query().Get("format") {
	case "", "json":
		auth.WriteJSON(w, http.StatusOK, data(rep))
		return nil
	case "csv":
		return writeCSV(w, rep)
	case "pdf":
		body, err := renderPDF(rep, sess.Workspace.Name, sess.Workspace.Today(s.now()))
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="vat-return-`+rep.Period+`.pdf"`)
		_, err = w.Write(body)
		return err
	case "xml":
		return s.writeXML(ctx, w, sess, rep)
	}
	return auth.Error(http.StatusBadRequest, "invalid_request", "format must be json, csv, pdf or xml.", nil)
}

// writeXML serves the eCH-0217 file the person imports in the ESTV ePortal, under the seller's UID.
func (s *Service) writeXML(ctx context.Context, w http.ResponseWriter, sess store.Session, rep Report) error {
	var settings struct {
		Seller struct {
			Name      string  `json:"name"`
			VATNumber *string `json:"vat_number"`
		} `json:"seller"`
	}
	if _, err := s.db.InvoiceSettings(ctx, sess.Workspace.ID, &settings); err != nil {
		return err
	}
	var uid string
	if v := settings.Seller.VATNumber; v != nil {
		uid, _ = uidOf(*v)
	}
	if reasons := exportReasons(rep, uid); len(reasons) > 0 {
		return errCannotExport(reasons)
	}
	name := settings.Seller.Name
	if strings.TrimSpace(name) == "" {
		name = sess.Workspace.Name
	}
	body, err := reportXML(rep, uid, name, s.now())
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="MWST_`+uid+"_"+rep.Period+`.xml"`)
	_, err = w.Write(body)
	return err
}

func (s *Service) build(ctx context.Context, workspaceID string, set store.VATReturnSettings, p span) (Report, error) {
	received := set.Basis == "received"
	read := s.db.VATSales
	if received {
		read = s.db.VATReceipts
	}
	docs, err := read(ctx, workspaceID, p.From, p.Next)
	if err != nil {
		return Report{}, err
	}
	purchases, err := s.db.VATPurchases(ctx, workspaceID, p.From, p.Next, received)
	if err != nil {
		return Report{}, err
	}
	selfBilled, err := s.db.VATSelfBilled(ctx, workspaceID, p.From, p.Next)
	if err != nil {
		return Report{}, err
	}
	closed, err := s.db.ClosedMonths(ctx, workspaceID, p.From, p.Next)
	if err != nil {
		return Report{}, err
	}
	var warnings []vatcalc.Warning
	warn := func(code, msg string, refs []string) {
		if len(refs) > 0 {
			warnings = append(warnings, vatcalc.Warning{Code: code, Message: msg, Refs: refs})
		}
	}
	var sales []vatcalc.Sale
	var foreign []string
	for _, d := range docs {
		if d.Currency != "CHF" {
			foreign = appendOnce(foreign, d.Ref)
			continue
		}
		sales = append(sales, vatcalc.Sale{Ref: d.Ref, SupplyDate: d.SupplyDate, Groups: d.Groups})
	}
	var bought []vatcalc.Purchase
	var notCHF []string
	for _, pu := range purchases {
		if pu.Currency != "CHF" {
			notCHF = append(notCHF, pu.Ref)
			continue
		}
		bought = append(bought, pu.Purchase)
	}
	warn("foreign_currency", "Invoices not in CHF carry no CHF exchange rate, so they are left out: add their CHF amounts by hand.", foreign)
	warn("expense_currency", "Expenses whose base amounts are not in CHF are left out.", notCHF)
	warn("self_billed", "Self-billed documents are purchases: book them as expenses to claim their input tax.", selfBilled)
	ret := vatcalc.Compute(vatcalc.Settings{Method: set.Method, Rates: set.NetRates}, sales, bought)
	months := monthsBetween(p.From, p.Next)
	if closed < months {
		warnings = append(warnings, vatcalc.Warning{Code: "open_period", Refs: []string{},
			Message: "Not every month of the period is closed: the figures can still change. Close the months before filing."})
	}
	return Report{Period: p.Name, From: p.From, To: p.Last, Method: set.Method, Basis: set.Basis, Currency: "CHF",
		Months: months, ClosedMonths: closed, NetRates: set.NetRates, Lines: ret.Lines,
		Warnings: append(warnings, ret.Warnings...)}, nil
}

func appendOnce(refs []string, ref string) []string {
	if len(refs) > 0 && refs[len(refs)-1] == ref {
		return refs
	}
	return append(refs, ref)
}

func monthsBetween(from, next string) int {
	a, _ := time.Parse(time.DateOnly, from)
	b, _ := time.Parse(time.DateOnly, next)
	return (b.Year()-a.Year())*12 + int(b.Month()-a.Month())
}

func writeCSV(w http.ResponseWriter, rep Report) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="vat-return-`+rep.Period+`.csv"`)
	c := csv.NewWriter(w)
	rows := [][]string{{"ziffer", "label_de", "label_en", "amount", "base", "rate", "tax", "sources"}}
	for _, l := range rep.Lines {
		row := []string{l.Ziffer, l.LabelDE, l.LabelEN, l.Amount.String(), "", "", "", strconv.Itoa(l.Sources)}
		if l.Kind == "rate" {
			row[3], row[4], row[5], row[6] = "", l.Base.String(), l.Rate.String(), l.Tax.String()
		}
		rows = append(rows, row)
	}
	if err := c.WriteAll(rows); err != nil {
		return fmt.Errorf("vat return csv: %w", err)
	}
	return nil
}
