package invoices

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// SetApprovals is startup wiring: drafts whose type has an approval policy are approved before they are issued.
func (s *Service) SetApprovals(a *approvals.Service) { s.approvals = a }

func approvalDoc(inv store.Invoice) approvals.Doc {
	client := inv.Client.Name
	if inv.Buyer != nil && inv.Buyer.Name != "" {
		client = inv.Buyer.Name
	}
	return approvals.Doc{Type: approvals.InvoiceType(inv.Kind), Subject: "invoice", Resource: "invoices", ID: inv.ID,
		Draft: inv.Status == "draft", Kind: inv.Kind, Client: client, Currency: inv.Currency, Total: inv.Payable()}
}

func (s *Service) registerApproval(handle func(string, handler)) {
	handle("GET /api/v1/invoices/{id}/approval", s.approvalView)
	handle("POST /api/v1/invoices/{id}/approval", s.approvalAction(func(ctx context.Context, q store.Q, sess store.Session, d approvals.Doc, _ decision) error {
		return s.approvals.Submit(ctx, q, sess, d)
	}))
	handle("POST /api/v1/invoices/{id}/approval/withdraw", s.approvalAction(func(ctx context.Context, q store.Q, sess store.Session, d approvals.Doc, _ decision) error {
		return s.approvals.Withdraw(ctx, q, sess, d)
	}))
	handle("POST /api/v1/invoices/{id}/approval/approve", s.approvalAction(func(ctx context.Context, q store.Q, sess store.Session, d approvals.Doc, b decision) error {
		return s.approvals.Approve(ctx, q, sess, d, b.requestID, b.comment)
	}))
	handle("POST /api/v1/invoices/{id}/approval/reject", s.approvalAction(func(ctx context.Context, q store.Q, sess store.Session, d approvals.Doc, b decision) error {
		return s.approvals.Reject(ctx, q, sess, d, b.requestID, b.comment)
	}))
}

func (s *Service) approvalView(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	inv, err := s.db.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	doc := approvalDoc(inv)
	if doc.Draft {
		planned, err := planSource(ctx, s.db.Q, sess.Workspace.ID, inv)
		if err != nil {
			return err
		}
		doc.Draft = !planned
	}
	v, err := s.approvals.View(ctx, s.db.Q, sess, doc)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(v))
	return nil
}

// approvalAction runs an approval step on the locked invoice, so it serialises with edits, issuing and other steps.
// decision: the request the person decides on (the one they saw) and their comment.
type decision struct {
	requestID string
	comment   *string
}

func (s *Service) approvalAction(step func(context.Context, store.Q, store.Session, approvals.Doc, decision) error) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		var body struct {
			RequestID string  `json:"request_id"`
			Comment   *string `json:"comment"`
		}
		if r.ContentLength != 0 && !s.auth.Decode(w, r, &body) {
			return nil
		}
		var comment *string
		if body.Comment != nil {
			if c := strings.TrimSpace(*body.Comment); c != "" {
				if utf8.RuneCountInString(c) > 1000 {
					return validationFailed(map[string]string{"comment": "Keep the comment to 1000 characters."})
				}
				comment = &c
			}
		}
		ctx := r.Context()
		if s.approvals == nil {
			return auth.ErrNotFound
		}
		err := s.db.Tx(ctx, func(q store.Q) error {
			if err := q.LockInvoiceSettings(ctx, sess.Workspace.ID); err != nil {
				return err
			}
			inv, err := q.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), true)
			if err != nil {
				return err
			}
			if planned, err := planSource(ctx, q, sess.Workspace.ID, inv); err != nil {
				return err
			} else if planned {
				return errPlanned
			}
			return step(ctx, q, sess, approvalDoc(inv), decision{requestID: body.RequestID, comment: comment})
		})
		if err != nil {
			return err
		}
		return s.approvalView(w, r, sess)
	}
}
