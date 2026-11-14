package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// SimilarInvoice: an invoice (not a credit note) of the client imported from the same document (its note) or with the
// same number, else one with the same issue date and total, with the matching rule.
func (q Q) SimilarInvoice(ctx context.Context, workspaceID, clientID, note, number, issueDate string, total int64) (*ImportDuplicate, error) {
	var d ImportDuplicate
	err := q.db.QueryRow(ctx, `SELECT id, coalesce(number, 'Draft of ' || to_char(issue_date, 'DD.MM.YYYY')),
			CASE WHEN ($3<>'' AND note=$3) OR ($4<>'' AND number=$4) THEN 'same document number' ELSE 'same date and total' END
		FROM invoices WHERE workspace_id=$1 AND client_id=$2 AND kind<>'credit_note'
			AND (($3<>'' AND note=$3) OR ($4<>'' AND number=$4) OR (issue_date=NULLIF($5, '')::date AND total=$6))
		ORDER BY (($3<>'' AND note=$3) OR ($4<>'' AND number=$4)) DESC, created_at LIMIT 1`,
		workspaceID, clientID, note, number, issueDate, total).Scan(&d.ID, &d.Label, &d.Reason)
	return similar(d, err)
}

// ImportConflict is an existing record an import record cannot be created beside (an invoice number already used),
// and whether the person may overwrite it with the record (Why says why not, for the person).
type ImportConflict struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`
	Reason       string  `json:"reason"`
	CanOverwrite bool    `json:"can_overwrite"`
	Why          *string `json:"why_not"`
}

// NumberUse is the issued invoice of a workspace that carries a number, with what ties it down.
type NumberUse struct {
	ID, Origin, Status, ClientName, IssueDate string
	// Payments, Credits, Dunning, Transmissions: it has payments or refunds, a credit note or correction (also a
	// draft one), a dunning letter, an e-invoice transmission.
	Payments, Credits, Dunning, Transmissions bool
}

// invoiceSeriesKinds share the invoice numbers (invoices.Series); the unique constraint is per kind, so a number
// check for one of them covers all of them.
const invoiceSeriesKinds = `('invoice','partial','prepayment','debit_note','corrected')`

// InvoiceNumberUse: the workspace's invoice in the kind's number series with this number (the kind itself first), nil
// when the number is free.
func (q Q) InvoiceNumberUse(ctx context.Context, workspaceID, kind, number string) (*NumberUse, error) {
	var u NumberUse
	err := q.db.QueryRow(ctx, `SELECT i.id, i.origin, i.status, `+invoiceClientName+`, i.issue_date::text,
			i.amount_paid <> 0 OR EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id)
				OR EXISTS (SELECT 1 FROM invoice_refunds r WHERE r.invoice_id = i.id),
			EXISTS (SELECT 1 FROM invoices x WHERE x.credited_invoice_id = i.id),
			EXISTS (SELECT 1 FROM dunning_notices d WHERE d.invoice_id = i.id),
			EXISTS (SELECT 1 FROM einvoice_transmissions t WHERE t.invoice_id = i.id)
		FROM invoices i JOIN clients c ON c.id = i.client_id
		WHERE i.workspace_id = $1 AND i.number = $3
			AND (i.kind = $2 OR (i.kind IN `+invoiceSeriesKinds+` AND $2 IN `+invoiceSeriesKinds+`))
		ORDER BY i.kind = $2 DESC LIMIT 1`, workspaceID, kind, number).Scan(
		&u.ID, &u.Origin, &u.Status, &u.ClientName, &u.IssueDate, &u.Payments, &u.Credits, &u.Dunning, &u.Transmissions)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

// ErrNumberTaken: another invoice of the workspace and kind already has the number (the constraint is per kind;
// InvoiceNumberUse checks the whole series first).
var ErrNumberTaken = errors.New("invoice number taken")

// IssueImported records a saved draft as issued elsewhere: the document's own number (seq stays NULL, the counter is
// never touched), the snapshots, no payment reference and the Document holding the legal original.
func (q Q) IssueImported(ctx context.Context, inv Invoice, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices SET status = 'open', origin = 'imported', number = $2, seq = NULL, iban = $3,
		reference_type = 'NON', payment_reference = NULL, qr_bill = false, seller = $4, buyer = $5, source_document_id = $6,
		pdf_key = NULL, issued_at = $7, updated_at = $7, revolut_url = NULL, pay_qr_bill = false, pay_revolut = false
		WHERE id = $1 AND status = 'draft'`, inv.ID, inv.Number, inv.Payment.IBAN, inv.Seller, inv.Buyer, inv.SourceDocumentID, now)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" && pg.ConstraintName == "invoices_workspace_id_kind_number_key" {
		return ErrNumberTaken
	}
	return err
}

// ReopenImported turns an open invoice issued elsewhere back into a draft inside the caller's transaction, so an
// import can replace its data and lines and issue it again under the same id.
func (q Q) ReopenImported(ctx context.Context, workspaceID, id string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE invoices SET status = 'draft', number = NULL, seller = NULL, buyer = NULL,
		source_document_id = NULL, issued_at = NULL, updated_at = $3
		WHERE workspace_id = $1 AND id = $2 AND origin = 'imported' AND status = 'open'`, workspaceID, id, now)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}
