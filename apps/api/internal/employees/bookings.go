package employees

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/ledger"
	"helvetly.com/api/internal/ledgercalc"
	"helvetly.com/api/internal/store"
)

// Bookings turn approved payroll into journal rows for the accounting: each entry's accrual, the reversal of an
// accrual a correction replaced, and payments, each booked exactly once (payroll_booking_items' key). Nothing is
// converted between currencies: an entry outside the base currency is listed as blocked.

var errNothingToBook = conflict("nothing_to_book", "There is nothing to book up to that date.")

const (
	blockIncomplete   = "Some figures are missing: gross, deductions, net pay and employer costs are all needed to book it."
	blockInconsistent = "Gross minus deductions does not equal net pay."
)

type candidate struct {
	store.BookingCandidate
	PaidBefore string `json:"paid_before,omitempty"`
}

// candidates is what the next booking up to the day would post, each with what blocks it.
func (s *Service) candidates(r *http.Request, q store.Q, sess store.Session, upTo string) ([]store.BookingCandidate, string, error) {
	d, err := q.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return nil, "", err
	}
	list, err := q.BookingCandidates(r.Context(), sess.Workspace.ID, upTo)
	if err != nil {
		return nil, "", err
	}
	accrued := map[string]bool{}
	for i := range list {
		c := &list[i]
		p := c.Entry
		switch {
		case c.Kind != "payment" && !p.Complete:
			c.Blocked = blockIncomplete
		case c.Kind == "payment" && p.Net == nil:
			c.Blocked = "Net pay is missing."
		case c.Kind != "payment" && *p.Gross-*p.Deductions != *p.Net:
			c.Blocked = blockInconsistent
		case p.Currency != d.Currency:
			c.Blocked = "In " + p.Currency + ", not the base currency " + d.Currency + ": book it in your accounting with the rate you use."
		case c.Kind == "payment" && !slices.Contains(p.Booked, "accrual") && !accrued[p.ID]:
			c.Blocked = "Its accrual is not booked yet."
		}
		if c.Kind == "accrual" && c.Blocked == "" {
			accrued[p.ID] = true
		}
	}
	return list, d.Currency, nil
}

func (s *Service) upTo(r *http.Request, sess store.Session, v string) (string, error) {
	if v == "" {
		return s.today(sess), nil
	}
	if _, msg := date(v); msg != "" {
		return "", badRequest("to must be a date YYYY-MM-DD.")
	}
	return v, nil
}

func (s *Service) preview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	to, err := s.upTo(r, sess, r.URL.Query().Get("to"))
	if err != nil {
		return err
	}
	list, base, err := s.candidates(r, s.db.Q, sess, to)
	if err != nil {
		return err
	}
	out := make([]candidate, len(list))
	for i, c := range list {
		out[i] = candidate{BookingCandidate: c}
		if c.PaidBefore != 0 {
			out[i].PaidBefore = c.PaidBefore.String()
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"up_to": to, "base_currency": base, "items": out,
		"accounts": ledgercalc.DefaultPayrollAccounts()}))
	return nil
}

func (s *Service) bookings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.PayrollBookings(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

// book records a booking of every unblocked candidate up to the day, under a per-workspace lock; an entry booked by a
// concurrent booking fails this one (ErrAlreadyBooked), so nothing is booked twice.
func (s *Service) book(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, []string{"to", "accounts"}); err != nil {
		return err
	}
	var to string
	if raw, ok := body["to"]; ok && json.Unmarshal(raw, &to) != nil {
		return badRequest("to must be a date YYYY-MM-DD.")
	}
	to, err := s.upTo(r, sess, to)
	if err != nil {
		return err
	}
	accounts := ledgercalc.DefaultPayrollAccounts()
	if raw, ok := body["accounts"]; ok {
		if err := json.Unmarshal(raw, &accounts); err != nil {
			return badRequest("accounts must name the salary, employer_costs, net_payable, deductions_payable and bank accounts.")
		}
		for _, code := range []string{accounts.Salary, accounts.EmployerCosts, accounts.NetPayable, accounts.DeductionsPayable, accounts.Bank} {
			if code == "" || len(code) > 20 {
				return validationFailed(map[string]string{"accounts": "Enter every account (at most 20 characters)."})
			}
		}
	}
	b := store.PayrollBooking{ID: auth.NewID("pb"), UpTo: to, Accounts: accounts, CreatedAt: s.now()}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAddress(r.Context(), "payroll-booking:"+sess.Workspace.ID); err != nil {
			return err
		}
		list, base, err := s.candidates(r, q, sess, to)
		if err != nil {
			return err
		}
		b.BaseCurrency = base
		var items [][2]string
		for _, c := range list {
			if c.Blocked == "" {
				items = append(items, [2]string{c.Entry.ID, c.Kind})
			}
		}
		if len(items) == 0 {
			return errNothingToBook
		}
		b.Items = len(items)
		if err := q.CreatePayrollBooking(r.Context(), sess.Workspace.ID, sess.User.ID, b, items); err != nil {
			if errors.Is(err, store.ErrAlreadyBooked) {
				return conflict("conflict", "Another booking took some of these entries first. Look at the bookings again.")
			}
			return err
		}
		return s.audit(r, q, sess, "payroll.booked", "payroll_booking", b.ID)
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(b))
	return nil
}

// bookingRows rebuilds a booking's journal from its items: approved figures never change, so the rows are the same
// every time it is written.
func (s *Service) bookingRows(r *http.Request, sess store.Session, b store.PayrollBooking, items [][2]string) ([]ledgercalc.Row, error) {
	var list []ledgercalc.PayrollItem
	entries := map[string]store.PayrollEntry{}
	load := func(id string) (store.PayrollEntry, error) {
		if p, ok := entries[id]; ok {
			return p, nil
		}
		p, err := s.db.PayrollEntry(r.Context(), sess.Workspace.ID, id)
		entries[id] = p
		return p, err
	}
	for _, it := range items {
		p, err := load(it[0])
		if err != nil {
			return nil, err
		}
		item := ledgercalc.PayrollItem{EntryID: p.ID, Kind: it[1], Ref: p.PeriodEnd[:7], Party: p.EmployeeName,
			Date: p.PeriodEnd, Currency: p.Currency}
		if p.Complete {
			item.Gross, item.Deductions, item.Net, item.EmployerCosts = *p.Gross, *p.Deductions, *p.Net, *p.EmployerCosts
		}
		switch it[1] {
		case "reversal":
			by, err := load(*p.SupersededBy)
			if err != nil {
				return nil, err
			}
			item.Date = by.PeriodEnd
		case "payment":
			item.Date, item.Amount = *p.PaidOn, *p.Net
			if p.SupersedesID != nil {
				prev, err := load(*p.SupersedesID)
				if err != nil {
					return nil, err
				}
				if prev.PaymentStatus == "paid" && prev.Net != nil {
					item.Amount -= *prev.Net
				}
			}
		}
		list = append(list, item)
	}
	slices.SortStableFunc(list, func(a, b ledgercalc.PayrollItem) int {
		if a.Date != b.Date {
			return map[bool]int{true: -1, false: 1}[a.Date < b.Date]
		}
		return 0
	})
	return ledgercalc.PostPayroll(b.Accounts, list), nil
}

func (s *Service) bookingExport(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "csv"
	}
	if !slices.Contains([]string{"csv", "banana", "bexio", "abacus"}, format) {
		return badRequest("format must be csv, banana, bexio or abacus.")
	}
	b, items, err := s.db.PayrollBookingItems(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	rows, err := s.bookingRows(r, sess, b, items)
	if err != nil {
		return err
	}
	if err := s.db.Tx(r.Context(), func(q store.Q) error {
		return s.audit(r, q, sess, "payroll.exported", "payroll_booking", b.ID)
	}); err != nil {
		return err
	}
	ext := map[string]string{"banana": "txt", "csv": "csv", "bexio": "csv", "abacus": "csv"}[format]
	h := w.Header()
	h.Set("Content-Type", "text/csv; charset=utf-8")
	h.Set("Content-Disposition", `attachment; filename="payroll-booking-`+b.CreatedAt.Format(time.DateOnly)+`.`+ext+`"`)
	h.Set("Cache-Control", "private, no-store")
	_, err = ledger.WriteExport(w, format, rows, b.BaseCurrency)
	return err
}
