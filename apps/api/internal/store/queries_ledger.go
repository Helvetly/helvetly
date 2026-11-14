package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/ledgercalc"
	"helvetly.com/api/internal/vatcalc"
)

// LedgerUnposted is a document the ledger cannot post, with why (docs/ledger-contract.md).
type LedgerUnposted struct{ Ref, Reason string }

func (q Q) LedgerAccounts(ctx context.Context, workspaceID string) (ledgercalc.Accounts, error) {
	var raw []byte
	err := q.db.QueryRow(ctx, `SELECT accounts FROM ledger_settings WHERE workspace_id = $1`, workspaceID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return ledgercalc.DefaultAccounts(), nil
	}
	if err != nil {
		return ledgercalc.Accounts{}, err
	}
	a := ledgercalc.DefaultAccounts()
	if err := json.Unmarshal(raw, &a); err != nil {
		return a, fmt.Errorf("ledger accounts: %w", err)
	}
	return a, nil
}

func (q Q) SaveLedgerAccounts(ctx context.Context, workspaceID, userID string, a ledgercalc.Accounts, now time.Time) error {
	raw, err := json.Marshal(a)
	if err != nil {
		return fmt.Errorf("ledger accounts: %w", err)
	}
	_, err = q.db.Exec(ctx, `INSERT INTO ledger_settings (workspace_id, accounts, updated_by, updated_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (workspace_id) DO UPDATE SET accounts = $2, updated_by = $3, updated_at = $4`, workspaceID, raw, userID, now)
	return err
}

// LedgerAccountNames maps each expense category's account code to a category name.
func (q Q) LedgerAccountNames(ctx context.Context, workspaceID string) (map[string]string, error) {
	rows, err := q.db.Query(ctx, `SELECT account_code, min(name) FROM expense_categories WHERE workspace_id = $1 GROUP BY account_code`, workspaceID)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for rows.Next() {
		var code, name string
		if err := rows.Scan(&code, &name); err != nil {
			rows.Close()
			return nil, err
		}
		names[code] = name
	}
	return names, rows.Err()
}

// ledgerInvoiceCols: id, ref, party, currency, breakdown and rounding of the `invoices i` joined to `clients c`;
// each branch of the query adds its own date and sign.
const ledgerInvoiceCols = `i.id, coalesce(i.number, i.id), coalesce(i.buyer->>'name', c.name, ''), i.currency, i.vat_breakdown, i.rounding_amount`

// LedgerSources gathers the signed documents, payments and booked expenses dated up to and including `to`.
func (q Q) LedgerSources(ctx context.Context, workspaceID, to string) (ledgercalc.Sources, []LedgerUnposted, error) {
	var src ledgercalc.Sources
	var unposted []LedgerUnposted
	rows, err := q.db.Query(ctx, `
		SELECT `+ledgerInvoiceCols+`, i.issue_date::text, CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END
		FROM invoices i JOIN clients c ON c.id = i.client_id
		WHERE i.workspace_id = $1 AND i.status <> 'draft' AND i.issue_date <= $2
			AND (i.kind IN `+receivableKinds+` OR (i.kind = 'credit_note' AND EXISTS (
				SELECT 1 FROM invoices o WHERE o.id = i.credited_invoice_id AND o.kind IN `+receivableKinds+`)))
		UNION ALL
		SELECT `+ledgerInvoiceCols+`, k.issue_date::text, -1
		FROM invoices k JOIN invoices i ON i.id = k.credited_invoice_id JOIN clients c ON c.id = i.client_id
		WHERE k.workspace_id = $1 AND k.kind = 'corrected' AND k.status <> 'draft' AND k.issue_date <= $2
		ORDER BY 4, 2, 3`, workspaceID, to)
	if err != nil {
		return src, nil, err
	}
	src.Invoices, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (ledgercalc.Invoice, error) {
		var d ledgercalc.Invoice
		var breakdown []byte
		if err := r.Scan(&d.ID, &d.Ref, &d.Party, &d.Currency, &breakdown, &d.Rounding, &d.Date, &d.Sign); err != nil {
			return d, err
		}
		if err := json.Unmarshal(breakdown, &d.Groups); err != nil {
			return d, fmt.Errorf("invoice %s breakdown: %w", d.Ref, err)
		}
		return d, nil
	})
	if err != nil {
		return src, nil, err
	}

	rows, err = q.db.Query(ctx, `SELECT i.id, coalesce(i.number, i.id), m.dt::text, m.method, i.currency, m.amount, m.refund
		FROM (SELECT invoice_id, paid_on AS dt, method, amount, false AS refund FROM invoice_payments
			UNION ALL SELECT invoice_id, refunded_on, method, amount, true FROM invoice_refunds) m
		JOIN invoices i ON i.id = m.invoice_id
		WHERE i.workspace_id = $1 AND i.kind IN `+receivableKinds+` AND m.dt <= $2
		ORDER BY m.dt, 2, m.refund`, workspaceID, to)
	if err != nil {
		return src, nil, err
	}
	src.Payments, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (p ledgercalc.Payment, err error) {
		err = r.Scan(&p.InvoiceID, &p.Ref, &p.Date, &p.Method, &p.Currency, &p.Amount, &p.Refund)
		return
	})
	if err != nil {
		return src, nil, err
	}

	rows, err = q.db.Query(ctx, `SELECT coalesce(number, id) FROM invoices WHERE workspace_id = $1 AND kind = 'self_billed'
		AND status <> 'draft' AND issue_date <= $2 ORDER BY 1`, workspaceID, to)
	if err != nil {
		return src, nil, err
	}
	refs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return src, nil, err
	}
	for _, ref := range refs {
		unposted = append(unposted, LedgerUnposted{ref, "self_billed"})
	}

	rows, err = q.db.Query(ctx, `SELECT e.id, e.number, coalesce(e.supplier_name, ''), COALESCE(e.document_date, e.booked_at::date)::text,
			e.base_currency, coalesce(c.account_code, ''), e.base_total, e.base_deductible_vat,
			COALESCE(e.input_tax_box, CASE WHEN c.account_code LIKE '4%' THEN '400' ELSE '405' END) = '400', coalesce(e.paid_on::text, ''), coalesce(e.payment_method, ''),
			e.paid_by IS NOT NULL, coalesce(e.reimbursed_on::text, ''), e.reverse_charge, e.base_net_total, e.deductible_percent
		FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
		WHERE e.workspace_id = $1 AND e.status = 'booked' AND e.deleted_at IS NULL
			AND LEAST(COALESCE(e.document_date, e.booked_at::date), e.paid_on, e.reimbursed_on) <= $2
		ORDER BY 4, e.number`, workspaceID, to)
	if err != nil {
		return src, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e ledgercalc.Expense
		var number int64
		var material *bool
		var net invoicecalc.Money
		var percent invoicecalc.Percent
		if err := rows.Scan(&e.ID, &number, &e.Party, &e.Date, &e.Currency, &e.Account, &e.Total, &e.Deductible, &material,
			&e.PaidOn, &e.Method, &e.PaidByMember, &e.ReimbursedOn, &e.ReverseCharge, &net, &percent); err != nil {
			return src, nil, err
		}
		e.Ref = strconv.FormatInt(number, 10)
		e.MaterialVAT = material != nil && *material
		// vatcalc keeps its 2024-01-01 cut-over unexported: before it, acquisition tax is at former rates and not in the return.
		if e.ReverseCharge && e.Date >= "2024-01-01" {
			e.AcquisitionTax = invoicecalc.Share(net, vatcalc.AcquisitionRate)
			e.AcquisitionDeductible = invoicecalc.Share(e.AcquisitionTax, percent)
		} else {
			e.ReverseCharge = false
		}
		if e.Account == "" {
			unposted = append(unposted, LedgerUnposted{e.Ref, "no_category"})
			continue
		}
		src.Expenses = append(src.Expenses, e)
	}
	return src, unposted, rows.Err()
}
