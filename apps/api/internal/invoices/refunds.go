package invoices

import (
	"encoding/json"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// addRefund records money paid back to the buyer out of the invoice's credit balance (refund_due).
func (s *Service) addRefund(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Amount     json.RawMessage `json:"amount"`
		RefundedOn json.RawMessage `json:"refunded_on"`
		Method     json.RawMessage `json:"method"`
		Note       json.RawMessage `json:"note"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if !Receivable(inv.Kind) || inv.RefundDue <= 0 {
			return invalidState("Nothing is due to be refunded on this invoice.")
		}
		p := newParser()
		ref := store.Refund{RefundedOn: s.today(sess.Workspace)}
		if body.RefundedOn != nil {
			ref.RefundedOn = p.required("refunded_on", body.RefundedOn, 10, date, "Enter the refund date.")
		}
		switch {
		case ref.RefundedOn > s.today(sess.Workspace):
			p.fail("refunded_on", "The refund date cannot be in the future.")
		case ref.RefundedOn != "" && p.invalid["refunded_on"] == "":
			available, err := q.RefundAvailableOn(ctx, id, ref.RefundedOn, inv.Payable())
			if err != nil {
				return err
			}
			if available == 0 {
				p.fail("refunded_on", "There was no refundable balance available on this date.")
			}
			inv.RefundDue = min(inv.RefundDue, available)
		}
		if body.Amount == nil {
			p.fail("amount", "Enter the amount.")
		} else if n, ok := p.decimal("amount", body.Amount, parseMoney, "Enter an amount with at most two decimals."); ok {
			ref.Amount = invoicecalc.Money(n)
			switch {
			case n <= 0:
				p.fail("amount", "Enter an amount above 0.")
			case ref.Amount > inv.RefundDue:
				p.fail("amount", "The amount exceeds what is due to be refunded ("+inv.Currency+" "+inv.RefundDue.String()+").")
			}
		}
		ref.Method = p.required("method", body.Method, 20, oneOf(paymentMethods...), "Choose how it was refunded.")
		if body.Note != nil {
			ref.Note = p.text("note", body.Note, 200, nil)
		}
		if err := p.err(); err != nil {
			return err
		}
		if err := checkOpen(ctx, q, sess.Workspace.ID, ref.RefundedOn); err != nil {
			return err
		}
		ref.ID, ref.CreatedAt = auth.NewID("rfd"), s.now()
		if err := q.CreateRefund(ctx, id, sess.User.ID, ref); err != nil {
			return err
		}
		if err := s.logEvent(ctx, q, sess, "refund.added", id, map[string]any{"number": deref(inv.Number), "refund_id": ref.ID,
			"amount": ref.Amount, "refunded_on": ref.RefundedOn, "method": ref.Method}); err != nil {
			return err
		}
		return q.RefreshBalance(ctx, id, s.now())
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}

func (s *Service) deleteRefund(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		k := slices.IndexFunc(inv.Refunds, func(f store.Refund) bool { return f.ID == r.PathValue("refund_id") })
		if k < 0 {
			return store.ErrNotFound
		}
		ref := inv.Refunds[k]
		if err := checkOpen(ctx, q, sess.Workspace.ID, ref.RefundedOn); err != nil {
			return err
		}
		if _, err := q.DeleteRefund(ctx, id, ref.ID); err != nil {
			return err
		}
		if err := s.logEvent(ctx, q, sess, "refund.deleted", id, map[string]any{"number": deref(inv.Number), "refund_id": ref.ID,
			"amount": ref.Amount, "refunded_on": ref.RefundedOn, "method": ref.Method}); err != nil {
			return err
		}
		return q.RefreshBalance(ctx, id, s.now())
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
