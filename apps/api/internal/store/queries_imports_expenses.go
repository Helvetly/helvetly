package store

import (
	"context"

	"helvetly.com/api/internal/invoicecalc"
)

// SimilarExpense: a live, non-void expense of the same supplier (case-insensitive) with the same reference, or with
// the same document date, currency and total, so a receipt imported twice is flagged. Nothing without a supplier.
func (q Q) SimilarExpense(ctx context.Context, workspaceID, supplier, reference, date, currency string, total invoicecalc.Money) (*ImportDuplicate, error) {
	if supplier == "" {
		return nil, nil
	}
	var d ImportDuplicate
	err := q.db.QueryRow(ctx, `SELECT id, 'Expense ' || number || ' · ' || supplier_name,
			CASE WHEN $3<>'' AND lower(reference)=lower($3) THEN 'same reference' ELSE 'same date and total' END
		FROM expenses WHERE workspace_id=$1 AND deleted_at IS NULL AND status<>'void' AND lower(supplier_name)=lower($2)
			AND (($3<>'' AND lower(reference)=lower($3)) OR ($4<>'' AND document_date::text=$4 AND currency=$5 AND total=$6))
		ORDER BY number LIMIT 1`, workspaceID, supplier, reference, date, currency, total).Scan(&d.ID, &d.Label, &d.Reason)
	return similar(d, err)
}
