package quotes

import (
	"context"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// CreateImport saves a quote read from a document by an AI import, in the caller's transaction: the content
// internal/invoices checked (inv, valid-until in DueDate), the document's own number and its status as the document
// shows it. A quote answered elsewhere was decided by staff. Its PDF is rendered live, like a draft's.
func CreateImport(ctx context.Context, q store.Q, sess store.Session, inv store.Invoice, number *string, status string, now time.Time) (string, error) {
	t := store.Quote{ID: auth.NewID("quo"), Number: number, Status: status, Revision: 1}
	fromInvoice(&t, inv)
	if status != "draft" {
		t.SentAt = &now
	}
	if status == "accepted" || status == "declined" {
		by := "staff"
		t.DecidedAt, t.DecidedBy = &now, &by
	}
	if err := q.SaveQuote(ctx, sess.Workspace.ID, t, now); err != nil {
		return "", err
	}
	return t.ID, wrote(ctx, q, sess, t.ID)
}
