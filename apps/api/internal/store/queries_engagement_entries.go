package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"helvetly.com/api/internal/invoicecalc"
)

// The delivery log of an engagement. An entry's allocations retain each invoice and billed quantity.
type UserRef struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

type EngagementEntry struct {
	ID                string               `json:"id"`
	PeriodID          string               `json:"period_id"`
	Date              string               `json:"date"`
	Quantity          invoicecalc.Quantity `json:"quantity"`
	Note              *string              `json:"note"`
	ClientPerformance *string              `json:"client_performance"`
	// PerformanceOnInvoice adds ClientPerformance to the entry's own invoice line.
	PerformanceOnInvoice bool               `json:"client_performance_on_invoice"`
	PerformedBy          *UserRef           `json:"performed_by"`
	Invoice              *EngagementInvoice `json:"invoice"`
	CreatedAt            time.Time          `json:"created_at"`
	CreatedBy            *UserRef           `json:"created_by"`

	InvoicedQuantity   invoicecalc.Quantity `json:"invoiced_quantity"`
	HistoricalEstimate bool                 `json:"historical_estimate,omitempty"`
}

var entryColumns = `coalesce(a.covered, 0), coalesce(a.estimate, false), en.id, en.period_id, to_char(en.date, ` + dateFmt + `), en.quantity, en.note, en.client_performance, en.client_performance_on_invoice,
	pu.id, pu.name, ` + avatarOf("pu") + `, i.id, i.number, i.status, coalesce(ei.kind, 'usage'), en.created_at, cu.id, cu.name, ` + avatarOf("cu")

const entryFrom = ` FROM engagement_entries en
	LEFT JOIN users pu ON pu.id = en.performed_by
	LEFT JOIN users cu ON cu.id = en.created_by
	LEFT JOIN LATERAL (SELECT sum(x.quantity) AS covered, bool_or(x.historical_estimate) AS estimate,
		(array_agg(b.id ORDER BY b.created_at DESC, b.id DESC))[1] AS latest
		FROM engagement_entry_allocations x JOIN invoices b ON b.id = x.invoice_id
		WHERE x.entry_id = en.id AND b.status <> 'void') a ON true
	LEFT JOIN invoices i ON i.id = a.latest
	LEFT JOIN engagement_invoices ei ON ei.period_id = en.period_id AND ei.invoice_id = i.id`

func scanEntry(row interface{ Scan(...any) error }) (EngagementEntry, error) {
	var e EngagementEntry
	var pID, pName, pAvatar, cID, cName, cAvatar, invID, invNumber, invStatus, invKind *string
	err := row.Scan(&e.InvoicedQuantity, &e.HistoricalEstimate, &e.ID, &e.PeriodID, &e.Date, &e.Quantity, &e.Note, &e.ClientPerformance, &e.PerformanceOnInvoice, &pID, &pName, &pAvatar, &invID, &invNumber, &invStatus, &invKind,
		&e.CreatedAt, &cID, &cName, &cAvatar)
	if err != nil {
		return e, err
	}
	if pID != nil {
		e.PerformedBy = &UserRef{ID: *pID, Name: *pName, AvatarURL: deref(pAvatar)}
	}
	if cID != nil {
		e.CreatedBy = &UserRef{ID: *cID, Name: *cName, AvatarURL: deref(cAvatar)}
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
	_, err := q.db.Exec(ctx, `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, note, client_performance,
		client_performance_on_invoice, performed_by, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		e.ID, engagementID, e.PeriodID, e.Date, e.Quantity, e.Note, e.ClientPerformance, e.PerformanceOnInvoice, userID(e.PerformedBy), userID(e.CreatedBy), now)
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
	tag, err := q.db.Exec(ctx, `UPDATE engagement_entries SET period_id = $2, date = $3, quantity = $4, note = $5, performed_by = $6,
		client_performance = $7, client_performance_on_invoice = $8 WHERE id = $1`, e.ID, e.PeriodID, e.Date, e.Quantity, e.Note,
		userID(e.PerformedBy), e.ClientPerformance, e.PerformanceOnInvoice)
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
func (q Q) LinkEntries(ctx context.Context, entryIDs []string, quantities []invoicecalc.Quantity, invoiceID string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO engagement_entry_allocations (entry_id, quantity, invoice_id)
		SELECT id, qty, $3 FROM unnest($1::text[], $2::bigint[]) AS a(id, qty)`, entryIDs, quantities, invoiceID)
	return err
}

// LinkPeriodInvoice records that the invoice was made from the period; repeating it is harmless.
func (q Q) LinkPeriodInvoice(ctx context.Context, periodID, invoiceID, kind string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO engagement_invoices (period_id, invoice_id, kind, created_at) VALUES ($1, $2, $3, now())
		ON CONFLICT DO NOTHING`, periodID, invoiceID, kind)
	return err
}

// LinkableInvoice is what linking an invoice to an engagement needs to know of it.
type LinkableInvoice struct {
	ClientID, Status       string
	ServiceDate, IssueDate string
	Linked                 bool
}

// LinkableInvoice reads and locks an invoice of the workspace for linking, so two engagements cannot both take it;
// ErrNotFound when it is not one of its own.
func (q Q) LinkableInvoice(ctx context.Context, workspaceID, id string) (LinkableInvoice, error) {
	var v LinkableInvoice
	err := q.db.QueryRow(ctx, `SELECT i.client_id, i.status, coalesce(to_char(i.service_date, `+dateFmt+`), ''), to_char(i.issue_date, `+dateFmt+`),
		EXISTS (SELECT 1 FROM engagement_invoices ei WHERE ei.invoice_id = i.id)
		FROM invoices i WHERE i.id = $1 AND i.workspace_id = $2 FOR UPDATE OF i`, id, workspaceID).
		Scan(&v.ClientID, &v.Status, &v.ServiceDate, &v.IssueDate, &v.Linked)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	return v, err
}

// UnlinkPeriodInvoice removes the invoice's link to the engagement's periods. It refuses (false) when entries sit on
// the invoice: those links were made by invoicing the usage and belong to it. A missing link is ErrNotFound.
func (q Q) UnlinkPeriodInvoice(ctx context.Context, engagementID, invoiceID string) (bool, error) {
	var entries int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM engagement_entry_allocations a JOIN engagement_entries e ON e.id = a.entry_id WHERE e.engagement_id = $1 AND a.invoice_id = $2`,
		engagementID, invoiceID).Scan(&entries); err != nil || entries > 0 {
		return false, err
	}
	tag, err := q.db.Exec(ctx, `DELETE FROM engagement_invoices ei USING engagement_periods p
		WHERE ei.period_id = p.id AND p.engagement_id = $1 AND ei.invoice_id = $2`, engagementID, invoiceID)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err == nil, err
}

// EngagementOfInvoice names the engagement an invoice of the workspace is linked to, empty when none; ErrNotFound
// when the invoice is not one of the workspace's.
func (q Q) EngagementOfInvoice(ctx context.Context, workspaceID, invoiceID string) (id, title string, err error) {
	err = q.db.QueryRow(ctx, `SELECT coalesce(e.id, ''), coalesce(e.title, '') FROM invoices i
		LEFT JOIN engagement_invoices ei ON ei.invoice_id = i.id
		LEFT JOIN engagement_periods p ON p.id = ei.period_id
		LEFT JOIN engagements e ON e.id = p.engagement_id AND e.workspace_id = i.workspace_id
		WHERE i.id = $1 AND i.workspace_id = $2 ORDER BY e.id NULLS LAST LIMIT 1`, invoiceID, workspaceID).Scan(&id, &title)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return id, title, err
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
