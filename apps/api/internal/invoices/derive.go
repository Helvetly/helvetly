package invoices

import (
	"net/http"

	"helvetly.com/api/internal/store"
)

// registerDerived adds the endpoints that derive a draft from an issued document (correct, debit note, convert),
// each through s.handle.
func (s *Service) registerDerived(mux *http.ServeMux) {
	s.handle(mux, "POST /api/v1/invoices/{id}/correct", s.correct)
	s.handle(mux, "POST /api/v1/invoices/{id}/debit-note", s.debitNote)
	s.handle(mux, "POST /api/v1/invoices/{id}/convert", s.convert)
}

func issuedReceivable(src store.Invoice) bool {
	return Receivable(src.Kind) && (src.Status == "open" || src.Status == "paid")
}

func (s *Service) correct(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.derive(w, r, sess, "corrected", func(src store.Invoice) error {
		if src.DeductedOn != nil {
			return invalidState(prepaymentDeductedMessage)
		}
		if !issuedReceivable(src) || src.AmountCredited > 0 {
			return invalidState("Only open or paid invoices without credit notes can be corrected.")
		}
		return nil
	}, nil)
}

func (s *Service) debitNote(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.derive(w, r, sess, "debit_note", func(src store.Invoice) error {
		if !issuedReceivable(src) {
			return invalidState("Only open or paid invoices can take a debit note.")
		}
		return nil
	}, func(inv *store.Invoice) { inv.Lines = []store.InvoiceLine{} })
}

func (s *Service) convert(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Kind string `json:"kind"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if body.Kind != "invoice" && body.Kind != "prepayment" {
		return validationFailed(map[string]string{"kind": "Convert a proforma to an invoice or a prepayment invoice."})
	}
	return s.derive(w, r, sess, body.Kind, func(src store.Invoice) error {
		if src.Kind != "proforma" || src.Status != "open" {
			return invalidState("Only open proforma invoices can be converted.")
		}
		return nil
	}, nil)
}

// derive saves a new draft of kind from the locked source once allowed accepts it; adjust may change it first.
func (s *Service) derive(w http.ResponseWriter, r *http.Request, sess store.Session, kind string,
	allowed func(store.Invoice) error, adjust func(*store.Invoice)) error {
	ctx, ws := r.Context(), sess.Workspace
	var id string
	err := s.db.Tx(ctx, func(q store.Q) error {
		src, err := q.Invoice(ctx, ws.ID, r.PathValue("id"), s.today(ws), true)
		if err != nil {
			return err
		}
		if err := allowed(src); err != nil {
			return err
		}
		set, err := loadSettings(ctx, q, ws.ID)
		if err != nil {
			return err
		}
		inv := s.draftFrom(src, kind)
		inv.IssueDate, inv.DueDate = s.today(ws), addDays(s.today(ws), daysBetween(inv.IssueDate, inv.DueDate))
		inv.PaymentMethods = usableMethods(inv.PaymentMethods, set, inv.Currency)
		if adjust != nil {
			adjust(&inv)
		}
		compute(&inv)
		id = inv.ID
		if err := q.SaveDraft(ctx, ws.ID, inv, s.now()); err != nil {
			return err
		}
		if err := wrote(ctx, q, sess, inv.ID); err != nil || len(inv.Prepayments) == 0 {
			return err
		}
		ids := make([]string, len(inv.Prepayments))
		for i, p := range inv.Prepayments {
			ids[i] = p.ID
		}
		return q.SetPrepayments(ctx, inv.ID, ids)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}
