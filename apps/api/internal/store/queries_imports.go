package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ImportDuplicate: an existing record an imported one may repeat (docs/imports-contract.md).
type ImportDuplicate struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

type ImportBatch struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"-"`
	UserID      string         `json:"-"`
	Kind        string         `json:"kind"`
	Status      string         `json:"status"`
	CreatedAt   time.Time      `json:"created_at"`
	Files       []ImportFile   `json:"files"`
	Records     []ImportRecord `json:"records"`
}

type ImportBatchSummary struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	Pending   int       `json:"pending"`
}

type ImportFile struct {
	ID          string  `json:"id"`
	BatchID     string  `json:"-"`
	WorkspaceID string  `json:"-"`
	Position    int     `json:"-"`
	Name        string  `json:"name"`
	Size        int64   `json:"size"`
	ContentType string  `json:"-"`
	ObjectKey   *string `json:"-"`
	EntryIndex  *int    `json:"-"`
	DocumentID  *string `json:"-"`
	Reused      bool    `json:"reused"`
	Status      string  `json:"status"`
	Error       *string `json:"error"`
	ChunksDone  int     `json:"chunks_done"`
	ChunksTotal *int    `json:"chunks_total"`
	Attempts    int     `json:"-"`
	Kind        string  `json:"-"` // the batch's, for the job
	// DocumentType is what the model recognised the file as, in an auto batch ("sales_invoice", "contract", …).
	DocumentType *string `json:"document_type"`
}

type ImportRecord struct {
	ID     string `json:"id"`
	FileID string `json:"file_id"`
	// Kind is the record's kind: the batch's, or the one the model chose in an auto batch.
	Kind      string                     `json:"kind"`
	Status    string                     `json:"status"`
	Data      map[string]json.RawMessage `json:"data"`
	Issues    map[string]string          `json:"issues"`
	Duplicate *ImportDuplicate           `json:"duplicate"`
	EntityID  *string                    `json:"entity_id"`
	Error     *string                    `json:"error"`
	// GeneratedBy marks the record as the AI model's extraction (AI Act Art. 50(2)); always "model", kept on edits.
	GeneratedBy string `json:"generated_by"`
}

// CreateImportBatch inserts the batch and its files (positions as given).
func (q Q) CreateImportBatch(ctx context.Context, b ImportBatch, files []ImportFile, now time.Time) error {
	if _, err := q.db.Exec(ctx, `INSERT INTO import_batches (id, workspace_id, user_id, kind, created_at) VALUES ($1,$2,$3,$4,$5)`,
		b.ID, b.WorkspaceID, b.UserID, b.Kind, now); err != nil {
		return err
	}
	for _, f := range files {
		if _, err := q.db.Exec(ctx, `INSERT INTO import_files (id, batch_id, workspace_id, position, name, size, content_type,
			object_key, entry_index, document_id, reused, status, error, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
			f.ID, b.ID, b.WorkspaceID, f.Position, f.Name, f.Size, f.ContentType, f.ObjectKey, f.EntryIndex, f.DocumentID,
			f.Reused, f.Status, f.Error, now); err != nil {
			return err
		}
	}
	return nil
}

// ImportBatch: the person's batch with its files and records; ErrNotFound for anyone else's.
func (q Q) ImportBatch(ctx context.Context, workspaceID, userID, id string) (ImportBatch, error) {
	var b ImportBatch
	err := q.db.QueryRow(ctx, `SELECT id, kind, created_at FROM import_batches WHERE workspace_id=$1 AND user_id=$2 AND id=$3`,
		workspaceID, userID, id).Scan(&b.ID, &b.Kind, &b.CreatedAt)
	if err != nil {
		return b, err
	}
	b.WorkspaceID, b.UserID, b.Status = workspaceID, userID, "review"
	rows, err := q.db.Query(ctx, `SELECT id, name, size, reused, status, error, chunks_done, chunks_total, document_type
		FROM import_files WHERE batch_id=$1 ORDER BY position`, id)
	if err != nil {
		return b, err
	}
	b.Files = []ImportFile{}
	for rows.Next() {
		var f ImportFile
		if err := rows.Scan(&f.ID, &f.Name, &f.Size, &f.Reused, &f.Status, &f.Error, &f.ChunksDone, &f.ChunksTotal, &f.DocumentType); err != nil {
			rows.Close()
			return b, err
		}
		if f.Status == "queued" || f.Status == "extracting" {
			b.Status = "extracting"
		}
		b.Files = append(b.Files, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return b, err
	}
	b.Records, err = q.importRecords(ctx, `WHERE batch_id=$1 ORDER BY position`, id)
	return b, err
}

func (q Q) importRecords(ctx context.Context, where string, args ...any) ([]ImportRecord, error) {
	rows, err := q.db.Query(ctx, `SELECT id, file_id, coalesce(kind, (SELECT b.kind FROM import_batches b WHERE b.id=import_records.batch_id)), status, data,
		issues, duplicate, entity_id, error, generated_by FROM import_records `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []ImportRecord{}
	for rows.Next() {
		var r ImportRecord
		if err := rows.Scan(&r.ID, &r.FileID, &r.Kind, &r.Status, &r.Data, &r.Issues, &r.Duplicate, &r.EntityID, &r.Error, &r.GeneratedBy); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	return list, rows.Err()
}

// ImportBatches: the person's ten newest batches of a kind, with how many records still wait.
func (q Q) ImportBatches(ctx context.Context, workspaceID, userID, kind string) ([]ImportBatchSummary, error) {
	rows, err := q.db.Query(ctx, `SELECT b.id, b.kind, b.created_at,
			EXISTS (SELECT 1 FROM import_files f WHERE f.batch_id=b.id AND f.status IN ('queued','extracting')),
			(SELECT count(*) FROM import_records r WHERE r.batch_id=b.id AND r.status NOT IN ('created','skipped'))
		FROM import_batches b WHERE b.workspace_id=$1 AND b.user_id=$2 AND b.kind=$3 ORDER BY b.created_at DESC, b.id DESC LIMIT 10`,
		workspaceID, userID, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []ImportBatchSummary{}
	for rows.Next() {
		var s ImportBatchSummary
		var extracting bool
		if err := rows.Scan(&s.ID, &s.Kind, &s.CreatedAt, &extracting, &s.Pending); err != nil {
			return nil, err
		}
		s.Status = "review"
		if extracting {
			s.Status = "extracting"
		}
		list = append(list, s)
	}
	return list, rows.Err()
}

// DeleteImportBatch removes the person's batch; false when there is none.
func (q Q) DeleteImportBatch(ctx context.Context, workspaceID, userID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM import_batches WHERE workspace_id=$1 AND user_id=$2 AND id=$3`, workspaceID, userID, id)
	return tag.RowsAffected() == 1, err
}

// LockImportRecord reads one record of a batch for update. Run it in a transaction.
func (q Q) LockImportRecord(ctx context.Context, batchID, id string) (ImportRecord, error) {
	list, err := q.importRecords(ctx, `WHERE batch_id=$1 AND id=$2 FOR UPDATE`, batchID, id)
	if err == nil && len(list) == 0 {
		err = ErrNotFound
	}
	if err != nil {
		return ImportRecord{}, err
	}
	return list[0], nil
}

// SaveImportRecord writes a record's data, review and outcome.
func (q Q) SaveImportRecord(ctx context.Context, r ImportRecord, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE import_records SET status=$2, data=$3, issues=$4, duplicate=$5, entity_id=$6, error=$7, updated_at=$8
		WHERE id=$1`, r.ID, r.Status, r.Data, r.Issues, r.Duplicate, r.EntityID, r.Error, now)
	return err
}

// AddImportRecords appends records extracted from one chunk of a file and counts the chunk done, in one write.
// ErrNotFound when f's claim (its attempt) is no longer the file's: another worker took it over. Run it in a transaction.
func (q Q) AddImportRecords(ctx context.Context, f ImportFile, records []ImportRecord, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE import_files SET chunks_done=chunks_done+1, updated_at=$2
		WHERE id=$1 AND status='extracting' AND attempts=$3`, f.ID, now, f.Attempts)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return q.InsertImportRecords(ctx, f, records, now)
}

// InsertImportRecords appends records read from file f after the batch's last one, without counting a chunk.
func (q Q) InsertImportRecords(ctx context.Context, f ImportFile, records []ImportRecord, now time.Time) error {
	var next int
	if err := q.db.QueryRow(ctx, `SELECT coalesce(max(position), -1) + 1 FROM import_records WHERE batch_id=$1`, f.BatchID).Scan(&next); err != nil {
		return err
	}
	for i, r := range records {
		if _, err := q.db.Exec(ctx, `INSERT INTO import_records (id, batch_id, file_id, workspace_id, position, kind, data, issues,
			duplicate, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
			r.ID, f.BatchID, f.ID, f.WorkspaceID, next+i, r.Kind, r.Data, r.Issues, r.Duplicate, now); err != nil {
			return err
		}
	}
	return nil
}

// ImportNameTaken: an earlier record of the batch of this kind whose field has the same value (case-insensitive), for
// the duplicate hint; with recordID "" any record of the kind not skipped.
func (q Q) ImportNameTaken(ctx context.Context, batchID, recordID, kind, field, name string) (bool, error) {
	var taken bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM import_records WHERE batch_id=$1 AND id<>$2
		AND (kind IS NULL OR kind=$5) AND status<>'skipped'
		AND lower(data->>$4)=lower($3) AND position < coalesce((SELECT position FROM import_records WHERE id=$2), 2147483647))`,
		batchID, recordID, name, field, kind).Scan(&taken)
	return taken, err
}

// SetImportFileType records the document type the model recognised the file as, under the file's claim (attempt).
func (q Q) SetImportFileType(ctx context.Context, id string, attempt int, documentType string) error {
	_, err := q.db.Exec(ctx, `UPDATE import_files SET document_type=$2 WHERE id=$1 AND attempts=$3`, id, documentType, attempt)
	return err
}

// ImportSource is the file a record was read from: its Document, unless it is a ZIP entry.
// ImportSource is the file a record was read from. DocumentID is set only for a plain upload whose bytes are a live
// Document (a reused upload may instead be another expense's receipt); ObjectKey is the stored upload (the ZIP, for an
// entry at EntryIndex).
type ImportSource struct {
	DocumentID  *string
	Name        string
	ContentType string
	ObjectKey   *string
	EntryIndex  *int
}

func (q Q) ImportRecordSource(ctx context.Context, batchID, recordID string) (ImportSource, error) {
	var s ImportSource
	err := q.db.QueryRow(ctx, `SELECT d.id, f.name, f.content_type, f.object_key, f.entry_index
		FROM import_records r JOIN import_files f ON f.id=r.file_id
		LEFT JOIN documents d ON f.entry_index IS NULL AND d.id=f.document_id AND d.workspace_id=f.workspace_id AND d.deleted_at IS NULL
		WHERE r.batch_id=$1 AND r.id=$2`, batchID, recordID).Scan(&s.DocumentID, &s.Name, &s.ContentType, &s.ObjectKey, &s.EntryIndex)
	return s, err
}

// ClaimImportFiles marks up to n due files as extracting until now+lease: queued ones whose retry time has come and
// extracting ones whose claim lapsed (a stopped instance). SKIP LOCKED keeps instances apart.
func (q Q) ClaimImportFiles(ctx context.Context, now time.Time, lease time.Duration, n int) ([]ImportFile, error) {
	rows, err := q.db.Query(ctx, `UPDATE import_files f SET status='extracting', attempts=f.attempts+1, claimed_until=$2, updated_at=$1
		FROM import_batches b WHERE b.id=f.batch_id AND f.id IN (
			SELECT id FROM import_files WHERE (status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=$1))
				OR (status='extracting' AND claimed_until<$1)
			ORDER BY created_at, position LIMIT $3 FOR UPDATE SKIP LOCKED)
		RETURNING f.id, f.batch_id, f.workspace_id, f.position, f.name, f.size, f.content_type, f.object_key, f.entry_index,
			f.chunks_done, f.attempts, b.kind`, now, now.Add(lease), n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []ImportFile{}
	for rows.Next() {
		var f ImportFile
		if err := rows.Scan(&f.ID, &f.BatchID, &f.WorkspaceID, &f.Position, &f.Name, &f.Size, &f.ContentType, &f.ObjectKey,
			&f.EntryIndex, &f.ChunksDone, &f.Attempts, &f.Kind); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	return list, rows.Err()
}

// ImportFileProgress records how many chunks the file has and keeps its claim (attempt) alive; ErrNotFound when the
// claim is no longer the file's.
func (q Q) ImportFileProgress(ctx context.Context, id string, attempt, total int, claimedUntil, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE import_files SET chunks_total=$2, claimed_until=$3, updated_at=$4
		WHERE id=$1 AND status='extracting' AND attempts=$5`, id, total, claimedUntil, now, attempt)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

// FinishImportFile ends a claim (attempt): done, failed with a reason, or queued again at retry. ErrNotFound when the
// claim is no longer the file's, which then stays with its current worker.
func (q Q) FinishImportFile(ctx context.Context, id string, attempt int, status string, reason *string, retry *time.Time, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE import_files SET status=$2, error=$3, next_attempt_at=$4, claimed_until=NULL, updated_at=$5
		WHERE id=$1 AND status='extracting' AND attempts=$6`, id, status, reason, retry, now, attempt)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

// ImportOutcome: a batch's state once a file finishes. Open counts files still to read; Error is a failed file's
// reason, "" when none failed.
type ImportOutcome struct {
	WorkspaceID, UserID, Kind string
	Open, Files, Records      int
	Error                     string
}

func (q Q) ImportOutcome(ctx context.Context, batchID string) (ImportOutcome, error) {
	var o ImportOutcome
	err := q.db.QueryRow(ctx, `SELECT b.workspace_id, b.user_id, b.kind,
			(SELECT count(*) FROM import_files f WHERE f.batch_id = b.id AND f.status IN ('queued', 'extracting')),
			(SELECT count(*) FROM import_files f WHERE f.batch_id = b.id),
			(SELECT count(*) FROM import_records r WHERE r.batch_id = b.id),
			coalesce((SELECT f.error FROM import_files f WHERE f.batch_id = b.id AND f.status = 'failed' ORDER BY f.position LIMIT 1), '')
		FROM import_batches b WHERE b.id = $1`, batchID).Scan(&o.WorkspaceID, &o.UserID, &o.Kind, &o.Open, &o.Files, &o.Records, &o.Error)
	return o, err
}

// ExistingUpload: the stored object of a Document or receipt of the workspace with these bytes, so an import reads it
// instead of storing the bytes again.
func (q Q) ExistingUpload(ctx context.Context, workspaceID, sum string) (id, objectKey string, err error) {
	err = q.db.QueryRow(ctx, `SELECT id, object_key FROM (
		SELECT id, object_key, 'document' AS resource FROM documents WHERE workspace_id=$1 AND sha256=$2 AND deleted_at IS NULL
		UNION ALL
		SELECT r.id, r.object_key, 'receipt' FROM expense_receipts r JOIN expenses e ON e.id=r.expense_id
		WHERE r.workspace_id=$1 AND r.sha256=$2 AND e.deleted_at IS NULL
	) matched ORDER BY resource, id LIMIT 1`, workspaceID, sum).Scan(&id, &objectKey)
	return id, objectKey, err
}

// SimilarClient: a live client with the same name, VAT number or email (case-insensitive), with the matching rule.
func (q Q) SimilarClient(ctx context.Context, workspaceID, name, vat, email string) (*ImportDuplicate, error) {
	var d ImportDuplicate
	err := q.db.QueryRow(ctx, `SELECT id, name, CASE WHEN lower(name)=lower($2) THEN 'same name'
			WHEN $3<>'' AND vat_number=$3 THEN 'same VAT number' ELSE 'same email' END
		FROM clients WHERE workspace_id=$1 AND deleted_at IS NULL
			AND (lower(name)=lower($2) OR ($3<>'' AND vat_number=$3) OR ($4<>'' AND lower(email)=lower($4)))
		ORDER BY lower(name)=lower($2) DESC, number LIMIT 1`, workspaceID, name, vat, email).Scan(&d.ID, &d.Label, &d.Reason)
	return similar(d, err)
}

// SimilarProduct: a live item with the same name or an active one with the same SKU (case-insensitive).
func (q Q) SimilarProduct(ctx context.Context, workspaceID, name, sku string) (*ImportDuplicate, error) {
	var d ImportDuplicate
	err := q.db.QueryRow(ctx, `SELECT id, name, CASE WHEN $3<>'' AND lower(sku)=lower($3) AND archived_at IS NULL THEN 'same SKU' ELSE 'same name' END
		FROM products WHERE workspace_id=$1 AND deleted_at IS NULL
			AND (lower(name)=lower($2) OR ($3<>'' AND lower(sku)=lower($3) AND archived_at IS NULL))
		ORDER BY created_at LIMIT 1`, workspaceID, name, sku).Scan(&d.ID, &d.Label, &d.Reason)
	return similar(d, err)
}

func similar(d ImportDuplicate, err error) (*ImportDuplicate, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}
