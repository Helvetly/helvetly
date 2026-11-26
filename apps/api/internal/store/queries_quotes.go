package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

// Quote is an offer to a client (docs/quotes-contract.md). Status is stored as draft, sent, accepted or declined;
// readers derive expired (QuoteStatus).
type Quote struct {
	ID              string              `json:"id"`
	Number          *string             `json:"number"`
	Revision        int                 `json:"revision"`
	Status          string              `json:"status"`
	ClientID        string              `json:"client_id"`
	Client          InvoiceClient       `json:"client"`
	IssueDate       string              `json:"issue_date"`
	ValidUntil      string              `json:"valid_until"`
	Currency        string              `json:"currency"`
	Language        string              `json:"language"`
	VATMode         string              `json:"vat_mode"`
	Reference       *string             `json:"reference"`
	Intro           *string             `json:"intro"`
	Footer          *string             `json:"footer"`
	Note            *string             `json:"note"`
	DiscountPercent Percent             `json:"discount_percent"`
	Lines           []InvoiceLine       `json:"lines"`
	Subtotal        Money               `json:"subtotal"`
	DiscountAmount  Money               `json:"discount_amount"`
	NetTotal        Money               `json:"net_total"`
	VATBreakdown    []invoicecalc.Group `json:"vat_breakdown"`
	VATTotal        Money               `json:"vat_total"`
	Total           Money               `json:"total"`
	RoundingAmount  Money               `json:"rounding_amount"`
	// Instalments: the payment schedule offered with the quote, amounts and due dates only; null is none.
	Instalments  *InstalmentSchedule `json:"instalments"`
	PayableTotal Money               `json:"payable_total"`
	SentAt       *time.Time          `json:"sent_at"`
	DecidedAt    *time.Time          `json:"decided_at"`
	DecidedBy    *string             `json:"decided_by"` // staff | client
	DecisionNote *string             `json:"decision_note"`
	Invoice      *InvoiceRef         `json:"invoice"` // the invoice draft it became; number "" until issued
	// ApprovalState: of a draft's latest approval request before sending (internal/approvals), as on Invoice.
	ApprovalState *string   `json:"approval_state"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	PDFKey        *string   `json:"-"`

	// ClientNumberDisplay, ContractReference, ContractDocument: as on Invoice.
	ClientNumberDisplay *string      `json:"client_number_display"`
	ContractReference   *string      `json:"contract_reference"`
	ContractDocument    *DocumentRef `json:"contract_document"`
	PDFDocument         *DocumentRef `json:"pdf_document"` // as on Invoice
}

// QuoteStatus: the stored status, or expired for a sent quote whose valid_until is before today.
func QuoteStatus(status, validUntil, today string) string {
	if status == "sent" && validUntil < today {
		return "expired"
	}
	return status
}

// quoteSelect reads the invoice link from q.invoice_id: under FOR UPDATE a concurrent change re-reads the locked quote
// row, while a joined invoices row stays as of the statement's snapshot.
var quoteSelect = `SELECT q.id, q.number, q.revision, q.status, q.client_id, c.number, c.name, q.issue_date::text,
		q.valid_until::text, q.currency, q.language, q.vat_mode, q.reference, q.intro, q.footer, q.note, q.discount_percent,
		q.lines, q.subtotal, q.discount_amount, q.net_total, q.vat_breakdown, q.vat_total, q.total, q.rounding_amount,
		q.sent_at, q.decided_at, q.decided_by, q.decision_note, q.invoice_id, coalesce(i.number, ''), q.created_at, q.updated_at, q.pdf_key,
		q.client_number_display, q.contract_reference, q.contract_document_id, q.instalments, ` + fmt.Sprintf(contractDocumentName, "q") + `, ` + approvalStateOf("q") + `,
		` + fmt.Sprintf(pdfDocument, "q", "NULL") + `
	FROM quotes q JOIN clients c ON c.id = q.client_id LEFT JOIN invoices i ON i.id = q.invoice_id `

func scanQuote(row interface{ Scan(...any) error }, today string) (Quote, error) {
	var t Quote
	var invoiceID *string
	var invoiceNumber string
	var contractDocID, contractDocName *string
	err := row.Scan(&t.ID, &t.Number, &t.Revision, &t.Status, &t.ClientID, &t.Client.Number, &t.Client.Name, &t.IssueDate,
		&t.ValidUntil, &t.Currency, &t.Language, &t.VATMode, &t.Reference, &t.Intro, &t.Footer, &t.Note, &t.DiscountPercent,
		&t.Lines, &t.Subtotal, &t.DiscountAmount, &t.NetTotal, &t.VATBreakdown, &t.VATTotal, &t.Total, &t.RoundingAmount,
		&t.SentAt, &t.DecidedAt, &t.DecidedBy, &t.DecisionNote, &invoiceID, &invoiceNumber, &t.CreatedAt, &t.UpdatedAt, &t.PDFKey,
		&t.ClientNumberDisplay, &t.ContractReference, &contractDocID, &t.Instalments, &contractDocName, &t.ApprovalState, &t.PDFDocument)
	t.ContractDocument = DocumentRefOf(contractDocID, contractDocName)
	t.Client.ID = t.ClientID
	t.PayableTotal = t.Total + t.RoundingAmount
	t.Status = QuoteStatus(t.Status, t.ValidUntil, today)
	if invoiceID != nil {
		t.Invoice = &InvoiceRef{ID: *invoiceID, Number: invoiceNumber}
	}
	return t, err
}

// Quote reads one quote of the workspace; forUpdate locks it for the caller's transaction.
func (q Q) Quote(ctx context.Context, workspaceID, id, today string, forUpdate bool) (Quote, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF q"
	}
	return scanQuote(q.db.QueryRow(ctx, quoteSelect+`WHERE q.workspace_id = $1 AND q.id = $2`+lock, workspaceID, id), today)
}

// Quotes: the workspace's quotes, newest first, of one client when clientID is set.
func (q Q) Quotes(ctx context.Context, workspaceID, clientID, today string) ([]Quote, error) {
	list, _, err := q.ListQuotes(ctx, workspaceID, today, QuoteFilter{ClientID: clientID}, 0, 0)
	return list, err
}

// quoteStatus is the status a reader sees (QuoteStatus in SQL), with today in $2.
const quoteStatus = `CASE WHEN q.status = 'sent' AND q.valid_until < $2::date THEN 'expired' ELSE q.status END`

// QuoteSorts maps the list's sort keys to their SQL; status sorts in the order of the lifecycle.
var QuoteSorts = map[string]string{"number": "q.number", "client": "lower(c.name)", "issue_date": "q.issue_date",
	"valid_until": "q.valid_until", "total": "q.total + q.rounding_amount", "created_at": "q.created_at",
	"status": "array_position(ARRAY['draft','sent','accepted','declined','expired'], " + quoteStatus + ")"}

// QuoteFilter narrows the quotes list; empty fields do not narrow.
type QuoteFilter struct {
	Search     string // number as shown ("Q-2026-001 (Rev. 2)"), client name or reference
	ClientID   string
	ClientName string   // part of the client's name
	Statuses   []string // draft, sent, accepted, declined, expired (as QuoteStatus derives it)
	IssuedFrom string   // YYYY-MM-DD, inclusive, on the quote's date
	IssuedTo   string
	TotalMin   *int64 // in cents, inclusive, of the payable total
	TotalMax   *int64
	Sort       string // a key of QuoteSorts, "-" prefixed for descending; "" for newest made first
}

func (f QuoteFilter) where(workspaceID, today string) (string, []any) {
	args := []any{workspaceID, today}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	conds := []string{"q.workspace_id = $1", "$2::date IS NOT NULL"}
	if term := strings.TrimSpace(f.Search); term != "" {
		p := arg(likePattern(term))
		conds = append(conds, "(q.number || CASE WHEN q.revision > 1 THEN ' (Rev. ' || q.revision || ')' ELSE '' END ILIKE "+p+
			" OR c.name ILIKE "+p+" OR q.reference ILIKE "+p+")")
	}
	if f.ClientID != "" {
		conds = append(conds, "q.client_id = "+arg(f.ClientID))
	}
	if term := strings.TrimSpace(f.ClientName); term != "" {
		conds = append(conds, "c.name ILIKE "+arg(likePattern(term)))
	}
	if len(f.Statuses) > 0 {
		conds = append(conds, quoteStatus+" = ANY("+arg(f.Statuses)+")")
	}
	if f.IssuedFrom != "" {
		conds = append(conds, "q.issue_date >= "+arg(f.IssuedFrom)+"::date")
	}
	if f.IssuedTo != "" {
		conds = append(conds, "q.issue_date <= "+arg(f.IssuedTo)+"::date")
	}
	if f.TotalMin != nil {
		conds = append(conds, QuoteSorts["total"]+" >= "+arg(*f.TotalMin))
	}
	if f.TotalMax != nil {
		conds = append(conds, QuoteSorts["total"]+" <= "+arg(*f.TotalMax))
	}
	return strings.Join(conds, " AND "), args
}

func (f QuoteFilter) orderBy() string {
	key, dir := strings.TrimPrefix(f.Sort, "-"), " ASC"
	if strings.HasPrefix(f.Sort, "-") {
		dir = " DESC"
	}
	col, ok := QuoteSorts[key]
	if !ok {
		return "q.created_at DESC, q.id DESC"
	}
	return col + dir + " NULLS LAST, q.created_at" + dir + ", q.id" + dir
}

// ListQuotes returns one page of the filtered quotes and how many match in all; limit 0 returns every match.
func (q Q) ListQuotes(ctx context.Context, workspaceID, today string, f QuoteFilter, limit, offset int) ([]Quote, int, error) {
	where, args := f.where(workspaceID, today)
	var total int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM quotes q JOIN clients c ON c.id = q.client_id WHERE `+where,
		args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	page := ""
	if limit > 0 {
		page = fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	}
	rows, err := q.db.Query(ctx, quoteSelect+`WHERE `+where+` ORDER BY `+f.orderBy()+page, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Quote{}
	for rows.Next() {
		t, err := scanQuote(rows, today)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, rows.Err()
}

func (q Q) saveQuote(ctx context.Context, workspaceID string, t Quote, now time.Time) error {
	status := t.Status
	if status == "expired" {
		status = "sent"
	}
	var invoiceID *string
	if t.Invoice != nil {
		invoiceID = &t.Invoice.ID
	}
	_, err := q.db.Exec(ctx, `INSERT INTO quotes (id, workspace_id, client_id, number, revision, status, issue_date, valid_until,
			currency, language, vat_mode, reference, intro, footer, note, discount_percent, lines, subtotal, discount_amount,
			net_total, vat_total, total, rounding_amount, vat_breakdown, pdf_key, sent_at, decided_at, decided_by, decision_note,
			invoice_id, created_at, updated_at, client_number_display, contract_reference, contract_document_id, instalments)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
			$25, $26, $27, $28, $29, $30, $31, $31, $32, $33, $34, $35)
		ON CONFLICT (id) DO UPDATE SET client_id = $3, number = $4, revision = $5, status = $6, issue_date = $7,
			valid_until = $8, currency = $9, language = $10, vat_mode = $11, reference = $12, intro = $13, footer = $14,
			note = $15, discount_percent = $16, lines = $17, subtotal = $18, discount_amount = $19, net_total = $20,
			vat_total = $21, total = $22, rounding_amount = $23, vat_breakdown = $24, pdf_key = $25, sent_at = $26,
			decided_at = $27, decided_by = $28, decision_note = $29, invoice_id = $30, updated_at = $31,
			client_number_display = $32, contract_reference = $33, contract_document_id = $34, instalments = $35
		WHERE quotes.workspace_id = $2`,
		t.ID, workspaceID, t.ClientID, t.Number, t.Revision, status, t.IssueDate, t.ValidUntil, t.Currency, t.Language,
		t.VATMode, t.Reference, t.Intro, t.Footer, t.Note, t.DiscountPercent, t.Lines, t.Subtotal, t.DiscountAmount,
		t.NetTotal, t.VATTotal, t.Total, t.RoundingAmount, t.VATBreakdown, t.PDFKey, t.SentAt, t.DecidedAt, t.DecidedBy,
		t.DecisionNote, invoiceID, now, t.ClientNumberDisplay, t.ContractReference, docRefID(t.ContractDocument), t.Instalments)
	return err
}

// NextQuoteNumber bumps the workspace's quote counter of the year in the caller's transaction.
func (q Q) NextQuoteNumber(ctx context.Context, workspaceID string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `INSERT INTO quote_counters (workspace_id, year, seq) VALUES ($1, $2, 1)
		ON CONFLICT (workspace_id, year) DO UPDATE SET seq = quote_counters.seq + 1 RETURNING seq`, workspaceID, year).Scan(&seq)
	return seq, err
}

// PeekQuoteNumber: the number the next quote of the year would take, without taking it.
func (q Q) PeekQuoteNumber(ctx context.Context, workspaceID string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `SELECT COALESCE((SELECT seq FROM quote_counters WHERE workspace_id = $1 AND year = $2), 0) + 1`,
		workspaceID, year).Scan(&seq)
	return seq, err
}

// DeleteQuoteDraft deletes a quote that was never sent; false when there is none (sent meanwhile, or missing).
func (q Q) DeleteQuoteDraft(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM quotes WHERE workspace_id = $1 AND id = $2 AND number IS NULL`, workspaceID, id)
	return tag.RowsAffected() == 1, err
}

// QuoteOfInvoice: the quote an invoice was made from, nil for none.
func (q Q) QuoteOfInvoice(ctx context.Context, invoiceID string) (*InvoiceRef, error) {
	var ref InvoiceRef
	err := q.db.QueryRow(ctx, `SELECT id, number FROM quotes WHERE invoice_id = $1`, invoiceID).Scan(&ref.ID, &ref.Number)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return &ref, err
}
