package documents

import (
	"context"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"strconv"

	"helvetly.com/api/internal/store"
)

// A bank statement, payment confirmation or credit advice linked to an invoice's payment or refund. An upload is
// filed in the invoice client's Documents/<year>/Bank Statements (the payment's year) as a payment confirmation; a
// picked Document stays where it is. While linked, the file cannot be moved or trashed (store's recordFileSQL).
// Attaching and unlinking are audited, never money events, and closed periods do not stop them.

func (s *Service) registerPaymentFiles(handle func(string, handler)) {
	for _, t := range []struct{ path, kind string }{{"payments", "payment"}, {"refunds", "refund"}} {
		target := "/api/v1/invoices/{id}/" + t.path + "/{" + t.kind + "_id}/documents"
		handle("POST "+target, s.attachPaymentFile(t.kind))
		handle("DELETE "+target+"/{document_id}", s.detachPaymentFile(t.kind))
	}
}

var errNoPaymentDocument = validationFailed(map[string]string{"document_id": "This document doesn't exist."})

func (s *Service) attachPaymentFile(kind string) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		ctx, ws, invoiceID, target := r.Context(), sess.Workspace.ID, r.PathValue("id"), r.PathValue(kind+"_id")
		clientID, number, on, err := s.db.PaymentTarget(ctx, ws, invoiceID, kind, target)
		if err != nil {
			return err
		}
		attach := func(q store.Q, documentID string) error {
			if _, _, _, err := q.PaymentTarget(ctx, ws, invoiceID, kind, target); err != nil {
				return err
			}
			// a live general file of this workspace only: never another workspace's, a trashed or an HR file
			if err := q.LockLiveDocument(ctx, ws, documentID); errors.Is(err, store.ErrNotFound) {
				return errNoPaymentDocument
			} else if err != nil {
				return err
			}
			if err := q.AddDocumentLink(ctx, ws, documentID, kind, target, sess.User.ID, s.now()); err != nil {
				return err
			}
			return s.logPaymentFile(ctx, q, sess, "invoice.payment_file_attached", kind, invoiceID, number, target, documentID)
		}
		linkExisting := func(documentID string) error {
			if documentID == "" {
				return errNoPaymentDocument
			}
			if err := s.db.Tx(ctx, func(q store.Q) error { return attach(q, documentID) }); err != nil {
				return err
			}
			return s.writeDocument(w, r, sess, http.StatusCreated, documentID)
		}
		if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "multipart/form-data" {
			var body struct {
				DocumentID string `json:"document_id"`
			}
			if !s.auth.Decode(w, r, &body) {
				return nil
			}
			return linkExisting(body.DocumentID)
		}
		form, h, err := s.parseUpload(w, r)
		if form != nil {
			defer func() { _ = form.RemoveAll() }()
			if id := formValue(form, "document_id"); id != "" && len(form.File["file"]) == 0 {
				return linkExisting(id)
			}
		}
		if err != nil {
			return err
		}
		year, err := strconv.Atoi(on[:4])
		if err != nil {
			return err
		}
		var folder string
		if err := s.db.Tx(ctx, func(q store.Q) error {
			folder, err = q.ClientBankStatementsFolder(ctx, ws, clientID, year, sess.User.ID, s.now())
			return err
		}); err != nil {
			return err
		}
		return s.storeUpload(w, r, sess, h, uploadTarget{folder: &folder, mode: "keep_both", kind: "payment-confirmation", attach: attach})
	}
}

func (s *Service) detachPaymentFile(kind string) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		ctx, ws, invoiceID, target, documentID := r.Context(), sess.Workspace.ID, r.PathValue("id"), r.PathValue(kind+"_id"), r.PathValue("document_id")
		err := s.db.Tx(ctx, func(q store.Q) error {
			_, number, _, err := q.PaymentTarget(ctx, ws, invoiceID, kind, target)
			if err != nil {
				return err
			}
			removed, err := q.RemovePaymentLink(ctx, ws, documentID, kind, target, s.now())
			if err != nil {
				return err
			}
			if !removed {
				return store.ErrNotFound
			}
			return s.logPaymentFile(ctx, q, sess, "invoice.payment_file_removed", kind, invoiceID, number, target, documentID)
		})
		if err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func (s *Service) logPaymentFile(ctx context.Context, q store.Q, sess store.Session, event, kind, invoiceID, number, target, documentID string) error {
	payload, err := json.Marshal(map[string]any{"number": number, kind + "_id": target, "document_id": documentID})
	if err != nil {
		return err
	}
	actor := sess.User.ID
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: event, SubjectType: "invoice",
		SubjectID: invoiceID, ActorID: &actor, At: s.now(), Payload: payload})
}
