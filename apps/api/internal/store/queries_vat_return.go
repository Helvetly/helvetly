package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/ledgercalc"
	"helvetly.com/api/internal/vatcalc"
)

// VATReturnSettings: how a workspace settles VAT with the ESTV (docs/vat-return-contract.md).
type VATReturnSettings struct {
	Method   string            `json:"method"`
	Period   string            `json:"period"`
	Basis    string            `json:"basis"`
	NetRates []vatcalc.NetRate `json:"net_rates"`
}

// DefaultVATReturnSettings: the effective method, quarterly, on agreed consideration (MWSTG art. 35, 39 and 40).
var DefaultVATReturnSettings = VATReturnSettings{Method: vatcalc.Effective, Period: "quarterly", Basis: "agreed", NetRates: []vatcalc.NetRate{}}

func (q Q) VATReturnSettings(ctx context.Context, workspaceID string) (VATReturnSettings, error) {
	s := VATReturnSettings{}
	var rates []byte
	err := q.db.QueryRow(ctx, `SELECT method, period, basis, net_rates FROM vat_return_settings WHERE workspace_id = $1`,
		workspaceID).Scan(&s.Method, &s.Period, &s.Basis, &rates)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultVATReturnSettings, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(rates, &s.NetRates); err != nil {
		return s, fmt.Errorf("vat return net rates: %w", err)
	}
	return s, nil
}

func (q Q) SaveVATReturnSettings(ctx context.Context, workspaceID, userID string, s VATReturnSettings, now time.Time) error {
	rates, err := json.Marshal(s.NetRates)
	if err != nil {
		return fmt.Errorf("vat return net rates: %w", err)
	}
	_, err = q.db.Exec(ctx, `INSERT INTO vat_return_settings (workspace_id, method, period, basis, net_rates, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workspace_id) DO UPDATE SET method = $2, period = $3, basis = $4,
		net_rates = $5, updated_by = $6, updated_at = $7`, workspaceID, s.Method, s.Period, s.Basis, rates, userID, now)
	return err
}

// VATDocument is a document's VAT groups as the return reads them, in its own currency and signed.
type VATDocument struct {
	Ref        string
	Currency   string
	SupplyDate string
	Groups     []invoicecalc.Group
}

// supplyDate: the date of supply is the end of the service period, else the service date, else the issue date.
const supplyDate = `COALESCE(i.service_date_end, i.service_date, i.issue_date)::text`

// VATSales: the sales documents of [from, to) on agreed consideration, dated by issue (MWSTG art. 40 para. 1 a).
// Credit notes on receivables are negative; a correction counts in full and takes its replaced original back out.
func (q Q) VATSales(ctx context.Context, workspaceID, from, to string) ([]VATDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT coalesce(i.number, i.id), i.currency, `+supplyDate+`, i.vat_breakdown,
			CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END, 1
		FROM invoices i WHERE i.workspace_id = $1 AND i.status <> 'draft' AND i.issue_date >= $2 AND i.issue_date < $3
			AND (i.kind IN `+receivableKinds+` OR (i.kind = 'credit_note' AND EXISTS (
				SELECT 1 FROM invoices original WHERE original.id = i.credited_invoice_id AND original.kind IN `+receivableKinds+`)))
		UNION ALL
		SELECT coalesce(i.number, i.id), i.currency, `+supplyDate+`, i.vat_breakdown, -1, 1
		FROM invoices c JOIN invoices i ON i.id = c.credited_invoice_id
		WHERE c.workspace_id = $1 AND c.kind = 'corrected' AND c.status <> 'draft' AND c.issue_date >= $2 AND c.issue_date < $3
		ORDER BY 1`, workspaceID, from, to)
	return collectVATDocuments(rows, err)
}

// VATReceipts allocates payments and refunds to the VAT groups still outstanding on their date.
// Previous receipts of the same invoices carry both the rounding and any amounts reported before a credit note.
func (q Q) VATReceipts(ctx context.Context, workspaceID, from, to string) ([]VATDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT i.id, coalesce(i.number, i.id), i.currency, `+supplyDate+`, i.vat_breakdown,
			i.total + i.rounding_amount, m.amount, m.moved_on >= $2, coalesce(c.latest::text, ''),
			coalesce(c.breakdowns, '[]'::json), coalesce(c.credited, 0)
		FROM invoices i
		CROSS JOIN LATERAL (SELECT 1 FROM (
			SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id AND p.paid_on >= $2 AND p.paid_on < $3
			UNION ALL SELECT 1 FROM invoice_refunds f WHERE f.invoice_id = i.id AND f.refunded_on >= $2 AND f.refunded_on < $3
		) activity LIMIT 1) active
		CROSS JOIN LATERAL (
			SELECT id, amount, paid_on AS moved_on, created_at FROM invoice_payments WHERE invoice_id = i.id AND paid_on < $3
			UNION ALL SELECT id, -amount, refunded_on, created_at FROM invoice_refunds WHERE invoice_id = i.id AND refunded_on < $3
		) m
		LEFT JOIN LATERAL (SELECT max(n.issue_date) AS latest, json_agg(n.vat_breakdown) AS breakdowns, sum(n.total + n.rounding_amount) AS credited
			FROM invoices n WHERE n.credited_invoice_id = i.id AND n.kind = 'credit_note' AND n.status <> 'draft' AND n.issue_date <= m.moved_on) c ON true
		WHERE i.workspace_id = $1 AND i.kind IN `+receivableKinds+`
		ORDER BY i.id, m.moved_on, m.created_at, m.id`, workspaceID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []VATDocument
	var state receiptAllocation
	for rows.Next() {
		var d VATDocument
		var id, latest string
		var breakdown, credits []byte
		var payable, amount, credited invoicecalc.Money
		var inPeriod bool
		if err := rows.Scan(&id, &d.Ref, &d.Currency, &d.SupplyDate, &breakdown, &payable, &amount, &inPeriod, &latest, &credits, &credited); err != nil {
			return nil, err
		}
		if state.invoice != id {
			state = receiptAllocation{invoice: id}
		}
		refund := amount < 0
		if state.basis == nil || state.creditDate != latest || state.refund != refund {
			var groups []invoicecalc.Group
			if err := json.Unmarshal(breakdown, &groups); err != nil {
				return nil, fmt.Errorf("invoice %s breakdown: %w", d.Ref, err)
			}
			var notes [][]invoicecalc.Group
			if err := json.Unmarshal(credits, &notes); err != nil {
				return nil, fmt.Errorf("invoice %s credit notes: %w", d.Ref, err)
			}
			state.creditDate, state.refund = latest, refund
			state.balance = payable - credited - state.received
			if state.balance == 0 {
				// A payment can precede a full credit on the same date. Its later refund unwinds that receipt.
				state.basis, state.balance = groups, payable
			} else {
				for _, n := range notes {
					groups = addGroups(groups, n, -1)
				}
				state.basis = addGroups(groups, state.recognised, -1)
			}
			state.inBasis = 0
		}
		d.Groups = state.apply(amount)
		if inPeriod {
			result = append(result, d)
		}
	}
	return result, rows.Err()
}

type receiptAllocation struct {
	invoice, creditDate        string
	refund                     bool
	received, inBasis, balance invoicecalc.Money
	basis, recognised          []invoicecalc.Group
}

func (s *receiptAllocation) apply(amount invoicecalc.Money) []invoicecalc.Group {
	before := vatcalc.Portion(s.basis, s.inBasis, s.balance)
	s.inBasis += amount
	s.received += amount
	after := vatcalc.Portion(s.basis, s.inBasis, s.balance)
	part := addGroups(after, before, -1)
	s.recognised = addGroups(s.recognised, part, 1)
	return part
}

// addGroups adds (sign 1) or subtracts (sign -1) the groups of b to those of a, by category and rate.
func addGroups(a, b []invoicecalc.Group, sign invoicecalc.Money) []invoicecalc.Group {
	out := slices.Clone(a)
	for _, g := range b {
		i := slices.IndexFunc(out, func(o invoicecalc.Group) bool { return o.Category == g.Category && o.Rate == g.Rate })
		if i < 0 {
			out = append(out, invoicecalc.Group{Category: g.Category, Rate: g.Rate})
			i = len(out) - 1
		}
		out[i].TaxableAmount += sign * g.TaxableAmount
		out[i].VATAmount += sign * g.VATAmount
	}
	return out
}

// collectVATDocuments scans ref, currency, supply date and breakdown, then scales the groups by part / whole.
func collectVATDocuments(rows pgx.Rows, err error) ([]VATDocument, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (VATDocument, error) {
		var d VATDocument
		var breakdown []byte
		var part, whole invoicecalc.Money
		if err := r.Scan(&d.Ref, &d.Currency, &d.SupplyDate, &breakdown, &part, &whole); err != nil {
			return d, err
		}
		if err := json.Unmarshal(breakdown, &d.Groups); err != nil {
			return d, fmt.Errorf("invoice %s breakdown: %w", d.Ref, err)
		}
		d.Groups = vatcalc.Portion(d.Groups, part, whole)
		return d, nil
	})
}

// VATSelfBilled: self-billed documents of [from, to); they are purchases, so the return only names them.
func (q Q) VATSelfBilled(ctx context.Context, workspaceID, from, to string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT coalesce(number, id) FROM invoices WHERE workspace_id = $1 AND kind = 'self_billed'
		AND status <> 'draft' AND issue_date >= $2 AND issue_date < $3 ORDER BY 1`, workspaceID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// VATPurchase is a booked expense as the return reads it, in the workspace's base currency.
type VATPurchase struct {
	vatcalc.Purchase
	Currency string
}

// VATPurchases: booked expenses dated in [from, to): by document date, or by payment date on the received basis, one
// purchase per account the expense posts to (ledgercalc.SplitExpense). The input-tax box is the expense's own, else
// 400 for an account of class 4 (materials, goods, services) and 405 otherwise.
func (q Q) VATPurchases(ctx context.Context, workspaceID, from, to string, received bool) ([]VATPurchase, error) {
	date := `COALESCE(e.document_date, e.booked_at::date)`
	if received {
		date = `e.paid_on`
	}
	rows, err := q.db.Query(ctx, `SELECT e.id, e.number, e.base_currency, `+date+`::text, e.base_total, e.base_net_total, e.base_deductible_vat,
			e.deductible_percent, e.reverse_charge, coalesce(e.input_tax_box, ''), coalesce(c.account_code, ''), e.amount_mode = 'gross'
		FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
		WHERE e.workspace_id = $1 AND e.status = 'booked' AND e.deleted_at IS NULL AND `+date+` >= $2 AND `+date+` < $3
		ORDER BY e.number`, workspaceID, from, to)
	if err != nil {
		return nil, err
	}
	type booked struct {
		id, box, account string
		gross            bool
		total            invoicecalc.Money
		p                VATPurchase
	}
	all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (booked, error) {
		var b booked
		var number int64
		err := r.Scan(&b.id, &number, &b.p.Currency, &b.p.SupplyDate, &b.total, &b.p.Net, &b.p.DeductibleVAT, &b.p.DeductiblePercent,
			&b.p.ReverseCharge, &b.box, &b.account, &b.gross)
		b.p.Ref = "Expense " + strconv.FormatInt(number, 10)
		return b, err
	})
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(all))
	for i, b := range all {
		ids[i] = b.id
	}
	lines, err := q.expenseSplitLines(ctx, ids)
	if err != nil {
		return nil, err
	}
	var purchases []VATPurchase
	for _, b := range all {
		for _, sp := range ledgercalc.SplitExpense(b.account, b.box, b.gross, lines[b.id], b.total, b.p.DeductibleVAT, b.p.Net) {
			p := b.p
			p.Box, p.DeductibleVAT, p.Net = "405", sp.Deductible, sp.Taxable
			if sp.Material {
				p.Box = "400"
			}
			purchases = append(purchases, p)
		}
	}
	return purchases, nil
}

// ClosedMonths counts the closed months among [from, to).
func (q Q) ClosedMonths(ctx context.Context, workspaceID, from, to string) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM closed_periods WHERE workspace_id = $1 AND month >= left($2, 7) AND month < left($3, 7)`,
		workspaceID, from, to).Scan(&n)
	return n, err
}

// VATPeriodicity is a live workspace that saved its VAT return settings, with how often it files.
type VATPeriodicity struct {
	Workspace Workspace
	Period    string
}

func (q Q) VATPeriodicities(ctx context.Context) ([]VATPeriodicity, error) {
	rows, err := q.db.Query(ctx, `SELECT w.id, w.name, w.timezone, s.period FROM vat_return_settings s
		JOIN workspaces w ON w.id = s.workspace_id WHERE w.deleted_at IS NULL ORDER BY w.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (VATPeriodicity, error) {
		var v VATPeriodicity
		err := r.Scan(&v.Workspace.ID, &v.Workspace.Name, &v.Workspace.Timezone, &v.Period)
		return v, err
	})
}
