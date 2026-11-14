package einvoice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// serializerVersion is recorded with each archived file, so a later change of the serializer stays traceable.
func serializerVersion(format string) string {
	if format == FormatFA3 {
		return "helvetly-ksef-fa3-2"
	}
	return "helvetly-en16931-1"
}

const maxXMLArchiveSize = 16 << 20

var errXMLArchiveIntegrity = errors.New("e-invoice archive integrity check failed")
var errXMLArchiveStorage = errors.New("e-invoice archive storage unavailable")

type FileStorage interface {
	Put(context.Context, string, io.Reader, int64, string, string) error
	Open(context.Context, string) (io.ReadSeekCloser, error)
	Delete(context.Context, string) error
}

type archivedXML struct {
	bytes  []byte
	record store.InvoiceXML
}
type xmlArchive struct {
	db    *store.Store
	files FileStorage
	now   func() time.Time
	log   *slog.Logger
}

func (a *xmlArchive) export(ctx context.Context, sess store.Session, invoice store.Invoice, format string, render func(store.Invoice) ([]byte, error)) (archivedXML, error) {
	if a.files == nil || a.db == nil {
		return archivedXML{}, fmt.Errorf("%w: storage is not configured", errXMLArchiveStorage)
	}
	var record store.InvoiceXML
	written := ""
	err := a.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, invoice.ID, sess.Workspace.Today(a.now()), true)
		if err != nil {
			return err
		}
		if err := q.LockInvoiceXML(ctx, sess.Workspace.ID, inv.ID, format); err != nil {
			return err
		}
		record, err = q.InvoiceXML(ctx, sess.Workspace.ID, inv.ID, format)
		if err == nil {
			return nil
		}
		if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		data, err := render(inv)
		if err != nil {
			return err
		}
		if len(data) == 0 || len(data) > maxXMLArchiveSize {
			return fmt.Errorf("e-invoice XML size %d is outside archive limits", len(data))
		}
		digest := sha256.Sum256(data)
		created := a.now().UTC().Truncate(time.Microsecond)
		var actor *string
		if sess.User.ID != "" {
			actor = &sess.User.ID
		}
		record = store.InvoiceXML{InvoiceID: inv.ID, Format: format, Version: serializerVersion(format), ObjectKey: "workspaces/" + sess.Workspace.ID + "/invoices/" + inv.ID + "/xml/" + auth.NewID("xml") + ".xml",
			SHA256: hex.EncodeToString(digest[:]), Size: int64(len(data)), Filename: deref(inv.Number) + ".xml", CreatedAt: created, CreatedBy: actor}
		written = record.ObjectKey
		if err := a.files.Put(ctx, record.ObjectKey, bytes.NewReader(data), record.Size, "application/xml", record.Filename); err != nil {
			return fmt.Errorf("%w: %w", errXMLArchiveStorage, err)
		}
		if err := q.CreateInvoiceXML(ctx, sess.Workspace.ID, record); err != nil {
			return err
		}
		if err := retention.Request(ctx, q, a.files, sess.Workspace.ID, record.ObjectKey, inv.IssueDate, created); err != nil {
			return err
		}
		payload, err := json.Marshal(struct {
			Format  string `json:"format"`
			Version string `json:"serializer_version"`
			SHA256  string `json:"sha256"`
			Size    int64  `json:"size"`
		}{format, record.Version, record.SHA256, record.Size})
		if err != nil {
			return err
		}
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "invoice.xml_archived", SubjectType: "invoice", SubjectID: inv.ID, ActorID: actor, At: created, Payload: payload})
	})
	if err != nil {
		if written != "" {
			a.cleanup(ctx, sess.Workspace.ID, invoice.ID, format, written)
		}
		return archivedXML{}, err
	}
	data, err := a.read(ctx, record)
	if err != nil {
		return archivedXML{}, err
	}
	if written != "" { // the archive committed: lock it now; a failure stays pending for the retention job
		retention.Settle(ctx, a.db, a.files, a.log, written)
		if r, err := a.db.Retention(ctx, written); err == nil {
			record.Retained = r.Status == store.RetentionConfirmed
		}
	}
	return archivedXML{data, record}, nil
}

func (a *xmlArchive) read(ctx context.Context, record store.InvoiceXML) ([]byte, error) {
	if record.Size <= 0 || record.Size > maxXMLArchiveSize {
		return nil, errXMLArchiveIntegrity
	}
	object, err := a.files.Open(ctx, record.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("%w: read: %w", errXMLArchiveStorage, err)
	}
	data, readErr := io.ReadAll(io.LimitReader(object, record.Size+1))
	closeErr := object.Close()
	if readErr != nil {
		return nil, fmt.Errorf("%w: read: %w", errXMLArchiveStorage, readErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("%w: close: %w", errXMLArchiveStorage, closeErr)
	}
	digest := sha256.Sum256(data)
	if int64(len(data)) != record.Size || hex.EncodeToString(digest[:]) != record.SHA256 {
		return nil, errXMLArchiveIntegrity
	}
	return data, nil
}

func (a *xmlArchive) cleanup(ctx context.Context, workspaceID, invoiceID, format, key string) {
	cleanupCtx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	// A failed COMMIT can have an unknown outcome. Never delete an object still referenced by an archive.
	stored, err := a.db.InvoiceXML(cleanupCtx, workspaceID, invoiceID, format)
	if err == nil && stored.ObjectKey == key {
		return
	}
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		a.log.ErrorContext(cleanupCtx, "cannot establish XML archive commit outcome; kept object", "key", key, "error", err)
		return
	}
	if err := a.files.Delete(cleanupCtx, key); err != nil {
		a.log.ErrorContext(cleanupCtx, "remove uncommitted XML archive", "key", key, "error", err)
	}
}
