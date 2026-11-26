package invoices

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"mime"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

var paymentMethods = []string{"bank_transfer", "cash", "card", "twint", "other"}

func payable(inv store.Invoice) error {
	if !takesPayments(inv.Kind) || inv.Status != "open" {
		return invalidState("Payments can be recorded on open invoices only, never on a proforma or a credit note.")
	}
	return nil
}

// recordPayment records p on inv (locked) and, when notify (nil: the workspace's setting), queues the client's
// confirmation, sent once the transaction commits.
func (s *Service) recordPayment(ctx context.Context, q store.Q, sess store.Session, inv store.Invoice, p store.Payment, notify *bool) error {
	if err := checkOpen(ctx, q, sess.Workspace.ID, p.PaidOn); err != nil {
		return err
	}
	p.ID, p.CreatedAt = auth.NewID("pay"), s.now()
	if err := q.CreatePayment(ctx, inv.ID, sess.User.ID, p); err != nil {
		return err
	}
	if err := s.logEvent(ctx, q, sess, "payment.added", inv.ID, map[string]any{"number": deref(inv.Number), "payment_id": p.ID,
		"amount": p.Amount, "paid_on": p.PaidOn, "method": p.Method}); err != nil {
		return err
	}
	if err := q.RefreshBalance(ctx, inv.ID, s.now()); err != nil {
		return err
	}
	if err := s.queueConfirmation(ctx, q, sess, inv, p, notify); err != nil {
		return err
	}
	to := store.NotifyTo{Roles: notifications.Managers, Except: sess.User.ID}
	data := map[string]any{"invoice_id": inv.ID, "number": deref(inv.Number), "client": inv.Client.Name,
		"currency": inv.Currency, "actor": notifications.Actor(sess.User), "actor_id": sess.User.ID}
	if p.Amount < inv.AmountDue {
		data["amount"], data["open"] = p.Amount.String(), (inv.AmountDue - p.Amount).String()
		return notifications.Notify(ctx, q, sess.Workspace.ID, "invoice.partly_paid", data, to, s.now())
	}
	data["amount"] = inv.Total.String()
	return notifications.Notify(ctx, q, sess.Workspace.ID, "invoice.paid", data, to, s.now())
}

// paidOn: a date not in the future, today when omitted.
func paidOn(p *parser, raw json.RawMessage, today string) string {
	if raw == nil {
		return today
	}
	d := p.required("paid_on", raw, 10, date, "Enter the payment date.")
	if d > today {
		p.fail("paid_on", "The payment date cannot be in the future.")
	}
	return d
}

func (s *Service) addPayment(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		RequestID json.RawMessage `json:"request_id"`
		Amount    json.RawMessage `json:"amount"`
		PaidOn    json.RawMessage `json:"paid_on"`
		Method    json.RawMessage `json:"method"`
		Note      json.RawMessage `json:"note"`
		Notify    *bool           `json:"notify_client"`
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
		p := newParser()
		pay := store.Payment{PaidOn: paidOn(p, body.PaidOn, s.today(sess.Workspace))}
		if body.Amount == nil {
			p.fail("amount", "Enter the amount.")
		} else if n, ok := p.decimal("amount", body.Amount, parseMoney, "Enter an amount with at most two decimals."); ok {
			pay.Amount = invoicecalc.Money(n)
			if n <= 0 {
				p.fail("amount", "Enter an amount above 0.")
			}
		}
		pay.Method = p.required("method", body.Method, 20, oneOf(paymentMethods...), "Choose how it was paid.")
		if body.Note != nil {
			pay.Note = p.text("note", body.Note, 200, nil)
		}
		var requestID string
		if body.RequestID != nil {
			requestID = p.required("request_id", body.RequestID, 128, nil, "Enter a request ID.")
		}
		if err := p.err(); err != nil {
			return err
		}
		if requestID != "" {
			// An omitted date still means the original payment day when a retry crosses midnight.
			dateParam := pay.PaidOn
			if body.PaidOn == nil {
				dateParam = ""
			}
			params, err := json.Marshal([]any{pay.Amount, dateParam, pay.Method, pay.Note})
			if err != nil {
				return err
			}
			hash := sha256.Sum256(params)
			replay, conflict, err := q.ClaimPaymentRequest(ctx, id, requestID, hash[:])
			if err != nil || replay {
				return err
			}
			if conflict {
				return auth.Error(http.StatusConflict, "request_id_conflict", "This payment request ID was already used with different details.", nil)
			}
		}
		if err := payable(inv); err != nil {
			return err
		}
		if pay.Amount > inv.AmountDue {
			return validationFailed(map[string]string{"amount": "The amount exceeds what is due (" + inv.Currency + " " + inv.AmountDue.String() + ")."})
		}
		return s.recordPayment(ctx, q, sess, inv, pay, body.Notify)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}

// markPaid records one payment of the amount due.
func (s *Service) markPaid(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		PaidOn json.RawMessage `json:"paid_on"`
		Method json.RawMessage `json:"method"`
		Notify *bool           `json:"notify_client"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	p := newParser()
	on, method := paidOn(p, body.PaidOn, s.today(sess.Workspace)), "bank_transfer"
	if body.Method != nil {
		method = p.required("method", body.Method, 20, oneOf(paymentMethods...), "Choose how it was paid.")
	}
	if err := p.err(); err != nil {
		return err
	}
	if err := s.payDue(r.Context(), sess, r.PathValue("id"), on, method, body.Notify); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

// payDue records, in its own transaction, one payment of everything still due, which settles every instalment.
func (s *Service) payDue(ctx context.Context, sess store.Session, id, on, method string, notify *bool) error {
	return s.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if err := payable(inv); err != nil {
			return err
		}
		if inv.AmountDue <= 0 {
			return invalidState("Nothing is due on this invoice.")
		}
		return s.recordPayment(ctx, q, sess, inv, store.Payment{Amount: inv.AmountDue, PaidOn: on, Method: method}, notify)
	})
}

func (s *Service) listPayments(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	inv, err := s.db.Invoice(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(inv.Payments))
	return nil
}

func (s *Service) deletePayment(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if inv.DeductedOn != nil {
			return invalidState(prepaymentDeductedMessage)
		}
		k := slices.IndexFunc(inv.Payments, func(p store.Payment) bool { return p.ID == r.PathValue("payment_id") })
		if k < 0 {
			return store.ErrNotFound
		}
		pay := inv.Payments[k]
		if err := checkOpen(ctx, q, sess.Workspace.ID, pay.PaidOn); err != nil {
			return err
		}
		if _, err := q.DeletePayment(ctx, id, pay.ID); err != nil {
			return err
		}
		if err := s.logEvent(ctx, q, sess, "payment.deleted", id, map[string]any{"number": deref(inv.Number), "payment_id": pay.ID,
			"amount": pay.Amount, "paid_on": pay.PaidOn}); err != nil {
			return err
		}
		if err := q.RefreshBalance(ctx, id, s.now()); err != nil {
			return err
		}
		after, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), false)
		if err != nil {
			return err
		}
		if after.RefundDue < 0 { // the payment funded a refund already made
			return invalidState("A refund was paid out of this payment: delete the refund first.")
		}
		return nil
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- deliveries ----

func (s *Service) deliveries(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if _, err := s.db.Invoice(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false); err != nil {
		return err
	}
	list, err := s.db.Deliveries(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) pdf(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	inv, err := s.load(ctx, s.db.Q, sess, r.PathValue("id"), false)
	if err != nil {
		return err
	}
	var out []byte
	contentType, name := "application/pdf", fileName(inv)
	switch {
	case inv.Status == "draft":
		if out, err = s.draftPDF(ctx, sess, inv); err != nil {
			return err
		}
	case inv.IssuedElsewhere(): // its original, as uploaded: a PDF rendered now would be a document nobody issued
		doc, err := s.db.Document(ctx, sess.Workspace.ID, deref(inv.SourceDocumentID))
		if err != nil {
			return err
		}
		if out, err = s.files.Get(ctx, doc.ObjectKey); err != nil {
			return err
		}
		contentType, name = doc.ContentType, doc.Name
	default:
		if out, err = s.files.Get(ctx, deref(inv.PDFKey)); err != nil {
			return err
		}
	}
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Type", contentType)
	header := disposition + `; filename="` + name + `"`
	if inv.IssuedElsewhere() { // an uploaded name may hold quotes or non-ASCII
		header = mime.FormatMediaType(disposition, map[string]string{"filename": name})
	}
	w.Header().Set("Content-Disposition", header)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Last-Modified", inv.UpdatedAt.Format(http.TimeFormat))
	_, _ = w.Write(out)
	return nil
}

// draftPDF renders a draft live, with the current settings and client, watermarked.
func (s *Service) draftPDF(ctx context.Context, sess store.Session, inv store.Invoice) ([]byte, error) {
	set, err := loadSettings(ctx, s.db.Q, sess.Workspace.ID)
	if err != nil {
		return nil, err
	}
	client, err := s.db.Client(ctx, sess.Workspace.ID, inv.ClientID)
	if err != nil {
		return nil, err
	}
	buyer := buyerOf(client)
	inv.Buyer = &buyer
	logo, err := s.logoBytes(ctx, sess.Workspace.ID, set)
	if err != nil {
		return nil, err
	}
	if inv.Payment.QRBill {
		if inv.Payment.Reference, err = draftReference(ctx, s.db.Q, sess.Workspace.ID, set.NumberFormat, inv); err != nil {
			return nil, err
		}
	}
	var preceding *store.Invoice
	if inv.CreditedInvoice != nil {
		credited, err := s.db.Invoice(ctx, sess.Workspace.ID, inv.CreditedInvoice.ID, s.today(sess.Workspace), false)
		if err != nil {
			return nil, err
		}
		preceding = &credited
	}
	doc := s.document(inv, set, true, preceding)
	doc.Logo = logo
	if doc.SentWith, err = s.sentWith(ctx, sess.Workspace.ID); err != nil {
		return nil, err
	}
	return invoicepdf.Render(doc)
}
