package store

import (
	"context"
	"time"
)

// PortalSignature is a signature request as its client sees it in the portal.
type PortalSignature struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Status: pending, completed, declined or expired (a pending request past its expiry). Revoked ones are not shown.
	Status      string     `json:"status"`
	SentAt      time.Time  `json:"sent_at"`
	CompletedAt *time.Time `json:"completed_at"`
	// AwaitingYou: pending and a signer with the portal session's address has neither signed nor declined.
	AwaitingYou bool `json:"awaiting_you"`
	// SignedFile: the signed PDF (with its certificate page) once completed, nil while it is missing or trashed.
	SignedFile       *PortalSignedFile `json:"signed_file"`
	SignedDocumentID string            `json:"-"`
}

type PortalSignedFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// portalSignaturesSQL: the signature requests of workspace $1 that belong to client $2, newest first; $3 is now, $4
// the session's address, $5 one request's id or "" for all. A request belongs to the client its original document
// belongs to, as automatic tags decide it: the client of the quote it is a contract of, else the Clients/<client>
// folder it was sent from, else the client the original is linked to. A request whose original belongs to no client
// (any PDF from Documents) belongs to the clients whose portal address is one of its signers'. Never an HR file's.
const portalSignaturesSQL = `WITH RECURSIVE up AS (
		SELECT r.id AS req, f.parent_id, f.system_kind, f.system_ref, 0 AS depth
		FROM signature_requests r JOIN document_folders f ON f.id = r.folder_id AND f.deleted_at IS NULL
		WHERE r.workspace_id = $1 AND r.status <> 'revoked' AND ($5 = '' OR r.id = $5)
		UNION ALL
		SELECT u.req, p.parent_id, p.system_kind, p.system_ref, u.depth + 1
		FROM up u JOIN document_folders p ON p.id = u.parent_id AND p.deleted_at IS NULL WHERE u.depth < 32),
	owner AS (SELECT r.id, coalesce(
			(SELECT t.client_id FROM quote_contracts c JOIN quotes t ON t.id = c.quote_id
				WHERE c.workspace_id = $1 AND c.document_id = r.document_id ORDER BY c.created_at DESC LIMIT 1),
			(SELECT system_ref FROM up WHERE up.req = r.id AND system_kind = 'client' ORDER BY depth LIMIT 1),
			(SELECT min(l.target_id) FROM document_links l WHERE l.document_id = r.document_id AND l.target_type = 'client')) AS client
		FROM signature_requests r WHERE r.workspace_id = $1 AND r.status <> 'revoked' AND ($5 = '' OR r.id = $5))
	SELECT r.id, r.title, CASE WHEN r.status = 'pending' AND r.expires_at < $3 THEN 'expired' ELSE r.status END,
		r.created_at, r.completed_at,
		r.status = 'pending' AND r.expires_at >= $3 AND EXISTS (SELECT 1 FROM signature_signers s WHERE s.request_id = r.id
			AND lower(s.email) = lower($4) AND s.signed_at IS NULL AND s.declined_at IS NULL),
		sd.id, sd.name, sd.size
	FROM signature_requests r JOIN owner o ON o.id = r.id
	LEFT JOIN documents src ON src.id = r.document_id
	LEFT JOIN documents sd ON sd.id = r.signed_document_id AND sd.workspace_id = $1 AND sd.deleted_at IS NULL
		AND NOT sd.hr_private AND r.status = 'completed'
	WHERE r.workspace_id = $1 AND NOT coalesce(src.hr_private, false)
		AND (o.client = $2 OR (o.client IS NULL AND EXISTS (SELECT 1 FROM signature_signers s JOIN clients c
			ON c.id = $2 AND c.workspace_id = $1 AND c.deleted_at IS NULL
			WHERE s.request_id = r.id AND lower(s.email) = ` + portalLogin + `)))
	ORDER BY r.created_at DESC, r.id`

// PortalSignatures: the signature requests that belong to the client (see portalSignaturesSQL), for a portal session
// signed in with email; id "" for all of them, else only that one.
func (q Q) PortalSignatures(ctx context.Context, workspaceID, clientID, email, id string, now time.Time) ([]PortalSignature, error) {
	rows, err := q.db.Query(ctx, portalSignaturesSQL, workspaceID, clientID, now, email, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PortalSignature{}
	for rows.Next() {
		var p PortalSignature
		var docID, name *string
		var size *int64
		if err := rows.Scan(&p.ID, &p.Title, &p.Status, &p.SentAt, &p.CompletedAt, &p.AwaitingYou, &docID, &name, &size); err != nil {
			return nil, err
		}
		if docID != nil {
			p.SignedDocumentID, p.SignedFile = *docID, &PortalSignedFile{*name, *size}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
