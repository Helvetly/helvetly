package employees

import (
	"encoding/json"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

var (
	payBases       = []string{"monthly", "hourly"}
	payFrequencies = []string{"monthly", "semimonthly", "biweekly", "weekly"}
)

// payTerms is the employee's pay history: append-only, so a change is a new version from its effective date, and
// payroll entries keep their own figures, so no change of terms reaches a recorded entry.
func (s *Service) payTerms(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	id := r.PathValue("id")
	if _, err := s.db.Employee(r.Context(), sess.Workspace.ID, id, s.today(sess)); err != nil {
		return err
	}
	list, err := s.db.PayTermsHistory(r.Context(), sess.Workspace.ID, id, s.today(sess))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) addPayTerms(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, []string{"effective_from", "basis", "amount", "currency", "frequency", "note"}); err != nil {
		return err
	}
	employeeID := r.PathValue("id")
	t := store.PayTerms{ID: auth.NewID("pt"), EmployeeID: employeeID, CreatedAt: s.now()}
	f := fields{}
	for k, msg := range map[string]string{"effective_from": "Enter the date the terms take effect.", "basis": "Choose monthly salary or hourly rate.",
		"amount": "Enter the amount.", "currency": "Choose a currency.", "frequency": "Choose how often pay is due."} {
		if body[k] == nil || string(body[k]) == "null" {
			f.fail(k, msg)
		}
	}
	if v := f.text("effective_from", body["effective_from"], 10, date); v != nil {
		t.EffectiveFrom = *v
	}
	if v := f.text("basis", body["basis"], 10, oneOf(payBases...)); v != nil {
		t.Basis = *v
	}
	if m := f.money("amount", body["amount"]); m != nil {
		if *m == 0 {
			f.fail("amount", "Enter an amount above 0.")
		}
		t.Amount = *m
	}
	if v := f.text("currency", body["currency"], 3, currency); v != nil {
		t.Currency = *v
	}
	if v := f.text("frequency", body["frequency"], 12, oneOf(payFrequencies...)); v != nil {
		t.Frequency = *v
	}
	if raw, ok := body["note"]; ok {
		t.Note = f.text("note", raw, 500, nil)
	}
	if len(f) > 0 {
		return validationFailed(f)
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, employeeID, s.today(sess))
		if err != nil {
			return err
		}
		if err := writable(e); err != nil {
			return err
		}
		if t.EffectiveFrom < e.EmploymentStart {
			return validationFailed(map[string]string{"effective_from": "Pay terms cannot start before the employment does."})
		}
		if err := q.AddPayTerms(r.Context(), sess.Workspace.ID, sess.User.ID, t); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.pay_terms_added", "employee", employeeID)
	})
	if err != nil {
		return err
	}
	return s.payTerms(w, r, sess)
}

// deletePayTerms removes terms entered by mistake before they take effect; terms in effect or past are history.
func (s *Service) deletePayTerms(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	employeeID := r.PathValue("id")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, employeeID, s.today(sess))
		if err != nil {
			return err
		}
		if err := writable(e); err != nil {
			return err
		}
		ok, err := q.DeleteFuturePayTerms(r.Context(), sess.Workspace.ID, employeeID, r.PathValue("terms"), s.today(sess))
		if err != nil {
			return err
		}
		if !ok {
			return conflict("pay_terms_in_effect", "Only pay terms that have not taken effect yet can be removed.")
		}
		return s.audit(r, q, sess, "employee.pay_terms_removed", "employee", employeeID)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
