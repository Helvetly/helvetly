package store

import (
	"context"
	"time"
)

type InvoiceXML struct {
	InvoiceID string
	Format    string
	Version   string
	ObjectKey string
	SHA256    string
	Size      int64
	Filename  string
	CreatedAt time.Time
	CreatedBy *string
	Retained  bool // storage confirmed its lock (object_retention), not the old unverified invoice_xml_retention mark
}

func (q Q) LockInvoiceXML(ctx context.Context, workspaceID, invoiceID, format string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "invoice_xml:"+workspaceID+":"+invoiceID+":"+format)
	return err
}

func (q Q) InvoiceXML(ctx context.Context, workspaceID, invoiceID, format string) (InvoiceXML, error) {
	var x InvoiceXML
	err := q.db.QueryRow(ctx, `SELECT x.invoice_id,x.format,x.serializer_version,x.object_key,x.sha256,x.size,x.filename,x.created_at,x.created_by,
		EXISTS(SELECT 1 FROM object_retention r WHERE r.object_key=x.object_key AND r.status='confirmed')
		FROM invoice_xml_exports x JOIN invoices i ON i.id=x.invoice_id WHERE i.workspace_id=$1 AND x.invoice_id=$2 AND x.format=$3`, workspaceID, invoiceID, format).
		Scan(&x.InvoiceID, &x.Format, &x.Version, &x.ObjectKey, &x.SHA256, &x.Size, &x.Filename, &x.CreatedAt, &x.CreatedBy, &x.Retained)
	return x, err
}

func (q Q) CreateInvoiceXML(ctx context.Context, workspaceID string, x InvoiceXML) error {
	tag, err := q.db.Exec(ctx, `INSERT INTO invoice_xml_exports(invoice_id,format,serializer_version,object_key,sha256,size,filename,created_at,created_by)
		SELECT id,$3,$4,$5,$6,$7,$8,$9,$10 FROM invoices WHERE workspace_id=$1 AND id=$2`, workspaceID, x.InvoiceID, x.Format, x.Version, x.ObjectKey, x.SHA256, x.Size, x.Filename, x.CreatedAt, x.CreatedBy)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}
