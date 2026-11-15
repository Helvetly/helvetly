package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/ledgercalc"
)

// The payroll register (docs/planning/2026-11-15-employees.md): pay computed by a person or an external system and
// recorded here, approved apart from being paid, corrected by new entries, booked once. Amounts are nil when missing,
// never 0 in their place.

// ErrPayrollPeriodTaken: the employee already has an entry for exactly this period (correct it instead).
var ErrPayrollPeriodTaken = errors.New("payroll period taken")

// ErrCorrectionOpen: the entry already has a correction (a draft or approved).
var ErrCorrectionOpen = errors.New("correction exists")

type PayrollComponent struct {
	Kind   string            `json:"kind"` // earning, deduction, employer_cost
	Label  string            `json:"label"`
	Amount invoicecalc.Money `json:"amount"`
}

type PayrollEntry struct {
	ID              string             `json:"id"`
	EmployeeID      string             `json:"employee_id"`
	EmployeeName    string             `json:"employee_name"`
	EmployeeNumber  *string            `json:"employee_number"`
	EmployingEntity string             `json:"employing_entity"`
	PeriodStart     string             `json:"period_start"`
	PeriodEnd       string             `json:"period_end"`
	PayDate         *string            `json:"pay_date"`
	Currency        string             `json:"currency"`
	Gross           *invoicecalc.Money `json:"gross"`
	Deductions      *invoicecalc.Money `json:"deductions"`
	Net             *invoicecalc.Money `json:"net"`
	EmployerCosts   *invoicecalc.Money `json:"employer_costs"`
	TotalCost       *invoicecalc.Money `json:"total_cost"` // gross + employer costs, when both are known
	Complete        bool               `json:"complete"`   // every total is known
	Components      []PayrollComponent `json:"components"`
	Source          string             `json:"source"`
	SourceRef       *string            `json:"source_ref"`
	DocumentID      *string            `json:"document_id"` // the employee\'s HR file behind the figures
	DocumentName    *string            `json:"document_name"`
	Status          string             `json:"status"`
	PaymentStatus   string             `json:"payment_status"`
	PaidOn          *string            `json:"paid_on"`
	ApprovedBy      *string            `json:"approved_by"`
	ApprovedAt      *time.Time         `json:"approved_at"`
	SupersedesID    *string            `json:"supersedes_id"`
	SupersededBy    *string            `json:"superseded_by"`
	Booked          []string           `json:"booked"` // accrual, payment, reversal
	Version         int                `json:"version"`
	Note            *string            `json:"note"`
	CreatedBy       *string            `json:"created_by"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

// Derive sets the figures computed from the stored ones: never a missing value filled in.
func (e *PayrollEntry) Derive() {
	e.Complete = e.Gross != nil && e.Deductions != nil && e.Net != nil && e.EmployerCosts != nil
	e.TotalCost = nil
	if e.Gross != nil && e.EmployerCosts != nil {
		t := *e.Gross + *e.EmployerCosts
		e.TotalCost = &t
	}
}

const payrollColumns = `p.id, p.employee_id, e.first_name || ' ' || e.last_name, e.employee_number, p.employing_entity,
	p.period_start::text, p.period_end::text, p.pay_date::text, p.currency, p.gross, p.deductions, p.net, p.employer_costs,
	p.source, p.source_ref, p.document_id, (SELECT name FROM documents d WHERE d.id = p.document_id), p.status, p.payment_status, p.paid_on::text, nullif(a.name, ''), p.approved_at, p.supersedes_id,
	p.superseded_by, p.version, p.note, nullif(c.name, ''), p.created_at, p.updated_at,
	coalesce((SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'label', k.label, 'amount', k.amount) ORDER BY k.position)
		FROM payroll_components k WHERE k.entry_id = p.id), '[]'),
	coalesce((SELECT array_agg(b.kind ORDER BY b.kind) FROM payroll_booking_items b WHERE b.entry_id = p.id), '{}')`

const payrollFrom = ` FROM payroll_entries p JOIN employees e ON e.id = p.employee_id
	LEFT JOIN users a ON a.id = p.approved_by LEFT JOIN users c ON c.id = p.created_by `

func scanPayroll(row interface{ Scan(...any) error }) (PayrollEntry, error) {
	var p PayrollEntry
	var components []byte
	err := row.Scan(&p.ID, &p.EmployeeID, &p.EmployeeName, &p.EmployeeNumber, &p.EmployingEntity, &p.PeriodStart,
		&p.PeriodEnd, &p.PayDate, &p.Currency, &p.Gross, &p.Deductions, &p.Net, &p.EmployerCosts, &p.Source, &p.SourceRef,
		&p.DocumentID, &p.DocumentName, &p.Status, &p.PaymentStatus, &p.PaidOn, &p.ApprovedBy, &p.ApprovedAt, &p.SupersedesID, &p.SupersededBy, &p.Version,
		&p.Note, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &components, &p.Booked)
	if err != nil {
		return p, err
	}
	var raw []struct {
		Kind   string `json:"kind"`
		Label  string `json:"label"`
		Amount int64  `json:"amount"`
	}
	if err := json.Unmarshal(components, &raw); err != nil {
		return p, err
	}
	p.Components = make([]PayrollComponent, len(raw))
	for i, c := range raw {
		p.Components[i] = PayrollComponent{c.Kind, c.Label, invoicecalc.Money(c.Amount)}
	}
	p.Derive()
	return p, nil
}

// PayrollFilter: the entries whose period ends in Month (YYYY-MM), of one employee, in one status; superseded entries
// only when asked for.
type PayrollFilter struct {
	Month, EmployeeID, Status string
	Superseded                bool
}

func (q Q) ListPayrollEntries(ctx context.Context, workspaceID string, f PayrollFilter) ([]PayrollEntry, error) {
	where, args := []string{"p.workspace_id = $1"}, []any{workspaceID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	if f.Month != "" {
		where = append(where, "to_char(p.period_end, 'YYYY-MM') = "+arg(f.Month))
	}
	if f.EmployeeID != "" {
		where = append(where, "p.employee_id = "+arg(f.EmployeeID))
	}
	if f.Status != "" {
		where = append(where, "p.status = "+arg(f.Status))
	}
	if !f.Superseded {
		where = append(where, "p.superseded_by IS NULL")
	}
	rows, err := q.db.Query(ctx, `SELECT `+payrollColumns+payrollFrom+` WHERE `+strings.Join(where, " AND ")+`
		ORDER BY p.period_end DESC, lower(e.last_name), lower(e.first_name), p.created_at LIMIT 2000`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PayrollEntry{}
	for rows.Next() {
		p, err := scanPayroll(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (q Q) PayrollEntry(ctx context.Context, workspaceID, id string) (PayrollEntry, error) {
	return scanPayroll(q.db.QueryRow(ctx, `SELECT `+payrollColumns+payrollFrom+` WHERE p.workspace_id = $1 AND p.id = $2`, workspaceID, id))
}

// PayrollEntryForUpdate locks the entry for the rest of the transaction.
func (q Q) PayrollEntryForUpdate(ctx context.Context, workspaceID, id string) (PayrollEntry, error) {
	return scanPayroll(q.db.QueryRow(ctx, `SELECT `+payrollColumns+payrollFrom+` WHERE p.workspace_id = $1 AND p.id = $2
		FOR UPDATE OF p`, workspaceID, id))
}

func money(m *invoicecalc.Money) *int64 {
	if m == nil {
		return nil
	}
	v := int64(*m)
	return &v
}

func (q Q) replaceComponents(ctx context.Context, id string, list []PayrollComponent) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM payroll_components WHERE entry_id = $1`, id); err != nil {
		return err
	}
	for i, c := range list {
		if _, err := q.db.Exec(ctx, `INSERT INTO payroll_components (entry_id, position, kind, label, amount)
			VALUES ($1, $2, $3, $4, $5)`, id, i, c.Kind, c.Label, int64(c.Amount)); err != nil {
			return err
		}
	}
	return nil
}

func payrollErr(err error) error {
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		switch pg.ConstraintName {
		case "payroll_entries_period":
			return ErrPayrollPeriodTaken
		case "payroll_entries_supersedes_id_key":
			return ErrCorrectionOpen
		}
	}
	return err
}

// CreatePayrollEntry stores a draft entry and its components.
func (q Q) CreatePayrollEntry(ctx context.Context, workspaceID, userID string, p PayrollEntry) error {
	return q.inTx(ctx, func(t pgx.Tx) error {
		tx := Q{db: t, admission: q.admission}
		_, err := tx.db.Exec(ctx, `INSERT INTO payroll_entries (id, workspace_id, employee_id, employing_entity, period_start,
			period_end, pay_date, currency, gross, deductions, net, employer_costs, source, source_ref, supersedes_id, note,
			created_by, created_at, updated_at, document_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, nullif($17, ''), $18, $18, $19)`,
			p.ID, workspaceID, p.EmployeeID, p.EmployingEntity, p.PeriodStart, p.PeriodEnd, p.PayDate, p.Currency,
			money(p.Gross), money(p.Deductions), money(p.Net), money(p.EmployerCosts), p.Source, p.SourceRef, p.SupersedesID,
			p.Note, userID, p.CreatedAt, p.DocumentID)
		if err != nil {
			return payrollErr(err)
		}
		return tx.replaceComponents(ctx, p.ID, p.Components)
	})
}

// SavePayrollDraft writes a draft at the expected version; false when it is no longer that draft (changed meanwhile,
// approved or gone).
func (q Q) SavePayrollDraft(ctx context.Context, workspaceID string, p PayrollEntry, version int, now time.Time) (bool, error) {
	ok := false
	err := q.inTx(ctx, func(t pgx.Tx) error {
		tx := Q{db: t, admission: q.admission}
		tag, err := tx.db.Exec(ctx, `UPDATE payroll_entries SET employee_id = $4, employing_entity = $5, period_start = $6,
			period_end = $7, pay_date = $8, currency = $9, gross = $10, deductions = $11, net = $12, employer_costs = $13,
			source_ref = $14, note = $15, version = version + 1, updated_at = $16, document_id = $17
			WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status = 'draft'`,
			workspaceID, p.ID, version, p.EmployeeID, p.EmployingEntity, p.PeriodStart, p.PeriodEnd, p.PayDate, p.Currency,
			money(p.Gross), money(p.Deductions), money(p.Net), money(p.EmployerCosts), p.SourceRef, p.Note, now, p.DocumentID)
		if err != nil || tag.RowsAffected() == 0 {
			return payrollErr(err)
		}
		ok = true
		return tx.replaceComponents(ctx, p.ID, p.Components)
	})
	return ok, err
}

// DeletePayrollDraft removes a draft; false when there is no such draft.
func (q Q) DeletePayrollDraft(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM payroll_entries WHERE workspace_id = $1 AND id = $2 AND status = 'draft'`, workspaceID, id)
	return tag.RowsAffected() == 1, err
}

// ApprovePayrollEntry approves the draft at the expected version; false when another request changed or approved it
// first, so of two concurrent approvals exactly one wins.
func (q Q) ApprovePayrollEntry(ctx context.Context, workspaceID, id string, version int, userID string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE payroll_entries SET status = 'approved', approved_by = $4, approved_at = $5,
		version = version + 1, updated_at = $5 WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status = 'draft'`,
		workspaceID, id, version, userID, now)
	return tag.RowsAffected() == 1, err
}

// SupersedePayrollEntry marks an approved entry as replaced by its approved correction.
func (q Q) SupersedePayrollEntry(ctx context.Context, workspaceID, id, by string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE payroll_entries SET superseded_by = $3, version = version + 1, updated_at = $4
		WHERE workspace_id = $1 AND id = $2 AND status = 'approved' AND superseded_by IS NULL`, workspaceID, id, by, now)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

// SetPayrollPayment records whether an approved entry's net pay was paid; false on a stale version.
func (q Q) SetPayrollPayment(ctx context.Context, workspaceID, id string, version int, paidOn *string, now time.Time) (bool, error) {
	status := "unpaid"
	if paidOn != nil {
		status = "paid"
	}
	tag, err := q.db.Exec(ctx, `UPDATE payroll_entries SET payment_status = $4, paid_on = $5, version = version + 1, updated_at = $6
		WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status = 'approved'`, workspaceID, id, version, status, paidOn, now)
	return tag.RowsAffected() == 1, err
}

// PayrollTotals is a month's current entries in one currency: sums of the values that are known, and how many entries
// miss each, so an incomplete total is never shown as a complete one.
type PayrollTotals struct {
	Currency          string            `json:"currency"`
	Entries           int               `json:"entries"`
	Drafts            int               `json:"drafts"`
	Approved          int               `json:"approved"`
	Paid              int               `json:"paid"`
	Gross             invoicecalc.Money `json:"gross"`
	Deductions        invoicecalc.Money `json:"deductions"`
	Net               invoicecalc.Money `json:"net"`
	EmployerCosts     invoicecalc.Money `json:"employer_costs"`
	TotalCost         invoicecalc.Money `json:"total_cost"`
	MissingGross      int               `json:"missing_gross"`
	MissingDeductions int               `json:"missing_deductions"`
	MissingNet        int               `json:"missing_net"`
	MissingEmployer   int               `json:"missing_employer_costs"`
	NetPaid           invoicecalc.Money `json:"net_paid"`
}

// PayrollSummary totals the month's (period end) current entries per currency; amounts are never converted.
func (q Q) PayrollSummary(ctx context.Context, workspaceID, month string) ([]PayrollTotals, error) {
	rows, err := q.db.Query(ctx, `SELECT currency, count(*), count(*) FILTER (WHERE status = 'draft'),
		count(*) FILTER (WHERE status = 'approved'), count(*) FILTER (WHERE payment_status = 'paid'),
		coalesce(sum(gross), 0), coalesce(sum(deductions), 0), coalesce(sum(net), 0), coalesce(sum(employer_costs), 0),
		coalesce(sum(gross + employer_costs), 0),
		count(*) FILTER (WHERE gross IS NULL), count(*) FILTER (WHERE deductions IS NULL), count(*) FILTER (WHERE net IS NULL),
		count(*) FILTER (WHERE employer_costs IS NULL), coalesce(sum(net) FILTER (WHERE payment_status = 'paid'), 0)
		FROM payroll_entries WHERE workspace_id = $1 AND superseded_by IS NULL AND to_char(period_end, 'YYYY-MM') = $2
		GROUP BY currency ORDER BY currency`, workspaceID, month)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PayrollTotals{}
	for rows.Next() {
		var t PayrollTotals
		if err := rows.Scan(&t.Currency, &t.Entries, &t.Drafts, &t.Approved, &t.Paid, &t.Gross, &t.Deductions, &t.Net,
			&t.EmployerCosts, &t.TotalCost, &t.MissingGross, &t.MissingDeductions, &t.MissingNet, &t.MissingEmployer,
			&t.NetPaid); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ---- bookings ----

type PayrollBooking struct {
	ID           string                     `json:"id"`
	UpTo         string                     `json:"up_to"`
	BaseCurrency string                     `json:"base_currency"`
	Accounts     ledgercalc.PayrollAccounts `json:"accounts"`
	Items        int                        `json:"items"`
	CreatedBy    *string                    `json:"created_by"`
	CreatedAt    time.Time                  `json:"created_at"`
}

// BookingCandidate is an entry the next booking would post, of one kind, with what blocks it ("" when nothing).
type BookingCandidate struct {
	Entry   PayrollEntry `json:"entry"`
	Kind    string       `json:"kind"` // accrual, reversal, payment
	Date    string       `json:"date"`
	Blocked string       `json:"blocked"`
	// PaidBefore is the net already paid on the entry this one corrects, so a payment books only the difference.
	PaidBefore invoicecalc.Money `json:"-"`
}

// BookingCandidates: what is not booked yet up to the day: accruals of current approved entries (by period end),
// reversals of booked accruals whose entry was corrected, payments of paid entries (by payment date).
func (q Q) BookingCandidates(ctx context.Context, workspaceID, upTo string) ([]BookingCandidate, error) {
	list, err := q.ListPayrollEntries(ctx, workspaceID, PayrollFilter{Status: "approved", Superseded: true})
	if err != nil {
		return nil, err
	}
	byID := map[string]PayrollEntry{}
	for _, p := range list {
		byID[p.ID] = p
	}
	booked := func(p PayrollEntry, kind string) bool {
		for _, k := range p.Booked {
			if k == kind {
				return true
			}
		}
		return false
	}
	out := []BookingCandidate{}
	for i := len(list) - 1; i >= 0; i-- { // oldest period first
		p := list[i]
		if p.SupersededBy == nil && p.PeriodEnd <= upTo && !booked(p, "accrual") {
			out = append(out, BookingCandidate{Entry: p, Kind: "accrual", Date: p.PeriodEnd})
		}
		if p.SupersededBy != nil && booked(p, "accrual") && !booked(p, "reversal") {
			out = append(out, BookingCandidate{Entry: p, Kind: "reversal", Date: byID[*p.SupersededBy].PeriodEnd})
		}
		// A payment happened even when its entry was corrected later, so it is booked either way.
		if p.PaidOn != nil && *p.PaidOn <= upTo && !booked(p, "payment") {
			c := BookingCandidate{Entry: p, Kind: "payment", Date: *p.PaidOn}
			if p.SupersedesID != nil {
				if prev, ok := byID[*p.SupersedesID]; ok && prev.PaymentStatus == "paid" && prev.Net != nil {
					c.PaidBefore = *prev.Net
				}
			}
			out = append(out, c)
		}
	}
	return out, nil
}

// CreatePayrollBooking records a booking and its items; an item already booked (a concurrent booking) fails the whole
// booking with ErrAlreadyBooked, so no entry is ever booked twice.
func (q Q) CreatePayrollBooking(ctx context.Context, workspaceID, userID string, b PayrollBooking, items [][2]string) error {
	accounts, err := json.Marshal(b.Accounts)
	if err != nil {
		return err
	}
	return q.inTx(ctx, func(t pgx.Tx) error {
		tx := Q{db: t, admission: q.admission}
		if _, err := tx.db.Exec(ctx, `INSERT INTO payroll_bookings (id, workspace_id, up_to, base_currency, accounts, created_by,
			created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, b.ID, workspaceID, b.UpTo, b.BaseCurrency, accounts, userID, b.CreatedAt); err != nil {
			return err
		}
		for _, it := range items {
			_, err := tx.db.Exec(ctx, `INSERT INTO payroll_booking_items (booking_id, entry_id, kind) VALUES ($1, $2, $3)`, b.ID, it[0], it[1])
			if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
				return ErrAlreadyBooked
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// ErrAlreadyBooked: an entry of the booking was booked by another booking first.
var ErrAlreadyBooked = errors.New("payroll already booked")

func (q Q) PayrollBookings(ctx context.Context, workspaceID string) ([]PayrollBooking, error) {
	rows, err := q.db.Query(ctx, `SELECT b.id, b.up_to::text, b.base_currency, b.accounts, (SELECT count(*) FROM payroll_booking_items i
		WHERE i.booking_id = b.id), nullif(u.name, ''), b.created_at FROM payroll_bookings b LEFT JOIN users u ON u.id = b.created_by
		WHERE b.workspace_id = $1 ORDER BY b.created_at DESC LIMIT 200`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PayrollBooking{}
	for rows.Next() {
		var b PayrollBooking
		var accounts []byte
		if err := rows.Scan(&b.ID, &b.UpTo, &b.BaseCurrency, &accounts, &b.Items, &b.CreatedBy, &b.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(accounts, &b.Accounts); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// PayrollBookingItems: a booking and its (entry, kind) items, to write its journal again.
func (q Q) PayrollBookingItems(ctx context.Context, workspaceID, id string) (PayrollBooking, [][2]string, error) {
	var b PayrollBooking
	var accounts []byte
	err := q.db.QueryRow(ctx, `SELECT id, up_to::text, base_currency, accounts, created_at FROM payroll_bookings
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id).Scan(&b.ID, &b.UpTo, &b.BaseCurrency, &accounts, &b.CreatedAt)
	if err != nil {
		return b, nil, err
	}
	if err := json.Unmarshal(accounts, &b.Accounts); err != nil {
		return b, nil, err
	}
	rows, err := q.db.Query(ctx, `SELECT entry_id, kind FROM payroll_booking_items WHERE booking_id = $1 ORDER BY entry_id, kind`, id)
	if err != nil {
		return b, nil, err
	}
	defer rows.Close()
	var items [][2]string
	for rows.Next() {
		var it [2]string
		if err := rows.Scan(&it[0], &it[1]); err != nil {
			return b, nil, err
		}
		items = append(items, it)
	}
	b.Items = len(items)
	return b, items, rows.Err()
}

// EmployeeIDByNumberOrEmail finds an employee of the workspace by number (preferred) or email, for the import.
func (q Q) EmployeeIDByNumberOrEmail(ctx context.Context, workspaceID, number, email string) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT id FROM employees WHERE workspace_id = $1 AND
		(($2 <> '' AND lower(employee_number) = lower($2)) OR ($2 = '' AND $3 <> '' AND lower(email) = lower($3)))
		ORDER BY archived_at NULLS FIRST LIMIT 1`, workspaceID, number, email).Scan(&id)
	return id, err
}

// PayrollOriginal is the original entry of an employee for exactly this period.
func (q Q) PayrollOriginal(ctx context.Context, workspaceID, employeeID, start, end string) (PayrollEntry, error) {
	return scanPayroll(q.db.QueryRow(ctx, `SELECT `+payrollColumns+payrollFrom+` WHERE p.workspace_id = $1 AND p.employee_id = $2
		AND p.period_start = $3 AND p.period_end = $4 AND p.supersedes_id IS NULL`, workspaceID, employeeID, start, end))
}
