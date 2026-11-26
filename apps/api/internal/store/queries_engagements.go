package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

// Engagements and their periods (docs/engagements-contract.md). Dates are civil "YYYY-MM-DD" strings.
// The derived fields (status, current_period, attention) are the service's job.

type EngagementClient struct {
	ID     string `json:"id"`
	Number int64  `json:"number"`
	Name   string `json:"name"`
}

type Engagement struct {
	ID               string               `json:"id"`
	Number           int64                `json:"number"`
	ClientID         string               `json:"-"`
	Client           EngagementClient     `json:"client"`
	Title            string               `json:"title"`
	Description      *string              `json:"description"`
	ProductID        *string              `json:"product_id"`
	Unit             *string              `json:"unit"`
	Quantity         invoicecalc.Quantity `json:"quantity"`
	Billing          string               `json:"billing"`
	PriceBasis       string               `json:"price_basis"`
	UnitPrice        invoicecalc.Money    `json:"unit_price"`
	OverageUnitPrice *invoicecalc.Money   `json:"overage_unit_price"`
	Currency         string               `json:"currency"`
	VATCategory      string               `json:"vat_category"`
	VATRate          invoicecalc.Percent  `json:"vat_rate"`
	StartDate        string               `json:"start_date"`
	Recurrence       string               `json:"recurrence"`
	Interval         int                  `json:"interval"`
	EndDate          *string              `json:"end_date"`
	Reference        *string              `json:"reference"`
	DocumentID       *string              `json:"document_id"`
	CancelledOn      *string              `json:"cancelled_on"`
	Rollover         bool                 `json:"rollover"`
	AutoInvoice      bool                 `json:"auto_invoice"`
	InvoiceDetail    string               `json:"invoice_detail"`
	CreatedAt        time.Time            `json:"created_at"`
	UpdatedAt        time.Time            `json:"updated_at"`
}

// EngagementInvoice: an invoice made from a period (never a void one).
type EngagementInvoice struct {
	ID     string  `json:"id"`
	Number *string `json:"number"`
	Status string  `json:"status"`
	Kind   string  `json:"kind"`
}

type EngagementPeriod struct {
	ID               string               `json:"id"`
	EngagementID     string               `json:"-"`
	Index            int                  `json:"index"`
	StartsOn         string               `json:"starts_on"`
	EndsOn           string               `json:"ends_on"`
	NaturalEndsOn    string               `json:"natural_ends_on"`
	FullQuantity     invoicecalc.Quantity `json:"full_quantity"`
	QuantityManual   bool                 `json:"quantity_manual"`
	Quantity         invoicecalc.Quantity `json:"quantity"`
	UnitPrice        invoicecalc.Money    `json:"unit_price"`
	OverageUnitPrice invoicecalc.Money    `json:"overage_unit_price"`
	Used             invoicecalc.Quantity `json:"used"`
	InvoicedQuantity invoicecalc.Quantity `json:"invoiced_quantity"`
	AdvanceInvoice   *EngagementInvoice   `json:"advance_invoice"`
}

// EngagementFilter: Statuses are scheduled/active/ended/cancelled, judged on the stored dates against Today.
type EngagementFilter struct {
	Q, ClientID string
	Statuses    []string
	Today       string
	Limit       int // zero: no limit
	Offset      int
	Sort        string // "", "-created_at", "[-]title" or "[-]client"; "" keeps newest number first
}

var engagementOrder = map[string]string{
	"":            "",
	"-created_at": "e.created_at DESC, ",
	"title":       `lower(e.title) COLLATE "C", `,
	"client":      `lower(c.name) COLLATE "C", `,
	"-title":      `lower(e.title) COLLATE "C" DESC, `,
	"-client":     `lower(c.name) COLLATE "C" DESC, `,
}

const dateFmt = `'YYYY-MM-DD'`

const engagementColumns = `e.id, e.number, e.client_id, c.number, c.name, e.title, e.description, e.product_id, e.unit,
	e.quantity, e.billing, e.price_basis, e.unit_price, e.overage_unit_price, e.currency, e.vat_category, e.vat_rate,
	to_char(e.start_date, ` + dateFmt + `), e.recurrence, e.interval, to_char(e.end_date, ` + dateFmt + `), e.reference,
	e.document_id, to_char(e.cancelled_on, ` + dateFmt + `), e.created_at, e.updated_at, e.rollover, e.auto_invoice, e.invoice_detail`

const engagementFrom = ` FROM engagements e JOIN clients c ON c.id = e.client_id`

func scanEngagement(row interface{ Scan(...any) error }) (Engagement, error) {
	var e Engagement
	err := row.Scan(&e.ID, &e.Number, &e.ClientID, &e.Client.Number, &e.Client.Name, &e.Title, &e.Description, &e.ProductID,
		&e.Unit, &e.Quantity, &e.Billing, &e.PriceBasis, &e.UnitPrice, &e.OverageUnitPrice, &e.Currency, &e.VATCategory,
		&e.VATRate, &e.StartDate, &e.Recurrence, &e.Interval, &e.EndDate, &e.Reference, &e.DocumentID, &e.CancelledOn,
		&e.CreatedAt, &e.UpdatedAt, &e.Rollover, &e.AutoInvoice, &e.InvoiceDetail)
	e.Client.ID = e.ClientID
	return e, err
}

// CreateEngagement inserts e with the workspace's next number (set on e); the counter moves in the same statement.
func (q Q) createEngagement(ctx context.Context, workspaceID string, e *Engagement, now time.Time) error {
	err := q.db.QueryRow(ctx, `WITH seq AS (
			INSERT INTO workspace_counters (workspace_id, engagements_seq) VALUES ($2, 1)
			ON CONFLICT (workspace_id) DO UPDATE SET engagements_seq = workspace_counters.engagements_seq + 1
			RETURNING engagements_seq)
		INSERT INTO engagements (id, workspace_id, number, client_id, title, description, product_id, unit, quantity, billing,
			price_basis, unit_price, overage_unit_price, currency, vat_category, vat_rate, start_date, recurrence, interval,
			end_date, reference, document_id, cancelled_on, rollover, auto_invoice, invoice_detail, created_at, updated_at)
		SELECT $1, $2, seq.engagements_seq, `+placeholders(3, 20)+`, $23, $24, coalesce(nullif($25, ''), 'summary'), $26, $26 FROM seq RETURNING number`,
		e.ID, workspaceID, e.ClientID, e.Title, e.Description, e.ProductID, e.Unit, e.Quantity, e.Billing, e.PriceBasis,
		e.UnitPrice, e.OverageUnitPrice, e.Currency, e.VATCategory, e.VATRate, e.StartDate, e.Recurrence, e.Interval, e.EndDate,
		e.Reference, e.DocumentID, e.CancelledOn, e.Rollover, e.AutoInvoice, e.InvoiceDetail, now).Scan(&e.Number)
	if err != nil {
		return err
	}
	e.CreatedAt, e.UpdatedAt = now, now
	return nil
}

// Engagement returns a live engagement of the workspace (ErrNotFound otherwise); forUpdate locks the row.
func (q Q) Engagement(ctx context.Context, workspaceID, id string, forUpdate bool) (Engagement, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF e"
	}
	return scanEngagement(q.db.QueryRow(ctx, `SELECT `+engagementColumns+engagementFrom+
		` WHERE e.workspace_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`+lock, workspaceID, id))
}

// SaveEngagement writes every editable field of a live engagement.
func (q Q) saveEngagement(ctx context.Context, workspaceID string, e Engagement, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagements SET title = $3, description = $4, product_id = $5, unit = $6, quantity = $7,
		billing = $8, price_basis = $9, unit_price = $10, overage_unit_price = $11, currency = $12, vat_category = $13,
		vat_rate = $14, start_date = $15, recurrence = $16, interval = $17, end_date = $18, reference = $19, document_id = $20,
		cancelled_on = $21, rollover = $23, auto_invoice = $24, invoice_detail = $25, updated_at = $22 WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
		workspaceID, e.ID, e.Title, e.Description, e.ProductID, e.Unit, e.Quantity, e.Billing, e.PriceBasis, e.UnitPrice,
		e.OverageUnitPrice, e.Currency, e.VATCategory, e.VATRate, e.StartDate, e.Recurrence, e.Interval, e.EndDate, e.Reference,
		e.DocumentID, e.CancelledOn, now, e.Rollover, e.AutoInvoice, e.InvoiceDetail)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteEngagement soft-deletes a live engagement.
func (q Q) DeleteEngagement(ctx context.Context, workspaceID, id string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagements SET deleted_at = $3, updated_at = $3
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`, workspaceID, id, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListEngagements returns the live engagements matching f in f.Sort order, then newest number first.
func (q Q) ListEngagements(ctx context.Context, workspaceID string, f EngagementFilter) ([]Engagement, error) {
	where, args := engagementWhere(workspaceID, f)
	order, ok := engagementOrder[f.Sort]
	if !ok {
		return nil, fmt.Errorf("engagement sort %q", f.Sort)
	}
	page := ""
	if f.Limit > 0 {
		page = " LIMIT " + strconv.Itoa(f.Limit)
	}
	if f.Offset > 0 {
		page += " OFFSET " + strconv.Itoa(f.Offset)
	}
	rows, err := q.db.Query(ctx, `SELECT `+engagementColumns+engagementFrom+where+` ORDER BY `+order+`e.number DESC`+page, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Engagement{}
	for rows.Next() {
		e, err := scanEngagement(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

// CountEngagements counts what ListEngagements would return without Limit and Offset.
func (q Q) CountEngagements(ctx context.Context, workspaceID string, f EngagementFilter) (n int, err error) {
	where, args := engagementWhere(workspaceID, f)
	err = q.db.QueryRow(ctx, `SELECT count(*)`+engagementFrom+where, args...).Scan(&n)
	return n, err
}

func engagementWhere(workspaceID string, f EngagementFilter) (string, []any) {
	args := []any{workspaceID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	conds := []string{"e.workspace_id = $1", "e.deleted_at IS NULL"}
	if term := strings.TrimSpace(f.Q); term != "" {
		p := arg(likePattern(term))
		conds = append(conds, "(e.title ILIKE "+p+" OR c.name ILIKE "+p+" OR e.reference ILIKE "+p+")")
	}
	if f.ClientID != "" {
		conds = append(conds, "e.client_id = "+arg(f.ClientID))
	}
	if len(f.Statuses) > 0 {
		today := arg(f.Today)
		// both dates past: whichever came first
		cancelled := "(e.cancelled_on IS NOT NULL AND e.cancelled_on < " + today + "::date AND (e.end_date IS NULL OR e.end_date >= " + today +
			"::date OR e.cancelled_on <= e.end_date))"
		states := map[string]string{
			"cancelled": cancelled,
			"ended":     "(NOT " + cancelled + " AND e.end_date IS NOT NULL AND e.end_date < " + today + "::date)",
			"scheduled": "(e.start_date > " + today + "::date)",
			"active": "(e.start_date <= " + today + "::date AND NOT " + cancelled + " AND (e.end_date IS NULL OR e.end_date >= " +
				today + "::date))",
		}
		var parts []string
		for _, s := range f.Statuses {
			if c, ok := states[s]; ok {
				parts = append(parts, c)
			}
		}
		if len(parts) == 0 {
			parts = []string{"false"}
		}
		conds = append(conds, "("+strings.Join(parts, " OR ")+")")
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// EngagementPeriods lists the periods of an engagement, newest first, with what was used (Σ entries, 0 without),
// what non-void invoices cover and the non-void advance invoice. Callers check the engagement's workspace first.
func (q Q) EngagementPeriods(ctx context.Context, engagementID string) ([]EngagementPeriod, error) {
	byID, err := q.EngagementPeriodsOf(ctx, []string{engagementID})
	if list := byID[engagementID]; list != nil || err != nil {
		return list, err
	}
	return []EngagementPeriod{}, nil
}

// EngagementPeriodsOf is EngagementPeriods for many engagements in one query, keyed by engagement id.
func (q Q) EngagementPeriodsOf(ctx context.Context, engagementIDs []string) (map[string][]EngagementPeriod, error) {
	rows, err := q.db.Query(ctx, `SELECT p.id, p.engagement_id, p.idx, to_char(p.starts_on, `+dateFmt+`),
		to_char(p.ends_on, `+dateFmt+`), to_char(p.natural_ends_on, `+dateFmt+`), p.full_quantity, p.quantity_manual, p.quantity, p.unit_price, p.overage_unit_price,
		coalesce((SELECT sum(en.quantity) FROM engagement_entries en WHERE en.period_id = p.id), 0),
		coalesce((SELECT sum(a.quantity) FROM engagement_entries en JOIN engagement_entry_allocations a ON a.entry_id = en.id JOIN invoices i ON i.id = a.invoice_id
			WHERE en.period_id = p.id AND i.status <> 'void'), 0),
		a.id, a.number, a.status, a.kind
		FROM engagement_periods p
		LEFT JOIN LATERAL (SELECT i.id, i.number, i.status, ei.kind FROM engagement_invoices ei
			JOIN invoices i ON i.id = ei.invoice_id
			WHERE ei.period_id = p.id AND ei.kind = 'advance' AND i.status <> 'void'
			ORDER BY ei.created_at LIMIT 1) a ON true
		WHERE p.engagement_id = ANY($1) ORDER BY p.idx DESC`, engagementIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := map[string][]EngagementPeriod{}
	for rows.Next() {
		var p EngagementPeriod
		var id, status, kind *string
		var number *string
		if err := rows.Scan(&p.ID, &p.EngagementID, &p.Index, &p.StartsOn, &p.EndsOn, &p.NaturalEndsOn, &p.FullQuantity, &p.QuantityManual, &p.Quantity, &p.UnitPrice,
			&p.OverageUnitPrice, &p.Used, &p.InvoicedQuantity, &id, &number, &status, &kind); err != nil {
			return nil, err
		}
		if id != nil {
			p.AdvanceInvoice = &EngagementInvoice{ID: *id, Number: number, Status: *status, Kind: *kind}
		}
		byID[p.EngagementID] = append(byID[p.EngagementID], p)
	}
	return byID, rows.Err()
}

// InsertPeriod adds a period unless (engagement, index) exists; false when it did, so opening periods is idempotent.
func (q Q) InsertPeriod(ctx context.Context, p EngagementPeriod) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO engagement_periods (id, engagement_id, idx, starts_on, ends_on, quantity, unit_price,
		overage_unit_price, natural_ends_on, full_quantity, quantity_manual)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce(nullif($9, '')::date, $5::date), coalesce(nullif($10::bigint, 0), $6), $11)
		ON CONFLICT (engagement_id, idx) DO NOTHING`,
		p.ID, p.EngagementID, p.Index, p.StartsOn, p.EndsOn, p.Quantity, p.UnitPrice, p.OverageUnitPrice,
		p.NaturalEndsOn, p.FullQuantity, p.QuantityManual)
	return tag.RowsAffected() == 1, err
}

func (q Q) SetPeriodQuantity(ctx context.Context, periodID string, quantity invoicecalc.Quantity) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagement_periods SET quantity = $2, quantity_manual = true WHERE id = $1`, periodID, quantity)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (q Q) SetPeriodPrices(ctx context.Context, periodID string, unitPrice, overageUnitPrice invoicecalc.Money) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagement_periods SET unit_price = $2, overage_unit_price = $3 WHERE id = $1`,
		periodID, unitPrice, overageUnitPrice)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (q Q) SetPeriodEnd(ctx context.Context, periodID, endsOn string) error {
	_, err := q.db.Exec(ctx, `UPDATE engagement_periods SET ends_on = $2 WHERE id = $1`, periodID, endsOn)
	return err
}

// DeletePeriods drops every period of an engagement (with its entries and links, which cascade); the caller
// checked that none has entries or invoices.
func (q Q) DeletePeriods(ctx context.Context, engagementID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM engagement_periods WHERE engagement_id = $1`, engagementID)
	return err
}

// CutPeriods ends the periods at lastDay: those starting on or before it end no later, and later periods (never the
// first) vanish unless they hold entries or an invoice.
func (q Q) CutPeriods(ctx context.Context, engagementID, lastDay string) error {
	if _, err := q.db.Exec(ctx, `UPDATE engagement_periods SET ends_on = least(ends_on, $2::date)
		WHERE engagement_id = $1 AND starts_on <= $2::date`, engagementID, lastDay); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `DELETE FROM engagement_periods p WHERE p.engagement_id = $1 AND p.idx > 1 AND p.starts_on > $2::date
		AND NOT EXISTS (SELECT 1 FROM engagement_entries en WHERE en.period_id = p.id)
		AND NOT EXISTS (SELECT 1 FROM engagement_invoices ei WHERE ei.period_id = p.id)`, engagementID, lastDay)
	return err
}
