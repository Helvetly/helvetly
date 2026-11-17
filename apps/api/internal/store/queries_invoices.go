package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"helvetly.com/api/internal/eaddress"
	"helvetly.com/api/internal/invoicecalc"
)

// Invoices, credit notes, payments and deliveries (docs/invoices-contract.md). The structs are the API's JSON.

type (
	Money    = invoicecalc.Money
	Quantity = invoicecalc.Quantity
	Percent  = invoicecalc.Percent
)

// Party is a seller or buyer as printed on a document (snapshotted on issue).
type Party struct {
	Name               string            `json:"name"`
	Street             string            `json:"street"`
	StreetNumber       string            `json:"street_number"`
	Apt                *string           `json:"apt"`
	Zip                string            `json:"zip"`
	City               string            `json:"city"`
	Country            string            `json:"country"`
	VATNumber          *string           `json:"vat_number"`
	Email              *string           `json:"email"`
	Phone              *string           `json:"phone,omitempty"`
	ElectronicAddress  *eaddress.Address `json:"electronic_address,omitempty"`
	RegistrationNumber *string           `json:"registration_number,omitempty"`
	Region             *string           `json:"region,omitempty"` // ISO 3166-2 subdivision (BT-39, BT-54)
}

// StreetLine is the street line as printed: "street number", with the apartment on the same line: "number/apt" in Poland,
// ", apt" elsewhere. Stored fields stay separate; structured exports (XML, QR) do not use it.
func (p Party) StreetLine() string {
	street := strings.TrimSpace(p.Street + " " + p.StreetNumber)
	apt := ""
	if p.Apt != nil {
		apt = strings.TrimSpace(*p.Apt)
	}
	switch {
	case apt == "":
		return street
	case street == "":
		return apt
	case p.Country == "PL" && strings.TrimSpace(p.StreetNumber) != "":
		return street + "/" + apt
	}
	return street + ", " + apt
}

type InvoiceClient struct {
	ID     string `json:"id"`
	Number int64  `json:"number"`
	Name   string `json:"name"`
}

type InvoiceRef struct {
	ID     string `json:"id"`
	Number string `json:"number"`
}

type InvoicePaymentInfo struct {
	IBAN          *string `json:"iban"`
	ReferenceType string  `json:"reference_type"`
	Reference     *string `json:"reference"`
	QRBill        bool    `json:"qr_bill"`     // a Swiss QR bill page is attached
	RevolutURL    *string `json:"revolut_url"` // "Pay with Revolut" is printed with this link
}

// PaymentMethods: what the seller chose to offer on the document; bank details are always printed.
type PaymentMethods struct {
	QRBill  bool `json:"qr_bill"`
	Revolut bool `json:"revolut"`
}

type Invoice struct {
	ID               string              `json:"id"`
	Kind             string              `json:"kind"`
	Number           *string             `json:"number"`
	Status           string              `json:"status"`
	IsOverdue        bool                `json:"is_overdue"`
	ClientID         string              `json:"client_id"`
	Client           InvoiceClient       `json:"client"`
	Quote            *InvoiceRef         `json:"quote"` // the accepted quote this draft was made from (docs/quotes-contract.md)
	CreditedInvoice  *InvoiceRef         `json:"credited_invoice"`
	IssueDate        string              `json:"issue_date"`
	DueDate          string              `json:"due_date"`
	ServiceDate      *string             `json:"service_date"`
	ServiceDateEnd   *string             `json:"service_date_end"`
	Currency         string              `json:"currency"`
	Language         string              `json:"language"`
	VATMode          string              `json:"vat_mode"`
	Reference        *string             `json:"reference"`
	TaxCurrencyRate  *string             `json:"tax_currency_rate"` // RON per unit of Currency for BT-111 (RO e-Factura), entered by the user
	Intro            *string             `json:"intro"`
	Footer           *string             `json:"footer"`
	Note             *string             `json:"note"`
	Lines            []InvoiceLine       `json:"lines"`
	DiscountPercent  Percent             `json:"discount_percent"`
	Subtotal         Money               `json:"subtotal"`
	DiscountAmount   Money               `json:"discount_amount"`
	NetTotal         Money               `json:"net_total"`
	VATBreakdown     []invoicecalc.Group `json:"vat_breakdown"`
	VATTotal         Money               `json:"vat_total"`
	Total            Money               `json:"total"`
	RoundingAmount   Money               `json:"rounding_amount"`
	PayableTotal     Money               `json:"payable_total"` // total + rounding_amount: what the buyer owes in all
	PrepaidTotal     Money               `json:"prepaid_total"` // final invoice: the gross prepaid amount, already out of the totals
	Prepayments      []PrepaymentRef     `json:"prepayments"`
	DeductedOn       *InvoiceRef         `json:"deducted_on"` // prepayment: the final invoice it was deducted on
	AmountPaid       Money               `json:"amount_paid"`
	AmountCredited   Money               `json:"amount_credited"`
	AmountDue        Money               `json:"amount_due"`
	AmountRefunded   Money               `json:"amount_refunded"` // Σ refunds
	RefundDue        Money               `json:"refund_due"`      // credit balance still to pay back to the buyer, ≥ 0
	PaymentMethods   PaymentMethods      `json:"payment_methods"`
	Payment          InvoicePaymentInfo  `json:"payment"`
	Seller           *Party              `json:"seller"`
	Buyer            *Party              `json:"buyer"`
	Payments         []Payment           `json:"payments"`
	Refunds          []Refund            `json:"refunds"`
	Instalments      *InstalmentSchedule `json:"instalments"`
	Plan             *PlanRef            `json:"plan"`
	RemindersEnabled bool                `json:"reminders_enabled"`
	IssuedAt         *time.Time          `json:"issued_at"`
	SentAt           *time.Time          `json:"sent_at"`
	CreatedAt        time.Time           `json:"created_at"`
	UpdatedAt        time.Time           `json:"updated_at"`
	PDFKey           *string             `json:"-"`
	// Origin is "imported" for an invoice issued in another system: its own number, no counter, and the legal
	// original is the Document SourceDocumentID (served as its PDF; never sent, exported or delivered by Helvetly).
	Origin           string  `json:"origin"`
	SourceDocumentID *string `json:"source_document_id"`
}

// IssuedElsewhere: an invoice an import brought in as issued by another system.
func (i Invoice) IssuedElsewhere() bool { return i.Origin == "imported" }

// PrepaymentRef is a prepayment invoice deducted on a final invoice.
type PrepaymentRef struct {
	ID           string              `json:"id"`
	Number       *string             `json:"number"`
	PayableTotal Money               `json:"payable_total"`
	Status       string              `json:"status"`
	VATBreakdown []invoicecalc.Group `json:"vat_breakdown"`
}

// Payable is what the buyer owes in all: the total after cash rounding.
func (i Invoice) Payable() Money { return i.Total + i.RoundingAmount }

type InvoiceLine struct {
	ID                 string   `json:"id"`
	Position           int      `json:"position"`
	Description        string   `json:"description"`
	Quantity           Quantity `json:"quantity"`
	Unit               *string  `json:"unit"`
	UnitPrice          Money    `json:"unit_price"`
	DiscountPercent    Percent  `json:"discount_percent"`
	VATCategory        string   `json:"vat_category"`
	VATRate            Percent  `json:"vat_rate"`
	Amount             Money    `json:"amount"`
	VATExemptionCode   *string  `json:"vat_exemption_code"` // VATEX code for exempt categories
	VATExemptionReason *string  `json:"vat_exemption_reason"`
}

type Payment struct {
	ID        string    `json:"id"`
	Amount    Money     `json:"amount"`
	PaidOn    string    `json:"paid_on"`
	Method    string    `json:"method"`
	Note      *string   `json:"note"`
	CreatedAt time.Time `json:"created_at"`
	CreatedBy *Uploader `json:"created_by"` // null once the person's account is gone
}

// Refund pays back part of an invoice's credit balance.
type Refund struct {
	ID         string    `json:"id"`
	Amount     Money     `json:"amount"`
	RefundedOn string    `json:"refunded_on"`
	Method     string    `json:"method"`
	Note       *string   `json:"note"`
	CreatedAt  time.Time `json:"created_at"`
	CreatedBy  *Uploader `json:"created_by"`
}

type Delivery struct {
	ID     string    `json:"id"`
	To     []string  `json:"to"`
	Cc     []string  `json:"cc"`
	SentAt time.Time `json:"sent_at"`
	SentBy *Uploader `json:"sent_by"`
}

type InvoiceListItem struct {
	ID             string         `json:"id"`
	Kind           string         `json:"kind"`
	Number         *string        `json:"number"`
	Status         string         `json:"status"`
	IsOverdue      bool           `json:"is_overdue"`
	Client         InvoiceClient  `json:"client"`
	IssueDate      string         `json:"issue_date"`
	DueDate        string         `json:"due_date"`
	Currency       string         `json:"currency"`
	NetTotal       Money          `json:"-"`
	VATTotal       Money          `json:"-"`
	Total          Money          `json:"total"`
	RoundingAmount Money          `json:"rounding_amount"`
	PayableTotal   Money          `json:"payable_total"`
	PrepaidTotal   Money          `json:"prepaid_total"`
	AmountDue      Money          `json:"amount_due"`
	RefundDue      Money          `json:"refund_due"`
	PaymentMethods PaymentMethods `json:"payment_methods"`
	DeductedOn     *InvoiceRef    `json:"deducted_on"`
	Paid           Money          `json:"-"`
	Reference      *string        `json:"-"`
	SentAt         *time.Time     `json:"sent_at"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ---- settings ----

// InvoiceSettings reads the workspace's settings document into v; false when none was saved yet.
func (q Q) InvoiceSettings(ctx context.Context, workspaceID string, v any) (bool, error) {
	var raw []byte
	err := q.db.QueryRow(ctx, `SELECT settings FROM invoice_settings WHERE workspace_id = $1`, workspaceID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(raw, v)
}

// LockInvoiceSettings serialises read-modify-write of one workspace's settings until the transaction ends.
func (q Q) LockInvoiceSettings(ctx context.Context, workspaceID string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "invoice-settings:"+workspaceID)
	return err
}

func (q Q) PutInvoiceSettings(ctx context.Context, workspaceID string, v any, now time.Time) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("invoice settings: %w", err)
	}
	_, err = q.db.Exec(ctx, `INSERT INTO invoice_settings (workspace_id, settings, updated_at) VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id) DO UPDATE SET settings = $2, updated_at = $3`, workspaceID, raw, now)
	return err
}

// ---- invoices ----

// receivableKinds: payments come in, they can be overdue and they count in the summary (the rest of the kinds
// are credit_note, proforma and self_billed).
const receivableKinds = `('invoice', 'partial', 'prepayment', 'debit_note', 'corrected')`

// isOverdue: an open receivable or self-billed document past its due date; a proforma is never overdue. With a schedule,
// what fell due (capped by the instalments less credit notes, which reduce from the last instalment) exceeds what was paid.
const isOverdue = `(i.status = 'open' AND i.kind <> 'proforma' AND CASE WHEN i.instalment_interval IS NULL THEN i.due_date < $%[1]d::date
	ELSE (SELECT LEAST(COALESCE(sum(x.amount) FILTER (WHERE x.due_date < $%[1]d::date), 0), COALESCE(sum(x.amount), 0) - i.amount_credited)
		FROM invoice_instalments x WHERE x.invoice_id = i.id) > i.amount_paid END)`

// amountDue: nothing for void or replaced documents and issued credit notes (applied on issue), else what is left
// after payments and credit notes, ≥ 0. A final invoice's totals are already net of its prepayments.
const amountDue = `CASE WHEN i.status = 'draft' THEN i.total + i.rounding_amount
	WHEN i.status IN ('void', 'replaced') OR i.kind = 'credit_note' THEN 0
	ELSE GREATEST(0, i.total + i.rounding_amount - i.amount_paid - i.amount_credited) END`

// refundDue: what payments and credit notes put above the invoice's payable amount, less what was refunded.
const refundDue = `CASE WHEN i.kind IN ` + receivableKinds + ` AND i.status <> 'draft'
	THEN GREATEST(0, i.amount_paid + i.amount_credited - i.total - i.rounding_amount) - i.amount_refunded ELSE 0 END`

// Issued documents keep the buyer's name; only drafts follow later edits of the client record.
const invoiceClientName = `COALESCE(i.buyer->>'name', c.name)`

var invoiceColumns = `i.id, i.kind, i.number, i.status, ` + fmt.Sprintf(isOverdue, 3) + `, i.client_id, c.number, ` + invoiceClientName + `,
	ci.id, ci.number, i.issue_date::text, i.due_date::text, i.service_date::text, i.service_date_end::text, i.currency, i.language,
	i.vat_mode, i.reference, i.intro, i.footer, i.note, i.discount_percent, i.subtotal, i.discount_amount, i.net_total,
	i.vat_breakdown, i.vat_total, i.total, i.rounding_amount, i.amount_paid, i.amount_credited, ` + amountDue + `, i.amount_refunded,
	` + refundDue + `, i.iban,
	COALESCE(i.reference_type, 'NON'), i.payment_reference, i.qr_bill, i.revolut_url, i.pay_qr_bill, i.pay_revolut, i.seller, i.buyer, i.issued_at, i.sent_at, i.created_at,
	i.updated_at, i.pdf_key, i.prepaid_total, di.id, di.number, i.reminders_enabled, i.instalment_interval, pl.id, COALESCE(i.plan_seq, 0), pl.count,
	trim_scale(i.tax_currency_rate)::text, i.origin, i.source_document_id`

// invoicePlanJoin: the plan that issued the document, or the live plan the draft is the source of.
const invoicePlanJoin = ` LEFT JOIN instalment_plans pl ON pl.id = COALESCE(i.plan_id, (SELECT sp.id FROM instalment_plans sp
	WHERE sp.source_invoice_id = i.id AND sp.status <> 'cancelled' ORDER BY sp.created_at DESC LIMIT 1))`

func scanInvoice(row pgx.Row) (Invoice, error) {
	var i Invoice
	var creditedID, creditedNumber, deductedID, deductedNumber, interval, planID *string
	var planSeq int
	var planCount *int
	err := row.Scan(&i.ID, &i.Kind, &i.Number, &i.Status, &i.IsOverdue, &i.ClientID, &i.Client.Number, &i.Client.Name,
		&creditedID, &creditedNumber, &i.IssueDate, &i.DueDate, &i.ServiceDate, &i.ServiceDateEnd, &i.Currency, &i.Language,
		&i.VATMode, &i.Reference, &i.Intro, &i.Footer, &i.Note, &i.DiscountPercent, &i.Subtotal, &i.DiscountAmount, &i.NetTotal,
		&i.VATBreakdown, &i.VATTotal, &i.Total, &i.RoundingAmount, &i.AmountPaid, &i.AmountCredited, &i.AmountDue, &i.AmountRefunded, &i.RefundDue, &i.Payment.IBAN,
		&i.Payment.ReferenceType, &i.Payment.Reference, &i.Payment.QRBill, &i.Payment.RevolutURL, &i.PaymentMethods.QRBill,
		&i.PaymentMethods.Revolut, &i.Seller, &i.Buyer, &i.IssuedAt, &i.SentAt, &i.CreatedAt,
		&i.UpdatedAt, &i.PDFKey, &i.PrepaidTotal, &deductedID, &deductedNumber, &i.RemindersEnabled, &interval, &planID, &planSeq, &planCount,
		&i.TaxCurrencyRate, &i.Origin, &i.SourceDocumentID)
	i.Client.ID = i.ClientID
	i.PayableTotal = i.Payable()
	if creditedID != nil {
		i.CreditedInvoice = &InvoiceRef{ID: *creditedID, Number: str(creditedNumber)}
	}
	if deductedID != nil {
		i.DeductedOn = &InvoiceRef{ID: *deductedID, Number: str(deductedNumber)}
	}
	if interval != nil {
		i.Instalments = &InstalmentSchedule{Interval: *interval}
	}
	if planID != nil {
		i.Plan = &PlanRef{ID: *planID, Seq: planSeq, Count: *planCount}
	}
	return i, err
}

func str(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// Invoice: the document with its lines and payments; today (YYYY-MM-DD, workspace time zone) decides is_overdue.
// forUpdate locks the row until the transaction ends.
func (q Q) Invoice(ctx context.Context, workspaceID, id, today string, forUpdate bool) (Invoice, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF i"
	}
	inv, err := scanInvoice(q.db.QueryRow(ctx, `SELECT `+invoiceColumns+` FROM invoices i JOIN clients c ON c.id = i.client_id
		LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id
		LEFT JOIN invoices di ON di.id = i.deducted_on_invoice_id`+invoicePlanJoin+` WHERE i.workspace_id = $1 AND i.id = $2`+lock, workspaceID, id, today))
	if err != nil {
		return inv, err
	}
	if inv.Lines, err = q.invoiceLines(ctx, id); err != nil {
		return inv, err
	}
	if inv.Payments, err = q.Payments(ctx, id); err != nil {
		return inv, err
	}
	if inv.Refunds, err = q.Refunds(ctx, id); err != nil {
		return inv, err
	}
	if inv.Instalments != nil {
		if inv.Instalments.Items, err = q.instalments(ctx, id); err != nil {
			return inv, err
		}
	}
	if inv.Quote, err = q.QuoteOfInvoice(ctx, id); err != nil {
		return inv, err
	}
	inv.Prepayments, err = q.prepayments(ctx, id)
	return inv, err
}

// prepayments: the prepayment invoices deducted on the invoice, in the order they were picked.
func (q Q) prepayments(ctx context.Context, invoiceID string) ([]PrepaymentRef, error) {
	rows, err := q.db.Query(ctx, `SELECT p.id, p.number, p.total + p.rounding_amount, p.status, p.vat_breakdown
		FROM invoice_prepayments ip JOIN invoices p ON p.id = ip.prepayment_id WHERE ip.invoice_id = $1 ORDER BY ip.position`, invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PrepaymentRef, error) {
		var p PrepaymentRef
		err := r.Scan(&p.ID, &p.Number, &p.PayableTotal, &p.Status, &p.VATBreakdown)
		return p, err
	})
}

// SetPrepayments replaces the prepayments picked for a draft; positions follow the order of ids.
func (q Q) SetPrepayments(ctx context.Context, invoiceID string, ids []string) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM invoice_prepayments WHERE invoice_id = $1`, invoiceID); err != nil {
		return err
	}
	for pos, id := range ids {
		if _, err := q.db.Exec(ctx, `INSERT INTO invoice_prepayments (invoice_id, prepayment_id, position) VALUES ($1, $2, $3)`,
			invoiceID, id, pos); err != nil {
			return err
		}
	}
	return nil
}

// prepaymentLike: invoice i is a prepayment, or a correction (of a correction…) that replaced one.
const prepaymentLike = `(i.kind = 'prepayment' OR (i.kind = 'corrected' AND EXISTS (
	WITH RECURSIVE chain (id, kind, credited) AS (
		SELECT p.id, p.kind, p.credited_invoice_id FROM invoices p WHERE p.id = i.credited_invoice_id
		UNION ALL SELECT p.id, p.kind, p.credited_invoice_id FROM invoices p JOIN chain c ON p.id = c.credited WHERE c.kind = 'corrected')
	SELECT 1 FROM chain WHERE kind = 'prepayment')))`

// ErrNotDeductible: a prepayment is missing, not a prepayment, or already deducted.
var ErrNotDeductible = errors.New("prepayment cannot be deducted")

// ErrNotDraft: SaveDraft was given an id that is not a draft of the workspace (issued documents are immutable).
var ErrNotDraft = errors.New("store: not a draft of the workspace")

// MarkDeducted marks the prepayments as deducted on the final invoice, each only once; any that cannot be
// (so none is changed once the caller rolls back) gives ErrNotDeductible.
func (q Q) MarkDeducted(ctx context.Context, workspaceID string, prepaymentIDs []string, finalID string) error {
	tag, err := q.db.Exec(ctx, `UPDATE invoices i SET deducted_on_invoice_id = $3 WHERE i.workspace_id = $1 AND i.id = ANY($2)
		AND `+prepaymentLike+` AND i.deducted_on_invoice_id IS NULL`, workspaceID, prepaymentIDs, finalID)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != len(prepaymentIDs) {
		return ErrNotDeductible
	}
	return nil
}

// ReleasePrepayments frees the prepayments deducted on a final invoice (it was voided), so they can be deducted again.
func (q Q) ReleasePrepayments(ctx context.Context, workspaceID, finalID string) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices SET deducted_on_invoice_id = NULL WHERE workspace_id = $1 AND deducted_on_invoice_id = $2`,
		workspaceID, finalID)
	return err
}

// CloseVoid sets an open document to void; for kinds a credit note cannot void (proforma, self-billed).
func (q Q) CloseVoid(ctx context.Context, workspaceID, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices SET status = 'void', updated_at = $3 WHERE workspace_id = $1 AND id = $2 AND status = 'open'`,
		workspaceID, id, now)
	return err
}

// MovePayments re-points the payments of one document to another of the workspace (a correction takes over the
// original's) and recomputes both balances.
func (q Q) MovePayments(ctx context.Context, workspaceID, fromID, toID string) error {
	if _, err := q.db.Exec(ctx, `UPDATE invoice_payments SET invoice_id = $3 WHERE invoice_id = $2
		AND EXISTS (SELECT 1 FROM invoices WHERE id = $2 AND workspace_id = $1) AND EXISTS (SELECT 1 FROM invoices WHERE id = $3 AND workspace_id = $1)`,
		workspaceID, fromID, toID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := q.RefreshBalance(ctx, fromID, now); err != nil {
		return err
	}
	return q.RefreshBalance(ctx, toID, now)
}

// MarkReplaced: an issued original that a corrected invoice supersedes; pgx.ErrNoRows when it is not issued.
func (q Q) MarkReplaced(ctx context.Context, workspaceID, id string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE invoices SET status = 'replaced', updated_at = $3
		WHERE workspace_id = $1 AND id = $2 AND status IN ('open', 'paid')`, workspaceID, id, now)
	if err == nil && tag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	return err
}

func (q Q) invoiceLines(ctx context.Context, invoiceID string) ([]InvoiceLine, error) {
	rows, err := q.db.Query(ctx, `SELECT id, position, description, quantity, unit, unit_price, discount_percent, vat_category,
		vat_rate, amount, vat_exemption_code, vat_exemption_reason FROM invoice_lines WHERE invoice_id = $1 ORDER BY position`, invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (InvoiceLine, error) {
		var l InvoiceLine
		err := r.Scan(&l.ID, &l.Position, &l.Description, &l.Quantity, &l.Unit, &l.UnitPrice, &l.DiscountPercent, &l.VATCategory,
			&l.VATRate, &l.Amount, &l.VATExemptionCode, &l.VATExemptionReason)
		return l, err
	})
}

// SaveDraft inserts the draft or, when it exists, replaces its fields and lines (totals as computed by the caller).
func (q Q) saveDraft(ctx context.Context, workspaceID string, inv Invoice, now time.Time) error {
	breakdown, err := json.Marshal(inv.VATBreakdown)
	if err != nil {
		return fmt.Errorf("save draft: %w", err)
	}
	tag, err := q.db.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, client_id, credited_invoice_id, issue_date, due_date,
			service_date, service_date_end, currency, language, vat_mode, reference, intro, footer, note, discount_percent, subtotal,
			discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, pay_qr_bill, pay_revolut, prepaid_total, created_at, updated_at,
			tax_currency_rate)
		VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
			$26, $27, $28, $25, $25, $29::text::numeric)
		ON CONFLICT (id) DO UPDATE SET client_id = $4, issue_date = $6, due_date = $7, service_date = $8, service_date_end = $9,
			currency = $10, language = $11, vat_mode = $12, reference = $13, intro = $14, footer = $15, note = $16,
			discount_percent = $17, subtotal = $18, discount_amount = $19, net_total = $20, vat_total = $21, total = $22,
			rounding_amount = $23, vat_breakdown = $24, pay_qr_bill = $26, pay_revolut = $27, prepaid_total = $28, updated_at = $25,
			tax_currency_rate = $29::text::numeric
		WHERE invoices.status = 'draft' AND invoices.workspace_id = $2`,
		inv.ID, workspaceID, inv.Kind, inv.ClientID, refID(inv.CreditedInvoice), inv.IssueDate, inv.DueDate, inv.ServiceDate,
		inv.ServiceDateEnd, inv.Currency, inv.Language, inv.VATMode, inv.Reference, inv.Intro, inv.Footer, inv.Note, inv.DiscountPercent,
		inv.Subtotal, inv.DiscountAmount, inv.NetTotal, inv.VATTotal, inv.Total, inv.RoundingAmount, breakdown, now,
		inv.PaymentMethods.QRBill, inv.PaymentMethods.Revolut, inv.PrepaidTotal, inv.TaxCurrencyRate)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 { // the guard matched nothing: the lines must stay as they are too
		return ErrNotDraft
	}
	if _, err := q.db.Exec(ctx, `DELETE FROM invoice_lines WHERE invoice_id = $1`, inv.ID); err != nil {
		return err
	}
	for _, l := range inv.Lines {
		if _, err := q.db.Exec(ctx, `INSERT INTO invoice_lines (id, invoice_id, position, description, quantity, unit, unit_price,
			discount_percent, vat_category, vat_rate, amount, vat_exemption_code, vat_exemption_reason)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			l.ID, inv.ID, l.Position, l.Description, l.Quantity, l.Unit, l.UnitPrice, l.DiscountPercent, l.VATCategory, l.VATRate,
			l.Amount, l.VATExemptionCode, l.VATExemptionReason); err != nil {
			return err
		}
	}
	return nil
}

func refID(r *InvoiceRef) *string {
	if r == nil {
		return nil
	}
	return &r.ID
}

// DeleteDraft: false when there is no such draft.
func (q Q) DeleteDraft(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM invoices WHERE workspace_id = $1 AND id = $2 AND status = 'draft'`, workspaceID, id)
	return tag.RowsAffected() == 1, err
}

// NextInvoiceSeq takes the next number of the (workspace, kind, year) sequence; the row stays locked until the
// transaction ends, so numbers are gapless and a rollback gives the number back.
func (q Q) NextInvoiceSeq(ctx context.Context, workspaceID, kind string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `INSERT INTO invoice_counters (workspace_id, kind, year, seq) VALUES ($1, $2, $3, 1)
		ON CONFLICT (workspace_id, kind, year) DO UPDATE SET seq = invoice_counters.seq + 1 RETURNING seq`,
		workspaceID, kind, year).Scan(&seq)
	return seq, err
}

// RaiseInvoiceCounter makes the (workspace, kind, year) sequence continue after seq, never moving it back.
func (q Q) RaiseInvoiceCounter(ctx context.Context, workspaceID, kind string, year int, seq int64) error {
	_, err := q.db.Exec(ctx, `INSERT INTO invoice_counters (workspace_id, kind, year, seq) VALUES ($1, $2, $3, $4)
		ON CONFLICT (workspace_id, kind, year) DO UPDATE SET seq = GREATEST(invoice_counters.seq, EXCLUDED.seq)`,
		workspaceID, kind, year, seq)
	return err
}

// ImportedInvoiceNumber: the number of an invoice imported as issued elsewhere, and its issue date.
type ImportedInvoiceNumber struct{ Number, IssueDate string }

// ImportedInvoiceNumbers: the numbers of the workspace's imported invoices of the invoice series, while it has issued
// none of its own (nil once it has: its numbering is then settled).
func (q Q) ImportedInvoiceNumbers(ctx context.Context, workspaceID string) ([]ImportedInvoiceNumber, error) {
	rows, err := q.db.Query(ctx, `SELECT number, issue_date::text FROM invoices
		WHERE workspace_id = $1 AND origin = 'imported' AND number IS NOT NULL
		AND kind IN ('invoice', 'partial', 'prepayment', 'debit_note', 'corrected')
		AND NOT EXISTS (SELECT 1 FROM invoices WHERE workspace_id = $1 AND origin = 'helvetly' AND status <> 'draft')`,
		workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ImportedInvoiceNumber, error) {
		var n ImportedInvoiceNumber
		return n, r.Scan(&n.Number, &n.IssueDate)
	})
}

// InvoiceNumberUsed: a document of the workspace, of any kind, already carries the number (one imported as issued
// elsewhere keeps its own, which the workspace's series may reach later).
func (q Q) InvoiceNumberUsed(ctx context.Context, workspaceID, number string) (bool, error) {
	var used bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoices WHERE workspace_id = $1 AND number = $2)`,
		workspaceID, number).Scan(&used)
	return used, err
}

// PeekInvoiceSeq: the number the next issue of the (workspace, kind, year) sequence would take, without taking it.
func (q Q) PeekInvoiceSeq(ctx context.Context, workspaceID, kind string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `SELECT COALESCE((SELECT seq FROM invoice_counters WHERE workspace_id = $1 AND kind = $2 AND year = $3), 0) + 1`,
		workspaceID, kind, year).Scan(&seq)
	return seq, err
}

// Issue records the issue snapshot of a locked draft and counts it (CountIssue; a replay when the caller counted it
// already, before its PDF).
func (q Q) Issue(ctx context.Context, workspaceID string, inv Invoice, seq int64, now time.Time) error {
	if err := q.CountIssue(ctx, workspaceID, inv, now); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `UPDATE invoices SET status = 'open', number = $2, seq = $3, iban = $4, reference_type = $5,
		payment_reference = $6, qr_bill = $7, seller = $8, buyer = $9, pdf_key = $10, issued_at = $11, updated_at = $11,
		revolut_url = $12, pay_qr_bill = $13, pay_revolut = $14
		WHERE id = $1 AND status = 'draft'`, inv.ID, inv.Number, seq, inv.Payment.IBAN, inv.Payment.ReferenceType,
		inv.Payment.Reference, inv.Payment.QRBill, inv.Seller, inv.Buyer, inv.PDFKey, now, inv.Payment.RevolutURL,
		inv.PaymentMethods.QRBill, inv.PaymentMethods.Revolut)
	return err
}

// RefreshBalance recomputes an issued document's paid and credited amounts and its status from its payments
// and issued credit notes. Issued credit notes are always 'paid' (applied).
func (q Q) RefreshBalance(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices i SET amount_paid = s.paid, amount_credited = s.credited, amount_refunded = s.refunded,
			updated_at = $2,
			status = CASE WHEN i.kind = 'credit_note' THEN 'paid'
				WHEN i.kind = 'proforma' OR i.status = 'replaced' OR (i.status = 'void' AND s.notes = 0) THEN i.status
				WHEN s.notes > 0 AND s.credited >= i.total + i.rounding_amount THEN 'void'
				WHEN s.paid + s.credited >= i.total + i.rounding_amount THEN 'paid'
				ELSE 'open' END
		FROM (SELECT COALESCE((SELECT sum(amount) FROM invoice_payments WHERE invoice_id = $1), 0) AS paid,
			COALESCE((SELECT sum(total + rounding_amount) FROM invoices WHERE credited_invoice_id = $1 AND kind = 'credit_note' AND status <> 'draft'), 0) AS credited,
			COALESCE((SELECT count(*) FROM invoices WHERE credited_invoice_id = $1 AND kind = 'credit_note' AND status <> 'draft'), 0) AS notes,
			COALESCE((SELECT sum(amount) FROM invoice_refunds WHERE invoice_id = $1), 0) AS refunded) s
		WHERE i.id = $1 AND i.status <> 'draft'`, id, now)
	return err
}

// TryLockInvoiceSend takes the invoice's send lock until the transaction ends; false when another send of the same
// invoice holds it.
func (q Q) TryLockInvoiceSend(ctx context.Context, invoiceID string) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended('invoice_send:' || $1, 0))`, invoiceID).Scan(&ok)
	return ok, err
}

func (q Q) MarkSent(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices SET sent_at = $2, updated_at = $2 WHERE id = $1`, id, now)
	return err
}

// ---- payments ----

func (q Q) CreatePayment(ctx context.Context, invoiceID, userID string, p Payment) error {
	_, err := q.db.Exec(ctx, `INSERT INTO invoice_payments (id, invoice_id, amount, paid_on, method, note, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, p.ID, invoiceID, p.Amount, p.PaidOn, p.Method, p.Note, userID, p.CreatedAt)
	return err
}

// Payments: the invoice's payments, oldest first.
func (q Q) Payments(ctx context.Context, invoiceID string) ([]Payment, error) {
	rows, err := q.db.Query(ctx, `SELECT p.id, p.amount, p.paid_on::text, p.method, p.note, p.created_at, u.id, u.name
		FROM invoice_payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.invoice_id = $1 ORDER BY p.paid_on, p.created_at, p.id`,
		invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Payment, error) {
		var p Payment
		var uid, uname *string
		err := r.Scan(&p.ID, &p.Amount, &p.PaidOn, &p.Method, &p.Note, &p.CreatedAt, &uid, &uname)
		if uid != nil {
			p.CreatedBy = &Uploader{ID: *uid, Name: *uname}
		}
		return p, err
	})
}

func (q Q) DeletePayment(ctx context.Context, invoiceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM invoice_payments WHERE invoice_id = $1 AND id = $2`, invoiceID, id)
	return tag.RowsAffected() == 1, err
}

// ---- refunds ----

func (q Q) CreateRefund(ctx context.Context, invoiceID, userID string, r Refund) error {
	_, err := q.db.Exec(ctx, `INSERT INTO invoice_refunds (id, invoice_id, amount, refunded_on, method, note, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, r.ID, invoiceID, r.Amount, r.RefundedOn, r.Method, r.Note, userID, r.CreatedAt)
	return err
}

// Refunds: the invoice's refunds, oldest first.
func (q Q) Refunds(ctx context.Context, invoiceID string) ([]Refund, error) {
	rows, err := q.db.Query(ctx, `SELECT r.id, r.amount, r.refunded_on::text, r.method, r.note, r.created_at, u.id, u.name
		FROM invoice_refunds r LEFT JOIN users u ON u.id = r.created_by WHERE r.invoice_id = $1 ORDER BY r.refunded_on, r.created_at, r.id`,
		invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Refund, error) {
		var r Refund
		var uid, uname *string
		err := row.Scan(&r.ID, &r.Amount, &r.RefundedOn, &r.Method, &r.Note, &r.CreatedAt, &uid, &uname)
		if uid != nil {
			r.CreatedBy = &Uploader{ID: *uid, Name: *uname}
		}
		return r, err
	})
}

func (q Q) DeleteRefund(ctx context.Context, invoiceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM invoice_refunds WHERE invoice_id = $1 AND id = $2`, invoiceID, id)
	return tag.RowsAffected() == 1, err
}

// LastCreditDate: the issue date of the invoice's latest issued credit note, "" when it has none.
func (q Q) LastCreditDate(ctx context.Context, invoiceID string) (string, error) {
	var d *string
	err := q.db.QueryRow(ctx, `SELECT max(issue_date)::text FROM invoices WHERE credited_invoice_id = $1 AND kind = 'credit_note' AND status <> 'draft'`,
		invoiceID).Scan(&d)
	return str(d), err
}

// ---- deliveries ----

// CreateDelivery records a send; userID is nil when the system sent it (an instalment plan).
func (q Q) CreateDelivery(ctx context.Context, invoiceID string, userID *string, d Delivery) error {
	_, err := q.db.Exec(ctx, `INSERT INTO invoice_deliveries (id, invoice_id, recipients, cc, sent_by, sent_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		d.ID, invoiceID, d.To, d.Cc, userID, d.SentAt)
	return err
}

// Deliveries: the invoice's sends, newest first.
func (q Q) Deliveries(ctx context.Context, invoiceID string) ([]Delivery, error) {
	rows, err := q.db.Query(ctx, `SELECT d.id, d.recipients, d.cc, d.sent_at, u.id, u.name FROM invoice_deliveries d
		LEFT JOIN users u ON u.id = d.sent_by WHERE d.invoice_id = $1 ORDER BY d.sent_at DESC, d.id DESC`, invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Delivery, error) {
		var d Delivery
		var uid, uname *string
		err := r.Scan(&d.ID, &d.To, &d.Cc, &d.SentAt, &uid, &uname)
		if uid != nil {
			d.SentBy = &Uploader{ID: *uid, Name: *uname}
		}
		return d, err
	})
}

// ---- list ----

// InvoiceSorts maps the list's sort keys to their SQL.
var InvoiceSorts = map[string]string{"number": "i.number", "issue_date": "i.issue_date", "due_date": "i.due_date",
	"total": "i.total + i.rounding_amount", "client": "lower(" + invoiceClientName + ")", "created_at": "i.created_at"}

// InvoiceFilter narrows the list and the export; empty fields do not narrow.
type InvoiceFilter struct {
	Search     string
	Statuses   []string // draft, open, paid, void, replaced, overdue, refund_due
	Kind       string   // any document kind
	ClientID   string
	Credited   string // credit notes of this invoice
	IssuedFrom string
	IssuedTo   string
	IDs        []string
	Sort       string // a key of InvoiceSorts, "-" prefixed for descending; "" for the default
}

func (f InvoiceFilter) where(workspaceID, today string) (string, []any) {
	args := []any{workspaceID, today}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	conds := []string{"i.workspace_id = $1"}
	if term := strings.TrimSpace(f.Search); term != "" {
		p := arg("%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%")
		conds = append(conds, "(i.number ILIKE "+p+" OR "+invoiceClientName+" ILIKE "+p+" OR i.reference ILIKE "+p+")")
	}
	if len(f.Statuses) > 0 {
		var or []string
		for _, s := range f.Statuses {
			switch s {
			case "overdue":
				or = append(or, fmt.Sprintf(isOverdue, 2))
			case "refund_due":
				or = append(or, "("+refundDue+") > 0")
			default:
				or = append(or, "i.status = "+arg(s))
			}
		}
		conds = append(conds, "("+strings.Join(or, " OR ")+")")
	}
	switch f.Kind {
	case "":
	case "prepayment": // with the corrections that replaced prepayments, so a final invoice can deduct them
		conds = append(conds, prepaymentLike)
	default:
		conds = append(conds, "i.kind = "+arg(f.Kind))
	}
	if f.ClientID != "" {
		conds = append(conds, "i.client_id = "+arg(f.ClientID))
	}
	if f.Credited != "" {
		conds = append(conds, "i.credited_invoice_id = "+arg(f.Credited))
	}
	if f.IssuedFrom != "" {
		conds = append(conds, "i.issue_date >= "+arg(f.IssuedFrom)+"::date")
	}
	if f.IssuedTo != "" {
		conds = append(conds, "i.issue_date <= "+arg(f.IssuedTo)+"::date")
	}
	if len(f.IDs) > 0 {
		conds = append(conds, "i.id = ANY("+arg(f.IDs)+")")
	}
	return strings.Join(conds, " AND "), args
}

func (f InvoiceFilter) orderBy() string {
	key, dir := strings.TrimPrefix(f.Sort, "-"), " ASC"
	if strings.HasPrefix(f.Sort, "-") {
		dir = " DESC"
	}
	col, ok := InvoiceSorts[key]
	if !ok {
		return "i.issue_date DESC, i.created_at DESC, i.id"
	}
	return col + dir + " NULLS LAST, i.created_at" + dir + ", i.id"
}

// ListInvoices returns one page of the filtered documents and how many match in all; limit 0 returns every match.
func (q Q) ListInvoices(ctx context.Context, workspaceID, today string, f InvoiceFilter, limit, offset int) ([]InvoiceListItem, int, error) {
	where, args := f.where(workspaceID, today)
	var total int
	if err := q.db.QueryRow(ctx, `SELECT count(*)`+invoiceListFrom+where+` AND $2::date IS NOT NULL`, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	list := []InvoiceListItem{}
	err := q.EachInvoice(ctx, workspaceID, today, f, limit, offset, func(i InvoiceListItem) error { list = append(list, i); return nil })
	return list, total, err
}

const invoiceListFrom = ` FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoices di ON di.id = i.deducted_on_invoice_id WHERE `

// EachInvoice streams the filtered documents in order to fn (limit 0: every match), so an export holds one row at a time.
func (q Q) EachInvoice(ctx context.Context, workspaceID, today string, f InvoiceFilter, limit, offset int, fn func(InvoiceListItem) error) error {
	where, args := f.where(workspaceID, today)
	page := ""
	if limit > 0 {
		page = fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	}
	rows, err := q.db.Query(ctx, `SELECT i.id, i.kind, i.number, i.status, `+fmt.Sprintf(isOverdue, 2)+`, i.client_id,
		c.number, `+invoiceClientName+`, i.issue_date::text, i.due_date::text, i.currency, i.net_total, i.vat_total, i.total, i.rounding_amount, `+amountDue+`,
		`+refundDue+`, i.amount_paid, i.reference, i.sent_at, i.created_at, i.pay_qr_bill, i.pay_revolut, i.prepaid_total,
		di.id, di.number`+invoiceListFrom+where+` ORDER BY `+f.orderBy()+page, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var i InvoiceListItem
		var deductedID, deductedNumber *string
		if err := rows.Scan(&i.ID, &i.Kind, &i.Number, &i.Status, &i.IsOverdue, &i.Client.ID, &i.Client.Number, &i.Client.Name,
			&i.IssueDate, &i.DueDate, &i.Currency, &i.NetTotal, &i.VATTotal, &i.Total, &i.RoundingAmount, &i.AmountDue, &i.RefundDue, &i.Paid, &i.Reference, &i.SentAt,
			&i.CreatedAt, &i.PaymentMethods.QRBill, &i.PaymentMethods.Revolut, &i.PrepaidTotal, &deductedID, &deductedNumber); err != nil {
			return err
		}
		i.PayableTotal = i.Total + i.RoundingAmount
		if deductedID != nil {
			i.DeductedOn = &InvoiceRef{ID: *deductedID, Number: str(deductedNumber)}
		}
		if err := fn(i); err != nil {
			return err
		}
	}
	return rows.Err()
}

// ---- summary ----

type Amount struct {
	Amount Money `json:"amount"`
	Count  int   `json:"count"`
}

type MonthTotals struct {
	Month    string `json:"month"`
	Invoiced Money  `json:"invoiced"`
	Paid     Money  `json:"paid"`
}

type InvoiceSummary struct {
	Currency      string `json:"currency"`
	Outstanding   Amount `json:"outstanding"`
	Overdue       Amount `json:"overdue"`
	PaidThisMonth Amount `json:"paid_this_month"`
	PaidLastMonth struct {
		Amount Money `json:"amount"`
	} `json:"paid_last_month"`
	Drafts         Amount         `json:"drafts"`
	RefundDue      Amount         `json:"refund_due"`
	AvgDaysToPay   *float64       `json:"avg_days_to_pay"`
	CollectionRate *float64       `json:"collection_rate"`
	Monthly        []MonthTotals  `json:"monthly"`
	Period         *PeriodSummary `json:"period,omitempty"`
}

// PeriodSummary: the figures of a chosen period (civil dates, both ends inclusive) beside the preceding one.
type PeriodSummary struct {
	Name         string `json:"name"`
	From         string `json:"from"`
	To           string `json:"to"`
	Paid         Amount `json:"paid"`
	PaidPrevious struct {
		Amount Money `json:"amount"`
	} `json:"paid_previous"`
	AvgDaysToPay   *float64 `json:"avg_days_to_pay"`
	CollectionRate *float64 `json:"collection_rate"`
}

// InvoicePeriod fills p's figures with the rules of InvoiceSummary, but in p's dates instead of fixed windows:
// net cash received in [From, To] and [prevFrom, prevTo], days to pay of invoices settled in it, and the
// collection rate of invoices issued in it.
func (q Q) InvoicePeriod(ctx context.Context, workspaceID, currency, clientID string, p *PeriodSummary, prevFrom, prevTo string) error {
	const scope = ` FROM invoices i WHERE i.workspace_id = $1 AND i.currency = $2 AND i.kind IN ` + receivableKinds + `
		AND i.status <> 'replaced' AND ($3 = '' OR i.client_id = $3)`
	moved := func(table, col string) string {
		return ` FROM ` + table + ` t JOIN invoices i ON i.id = t.invoice_id
		WHERE i.workspace_id = $1 AND i.currency = $2 AND ($3 = '' OR i.client_id = $3) AND i.kind IN ` + receivableKinds + `
		AND t.` + col + ` BETWEEN $4::date AND $5::date`
	}
	cash := `COALESCE((SELECT sum(t.amount)` + moved("invoice_payments", "paid_on") + `), 0)
		- COALESCE((SELECT sum(t.amount)` + moved("invoice_refunds", "refunded_on") + `), 0)`
	if err := q.db.QueryRow(ctx, `SELECT `+cash+`,
		(SELECT count(DISTINCT t.invoice_id)`+moved("invoice_payments", "paid_on")+`),
		(SELECT avg(last_paid - i.issue_date)::float8 FROM (SELECT i.issue_date, (SELECT max(paid_on) FROM invoice_payments
			WHERE invoice_id = i.id) AS last_paid`+scope+` AND i.status = 'paid') i WHERE last_paid BETWEEN $4::date AND $5::date),
		(SELECT CASE WHEN sum(`+netInvoiced+`) > 0 THEN LEAST(1, GREATEST(0,
			sum(LEAST(GREATEST(0, i.amount_paid - i.amount_refunded), `+netInvoiced+`))::float8 / sum(`+netInvoiced+`))) END`+scope+`
			AND i.status <> 'draft' AND i.issue_date BETWEEN $4::date AND $5::date)`,
		workspaceID, currency, clientID, p.From, p.To).Scan(&p.Paid.Amount, &p.Paid.Count, &p.AvgDaysToPay, &p.CollectionRate); err != nil {
		return err
	}
	return q.db.QueryRow(ctx, `SELECT `+cash, workspaceID, currency, clientID, prevFrom, prevTo).Scan(&p.PaidPrevious.Amount)
}

// netInvoiced: what an issued invoice is still worth after its credit notes (payable_total − amount_credited, ≥ 0).
const netInvoiced = `GREATEST(0, i.total + i.rounding_amount - i.amount_credited)`

// InvoiceSummary: the KPIs of one currency's invoices (credit notes count through amount_credited).
func (q Q) InvoiceSummary(ctx context.Context, workspaceID, currency, today, clientID string) (InvoiceSummary, error) {
	s := InvoiceSummary{Currency: currency}
	const scope = ` FROM invoices i WHERE i.workspace_id = $1 AND i.currency = $2 AND $3::date IS NOT NULL AND i.kind IN ` + receivableKinds + `
		AND i.status <> 'replaced' AND ($4 = '' OR i.client_id = $4)`
	// inMonth: money moved (table t: invoice_payments or invoice_refunds, dated by col) in the month $5 away from today.
	inMonth := func(table, col string) string {
		return ` FROM ` + table + ` t JOIN invoices i ON i.id = t.invoice_id
		WHERE i.workspace_id = $1 AND i.currency = $2 AND ($4 = '' OR i.client_id = $4) AND i.kind IN ` + receivableKinds + `
		AND t.` + col + ` >= date_trunc('month', $3::date) + $5::interval AND t.` + col + ` < date_trunc('month', $3::date) + $5::interval + interval '1 month'`
	}
	err := q.db.QueryRow(ctx, `SELECT
		(SELECT COALESCE(sum(`+amountDue+`), 0)`+scope+` AND i.status = 'open'),
		(SELECT count(*)`+scope+` AND i.status = 'open'),
		(SELECT COALESCE(sum(`+amountDue+`), 0)`+scope+` AND `+fmt.Sprintf(isOverdue, 3)+`),
		(SELECT count(*)`+scope+` AND `+fmt.Sprintf(isOverdue, 3)+`),
		(SELECT COALESCE(sum(i.total + i.rounding_amount), 0)`+scope+` AND i.status = 'draft'),
		(SELECT count(*)`+scope+` AND i.status = 'draft'),
		(SELECT COALESCE(sum(`+refundDue+`), 0)`+scope+`),
		(SELECT count(*)`+scope+` AND (`+refundDue+`) > 0),
		(SELECT avg(last_paid - i.issue_date)::float8 FROM (SELECT i.issue_date, (SELECT max(paid_on) FROM invoice_payments
			WHERE invoice_id = i.id) AS last_paid`+scope+` AND i.status = 'paid') i WHERE last_paid > $3::date - 90),
		(SELECT CASE WHEN sum(`+netInvoiced+`) > 0 THEN LEAST(1, GREATEST(0, -- GREATEST/LEAST skip NULLs: clamp only a real ratio
			sum(LEAST(GREATEST(0, i.amount_paid - i.amount_refunded), `+netInvoiced+`))::float8 / sum(`+netInvoiced+`))) END`+scope+`
			AND i.status <> 'draft' AND i.issue_date > $3::date - interval '12 months')`,
		workspaceID, currency, today, clientID).Scan(&s.Outstanding.Amount, &s.Outstanding.Count, &s.Overdue.Amount, &s.Overdue.Count,
		&s.Drafts.Amount, &s.Drafts.Count, &s.RefundDue.Amount, &s.RefundDue.Count, &s.AvgDaysToPay, &s.CollectionRate)
	if err != nil {
		return s, err
	}
	for _, m := range []struct {
		shift string
		into  *Money
		count *int
	}{{"0 months", &s.PaidThisMonth.Amount, &s.PaidThisMonth.Count}, {"-1 month", &s.PaidLastMonth.Amount, new(int)}} {
		if err := q.db.QueryRow(ctx, `SELECT COALESCE((SELECT sum(t.amount)`+inMonth("invoice_payments", "paid_on")+`), 0)
			- COALESCE((SELECT sum(t.amount)`+inMonth("invoice_refunds", "refunded_on")+`), 0),
			(SELECT count(DISTINCT t.invoice_id)`+inMonth("invoice_payments", "paid_on")+`)`,
			workspaceID, currency, today, clientID, m.shift).Scan(m.into, m.count); err != nil {
			return s, err
		}
	}
	rows, err := q.db.Query(ctx, `SELECT to_char(m, 'YYYY-MM'),
		COALESCE((SELECT sum(CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END * (i.total + i.rounding_amount)) FROM invoices i
			WHERE i.workspace_id = $1 AND i.currency = $2 AND ($4 = '' OR i.client_id = $4) AND i.status NOT IN ('draft', 'replaced')
			AND (i.kind IN `+receivableKinds+` OR (i.kind = 'credit_note' AND EXISTS (
				SELECT 1 FROM invoices original WHERE original.id = i.credited_invoice_id AND original.kind IN `+receivableKinds+`)))
			AND date_trunc('month', i.issue_date) = m), 0),
		COALESCE((SELECT sum(p.amount) FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
			WHERE i.workspace_id = $1 AND i.currency = $2 AND ($4 = '' OR i.client_id = $4) AND i.kind IN `+receivableKinds+` AND date_trunc('month', p.paid_on) = m), 0)
		- COALESCE((SELECT sum(r.amount) FROM invoice_refunds r JOIN invoices i ON i.id = r.invoice_id
			WHERE i.workspace_id = $1 AND i.currency = $2 AND ($4 = '' OR i.client_id = $4) AND i.kind IN `+receivableKinds+` AND date_trunc('month', r.refunded_on) = m), 0)
		FROM generate_series(date_trunc('month', $3::date) - interval '11 months', date_trunc('month', $3::date), interval '1 month') m
		ORDER BY m`, workspaceID, currency, today, clientID)
	if err != nil {
		return s, err
	}
	s.Monthly, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (MonthTotals, error) {
		var m MonthTotals
		err := r.Scan(&m.Month, &m.Invoiced, &m.Paid)
		return m, err
	})
	return s, err
}
