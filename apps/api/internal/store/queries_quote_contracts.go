package store

import (
	"context"
	"time"
)

// Quote contracts (migration 00055): the contract documents made from a quote, newest first.

// ContractsFolderName: the stored (English) name of the system folder Clients/<client>/Documents/<year>/Contracts.
const ContractsFolderName = "Contracts"

type QuoteContract struct {
	DocumentID string    `json:"document_id"`
	Number     string    `json:"number"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"created_at"`
	// Signature: the document's latest signature request, null when it was never sent for signature.
	Signature *QuoteContractSignature `json:"signature"`
}

type QuoteContractSignature struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// ContractsFolder: Clients/<client>/Documents/<year>/Contracts, made where missing. Run it in a transaction.
func (q Q) ContractsFolder(ctx context.Context, workspaceID, clientID string, year int, userID string, now time.Time) (string, error) {
	yearFolder, err := q.ClientRecordFolder(ctx, workspaceID, clientID, "documents", year, userID, now)
	if err != nil {
		return "", err
	}
	return q.systemFolder(ctx, workspaceID, &yearFolder, "contracts", "", ContractsFolderName, userID, now)
}

// NextContractNumber bumps the workspace's contract counter of the year in the caller's transaction: the row lock
// holds concurrent contracts back until it ends, so the numbers have no gaps and never repeat.
func (q Q) NextContractNumber(ctx context.Context, workspaceID string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `INSERT INTO contract_counters (workspace_id, year, seq) VALUES ($1, $2, 1)
		ON CONFLICT (workspace_id, year) DO UPDATE SET seq = contract_counters.seq + 1 RETURNING seq`, workspaceID, year).Scan(&seq)
	return seq, err
}

// PeekContractNumber: the number the next contract of the year would take, without taking it.
func (q Q) PeekContractNumber(ctx context.Context, workspaceID string, year int) (int64, error) {
	var seq int64
	err := q.db.QueryRow(ctx, `SELECT COALESCE((SELECT seq FROM contract_counters WHERE workspace_id = $1 AND year = $2), 0) + 1`,
		workspaceID, year).Scan(&seq)
	return seq, err
}

// AddQuoteContract links a contract document, by its number, to the quote it was made from.
func (q Q) AddQuoteContract(ctx context.Context, workspaceID, quoteID, documentID, number, templateID, userID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO quote_contracts (workspace_id, quote_id, document_id, number, template_id, created_by, created_at)
		VALUES ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7) ON CONFLICT DO NOTHING`,
		workspaceID, quoteID, documentID, number, templateID, userID, now)
	return err
}

// SetQuoteContractSections keeps a written contract's reviewed sections (JSON) with its link to the quote.
func (q Q) SetQuoteContractSections(ctx context.Context, workspaceID, documentID string, sections []byte) error {
	_, err := q.db.Exec(ctx, `UPDATE quote_contracts SET sections = $3 WHERE workspace_id = $1 AND document_id = $2`,
		workspaceID, documentID, sections)
	return err
}

// QuoteContracts: the live (not trashed) contracts of a quote, newest first, with their latest signature request.
func (q Q) QuoteContracts(ctx context.Context, workspaceID, quoteID string) ([]QuoteContract, error) {
	rows, err := q.db.Query(ctx, `SELECT d.id, qc.number, d.name, qc.created_at, s.id, s.status
		FROM quote_contracts qc JOIN documents d ON d.id = qc.document_id AND d.workspace_id = qc.workspace_id
		LEFT JOIN LATERAL (SELECT sr.id, sr.status FROM signature_requests sr
			WHERE sr.workspace_id = qc.workspace_id AND sr.document_id = d.id ORDER BY sr.created_at DESC, sr.id DESC LIMIT 1) s ON true
		WHERE qc.workspace_id = $1 AND qc.quote_id = $2 AND d.deleted_at IS NULL
		ORDER BY qc.created_at DESC, d.id DESC`, workspaceID, quoteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuoteContract{}
	for rows.Next() {
		var c QuoteContract
		var sigID, sigStatus *string
		if err := rows.Scan(&c.DocumentID, &c.Number, &c.Name, &c.CreatedAt, &sigID, &sigStatus); err != nil {
			return nil, err
		}
		if sigID != nil && sigStatus != nil {
			c.Signature = &QuoteContractSignature{ID: *sigID, Status: *sigStatus}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// QuoteContractCounts: the number of live contracts of each of the workspace's quotes that has any.
func (q Q) QuoteContractCounts(ctx context.Context, workspaceID string) (map[string]int, error) {
	rows, err := q.db.Query(ctx, `SELECT qc.quote_id, count(*) FROM quote_contracts qc
		JOIN documents d ON d.id = qc.document_id AND d.deleted_at IS NULL
		WHERE qc.workspace_id = $1 GROUP BY qc.quote_id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}
