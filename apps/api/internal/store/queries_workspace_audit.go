package store

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// Each projection contains only the inputs used in the audit, never HR files or private client notes.
type AuditClient struct {
	ID, Name string
	Number   int64
}
type AuditInvoice struct {
	ID, Number, Client, Currency, Reference, Contract, Source, PDFKey, Status, Kind string
	Total, Paid, PaidRows, InstalmentTotal                                          int64
	Schedule                                                                        []AuditInstalment
}
type AuditInstalment struct {
	Date   string `json:"date"`
	Amount int64  `json:"amount"`
}
type AuditPayment struct {
	ID, Invoice, Date, Method string
	Amount                    int64
}
type AuditOtherRecord struct {
	ID, Label, Client, Currency string
	Total                       int64
	PDFKey                      string
}
type AuditDocument struct {
	ID, Name, Kind, Client, FolderClient, FolderYear, ObjectKey string
	Owners, Payments, Refunds, Expenses, Invoices               []string
	ContractEvidence                                            bool
	Status                                                      string
	Facts                                                       json.RawMessage
}

func (q Q) AuditClients(ctx context.Context, ws string) ([]AuditClient, error) {
	rows, err := q.db.Query(ctx, `SELECT id,name,number FROM clients WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY number`, ws)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditClient])
}
func (q Q) AuditInvoices(ctx context.Context, ws string) ([]AuditInvoice, error) {
	rows, err := q.db.Query(ctx, `SELECT i.id,coalesce(i.number,''),i.client_id,i.currency,coalesce(i.contract_reference,''),coalesce(i.contract_document_id,''),
 coalesce(i.source_document_id,''),coalesce(i.pdf_key,''),i.status,i.kind,i.total+i.rounding_amount,i.amount_paid,
 coalesce((SELECT sum(p.amount) FROM invoice_payments p WHERE p.invoice_id=i.id),0)::bigint,
 a.total,a.schedule FROM invoices i CROSS JOIN LATERAL (SELECT coalesce(sum(t.amount),0)::bigint total,coalesce(jsonb_agg(jsonb_build_object('date',t.due_date,'amount',t.amount) ORDER BY t.seq),'[]') schedule FROM invoice_instalments t WHERE t.invoice_id=i.id) a
 WHERE i.workspace_id=$1 ORDER BY i.id`, ws)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditInvoice])
}
func (q Q) AuditPayments(ctx context.Context, ws string) ([]AuditPayment, error) {
	rows, err := q.db.Query(ctx, `SELECT p.id,p.invoice_id,to_char(p.paid_on,'YYYY-MM-DD'),p.method,p.amount FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.workspace_id=$1 ORDER BY p.id`, ws)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditPayment])
}
func (q Q) AuditQuotes(ctx context.Context, ws string) ([]AuditOtherRecord, error) {
	rows, err := q.db.Query(ctx, `SELECT id,coalesce(number,id),client_id,currency,total,coalesce(pdf_key,'') FROM quotes WHERE workspace_id=$1 ORDER BY id`, ws)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditOtherRecord])
}
func (q Q) AuditExpenses(ctx context.Context, ws string) ([]AuditOtherRecord, error) {
	rows, err := q.db.Query(ctx, `SELECT id,coalesce(nullif(supplier_name,''),id),'',currency,total,'' FROM expenses WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY id`, ws)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditOtherRecord])
}

// The source name is part of the reading (e.g. the format of an otherwise untyped spreadsheet).
const auditFingerprint = `md5(jsonb_build_array('v1',d.object_key,d.sha256,d.size,d.content_type,d.name)::text)`
const auditCached = ` LEFT JOIN workspace_audit_evidence a ON a.workspace_id=d.workspace_id AND a.document_id=d.id
 AND a.language=$2 AND a.fingerprint=` + auditFingerprint + `
 AND (a.status NOT IN ('missing','integrity') OR a.checked_at > now()-interval '5 minutes') `

func (q Q) AuditDocuments(ctx context.Context, ws, lang, zone, id string, contractChecks bool) ([]AuditDocument, error) {
	args := []any{ws, lang, zoneOr(zone), contractChecks}
	filter := ""
	if id != "" {
		filter = " AND d.id=$5"
		args = append(args, id)
	}
	rows, err := q.db.Query(ctx, classCTE+` SELECT d.id,d.name,g.type,g.client,coalesce(fx.client,''),coalesce(fx.year,''),d.object_key,
 ARRAY(SELECT l.target_id FROM document_links l WHERE l.workspace_id=$1 AND l.document_id=d.id AND l.target_type='client' ORDER BY l.target_id),
 ARRAY(SELECT l.target_id FROM document_links l WHERE l.workspace_id=$1 AND l.document_id=d.id AND l.target_type='payment' ORDER BY l.target_id),
 ARRAY(SELECT l.target_id FROM document_links l WHERE l.workspace_id=$1 AND l.document_id=d.id AND l.target_type='refund' ORDER BY l.target_id),
 ARRAY(SELECT l.target_id FROM document_links l WHERE l.workspace_id=$1 AND l.document_id=d.id AND l.target_type='expense' ORDER BY l.target_id),
 ARRAY(SELECT l.target_id FROM document_links l WHERE l.workspace_id=$1 AND l.document_id=d.id AND l.target_type='invoice' ORDER BY l.target_id),
CASE WHEN $4::boolean AND a.status IS NULL THEN EXISTS (SELECT 1 FROM invoices i WHERE i.workspace_id=$1 AND i.number<>'' AND i.status<>'draft'
	AND (i.contract_document_id=d.id OR i.source_document_id=d.id
		OR (coalesce(i.source_document_id,'')='' AND i.pdf_key=d.object_key))) ELSE false END,
 coalesce(a.status,''),coalesce(a.facts,'{}'::jsonb) FROM documents d `+classJoins("$3")+auditCached+
		` WHERE d.workspace_id=$1 AND d.deleted_at IS NULL AND NOT d.hr_private`+filter+` ORDER BY d.id`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditDocument])
}

type AuditSource struct {
	ID, Name, Key, Hash, Fingerprint, Status string
	Size                                     int64
}

func (q Q) AuditSource(ctx context.Context, ws, lang, id string) (AuditSource, error) {
	var d AuditSource
	err := q.db.QueryRow(ctx, `SELECT d.id,d.name,d.object_key,coalesce(d.sha256,''),`+auditFingerprint+`,coalesce(a.status,''),d.size FROM documents d `+auditCached+
		` WHERE d.workspace_id=$1 AND d.id=$3 AND d.deleted_at IS NULL AND NOT d.hr_private`, ws, lang, id).Scan(&d.ID, &d.Name, &d.Key, &d.Hash, &d.Fingerprint, &d.Status, &d.Size)
	return d, err
}
func (q Q) SaveAuditEvidence(ctx context.Context, ws, lang, id, fingerprint, status string, facts json.RawMessage) error {
	tag, err := q.db.Exec(ctx, `INSERT INTO workspace_audit_evidence(workspace_id,document_id,language,fingerprint,status,facts,checked_at)
 SELECT d.workspace_id,d.id,$2,$4,$5,$6,now() FROM documents d WHERE d.workspace_id=$1 AND d.id=$3 AND d.deleted_at IS NULL AND NOT d.hr_private AND `+auditFingerprint+`=$4
 ON CONFLICT(workspace_id,document_id,language) DO UPDATE SET fingerprint=excluded.fingerprint,status=excluded.status,facts=excluded.facts,checked_at=excluded.checked_at`, ws, lang, id, fingerprint, status, facts)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (q Q) ClaimAuditDocument(ctx context.Context, ws, lang, id, token string) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO workspace_audit_claims(workspace_id,document_id,language,token,expires_at)
 SELECT d.workspace_id,d.id,$2,$4,now()+interval '5 minutes' FROM documents d `+auditCached+`
 WHERE d.workspace_id=$1 AND d.id=$3 AND d.deleted_at IS NULL AND NOT d.hr_private AND a.document_id IS NULL
 ON CONFLICT(workspace_id,document_id,language) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at
 WHERE workspace_audit_claims.expires_at<=now()`, ws, lang, id, token)
	return tag.RowsAffected() == 1, err
}
func (q Q) ReleaseAuditDocument(ctx context.Context, ws, lang, id, token string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM workspace_audit_claims WHERE workspace_id=$1 AND language=$2 AND document_id=$3 AND token=$4`, ws, lang, id, token)
	return err
}
