package employees

import (
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/employment"
	"helvetly.com/api/internal/store"
)

// documentTypes are the research's document types, which its retention rules are keyed by. An ID copy is only for
// where a law requires one (a right-to-work or I-9 check); nothing asks for it otherwise.
var documentTypes = []string{"employment_contract", "contract_amendment", "termination_document", "personnel_file", "payslip",
	"payroll_record", "tax_withholding_record", "social_security_record", "time_record", "work_permit_copy", "id_document_copy", "other"}

// mistakeWindow: a file uploaded by mistake can be removed this long after upload, whatever its retention says.
const mistakeWindow = 24 * time.Hour

// documentView is a document with the rules a person should read before relying on its retention date: partially
// verified ones, and verified ones whose start the module cannot date.
type documentView struct {
	store.EmployeeDocument
	Guidance []employment.Rule `json:"retention_guidance"`
	Due      bool              `json:"retention_due"` // the retention date has passed: review it for deletion
}

func (s *Service) documents(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	id, today := r.PathValue("id"), s.today(sess)
	e, err := s.db.Employee(r.Context(), sess.Workspace.ID, id, today)
	if err != nil {
		return err
	}
	list, err := s.db.EmployeeDocuments(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	on, _ := time.Parse(time.DateOnly, today)
	res := resolve(e, on)
	out := make([]documentView, len(list))
	for i, d := range list {
		out[i] = documentView{EmployeeDocument: d, Guidance: []employment.Rule{},
			Due: d.RetainUntil != nil && *d.RetainUntil < today && !d.LegalHold && !e.LegalHold}
		if res.Status == employment.RegisterOnly {
			if g := employment.RetainUntil(res.Applicable, d.Type, parseDay(d.DocumentDate), parseDay(e.EmploymentEnd), on).Guidance; g != nil {
				out[i].Guidance = g
			}
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func parseDay(v *string) *time.Time {
	if v == nil {
		return nil
	}
	t, err := time.Parse(time.DateOnly, *v)
	if err != nil {
		return nil
	}
	return &t
}

// retention is the end of a document's retention under the rule for the employee's situation, or nil when no rule
// applies or the situation is not plain enough to pick one (employment.Resolve blocks the suggestion then).
func (s *Service) retention(e store.Employee, typ string, documentDate *string, today string) (*string, *string) {
	on, _ := time.Parse(time.DateOnly, today)
	res := resolve(e, on)
	if res.Status != employment.RegisterOnly {
		return nil, nil
	}
	r := employment.RetainUntil(res.Applicable, typ, parseDay(documentDate), parseDay(e.EmploymentEnd), on)
	if r.Until == nil {
		return nil, nil
	}
	ids := make([]string, len(r.Rules))
	for i, rule := range r.Rules {
		ids[i] = rule.ID
	}
	day, joined := r.Until.Format(time.DateOnly), strings.Join(ids, ",")
	return &day, &joined
}

// recomputeRetention updates the rule-set retention of the employee's documents after the dates or place changed;
// a date a person set stays.
func (s *Service) recomputeRetention(r *http.Request, q store.Q, sess store.Session, e store.Employee) error {
	docs, err := q.EmployeeDocuments(r.Context(), sess.Workspace.ID, e.ID)
	if err != nil {
		return err
	}
	for _, d := range docs {
		if d.RetentionRule == nil && d.RetainUntil != nil {
			continue
		}
		until, rule := s.retention(e, d.Type, d.DocumentDate, s.today(sess))
		if same(until, d.RetainUntil) && same(rule, d.RetentionRule) {
			continue
		}
		d.RetainUntil, d.RetentionRule = until, rule
		if err := q.SaveEmployeeDocument(r.Context(), sess.Workspace.ID, e.ID, d); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) upload(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	employeeID := r.PathValue("id")
	e, err := s.db.Employee(r.Context(), sess.Workspace.ID, employeeID, s.today(sess))
	if err != nil {
		return err
	}
	if err := writable(e); err != nil {
		return err
	}
	id, err := s.files.UploadEmployeeFile(w, r, sess, employeeID, func(q store.Q, doc store.Document, form *multipart.Form) error {
		locked, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, employeeID, s.today(sess))
		if err != nil {
			return err
		}
		if err := writable(locked); err != nil { // checked again under the lock: a restriction may have just been set
			return err
		}
		f := fields{}
		d := store.EmployeeDocument{ID: doc.ID}
		if v := f.text("type", jsonString(formValue(form, "type")), 20, oneOf(documentTypes...)); v != nil {
			d.Type = *v
		} else {
			f.fail("type", "Choose the kind of document.")
		}
		d.DocumentDate = f.text("document_date", jsonString(formValue(form, "document_date")), 10, date)
		manual := f.text("retain_until", jsonString(formValue(form, "retain_until")), 10, date)
		if len(f) > 0 {
			return validationFailed(f)
		}
		d.RetainUntil, d.RetentionRule = s.retention(e, d.Type, d.DocumentDate, s.today(sess))
		if manual != nil {
			if d.RetainUntil != nil && *manual < *d.RetainUntil {
				return validationFailed(map[string]string{"retain_until": "Keep it at least until " + *d.RetainUntil + ", as its retention rule says."})
			}
			d.RetainUntil, d.RetentionRule = manual, nil
		}
		if err := q.SaveEmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, d); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.document_added", "employee", employeeID)
	})
	if err != nil {
		return err
	}
	d, err := s.db.EmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(d))
	return nil
}

func jsonString(v string) json.RawMessage {
	b, _ := json.Marshal(strings.TrimSpace(v))
	return b
}

// updateDocument changes a document's type, date, retention date or legal hold. A rule's retention can be extended,
// never shortened; null returns to the rule's date. Only an owner sets or lifts a legal hold.
func (s *Service) updateDocument(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, []string{"type", "document_date", "retain_until", "legal_hold"}); err != nil {
		return err
	}
	if _, ok := body["legal_hold"]; ok && sess.Role != "owner" {
		return errOwnerOnly
	}
	employeeID, id := r.PathValue("id"), r.PathValue("doc")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, employeeID, s.today(sess))
		if err != nil {
			return err
		}
		if err := writable(e); err != nil && !onlyKeys(body, "legal_hold") {
			return err
		}
		d, err := q.EmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, id)
		if err != nil {
			return err
		}
		f := fields{}
		if raw, ok := body["type"]; ok {
			if v := f.text("type", raw, 20, oneOf(documentTypes...)); v != nil {
				d.Type = *v
			} else {
				f.fail("type", "Choose the kind of document.")
			}
		}
		if raw, ok := body["document_date"]; ok {
			d.DocumentDate = f.text("document_date", raw, 10, date)
		}
		if raw, ok := body["legal_hold"]; ok {
			d.LegalHold = f.flag("legal_hold", raw)
		}
		var manual *string
		raw, setsRetention := body["retain_until"]
		if setsRetention {
			manual = f.text("retain_until", raw, 10, date)
		}
		if len(f) > 0 {
			return validationFailed(f)
		}
		ruleUntil, rule := s.retention(e, d.Type, d.DocumentDate, s.today(sess))
		switch {
		case setsRetention && manual != nil:
			if ruleUntil != nil && *manual < *ruleUntil {
				return validationFailed(map[string]string{"retain_until": "Keep it at least until " + *ruleUntil + ", as its retention rule says."})
			}
			d.RetainUntil, d.RetentionRule = manual, nil
		case setsRetention || d.RetentionRule != nil || d.RetainUntil == nil:
			d.RetainUntil, d.RetentionRule = ruleUntil, rule
		}
		if err := q.SaveEmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, d); err != nil {
			return err
		}
		if _, ok := body["legal_hold"]; ok {
			return s.audit(r, q, sess, map[bool]string{true: "employee.document_hold_set", false: "employee.document_hold_lifted"}[d.LegalHold], "employee", employeeID)
		}
		return nil
	})
	if err != nil {
		return err
	}
	d, err := s.db.EmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(d))
	return nil
}

// deleteDocument removes a document whose retention has passed, or one uploaded by mistake in the last 24 hours;
// never one under a legal hold (its own or the employee's).
func (s *Service) deleteDocument(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	employeeID, id, today := r.PathValue("id"), r.PathValue("doc"), s.today(sess)
	var key string
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, employeeID, today)
		if err != nil {
			return err
		}
		if e.Restricted {
			return errRestricted
		}
		d, err := q.EmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, id)
		if err != nil {
			return err
		}
		switch {
		case d.LegalHold || e.LegalHold:
			return conflict("legal_hold", "This document is under a legal hold.")
		case s.now().Sub(d.CreatedAt) < mistakeWindow:
		case d.RetainUntil == nil:
			return conflict("retention_unknown", "Set how long this document must be kept before deleting it.")
		case *d.RetainUntil >= today:
			return conflict("retained", "This document must be kept until "+*d.RetainUntil+".")
		}
		if key, err = q.DeleteHRFile(r.Context(), sess.Workspace.ID, id); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.document_deleted", "employee", employeeID)
	})
	if err != nil {
		return err
	}
	s.files.RemoveObject(r.Context(), key)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) download(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	employeeID, id := r.PathValue("id"), r.PathValue("doc")
	if _, err := s.db.EmployeeDocument(r.Context(), sess.Workspace.ID, employeeID, id); err != nil {
		return err
	}
	d, err := s.db.HRFile(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	return s.files.ServeHRFile(w, r, sess.Workspace.ID, d)
}
