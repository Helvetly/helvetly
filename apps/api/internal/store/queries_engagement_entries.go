package store

import (
	"context"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

// The delivery log of an engagement (docs/engagements-contract.md). An entry is covered by an invoice through
// invoice_id; a void invoice is ignored when reading, so it releases its entries.

type UserRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type EngagementEntry struct {
	ID          string               `json:"id"`
	PeriodID    string               `json:"period_id"`
	Date        string               `json:"date"`
	Quantity    invoicecalc.Quantity `json:"quantity"`
	Note        *string              `json:"note"`
	PerformedBy *UserRef             `json:"performed_by"`
	Invoice     *EngagementInvoice   `json:"invoice"`
	CreatedAt   time.Time            `json:"created_at"`
	CreatedBy   *UserRef             `json:"created_by"`
}

const entryColumns = `en.id, en.period_id, to_char(en.date, ` + dateFmt + `), en.quantity, en.note,
	pu.id, pu.name, i.id, i.number, i.status, coalesce(ei.kind, 'usage'), en.created_at, cu.id, cu.name`

const entryFrom = ` FROM engagement_entries en
	LEFT JOIN users pu ON pu.id = en.performed_by
	LEFT JOIN users cu ON cu.id = en.created_by
	LEFT JOIN invoices i ON i.id = en.invoice_id AND i.status <> 'void'
	LEFT JOIN engagement_invoices ei ON ei.period_id = en.period_id AND ei.invoice_id = i.id`

func scanEntry(row interface{ Scan(...any) error }) (EngagementEntry, error) {
	var e EngagementEntry
	var pID, pName, cID, cName, invID, invNumber, invStatus, invKind *string
	err := row.Scan(&e.ID, &e.PeriodID, &e.Date, &e.Quantity, &e.Note, &pID, &pName, &invID, &invNumber, &invStatus, &invKind,
		&e.CreatedAt, &cID, &cName)
	if err != nil {
		return e, err
	}
	if pID != nil {
		e.PerformedBy = &UserRef{ID: *pID, Name: *pName}
	}
	if cID != nil {
		e.CreatedBy = &UserRef{ID: *cID, Name: *cName}
	}
	if invID != nil {
		e.Invoice = &EngagementInvoice{ID: *invID, Number: invNumber, Status: *invStatus, Kind: *invKind}
	}
	return e, nil
}

func userID(u *UserRef) *string {
	if u == nil {
		return nil
	}
	return &u.ID
}

// CreateEntry inserts e (uninvoiced) into the engagement; CreatedAt is set on the stored row.
func (q Q) CreateEntry(ctx context.Context, engagementID string, e EngagementEntry, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, note, performed_by,
		created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		e.ID, engagementID, e.PeriodID, e.Date, e.Quantity, e.Note, userID(e.PerformedBy), userID(e.CreatedBy), now)
	return err
}

// Entry returns one entry of the engagement (ErrNotFound otherwise); forUpdate locks the row.
func (q Q) Entry(ctx context.Context, engagementID, id string, forUpdate bool) (EngagementEntry, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF en"
	}
	return scanEntry(q.db.QueryRow(ctx, `SELECT `+entryColumns+entryFrom+` WHERE en.engagement_id = $1 AND en.id = $2`+lock,
		engagementID, id))
}

// SaveEntry writes the editable fields of an entry.
func (q Q) SaveEntry(ctx context.Context, e EngagementEntry) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagement_entries SET period_id = $2, date = $3, quantity = $4, note = $5, performed_by = $6
		WHERE id = $1`, e.ID, e.PeriodID, e.Date, e.Quantity, e.Note, userID(e.PerformedBy))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (q Q) DeleteEntry(ctx context.Context, id string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM engagement_entries WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Entries lists the engagement's entries (one period's when periodID is set), newest date first, then newest created.
func (q Q) Entries(ctx context.Context, engagementID, periodID string) ([]EngagementEntry, error) {
	rows, err := q.db.Query(ctx, `SELECT `+entryColumns+entryFrom+` WHERE en.engagement_id = $1 AND ($2 = '' OR en.period_id = $2)
		ORDER BY en.date DESC, en.created_at DESC, en.id DESC`, engagementID, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []EngagementEntry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

// LinkEntries points the entries at the invoice that covers them.
func (q Q) LinkEntries(ctx context.Context, entryIDs []string, invoiceID string) error {
	_, err := q.db.Exec(ctx, `UPDATE engagement_entries SET invoice_id = $2 WHERE id = ANY($1)`, entryIDs, invoiceID)
	return err
}

// LinkPeriodInvoice records that the invoice was made from the period; repeating it is harmless.
func (q Q) LinkPeriodInvoice(ctx context.Context, periodID, invoiceID, kind string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO engagement_invoices (period_id, invoice_id, kind, created_at) VALUES ($1, $2, $3, now())
		ON CONFLICT DO NOTHING`, periodID, invoiceID, kind)
	return err
}

// PeriodInvoices lists the period's non-void invoices, oldest link first.
func (q Q) PeriodInvoices(ctx context.Context, periodID string) ([]EngagementInvoice, error) {
	rows, err := q.db.Query(ctx, `SELECT i.id, i.number, i.status, ei.kind FROM engagement_invoices ei
		JOIN invoices i ON i.id = ei.invoice_id WHERE ei.period_id = $1 AND i.status <> 'void'
		ORDER BY ei.created_at, i.id`, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []EngagementInvoice{}
	for rows.Next() {
		var v EngagementInvoice
		if err := rows.Scan(&v.ID, &v.Number, &v.Status, &v.Kind); err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, rows.Err()
}

// LatestEntryDate is the newest entry date of the engagement, "" without entries.
func (q Q) LatestEntryDate(ctx context.Context, engagementID string) (string, error) {
	var d *string
	err := q.db.QueryRow(ctx, `SELECT to_char(max(date), `+dateFmt+`) FROM engagement_entries WHERE engagement_id = $1`,
		engagementID).Scan(&d)
	if d == nil {
		return "", err
	}
	return *d, err
}
