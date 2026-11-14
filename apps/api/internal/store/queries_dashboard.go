package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// DashboardMovement is a day's recorded cash, in one original transaction currency.
// Credit notes change receivables; only an actual refund moves cash out of income.
type DashboardMovement struct {
	Date             string
	Income, Expenses Money
}

func (q Q) DashboardMovements(ctx context.Context, workspaceID, currency, from, today string, invoices, expenses bool) ([]DashboardMovement, error) {
	rows, err := q.db.Query(ctx, `SELECT to_char(day,'YYYY-MM-DD'), sum(income),sum(expenses) FROM (
		SELECT p.paid_on AS day,p.amount AS income,0::bigint AS expenses FROM invoice_payments p
		JOIN invoices i ON i.id=p.invoice_id WHERE $5 AND i.workspace_id=$1 AND i.currency=$2 AND i.kind IN `+receivableKinds+`
		AND p.paid_on BETWEEN $3::date AND $4::date
		UNION ALL SELECT r.refunded_on,-r.amount,0::bigint FROM invoice_refunds r
		JOIN invoices i ON i.id=r.invoice_id WHERE $5 AND i.workspace_id=$1 AND i.currency=$2 AND i.kind IN `+receivableKinds+`
		AND r.refunded_on BETWEEN $3::date AND $4::date
		UNION ALL SELECT e.paid_on,0::bigint,e.total FROM expenses e
		WHERE $6 AND e.workspace_id=$1 AND e.currency=$2 AND e.status='booked' AND e.deleted_at IS NULL
		AND e.payment_status='paid' AND e.paid_on BETWEEN $3::date AND $4::date
	) movement GROUP BY day ORDER BY day`, workspaceID, currency, from, today, invoices, expenses)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DashboardMovement, error) {
		var m DashboardMovement
		err := r.Scan(&m.Date, &m.Income, &m.Expenses)
		return m, err
	})
}

func (q Q) DashboardCurrencies(ctx context.Context, workspaceID string, invoices, expenses bool) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT currency FROM (
		SELECT currency FROM invoices WHERE $2 AND workspace_id=$1 AND status<>'replaced' AND kind IN `+receivableKinds+`
		UNION SELECT currency FROM expenses WHERE $3 AND workspace_id=$1 AND deleted_at IS NULL AND status<>'void'
	) currencies ORDER BY currency`, workspaceID, invoices, expenses)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type DashboardExpenseMetrics struct {
	Spent, DeductibleVAT Money
	Pending, Count       int
	ReceiptsMatched      float64
}

// DashboardExpenseSummary keeps cash spent separate from booked deductible VAT.
func (q Q) DashboardExpenseSummary(ctx context.Context, workspaceID, currency, today string) (DashboardExpenseMetrics, error) {
	var m DashboardExpenseMetrics
	err := q.db.QueryRow(ctx, `SELECT
		coalesce(sum(e.total) FILTER(WHERE e.status='booked' AND e.payment_status='paid'
		AND e.paid_on>=date_trunc('month',$3::date) AND e.paid_on<=$3::date),0),
		coalesce(sum(e.deductible_vat) FILTER(WHERE e.status='booked'
		AND e.document_date>=date_trunc('month',$3::date) AND e.document_date<=$3::date),0),
		count(*) FILTER(WHERE e.status='draft'),count(*),
		CASE WHEN count(*) FILTER(WHERE e.status='booked')=0 THEN 0 ELSE
		count(*) FILTER(WHERE e.status='booked' AND EXISTS(SELECT 1 FROM expense_receipts r WHERE r.expense_id=e.id))::float8
		/count(*) FILTER(WHERE e.status='booked') END
		FROM expenses e WHERE e.workspace_id=$1 AND e.currency=$2 AND e.deleted_at IS NULL AND e.status<>'void'`,
		workspaceID, currency, today).Scan(&m.Spent, &m.DeductibleVAT, &m.Pending, &m.Count, &m.ReceiptsMatched)
	return m, err
}

func (q Q) DashboardInvoiceCount(ctx context.Context, workspaceID, currency string) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE workspace_id=$1 AND currency=$2
		AND status<>'replaced' AND kind IN `+receivableKinds, workspaceID, currency).Scan(&n)
	return n, err
}

type DashboardMonth struct {
	Month            string
	Outstanding, VAT Money
}

// Outstanding is today's balance grouped by issue month, not a reconstructed historical balance.
func (q Q) DashboardMonths(ctx context.Context, workspaceID, currency, today string, invoices, expenses bool) ([]DashboardMonth, error) {
	rows, err := q.db.Query(ctx, `SELECT to_char(m,'YYYY-MM'),
		coalesce((SELECT sum(`+amountDue+`) FROM invoices i WHERE $4 AND i.workspace_id=$1 AND i.currency=$2
		AND i.kind IN `+receivableKinds+` AND i.status='open' AND date_trunc('month',i.issue_date)=m),0),
		coalesce((SELECT sum(e.deductible_vat) FROM expenses e WHERE $5 AND e.workspace_id=$1 AND e.currency=$2
		AND e.status='booked' AND e.deleted_at IS NULL AND e.document_date<=$3::date AND date_trunc('month',e.document_date)=m),0)
		FROM generate_series(date_trunc('month',$3::date)-interval '11 months',date_trunc('month',$3::date),interval '1 month') m ORDER BY m`,
		workspaceID, currency, today, invoices, expenses)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DashboardMonth, error) {
		var m DashboardMonth
		err := r.Scan(&m.Month, &m.Outstanding, &m.VAT)
		return m, err
	})
}

// DashboardRead makes multiple dashboard queries observe one database snapshot.
func (s *Store) DashboardRead(ctx context.Context, fn func(Q) error) error {
	return s.Tx(ctx, func(q Q) error {
		if _, err := q.db.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); err != nil {
			return err
		}
		return fn(q)
	})
}
