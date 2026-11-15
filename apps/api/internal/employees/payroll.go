package employees

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// Payroll entries record pay that a person or an external system computed: saving or importing one certifies
// nothing, approving one is a person's confirmation, and neither means it was paid.

var (
	errPeriodClosed   = auth.Error(http.StatusConflict, "period_closed", "That month is closed in the books.", nil)
	errStale          = conflict("conflict", "This entry was changed meanwhile. Reload it and try again.")
	errApproved       = conflict("approved", "An approved entry cannot be changed. Record a correction instead.")
	errPeriodTaken    = validationFailed(map[string]string{"period_start": "This employee already has an entry for this period. Correct that entry instead."})
	errCorrectionOpen = conflict("correction_exists", "This entry already has a correction.")
)

var entryKeys = []string{"employee_id", "employing_entity", "period_start", "period_end", "pay_date", "currency", "gross",
	"deductions", "net", "employer_costs", "components", "source", "source_ref", "note"}

var componentKinds = []string{"earning", "deduction", "employer_cost"}

var month = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// parseEntry applies a body's fields to p. An absent or null amount is missing and stays missing.
func parseEntry(p *store.PayrollEntry, body map[string]json.RawMessage) fields {
	f := fields{}
	for k, raw := range body {
		switch k {
		case "employee_id":
			p.EmployeeID = f.required(k, raw, 64, "Choose the employee.")
		case "employing_entity":
			p.EmployingEntity = f.required(k, raw, 200, "Enter the employing company.")
		case "period_start", "period_end":
			v := f.text(k, raw, 10, date)
			if v == nil {
				f.fail(k, "Enter the date.")
				continue
			}
			if k == "period_start" {
				p.PeriodStart = *v
			} else {
				p.PeriodEnd = *v
			}
		case "pay_date":
			p.PayDate = f.text(k, raw, 10, date)
		case "currency":
			if v := f.text(k, raw, 3, currency); v != nil {
				p.Currency = *v
			} else {
				f.fail(k, "Choose a currency.")
			}
		case "gross":
			p.Gross = f.money(k, raw)
		case "deductions":
			p.Deductions = f.money(k, raw)
		case "net":
			p.Net = f.money(k, raw)
		case "employer_costs":
			p.EmployerCosts = f.money(k, raw)
		case "components":
			p.Components = f.components(raw)
		case "source":
			if v := f.text(k, raw, 10, oneOf("manual", "external")); v != nil {
				p.Source = *v
			}
		case "source_ref":
			p.SourceRef = f.text(k, raw, 100, nil)
		case "note":
			p.Note = f.text(k, raw, 1000, nil)
		}
	}
	return f
}

func (f fields) components(raw json.RawMessage) []store.PayrollComponent {
	var list []map[string]json.RawMessage
	if string(raw) == "null" {
		return []store.PayrollComponent{}
	}
	if json.Unmarshal(raw, &list) != nil || len(list) > 50 {
		f.fail("components", "Send up to 50 components with kind, label and amount.")
		return nil
	}
	out := make([]store.PayrollComponent, 0, len(list))
	for _, c := range list {
		var item store.PayrollComponent
		if v := f.text("components", c["kind"], 20, oneOf(componentKinds...)); v != nil {
			item.Kind = *v
		}
		item.Label = f.required("components", c["label"], 100, "Each component needs a label.")
		if m := f.money("components", c["amount"]); m != nil {
			item.Amount = *m
		} else {
			f.fail("components", "Each component needs an amount.")
		}
		out = append(out, item)
	}
	return out
}

// CheckEntry validates an entry's figures against each other. Only values that are present are compared; a missing
// one is never assumed to be 0, so an incomplete entry is valid but not complete.
func CheckEntry(p store.PayrollEntry) map[string]string {
	f := fields{}
	if p.PeriodStart != "" && p.PeriodEnd != "" {
		start, _ := time.Parse(time.DateOnly, p.PeriodStart)
		end, _ := time.Parse(time.DateOnly, p.PeriodEnd)
		switch {
		case end.Before(start):
			f.fail("period_end", "The period cannot end before it starts.")
		case end.Sub(start) > 366*24*time.Hour:
			f.fail("period_end", "A pay period is at most one year.")
		}
	}
	if p.Gross == nil && p.Deductions == nil && p.Net == nil && p.EmployerCosts == nil {
		f.fail("gross", "Enter at least one of gross, deductions, net pay or employer costs.")
	}
	if p.Gross != nil && p.Deductions != nil && p.Net != nil && *p.Gross-*p.Deductions != *p.Net {
		f.fail("net", "Gross minus deductions must equal net pay ("+(*p.Gross-*p.Deductions).String()+").")
	}
	if p.Gross != nil && p.Deductions != nil && *p.Deductions > *p.Gross {
		f.fail("deductions", "Deductions cannot exceed gross pay.")
	}
	sums := map[string]invoicecalc.Money{}
	has := map[string]bool{}
	for _, c := range p.Components {
		sums[c.Kind] += c.Amount
		has[c.Kind] = true
	}
	for kind, total := range map[string]*invoicecalc.Money{"earning": p.Gross, "deduction": p.Deductions, "employer_cost": p.EmployerCosts} {
		if has[kind] && total != nil && sums[kind] != *total {
			key := map[string]string{"earning": "gross", "deduction": "deductions", "employer_cost": "employer_costs"}[kind]
			f.fail(key, "The "+kind+" components add up to "+sums[kind].String()+", not "+total.String()+".")
		}
	}
	return f
}

// checkEmployment refuses an entry for an employee who cannot take one, or a period outside the employment.
func checkEmployment(e store.Employee, p store.PayrollEntry) error {
	if err := writable(e); err != nil {
		return err
	}
	if p.PeriodEnd < e.EmploymentStart || e.EmploymentEnd != nil && p.PeriodStart > *e.EmploymentEnd {
		return validationFailed(map[string]string{"period_start": "The period lies outside this employee's employment."})
	}
	return nil
}

func (s *Service) entries(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f := store.PayrollFilter{Month: q.Get("month"), EmployeeID: q.Get("employee_id"), Status: q.Get("status"),
		Superseded: q.Get("superseded") == "true"}
	if f.Month != "" && !month.MatchString(f.Month) {
		return badRequest("month must be YYYY-MM.")
	}
	if f.Status != "" && f.Status != "draft" && f.Status != "approved" {
		return badRequest("status must be draft or approved.")
	}
	list, err := s.db.ListPayrollEntries(r.Context(), sess.Workspace.ID, f)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) entry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respondEntry(w, r, sess, http.StatusOK, r.PathValue("id"))
}

func (s *Service) respondEntry(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	p, err := s.db.PayrollEntry(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(p))
	return nil
}

// CreateEntry checks and stores a new draft entry in q's transaction: the canonical write for the form and the
// payroll import alike.
func CreateEntry(ctx context.Context, q store.Q, sess store.Session, p store.PayrollEntry, today string, now time.Time) (string, error) {
	if invalid := CheckEntry(p); len(invalid) > 0 {
		return "", validationFailed(invalid)
	}
	e, err := q.EmployeeForUpdate(ctx, sess.Workspace.ID, p.EmployeeID, today)
	if errors.Is(err, store.ErrNotFound) {
		return "", validationFailed(map[string]string{"employee_id": "Choose an employee of this workspace."})
	}
	if err != nil {
		return "", err
	}
	if err := checkEmployment(e, p); err != nil {
		return "", err
	}
	if p.EmployingEntity == "" {
		p.EmployingEntity = e.EmployingEntity
	}
	if p.Source == "" {
		p.Source = "manual"
	}
	if p.Components == nil {
		p.Components = []store.PayrollComponent{}
	}
	p.ID, p.CreatedAt = auth.NewID("pay"), now
	err = q.CreatePayrollEntry(ctx, sess.Workspace.ID, sess.User.ID, p)
	switch {
	case errors.Is(err, store.ErrPayrollPeriodTaken):
		return "", errPeriodTaken
	case err != nil:
		return "", err
	}
	return p.ID, nil
}

func (s *Service) createEntry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, entryKeys); err != nil {
		return err
	}
	var p store.PayrollEntry
	f := parseEntry(&p, body)
	for k, msg := range map[string]string{"employee_id": "Choose the employee.", "period_start": "Enter the date.",
		"period_end": "Enter the date.", "currency": "Choose a currency."} {
		if body[k] == nil {
			f.fail(k, msg)
		}
	}
	if len(f) > 0 {
		return validationFailed(f)
	}
	var id string
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		var err error
		id, err = CreateEntry(r.Context(), q, sess, p, s.today(sess), s.now())
		return err
	})
	if err != nil {
		return err
	}
	return s.respondEntry(w, r, sess, http.StatusCreated, id)
}

// version reads the version a change is based on, required so a change never silently overwrites another.
func version(body map[string]json.RawMessage) (int, error) {
	var v int
	if raw, ok := body["version"]; !ok || json.Unmarshal(raw, &v) != nil || v < 1 {
		return 0, validationFailed(map[string]string{"version": "Send the version of the entry you changed."})
	}
	delete(body, "version")
	return v, nil
}

func (s *Service) updateEntry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	v, err := version(body)
	if err != nil {
		return err
	}
	if err := known(body, entryKeys); err != nil {
		return err
	}
	id := r.PathValue("id")
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		p, err := q.PayrollEntryForUpdate(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if p.Status != "draft" {
			return errApproved
		}
		if p.Version != v {
			return errStale
		}
		before := p.EmployeeID
		if f := parseEntry(&p, body); len(f) > 0 {
			return validationFailed(f)
		}
		if p.SupersedesID != nil && p.EmployeeID != before {
			return validationFailed(map[string]string{"employee_id": "A correction stays with the employee of the entry it corrects."})
		}
		if invalid := CheckEntry(p); len(invalid) > 0 {
			return validationFailed(invalid)
		}
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, p.EmployeeID, s.today(sess))
		if errors.Is(err, store.ErrNotFound) {
			return validationFailed(map[string]string{"employee_id": "Choose an employee of this workspace."})
		}
		if err != nil {
			return err
		}
		if err := checkEmployment(e, p); err != nil {
			return err
		}
		ok, err := q.SavePayrollDraft(r.Context(), sess.Workspace.ID, p, v, s.now())
		switch {
		case errors.Is(err, store.ErrPayrollPeriodTaken):
			return errPeriodTaken
		case err != nil:
			return err
		case !ok:
			return errStale
		}
		return nil
	})
	if err != nil {
		return err
	}
	return s.respondEntry(w, r, sess, http.StatusOK, id)
}

func (s *Service) deleteEntry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ok, err := s.db.DeletePayrollDraft(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !ok {
		if _, err := s.db.PayrollEntry(r.Context(), sess.Workspace.ID, r.PathValue("id")); err != nil {
			return err
		}
		return errApproved
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// approve confirms a draft at the version the approver saw. Of two approvals at once, one wins and the other gets
// 409 conflict. Approving a correction marks the entry it corrects as superseded; both stay.
func (s *Service) approve(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	v, err := version(body)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		p, err := q.PayrollEntryForUpdate(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if p.Status != "draft" {
			return conflict("conflict", "This entry is already approved.")
		}
		if p.Version != v {
			return errStale
		}
		if invalid := CheckEntry(p); len(invalid) > 0 {
			return validationFailed(invalid)
		}
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, p.EmployeeID, s.today(sess))
		if err != nil {
			return err
		}
		if err := writable(e); err != nil {
			return err
		}
		if err := q.CheckOpen(r.Context(), sess.Workspace.ID, p.PeriodEnd); err != nil {
			return err
		}
		ok, err := q.ApprovePayrollEntry(r.Context(), sess.Workspace.ID, id, v, sess.User.ID, s.now())
		if err != nil {
			return err
		}
		if !ok {
			return errStale
		}
		if p.SupersedesID != nil {
			if err := q.SupersedePayrollEntry(r.Context(), sess.Workspace.ID, *p.SupersedesID, id, s.now()); err != nil {
				return err
			}
			if err := s.audit(r, q, sess, "payroll.corrected", "payroll_entry", *p.SupersedesID); err != nil {
				return err
			}
		}
		return s.audit(r, q, sess, "payroll.approved", "payroll_entry", id)
	})
	if err != nil {
		return err
	}
	return s.respondEntry(w, r, sess, http.StatusOK, id)
}

// payment records whether the net pay of an approved entry was paid, apart from its approval. It moves no money.
func (s *Service) payment(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	v, err := version(body)
	if err != nil {
		return err
	}
	if err := known(body, []string{"status", "paid_on"}); err != nil {
		return err
	}
	f := fields{}
	status := f.text("status", body["status"], 10, oneOf("paid", "unpaid"))
	var paidOn *string
	if status != nil && *status == "paid" {
		if paidOn = f.text("paid_on", body["paid_on"], 10, date); paidOn == nil {
			f.fail("paid_on", "Enter the payment date.")
		}
	}
	if status == nil {
		f.fail("status", "Choose paid or unpaid.")
	}
	if len(f) > 0 {
		return validationFailed(f)
	}
	id := r.PathValue("id")
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		p, err := q.PayrollEntryForUpdate(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		switch {
		case p.Status != "approved":
			return conflict("not_approved", "Only an approved entry can be marked as paid.")
		case p.SupersededBy != nil:
			return conflict("superseded", "This entry was corrected; record the payment on the correction.")
		case p.Version != v:
			return errStale
		}
		for _, k := range p.Booked {
			if k == "payment" {
				return conflict("booked", "The payment of this entry is already booked.")
			}
		}
		if paidOn != nil {
			if err := q.CheckOpen(r.Context(), sess.Workspace.ID, *paidOn); err != nil {
				return err
			}
		} else if p.PaidOn != nil {
			if err := q.CheckOpen(r.Context(), sess.Workspace.ID, *p.PaidOn); err != nil {
				return err
			}
		}
		ok, err := q.SetPayrollPayment(r.Context(), sess.Workspace.ID, id, v, paidOn, s.now())
		if err != nil {
			return err
		}
		if !ok {
			return errStale
		}
		return s.audit(r, q, sess, map[bool]string{true: "payroll.paid", false: "payroll.unpaid"}[paidOn != nil], "payroll_entry", id)
	})
	if err != nil {
		return err
	}
	return s.respondEntry(w, r, sess, http.StatusOK, id)
}

// correct starts a correction of an approved entry: a new draft with the same figures to change, the original kept.
func (s *Service) correct(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	original := r.PathValue("id")
	var id string
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		p, err := q.PayrollEntryForUpdate(r.Context(), sess.Workspace.ID, original)
		if err != nil {
			return err
		}
		if p.Status != "approved" || p.SupersededBy != nil {
			return conflict("not_correctable", "Only the current approved entry can be corrected; a draft is edited directly.")
		}
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, p.EmployeeID, s.today(sess))
		if err != nil {
			return err
		}
		if err := writable(e); err != nil {
			return err
		}
		c := p
		c.ID, c.SupersedesID, c.CreatedAt = auth.NewID("pay"), &original, s.now()
		err = q.CreatePayrollEntry(r.Context(), sess.Workspace.ID, sess.User.ID, c)
		if errors.Is(err, store.ErrCorrectionOpen) {
			return errCorrectionOpen
		}
		id = c.ID
		return err
	})
	if err != nil {
		return err
	}
	return s.respondEntry(w, r, sess, http.StatusCreated, id)
}

func (s *Service) summary(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	m := r.URL.Query().Get("month")
	if !month.MatchString(m) {
		return badRequest("month must be YYYY-MM.")
	}
	totals, err := s.db.PayrollSummary(r.Context(), sess.Workspace.ID, m)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"month": m, "currencies": totals}))
	return nil
}

func moneyCell(m *invoicecalc.Money) string {
	if m == nil {
		return ""
	}
	return m.String()
}

func cell(v *string) string {
	if v == nil {
		return ""
	}
	return csvSafe(*v)
}

// csvSafe keeps a spreadsheet from reading a cell as a formula.
func csvSafe(v string) string {
	if v != "" && (v[0] == '=' || v[0] == '+' || v[0] == '-' || v[0] == '@' || v[0] == '\t' || v[0] == '\r') {
		return "'" + v
	}
	return v
}

// export writes the month's register as CSV (missing values empty, never 0), and records who exported it.
func (s *Service) export(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	m := r.URL.Query().Get("month")
	if !month.MatchString(m) {
		return badRequest("month must be YYYY-MM.")
	}
	list, err := s.db.ListPayrollEntries(r.Context(), sess.Workspace.ID, store.PayrollFilter{Month: m, Superseded: true})
	if err != nil {
		return err
	}
	if err := s.db.Tx(r.Context(), func(q store.Q) error {
		return s.audit(r, q, sess, "payroll.exported", "payroll_month", m)
	}); err != nil {
		return err
	}
	h := w.Header()
	h.Set("Content-Type", "text/csv; charset=utf-8")
	h.Set("Content-Disposition", `attachment; filename="payroll-`+m+`.csv"`)
	h.Set("Cache-Control", "private, no-store")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"entry_id", "employee_number", "employee", "employing_entity", "period_start", "period_end", "pay_date",
		"currency", "gross", "deductions", "net", "employer_costs", "total_cost", "status", "payment_status", "paid_on", "source",
		"source_ref", "supersedes", "superseded_by"})
	for _, p := range list {
		_ = cw.Write([]string{p.ID, cell(p.EmployeeNumber), csvSafe(p.EmployeeName), csvSafe(p.EmployingEntity), p.PeriodStart,
			p.PeriodEnd, cell(p.PayDate), p.Currency, moneyCell(p.Gross), moneyCell(p.Deductions), moneyCell(p.Net),
			moneyCell(p.EmployerCosts), moneyCell(p.TotalCost), p.Status, p.PaymentStatus, cell(p.PaidOn), p.Source,
			cell(p.SourceRef), cell(p.SupersedesID), cell(p.SupersededBy)})
	}
	cw.Flush()
	return cw.Error()
}
