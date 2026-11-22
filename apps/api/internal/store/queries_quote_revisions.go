package store

import (
	"context"
	"time"
)

// QuoteRevision is one sent revision of a quote, as it was sent (migration 00049). Snapshot is nil for a revision
// sent before revisions were kept; PDFKey nil when its PDF is no longer stored.
type QuoteRevision struct {
	Revision  int        `json:"revision"`
	SentAt    *time.Time `json:"sent_at"`
	SentTo    []string   `json:"sent_to"`
	Outcome   *string    `json:"outcome"` // accepted | declined | expired
	OutcomeAt *time.Time `json:"outcome_at"`
	OutcomeBy *string    `json:"outcome_by"` // staff | client
	Reason    *string    `json:"reason"`
	Current   bool       `json:"current"` // the revision the quote is at now (not a draft of the next one)
	HasPDF    bool       `json:"has_pdf"`
	Snapshot  *Quote     `json:"snapshot"`
	PDFKey    *string    `json:"-"`
}

// AddQuoteRevision records the first send of the quote's revision, as t holds it, in the send's transaction; a
// resend keeps the first.
func (q Q) AddQuoteRevision(ctx context.Context, workspaceID string, t Quote, sentTo []string, sentAt *time.Time, now time.Time) error {
	if sentTo == nil {
		sentTo = []string{}
	}
	_, err := q.db.Exec(ctx, `INSERT INTO quote_revisions (workspace_id, quote_id, revision, sent_at, sent_to, snapshot, pdf_key, created_at)
		SELECT $1, id, $3, $4, $5, $6, $7, $8 FROM quotes WHERE workspace_id = $1 AND id = $2
		ON CONFLICT (quote_id, revision) DO NOTHING`, workspaceID, t.ID, t.Revision, sentAt, sentTo, t, t.PDFKey, now)
	return err
}

// SetQuoteRevisionOutcome records the answer to a sent revision once; a revision kept without one gets none.
func (q Q) SetQuoteRevisionOutcome(ctx context.Context, workspaceID, quoteID string, revision int, outcome string,
	at *time.Time, by, reason *string) error {
	_, err := q.db.Exec(ctx, `UPDATE quote_revisions SET outcome = $4, outcome_at = $5, outcome_by = $6, reason = $7
		WHERE workspace_id = $1 AND quote_id = $2 AND revision = $3 AND outcome IS NULL`,
		workspaceID, quoteID, revision, outcome, at, by, reason)
	return err
}

// QuoteRevisions: the sent revisions of the workspace's quote t, newest first; the current one carries t's live
// answer (expired is derived, as on the quote).
func (q Q) QuoteRevisions(ctx context.Context, workspaceID string, t Quote) ([]QuoteRevision, error) {
	rows, err := q.db.Query(ctx, `SELECT revision, sent_at, sent_to, outcome, outcome_at, outcome_by, reason, snapshot, pdf_key
		FROM quote_revisions WHERE workspace_id = $1 AND quote_id = $2 ORDER BY revision DESC`, workspaceID, t.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuoteRevision{}
	for rows.Next() {
		var r QuoteRevision
		if err := rows.Scan(&r.Revision, &r.SentAt, &r.SentTo, &r.Outcome, &r.OutcomeAt, &r.OutcomeBy, &r.Reason, &r.Snapshot, &r.PDFKey); err != nil {
			return nil, err
		}
		r.HasPDF = r.PDFKey != nil
		r.Current = r.Revision == t.Revision && t.Status != "draft"
		if r.Current && r.Outcome == nil && t.Status == "expired" {
			expired := "expired"
			r.Outcome = &expired
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// QuoteRevision: one sent revision of the workspace's quote.
func (q Q) QuoteRevision(ctx context.Context, workspaceID, quoteID string, revision int) (QuoteRevision, error) {
	var r QuoteRevision
	err := q.db.QueryRow(ctx, `SELECT revision, pdf_key, snapshot FROM quote_revisions
		WHERE workspace_id = $1 AND quote_id = $2 AND revision = $3`, workspaceID, quoteID, revision).Scan(&r.Revision, &r.PDFKey, &r.Snapshot)
	r.HasPDF = r.PDFKey != nil
	return r, err
}

// BackfillEarlierQuoteRevisions adds the revisions sent before quote_revisions existed, below each quote's current
// one: the PDF of the send where its object is still stored (sent_at its reservation), no snapshot. Idempotent.
func (q Q) BackfillEarlierQuoteRevisions(ctx context.Context, now time.Time) (int64, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO quote_revisions (workspace_id, quote_id, revision, sent_at, pdf_key, created_at)
		SELECT t.workspace_id, t.id, n, o.created_at, o.object_key, $1
		FROM quotes t CROSS JOIN LATERAL generate_series(1, t.revision - 1) n
		LEFT JOIN stored_objects o ON o.object_key = 'quotes/' || t.workspace_id || '/' || t.id || '-r' || n || '.pdf'
		WHERE t.number IS NOT NULL AND t.revision > 1
		ON CONFLICT (quote_id, revision) DO NOTHING`, now)
	return tag.RowsAffected(), err
}

// QuotesWithoutCurrentRevision: up to limit sent quotes (any answer) whose current revision has no row yet, as
// workspace and quote ids.
func (q Q) QuotesWithoutCurrentRevision(ctx context.Context, limit int) ([][2]string, error) {
	rows, err := q.db.Query(ctx, `SELECT t.workspace_id, t.id FROM quotes t
		WHERE t.status <> 'draft' AND NOT EXISTS (SELECT 1 FROM quote_revisions r WHERE r.quote_id = t.id AND r.revision = t.revision)
		ORDER BY t.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var ws, id string
		if err := rows.Scan(&ws, &id); err != nil {
			return nil, err
		}
		out = append(out, [2]string{ws, id})
	}
	return out, rows.Err()
}
