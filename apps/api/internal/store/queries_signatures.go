package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

type SignatureRequest struct {
	ID             string           `json:"id"`
	Title          string           `json:"title"`
	Message        *string          `json:"message"`
	Language       *string          `json:"language"` // its emails' language; nil: the English email of before templates
	Status         string           `json:"status"`   // set to "expired" by internal/signatures when due
	SigningOrder   string           `json:"signing_order"`
	Document       *FolderRef       `json:"document"`
	SignedDocument *FolderRef       `json:"signed_document"`
	FolderID       *string          `json:"folder_id"`
	OriginalSHA256 string           `json:"original_sha256"`
	FinalSHA256    *string          `json:"final_sha256"`
	PageCount      int              `json:"page_count"`
	ExpiresAt      time.Time        `json:"expires_at"`
	CreatedBy      *Uploader        `json:"created_by"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
	CompletedAt    *time.Time       `json:"completed_at"`
	Signers        []Signer         `json:"signers"`
	Fields         []SignatureField `json:"fields"`
	Events         []SignatureEvent `json:"events,omitempty"`

	WorkspaceID   string `json:"-"`
	WorkspaceName string `json:"-"`
	Timezone      string `json:"-"` // the workspace's: dates in the mails and on the PDF
	SenderEmail   string `json:"-"`
	OriginalKey   string `json:"-"`
}

type Signer struct {
	ID            string     `json:"id"`
	Position      int        `json:"position"`
	Name          string     `json:"name"`
	Email         string     `json:"email"`
	Status        string     `json:"status"`
	SentAt        *time.Time `json:"sent_at"`
	ViewedAt      *time.Time `json:"viewed_at"`
	SignedAt      *time.Time `json:"signed_at"`
	DeclinedAt    *time.Time `json:"declined_at"`
	DeclineReason *string    `json:"decline_reason"`

	HasToken        bool    `json:"-"`
	ViewedIP        *string `json:"-"`
	ViewedUA        *string `json:"-"`
	SignedIP        *string `json:"-"`
	SignedUA        *string `json:"-"`
	SignatureMethod *string `json:"-"`
}

type SignatureField struct {
	ID       string  `json:"id"`
	SignerID string  `json:"signer_id"`
	Page     int     `json:"page"`
	Kind     string  `json:"kind"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	Label    *string `json:"label"`
	Value    *string `json:"value"`
}

type EventSigner struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type SignatureEvent struct {
	Seq       int             `json:"-"`
	Type      string          `json:"type"`
	SignerID  *string         `json:"-"`
	Signer    *EventSigner    `json:"signer"`
	At        time.Time       `json:"at"`
	IP        *string         `json:"ip"`
	UserAgent *string         `json:"user_agent"`
	Data      json.RawMessage `json:"-"`
	Hash      string          `json:"hash"`
}

func (q Q) createSignatureRequest(ctx context.Context, r SignatureRequest, userID string) error {
	if _, err := q.db.Exec(ctx, `INSERT INTO signature_requests (id, workspace_id, document_id, folder_id, title, message, language,
			signing_order, status, original_key, original_sha256, page_count, expires_at, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $14, $7, 'pending', $8, $9, $10, $11, $12, $13, $13)`,
		r.ID, r.WorkspaceID, r.Document.ID, r.FolderID, r.Title, r.Message, r.SigningOrder, r.OriginalKey, r.OriginalSHA256,
		r.PageCount, r.ExpiresAt, userID, r.CreatedAt, r.Language); err != nil {
		return err
	}
	for _, s := range r.Signers {
		if _, err := q.db.Exec(ctx, `INSERT INTO signature_signers (id, request_id, position, name, email) VALUES ($1, $2, $3, $4, $5)`,
			s.ID, r.ID, s.Position, s.Name, s.Email); err != nil {
			return err
		}
	}
	for i, f := range r.Fields {
		if _, err := q.db.Exec(ctx, `INSERT INTO signature_fields (id, request_id, signer_id, position, page, kind, x, y, w, h, label)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			f.ID, r.ID, f.SignerID, i, f.Page, f.Kind, f.X, f.Y, f.W, f.H, f.Label); err != nil {
			return err
		}
	}
	return nil
}

const signatureSelect = `SELECT r.id, r.workspace_id, w.name, w.timezone, r.title, r.message, r.language, r.status, r.signing_order, r.document_id, d.name,
		r.signed_document_id, sd.name, r.folder_id, r.original_key, r.original_sha256, r.final_sha256, r.page_count, r.expires_at,
		u.id, u.name, ` + avatarColumn + `, coalesce(u.email, ''), r.created_at, r.updated_at, r.completed_at
	FROM signature_requests r
	JOIN workspaces w ON w.id = r.workspace_id
	LEFT JOIN documents d ON d.id = r.document_id
	LEFT JOIN documents sd ON sd.id = r.signed_document_id
	LEFT JOIN users u ON u.id = r.created_by `

func scanSignatureRequest(row pgx.Row) (SignatureRequest, error) {
	var r SignatureRequest
	var docID, docName, signedID, signedName, userID, userName, userAvatar *string
	err := row.Scan(&r.ID, &r.WorkspaceID, &r.WorkspaceName, &r.Timezone, &r.Title, &r.Message, &r.Language, &r.Status, &r.SigningOrder, &docID, &docName,
		&signedID, &signedName, &r.FolderID, &r.OriginalKey, &r.OriginalSHA256, &r.FinalSHA256, &r.PageCount, &r.ExpiresAt,
		&userID, &userName, &userAvatar, &r.SenderEmail, &r.CreatedAt, &r.UpdatedAt, &r.CompletedAt)
	if docID != nil && docName != nil {
		r.Document = &FolderRef{ID: *docID, Name: *docName}
	}
	if signedID != nil && signedName != nil {
		r.SignedDocument = &FolderRef{ID: *signedID, Name: *signedName}
	}
	r.CreatedBy = uploader(userID, userName, userAvatar)
	r.Signers, r.Fields = []Signer{}, []SignatureField{}
	return r, err
}

// SignatureRequest: one request of the workspace with its signers and fields.
func (q Q) SignatureRequest(ctx context.Context, workspaceID, id string) (SignatureRequest, error) {
	r, err := scanSignatureRequest(q.db.QueryRow(ctx, signatureSelect+`WHERE r.workspace_id = $1 AND r.id = $2`, workspaceID, id))
	if err != nil {
		return r, err
	}
	list := []SignatureRequest{r}
	err = q.addSignersAndFields(ctx, list)
	return list[0], err
}

// SignatureRequests: the workspace's requests, newest first; documentID and status filter when not "".
func (q Q) SignatureRequests(ctx context.Context, workspaceID, documentID, status string, now time.Time) ([]SignatureRequest, error) {
	rows, err := q.db.Query(ctx, signatureSelect+`WHERE r.workspace_id = $1
			AND ($2 = '' OR r.document_id = $2 OR r.signed_document_id = $2)
			AND ($3 = '' OR ($3 = 'expired' AND r.status = 'pending' AND r.expires_at <= $4)
				OR ($3 = 'pending' AND r.status = 'pending' AND r.expires_at > $4) OR ($3 NOT IN ('expired', 'pending') AND r.status = $3))
		ORDER BY r.created_at DESC, r.id LIMIT 500`, workspaceID, documentID, status, now)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (SignatureRequest, error) { return scanSignatureRequest(row) })
	if err != nil {
		return nil, err
	}
	return list, q.addSignersAndFields(ctx, list)
}

func (q Q) addSignersAndFields(ctx context.Context, list []SignatureRequest) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]string, len(list))
	at := make(map[string]int, len(list))
	for i, r := range list {
		ids[i], at[r.ID] = r.ID, i
	}
	rows, err := q.db.Query(ctx, `SELECT request_id, id, position, name, email, token_hash IS NOT NULL, sent_at, viewed_at, viewed_ip,
			viewed_ua, signed_at, signed_ip, signed_ua, signature_method, declined_at, decline_reason
		FROM signature_signers WHERE request_id = ANY($1) ORDER BY request_id, position`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var rid string
		var s Signer
		if err := rows.Scan(&rid, &s.ID, &s.Position, &s.Name, &s.Email, &s.HasToken, &s.SentAt, &s.ViewedAt, &s.ViewedIP, &s.ViewedUA,
			&s.SignedAt, &s.SignedIP, &s.SignedUA, &s.SignatureMethod, &s.DeclinedAt, &s.DeclineReason); err != nil {
			return err
		}
		list[at[rid]].Signers = append(list[at[rid]].Signers, s)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	frows, err := q.db.Query(ctx, `SELECT request_id, id, signer_id, page, kind, x, y, w, h, label, value
		FROM signature_fields WHERE request_id = ANY($1) ORDER BY request_id, position`, ids)
	if err != nil {
		return err
	}
	defer frows.Close()
	for frows.Next() {
		var rid string
		var f SignatureField
		if err := frows.Scan(&rid, &f.ID, &f.SignerID, &f.Page, &f.Kind, &f.X, &f.Y, &f.W, &f.H, &f.Label, &f.Value); err != nil {
			return err
		}
		list[at[rid]].Fields = append(list[at[rid]].Fields, f)
	}
	return frows.Err()
}

// LockSignatureRequest holds the request's row until the transaction ends, so signatures, declines, reminders and
// the completion of one request happen one at a time.
func (q Q) LockSignatureRequest(ctx context.Context, id string) error {
	var x string
	return q.db.QueryRow(ctx, `SELECT id FROM signature_requests WHERE id = $1 FOR UPDATE`, id).Scan(&x)
}

// SignerByToken: the workspace, request and signer a link's token hash belongs to.
func (q Q) SignerByToken(ctx context.Context, tokenHash string) (workspaceID, requestID, signerID string, err error) {
	err = q.db.QueryRow(ctx, `SELECT r.workspace_id, r.id, s.id FROM signature_signers s
		JOIN signature_requests r ON r.id = s.request_id WHERE s.token_hash = $1`, tokenHash).Scan(&workspaceID, &requestID, &signerID)
	return
}

// SetSignerToken gives the signer a new link (the old one stops working) and records when it was emailed.
func (q Q) SetSignerToken(ctx context.Context, signerID, tokenHash string, sentAt *time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_signers SET token_hash = $2, sent_at = coalesce($3, sent_at) WHERE id = $1`,
		signerID, tokenHash, sentAt)
	return err
}

func (q Q) MarkSignerSent(ctx context.Context, signerID string, at time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_signers SET sent_at = $2 WHERE id = $1`, signerID, at)
	return err
}

// MarkSignerViewed records the first view only; true when this was it.
func (q Q) MarkSignerViewed(ctx context.Context, signerID string, at time.Time, ip, ua string) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE signature_signers SET viewed_at = $2, viewed_ip = $3, viewed_ua = $4
		WHERE id = $1 AND viewed_at IS NULL`, signerID, at, ip, ua)
	return tag.RowsAffected() == 1, err
}

func (q Q) SignSigner(ctx context.Context, signerID string, at time.Time, ip, ua, method string, png []byte) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_signers SET signed_at = $2, signed_ip = $3, signed_ua = $4, signature_method = $5,
		signature_png = $6, viewed_at = coalesce(viewed_at, $2), viewed_ip = coalesce(viewed_ip, $3), viewed_ua = coalesce(viewed_ua, $4)
		WHERE id = $1`, signerID, at, ip, ua, method, png)
	return err
}

func (q Q) SetSignatureFieldValue(ctx context.Context, fieldID, value string) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_fields SET value = $2 WHERE id = $1`, fieldID, value)
	return err
}

func (q Q) DeclineSigner(ctx context.Context, signerID string, at time.Time, reason string) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_signers SET declined_at = $2, decline_reason = $3 WHERE id = $1`, signerID, at, reason)
	return err
}

func (q Q) SetSignatureStatus(ctx context.Context, id, status string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_requests SET status = $2, updated_at = $3 WHERE id = $1`, id, status, now)
	return err
}

func (q Q) CompleteSignatureRequest(ctx context.Context, id, documentID, finalSHA256 string, now time.Time) error {
	var workspaceID string
	var original *string
	if err := q.db.QueryRow(ctx, `UPDATE signature_requests SET status = 'completed', signed_document_id = $2, final_sha256 = $3,
		completed_at = $4, updated_at = $4 WHERE id = $1 RETURNING workspace_id, document_id`, id, documentID, finalSHA256, now).
		Scan(&workspaceID, &original); err != nil {
		return err
	}
	if original != nil {
		if err := q.AutoTag(ctx, workspaceID, *original, now); err != nil {
			return err
		}
	}
	return q.AutoTag(ctx, workspaceID, documentID, now)
}

func (q Q) TouchSignatureRequest(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE signature_requests SET updated_at = $2 WHERE id = $1`, id, now)
	return err
}

// SignatureImages: each signer's signature PNG, by signer id.
func (q Q) SignatureImages(ctx context.Context, requestID string) (map[string][]byte, error) {
	rows, err := q.db.Query(ctx, `SELECT id, signature_png FROM signature_signers WHERE request_id = $1 AND signature_png IS NOT NULL`,
		requestID)
	if err != nil {
		return nil, err
	}
	out := map[string][]byte{}
	for rows.Next() {
		var id string
		var png []byte
		if err := rows.Scan(&id, &png); err != nil {
			rows.Close()
			return nil, err
		}
		out[id] = png
	}
	return out, rows.Err()
}

// LastSignatureEvent: the newest event's sequence number and hash (0, "" before the first).
func (q Q) LastSignatureEvent(ctx context.Context, requestID string) (int, string, error) {
	var seq int
	var hash string
	err := q.db.QueryRow(ctx, `SELECT seq, hash FROM signature_events WHERE request_id = $1 ORDER BY seq DESC LIMIT 1`, requestID).
		Scan(&seq, &hash)
	if err == pgx.ErrNoRows {
		return 0, "", nil
	}
	return seq, hash, err
}

func (q Q) InsertSignatureEvent(ctx context.Context, requestID string, e SignatureEvent) error {
	_, err := q.db.Exec(ctx, `INSERT INTO signature_events (request_id, seq, type, signer_id, at, ip, user_agent, data, hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, requestID, e.Seq, e.Type, e.SignerID, e.At, e.IP, e.UserAgent, e.Data, e.Hash)
	return err
}

// SignatureEvents: the request's audit trail, oldest first.
func (q Q) SignatureEvents(ctx context.Context, requestID string) ([]SignatureEvent, error) {
	rows, err := q.db.Query(ctx, `SELECT e.seq, e.type, e.signer_id, s.name, s.email, e.at, e.ip, e.user_agent, e.data, e.hash
		FROM signature_events e LEFT JOIN signature_signers s ON s.id = e.signer_id
		WHERE e.request_id = $1 ORDER BY e.seq`, requestID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (SignatureEvent, error) {
		var e SignatureEvent
		var name, email *string
		err := row.Scan(&e.Seq, &e.Type, &e.SignerID, &name, &email, &e.At, &e.IP, &e.UserAgent, &e.Data, &e.Hash)
		if e.SignerID != nil && name != nil && email != nil {
			e.Signer = &EventSigner{ID: *e.SignerID, Name: *name, Email: *email}
		}
		return e, err
	})
}

// CountSignatureEvents: events of a type since a moment (for the reminder limit).
func (q Q) CountSignatureEvents(ctx context.Context, requestID, eventType string, since time.Time) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM signature_events WHERE request_id = $1 AND type = $2 AND at > $3`,
		requestID, eventType, since).Scan(&n)
	return n, err
}
