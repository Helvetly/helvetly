package quotes

import (
	"context"
	"net/http"
	"strconv"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// revisions: the quote's sent revisions, newest first, each as it was sent.
func (s *Service) revisions(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	t, err := s.db.Quote(ctx, sess.Workspace.ID, r.PathValue("id"), today(sess.Workspace, s.now()), false)
	if err != nil {
		return err
	}
	list, err := s.db.QuoteRevisions(ctx, sess.Workspace.ID, t)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

// revisionPDF: the PDF one revision was sent with, as stored.
func (s *Service) revisionPDF(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	n, err := strconv.Atoi(r.PathValue("revision"))
	if err != nil || n < 1 {
		return store.ErrNotFound
	}
	t, err := s.db.Quote(ctx, sess.Workspace.ID, r.PathValue("id"), "", false)
	if err != nil {
		return err
	}
	rev, err := s.db.QuoteRevision(ctx, sess.Workspace.ID, t.ID, n)
	if err != nil {
		return err
	}
	if rev.PDFKey == nil {
		return store.ErrNotFound
	}
	t.Revision = n
	return storage.Serve(w, r, s.files, sess.Workspace.ID, *rev.PDFKey, FileName(t), "application/pdf")
}

// asSent: the quote as its current revision went out, without the answer it got since.
func asSent(t store.Quote) store.Quote {
	t.Status, t.DecidedAt, t.DecidedBy, t.DecisionNote, t.Invoice, t.ApprovalState = "sent", nil, nil, nil, nil, nil
	return t
}

// BackfillRevisions fills in, once per start, the revisions sent before they were kept: earlier ones with the PDF
// still stored, and the current revision of each sent quote with the quote itself, which is locked since its send.
// Idempotent; it returns when done, logging a failure.
func (s *Service) BackfillRevisions(ctx context.Context) {
	if err := s.backfillRevisions(ctx); err != nil {
		s.log.ErrorContext(ctx, "backfill quote revisions", "error", err)
	}
}

func (s *Service) backfillRevisions(ctx context.Context) error {
	if _, err := s.db.BackfillEarlierQuoteRevisions(ctx, s.now()); err != nil {
		return err
	}
	const batch = 200
	for {
		pending, err := s.db.QuotesWithoutCurrentRevision(ctx, batch)
		if err != nil {
			return err
		}
		for _, p := range pending {
			if err := s.db.Tx(ctx, func(q store.Q) error {
				t, err := q.Quote(ctx, p[0], p[1], "", true)
				if err != nil || t.Status == "draft" { // revised meanwhile
					return err
				}
				if err := q.AddQuoteRevision(ctx, p[0], asSent(t), nil, t.SentAt, s.now()); err != nil {
					return err
				}
				if t.DecidedAt == nil {
					return nil
				}
				return q.SetQuoteRevisionOutcome(ctx, p[0], t.ID, t.Revision, t.Status, t.DecidedAt, t.DecidedBy, t.DecisionNote)
			}); err != nil {
				return err
			}
		}
		if len(pending) < batch {
			return nil
		}
	}
}
