package store

import (
	"context"
	"errors"
	"fmt"
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
	PayableTotal    Money               `json:"payable_total"`
	SentAt          *time.Time          `json:"sent_at"`
	DecidedAt       *time.Time          `json:"decided_at"`
	DecidedBy       *string             `json:"decided_by"` // staff | client
	DecisionNote    *string             `json:"decision_note"`
	Invoice         *InvoiceRef         `json:"invoice"` // the invoice draft it became; number "" until issued
	CreatedAt       time.Time           `json:"created_at"`
	UpdatedAt       time.Time           `json:"updated_at"`
	PDFKey          *string             `json:"-"`

	// ClientNumberDisplay, ContractReference, ContractDocument: as on Invoice.
	ClientNumberDisplay *string      `json:"client_number_display"`
	ContractReference   *string      `json:"contract_reference"`
	ContractDocument    *DocumentRef `json:"contract_document"`
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
		q.client_number_display, q.contract_reference, q.contract_document_id, ` + fmt.Sprintf(contractDocumentName, "q") + `
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
		&t.ClientNumberDisplay, &t.ContractReference, &contractDocID, &contractDocName)
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
	rows, err := q.db.Query(ctx, quoteSelect+`WHERE q.workspace_id = $1 AND ($2 = '' OR q.client_id = $2)
		ORDER BY q.created_at DESC, q.id DESC`, workspaceID, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Quote{}
	for rows.Next() {
		t, err := scanQuote(rows, today)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
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
			invoice_id, created_at, updated_at, client_number_display, contract_reference, contract_document_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
			$25, $26, $27, $28, $29, $30, $31, $31, $32, $33, $34)
		ON CONFLICT (id) DO UPDATE SET client_id = $3, number = $4, revision = $5, status = $6, issue_date = $7,
			valid_until = $8, currency = $9, language = $10, vat_mode = $11, reference = $12, intro = $13, footer = $14,
			note = $15, discount_percent = $16, lines = $17, subtotal = $18, discount_amount = $19, net_total = $20,
			vat_total = $21, total = $22, rounding_amount = $23, vat_breakdown = $24, pdf_key = $25, sent_at = $26,
			decided_at = $27, decided_by = $28, decision_note = $29, invoice_id = $30, updated_at = $31,
			client_number_display = $32, contract_reference = $33, contract_document_id = $34
		WHERE quotes.workspace_id = $2`,
		t.ID, workspaceID, t.ClientID, t.Number, t.Revision, status, t.IssueDate, t.ValidUntil, t.Currency, t.Language,
		t.VATMode, t.Reference, t.Intro, t.Footer, t.Note, t.DiscountPercent, t.Lines, t.Subtotal, t.DiscountAmount,
		t.NetTotal, t.VATTotal, t.Total, t.RoundingAmount, t.VATBreakdown, t.PDFKey, t.SentAt, t.DecidedAt, t.DecidedBy,
		t.DecisionNote, invoiceID, now, t.ClientNumberDisplay, t.ContractReference, docRefID(t.ContractDocument))
	return err
}

// NextQuoteNumber bumps the workspace's quote counter of the year in the caller's transaction.
func (q Q) NextQuoteNumber(ctx context.Context, workspaceID string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `INSERT INTO quote_counters (workspace_id, year, seq) VALUES ($1, $2, 1)
		ON CONFLICT (workspace_id, year) DO UPDATE SET seq = quote_counters.seq + 1 RETURNING seq`, workspaceID, year).Scan(&seq)
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
