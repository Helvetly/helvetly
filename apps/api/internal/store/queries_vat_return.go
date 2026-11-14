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

// VATReceipts: the share of each receivable that payments less refunds of [from, to) cover (received basis,
// MWSTG art. 40 para. 1 b), as signed documents. A payment is priced against what its invoice still asks once the
// credit notes issued by its date are taken out; a refund against those credit notes, which created what it pays back.
func (q Q) VATReceipts(ctx context.Context, workspaceID, from, to string) ([]VATDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT coalesce(i.number, i.id), i.currency, `+supplyDate+`, i.vat_breakdown,
			m.amount, i.total + i.rounding_amount, m.refund,
			COALESCE(c.breakdowns, '[]'::json), COALESCE(c.payable, 0)
		FROM (SELECT invoice_id, amount, paid_on AS moved_on, false AS refund FROM invoice_payments WHERE paid_on >= $2 AND paid_on < $3
			UNION ALL SELECT invoice_id, -amount, refunded_on, true FROM invoice_refunds WHERE refunded_on >= $2 AND refunded_on < $3) m
		JOIN invoices i ON i.id = m.invoice_id
		LEFT JOIN LATERAL (SELECT json_agg(n.vat_breakdown) AS breakdowns, sum(n.total + n.rounding_amount) AS payable
			FROM invoices n WHERE n.credited_invoice_id = i.id AND n.kind = 'credit_note' AND n.status <> 'draft'
				AND n.issue_date <= m.moved_on) c ON true
		WHERE i.workspace_id = $1 AND i.kind IN `+receivableKinds+`
		ORDER BY 1`, workspaceID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (VATDocument, error) {
		var d VATDocument
		var breakdown, credits []byte
		var part, whole, credited invoicecalc.Money
		var refund bool
		if err := r.Scan(&d.Ref, &d.Currency, &d.SupplyDate, &breakdown, &part, &whole, &refund, &credits, &credited); err != nil {
			return d, err
		}
		var groups []invoicecalc.Group
		var notes [][]invoicecalc.Group
		if err := json.Unmarshal(breakdown, &groups); err != nil {
			return d, fmt.Errorf("invoice %s breakdown: %w", d.Ref, err)
		}
		if err := json.Unmarshal(credits, &notes); err != nil {
			return d, fmt.Errorf("invoice %s credit notes: %w", d.Ref, err)
		}
		var noted []invoicecalc.Group
		for _, n := range notes {
			noted = addGroups(noted, n, 1)
		}
		switch {
		case refund && credited > 0:
			groups, whole = noted, credited
		case !refund && credited > 0 && whole > credited:
			groups, whole = addGroups(groups, noted, -1), whole-credited
		}
		d.Groups = vatcalc.Portion(groups, part, whole)
		return d, nil
	})
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

// VATPurchases: booked expenses dated in [from, to): by document date, or by payment date on the received basis. The
// input-tax box is the expense's own, else 400 for an account of class 4 (materials, goods, services) and 405 otherwise.
func (q Q) VATPurchases(ctx context.Context, workspaceID, from, to string, received bool) ([]VATPurchase, error) {
	date := `COALESCE(e.document_date, e.booked_at::date)`
	if received {
		date = `e.paid_on`
	}
	rows, err := q.db.Query(ctx, `SELECT e.number, e.base_currency, `+date+`::text, e.base_net_total, e.base_deductible_vat,
			e.deductible_percent, e.reverse_charge, COALESCE(e.input_tax_box, CASE WHEN c.account_code LIKE '4%' THEN '400' ELSE '405' END)
		FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
		WHERE e.workspace_id = $1 AND e.status = 'booked' AND e.deleted_at IS NULL AND `+date+` >= $2 AND `+date+` < $3
		ORDER BY e.number`, workspaceID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (VATPurchase, error) {
		var p VATPurchase
		var number int64
		err := r.Scan(&number, &p.Currency, &p.SupplyDate, &p.Net, &p.DeductibleVAT, &p.DeductiblePercent, &p.ReverseCharge, &p.Box)
		p.Ref = "Expense " + strconv.FormatInt(number, 10)
		return p, err
	})
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
