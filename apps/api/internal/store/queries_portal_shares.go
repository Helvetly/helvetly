package store

import (
	"context"
	"time"
)

type DocumentShare struct {
	ClientID   string     `json:"client_id"`
	ClientName string     `json:"client_name"`
	SharedAt   time.Time  `json:"shared_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
}

type SharedDocument struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	ContentType string    `json:"content_type"`
	SharedAt    time.Time `json:"shared_at"`
	// Quote names the quote revision whose PDF this is; nil for a file shared by hand.
	Quote *SharedQuote `json:"quote"`
}

type SharedQuote struct {
	Number   string `json:"number"`
	Revision int    `json:"revision"`
}

type ChangeRequest struct {
	ID          string         `json:"id"`
	ClientID    string         `json:"client_id"`
	ContactID   *string        `json:"contact_id"`
	ContactName string         `json:"contact_name"`
	Fields      map[string]any `json:"fields"`
	Status      string         `json:"status"`
	CreatedAt   time.Time      `json:"created_at"`
	DecidedAt   *time.Time     `json:"decided_at"`
	Applied     []string       `json:"applied_fields"` // approved: the fields applied, the others were discarded
	Reason      *string        `json:"reason"`         // rejected: why, when the decider said
}

// ShareDocument preserves an active share's original settings when repeated; an expired share can be renewed.
func (q Q) ShareDocument(ctx context.Context, workspaceID, documentID, clientID, userID string, now time.Time, expiresAt ...*time.Time) error {
	var expiry *time.Time
	if len(expiresAt) > 0 {
		expiry = expiresAt[0]
	}
	tag, err := q.db.Exec(ctx, `INSERT INTO document_shares (document_id, client_id, workspace_id, shared_by, created_at, expires_at)
		SELECT d.id, c.id, $1, nullif($4, ''), $5, $6 FROM documents d, clients c
		WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private
		  AND c.workspace_id = $1 AND c.id = $3 AND c.deleted_at IS NULL
		ON CONFLICT (document_id, client_id) DO UPDATE
		SET expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at, shared_by = EXCLUDED.shared_by
		WHERE document_shares.expires_at <= EXCLUDED.created_at`, workspaceID, documentID, clientID, userID, now, expiry)
	if err != nil || tag.RowsAffected() > 0 {
		return err
	}
	var one int
	return q.db.QueryRow(ctx, `SELECT 1 FROM document_shares s JOIN documents d ON d.id = s.document_id JOIN clients c ON c.id = s.client_id
		WHERE s.workspace_id = $1 AND s.document_id = $2 AND s.client_id = $3 AND d.deleted_at IS NULL AND NOT d.hr_private AND c.deleted_at IS NULL`,
		workspaceID, documentID, clientID).Scan(&one)
}

func (q Q) UnshareDocument(ctx context.Context, workspaceID, documentID, clientID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM document_shares WHERE workspace_id = $1 AND document_id = $2 AND client_id = $3`,
		workspaceID, documentID, clientID)
	return err
}

func (q Q) DocumentShares(ctx context.Context, workspaceID, documentID string) ([]DocumentShare, error) {
	rows, err := q.db.Query(ctx, `SELECT c.id, c.name, s.created_at, s.expires_at FROM document_shares s JOIN clients c ON c.id = s.client_id
		WHERE s.workspace_id = $1 AND s.document_id = $2 AND c.deleted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) ORDER BY s.created_at DESC, c.id`, workspaceID, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DocumentShare{}
	for rows.Next() {
		var s DocumentShare
		if err := rows.Scan(&s.ClientID, &s.ClientName, &s.SharedAt, &s.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// sentQuotePDFs: the documents holding the PDF of a quote revision as sent to client $2 of workspace $1. A revision
// keeps the client it went to in its snapshot (a later revision may go to another).
const sentQuotePDFs = `SELECT d.id, coalesce(qr.sent_at, qr.created_at) AS at, t.number, qr.revision
	FROM quote_revisions qr JOIN quotes t ON t.id = qr.quote_id
	JOIN documents d ON d.workspace_id = qr.workspace_id AND d.object_key = qr.pdf_key
	WHERE qr.workspace_id = $1 AND coalesce(qr.snapshot->>'client_id', t.client_id) = $2`

// SharedDocuments: the documents shared with the client and the PDFs of the quotes sent to it, not in the Trash,
// newest first.
func (q Q) SharedDocuments(ctx context.Context, workspaceID, clientID string) ([]SharedDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT * FROM (
		SELECT DISTINCT ON (d.id) d.id, d.name, d.size, d.content_type, x.at, x.number, x.revision
		FROM (SELECT document_id AS id, created_at AS at, NULL AS number, NULL::integer AS revision
			FROM document_shares WHERE workspace_id = $1 AND client_id = $2 AND (expires_at IS NULL OR expires_at > now())
			UNION ALL `+sentQuotePDFs+`) x
		JOIN documents d ON d.id = x.id
		WHERE d.workspace_id = $1 AND d.deleted_at IS NULL AND NOT d.hr_private
		ORDER BY d.id, x.revision IS NULL, x.at DESC) o
		ORDER BY at DESC, id`, workspaceID, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SharedDocument{}
	for rows.Next() {
		var d SharedDocument
		var number *string
		var revision *int
		if err := rows.Scan(&d.ID, &d.Name, &d.Size, &d.ContentType, &d.SharedAt, &number, &revision); err != nil {
			return nil, err
		}
		if number != nil && revision != nil {
			d.Quote = &SharedQuote{*number, *revision}
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

type PortalDocumentDownload struct {
	ID          string
	ObjectKey   string
	Name        string
	ContentType string
	ExpiresAt   *time.Time
}

// SharedDocument authorizes an active portal share or a sent quote PDF. The quote grants its own permanent access.
func (q Q) SharedDocument(ctx context.Context, workspaceID, clientID, documentID string) (PortalDocumentDownload, error) {
	var d PortalDocumentDownload
	err := q.db.QueryRow(ctx, `WITH sent_quote AS (SELECT id FROM (`+sentQuotePDFs+`) p WHERE id = $3)
		SELECT d.id, d.object_key, d.name, d.content_type,
		       CASE WHEN EXISTS (SELECT 1 FROM sent_quote) THEN NULL ELSE s.expires_at END
		FROM documents d
		LEFT JOIN document_shares s ON s.document_id = d.id AND s.workspace_id = $1 AND s.client_id = $2
		  AND (s.expires_at IS NULL OR s.expires_at > now())
		WHERE d.workspace_id = $1 AND d.id = $3 AND d.deleted_at IS NULL AND NOT d.hr_private
		  AND (s.document_id IS NOT NULL OR EXISTS (SELECT 1 FROM sent_quote))`, workspaceID, clientID, documentID).
		Scan(&d.ID, &d.ObjectKey, &d.Name, &d.ContentType, &d.ExpiresAt)
	return d, err
}

// DocumentSharer: who shared the document with the client, "" when unknown (they left, it predates the column, or
// it is a sent quote's PDF, which nobody shared).
func (q Q) DocumentSharer(ctx context.Context, documentID, clientID string) (string, error) {
	var by *string
	err := q.db.QueryRow(ctx, `SELECT (SELECT shared_by FROM document_shares WHERE document_id = $1 AND client_id = $2)`,
		documentID, clientID).Scan(&by)
	if by == nil {
		return "", err
	}
	return *by, err
}

const changeRequestSelect = `SELECT r.id, r.client_id, r.contact_id, coalesce(ct.name, ''), r.fields, r.status, r.created_at,
	r.decided_at, r.applied_fields, r.reject_reason
	FROM client_change_requests r LEFT JOIN client_contacts ct ON ct.id = r.contact_id `

func scanChangeRequest(row interface{ Scan(...any) error }) (ChangeRequest, error) {
	var r ChangeRequest
	err := row.Scan(&r.ID, &r.ClientID, &r.ContactID, &r.ContactName, &r.Fields, &r.Status, &r.CreatedAt, &r.DecidedAt, &r.Applied, &r.Reason)
	return r, err
}

// UpsertChangeRequest keeps one pending request per client: a new one replaces the fields of the pending one (same ID).
func (q Q) UpsertChangeRequest(ctx context.Context, id, workspaceID, clientID, contactID string, fields map[string]any, now time.Time) (ChangeRequest, error) {
	var got string
	err := q.db.QueryRow(ctx, `INSERT INTO client_change_requests (id, workspace_id, client_id, contact_id, fields, created_at)
		VALUES ($1, $2, $3, nullif($4, ''), $5, $6)
		ON CONFLICT (client_id) WHERE status = 'pending'
		DO UPDATE SET fields = EXCLUDED.fields, contact_id = EXCLUDED.contact_id, created_at = greatest(EXCLUDED.created_at, client_change_requests.created_at + interval '1 microsecond')
		WHERE client_change_requests.workspace_id = EXCLUDED.workspace_id
		RETURNING id`, id, workspaceID, clientID, contactID, fields, now).Scan(&got)
	if err != nil {
		return ChangeRequest{}, err
	}
	return scanChangeRequest(q.db.QueryRow(ctx, changeRequestSelect+`WHERE r.id = $1`, got))
}

func (q Q) PendingChangeRequest(ctx context.Context, workspaceID, clientID string) (ChangeRequest, error) {
	return scanChangeRequest(q.db.QueryRow(ctx, changeRequestSelect+
		`WHERE r.workspace_id = $1 AND r.client_id = $2 AND r.status = 'pending'`, workspaceID, clientID))
}

// LockPendingChangeRequest holds the reviewed revision until both the client edit and decision commit.
func (q Q) LockPendingChangeRequest(ctx context.Context, workspaceID, clientID string) (ChangeRequest, error) {
	return scanChangeRequest(q.db.QueryRow(ctx, changeRequestSelect+
		`WHERE r.workspace_id = $1 AND r.client_id = $2 AND r.status = 'pending' FOR UPDATE OF r`, workspaceID, clientID))
}

// DecideChangeRequest marks the pending request approved (with the fields applied) or rejected (with an optional
// reason); ErrNotFound when none is pending.
func (q Q) DecideChangeRequest(ctx context.Context, workspaceID, clientID, status, userID string, applied []string, reason string, now time.Time) (ChangeRequest, error) {
	var id string
	err := q.db.QueryRow(ctx, `UPDATE client_change_requests SET status = $3, decided_at = $5, decided_by = nullif($4, ''),
		applied_fields = $6, reject_reason = nullif($7, '')
		WHERE workspace_id = $1 AND client_id = $2 AND status = 'pending' RETURNING id`,
		workspaceID, clientID, status, userID, now, applied, reason).Scan(&id)
	if err != nil {
		return ChangeRequest{}, err
	}
	return scanChangeRequest(q.db.QueryRow(ctx, changeRequestSelect+`WHERE r.id = $1`, id))
}

// LastDecidedChangeRequest: the client's most recently decided request; ErrNotFound when none was decided.
func (q Q) LastDecidedChangeRequest(ctx context.Context, workspaceID, clientID string) (ChangeRequest, error) {
	return scanChangeRequest(q.db.QueryRow(ctx, changeRequestSelect+
		`WHERE r.workspace_id = $1 AND r.client_id = $2 AND r.status <> 'pending' ORDER BY r.decided_at DESC, r.id LIMIT 1`,
		workspaceID, clientID))
}

// ShareDocumentWithParticipant shares the document with one participant of the client (repeating keeps the share).
func (q Q) ShareDocumentWithParticipant(ctx context.Context, workspaceID, documentID, clientID, contactID, userID string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `INSERT INTO document_participant_shares (document_id, contact_id, client_id, workspace_id, shared_by, created_at)
		SELECT d.id, k.id, c.id, $1, nullif($5, ''), $6 FROM documents d, clients c, client_contacts k
		WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private
			AND c.workspace_id = $1 AND c.id = $3 AND c.deleted_at IS NULL
			AND k.id = $4 AND k.client_id = c.id AND 'participant' = ANY (k.roles)
		ON CONFLICT (document_id, contact_id) DO NOTHING`, workspaceID, documentID, clientID, contactID, userID, now)
	if err != nil || tag.RowsAffected() > 0 {
		return err
	}
	var one int
	return q.db.QueryRow(ctx, `SELECT 1 FROM document_participant_shares WHERE workspace_id = $1 AND document_id = $2 AND contact_id = $3`,
		workspaceID, documentID, contactID).Scan(&one)
}

func (q Q) UnshareDocumentWithParticipant(ctx context.Context, workspaceID, documentID, contactID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM document_participant_shares WHERE workspace_id = $1 AND document_id = $2 AND contact_id = $3`,
		workspaceID, documentID, contactID)
	return err
}

// ParticipantShare is a document's share with one participant of a client.
type ParticipantShare struct {
	ClientID        string    `json:"client_id"`
	ClientName      string    `json:"client_name"`
	ParticipantID   string    `json:"participant_id"`
	ParticipantName string    `json:"participant_name"`
	SharedAt        time.Time `json:"shared_at"`
}

func (q Q) DocumentParticipantShares(ctx context.Context, workspaceID, documentID string) ([]ParticipantShare, error) {
	rows, err := q.db.Query(ctx, `SELECT c.id, c.name, k.id, k.name, s.created_at FROM document_participant_shares s
		JOIN clients c ON c.id = s.client_id JOIN client_contacts k ON k.id = s.contact_id
		WHERE s.workspace_id = $1 AND s.document_id = $2 AND c.deleted_at IS NULL ORDER BY s.created_at DESC, k.id`, workspaceID, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ParticipantShare{}
	for rows.Next() {
		var s ParticipantShare
		if err := rows.Scan(&s.ClientID, &s.ClientName, &s.ParticipantID, &s.ParticipantName, &s.SharedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ParticipantSharedDocuments: the documents shared with the participant of the client, not in the Trash, newest first.
func (q Q) ParticipantSharedDocuments(ctx context.Context, workspaceID, clientID, contactID string) ([]SharedDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT d.id, d.name, d.size, d.content_type, s.created_at FROM document_participant_shares s
		JOIN documents d ON d.id = s.document_id
		WHERE s.workspace_id = $1 AND s.client_id = $2 AND s.contact_id = $3 AND d.workspace_id = $1 AND d.deleted_at IS NULL
			AND NOT d.hr_private
		ORDER BY s.created_at DESC, d.id`, workspaceID, clientID, contactID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SharedDocument{}
	for rows.Next() {
		var d SharedDocument
		if err := rows.Scan(&d.ID, &d.Name, &d.Size, &d.ContentType, &d.SharedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ParticipantSharedDocument authorizes a download of a document shared with the participant of the client.
func (q Q) ParticipantSharedDocument(ctx context.Context, workspaceID, clientID, contactID, documentID string) (PortalDocumentDownload, error) {
	var d PortalDocumentDownload
	err := q.db.QueryRow(ctx, `SELECT d.id, d.object_key, d.name, d.content_type FROM document_participant_shares s
		JOIN documents d ON d.id = s.document_id
		WHERE s.workspace_id = $1 AND s.client_id = $2 AND s.contact_id = $3 AND s.document_id = $4 AND d.workspace_id = $1
			AND d.deleted_at IS NULL AND NOT d.hr_private`, workspaceID, clientID, contactID, documentID).
		Scan(&d.ID, &d.ObjectKey, &d.Name, &d.ContentType)
	return d, err
}
