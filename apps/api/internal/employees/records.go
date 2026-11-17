package employees

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/employment"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

var employeeKeys = []string{"member_user_id", "employee_number", "first_name", "last_name", "email", "phone", "street",
	"street_number", "apt",
	"postal_code", "city", "address_country", "position", "department", "employment_type", "working_time",
	"employment_start", "employment_end", "employing_entity", "employer_country", "social_security_country",
	"work_country", "work_region", "work_locality",
	"place_of_work", "residence_country", "cross_border", "cross_border_note", "bank_account", "tax_id", "legal_hold",
	"legal_hold_reason", "restricted", "weekly_hours", "notice_period", "thirteenth_salary", "withholding_tax",
	"withholding_tax_canton", "pension_insurer", "accident_insurer", "sickness_insurer", "free_transport", "canteen_meals",
	"social_security_number"}

var employmentTypes = []string{"permanent", "fixed_term", "hourly", "temporary", "apprentice", "other"}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f := store.EmployeeFilter{Status: q.Get("status"), Department: strings.TrimSpace(q.Get("department")),
		Search: strings.TrimSpace(q.Get("search"))}
	if f.Status != "" && f.Status != "all" && f.Status != "active" && f.Status != "upcoming" && f.Status != "ended" &&
		f.Status != "archived" {
		return badRequest("status must be active, upcoming, ended, archived or all.")
	}
	if len(f.Search) > 100 || len(f.Department) > 100 {
		return badRequest("Search for at most 100 characters.")
	}
	page, err := intParam(q.Get("page"), 1, 1_000_000)
	if err != nil {
		return err
	}
	size, err := intParam(q.Get("page_size"), 50, 200)
	if err != nil {
		return err
	}
	list, total, err := s.db.ListEmployees(r.Context(), sess.Workspace.ID, f, s.today(sess), size, (page-1)*size)
	if err != nil {
		return err
	}
	for i := range list {
		list[i] = hideHints(sess, list[i])
	}
	departments, err := s.db.EmployeeDepartments(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": list, "departments": departments,
		"meta": map[string]int{"page": page, "page_size": size, "total": total, "total_pages": (total + size - 1) / size}})
	return nil
}

func intParam(v string, fallback, hi int) (int, error) {
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > hi {
		return 0, badRequest("page and page_size must be whole numbers from 1.")
	}
	return n, nil
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	e, err := s.db.Employee(r.Context(), sess.Workspace.ID, id, s.today(sess))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(hideHints(sess, e)))
	return nil
}

// hideHints leaves the masked hints of the sealed fields (last characters only) to those who may see pay.
func hideHints(sess store.Session, e store.Employee) store.Employee {
	if !permissions.Allows(sess.Role, sess.Scopes, "read:payroll") {
		e.BankAccountHint, e.TaxIDHint, e.SocialSecurityHint = nil, nil, nil
	}
	return e
}

// socialSecurityCheck validates the social-security number where its format is known: the Swiss AHV number when the
// employee is insured in Switzerland (or, without a social-security country, works there). Others are kept as given.
func socialSecurityCheck(e *store.Employee) func(string) (string, string) {
	return func(v string) (string, string) {
		insured := e.WorkCountry
		if e.SocialSecurity != nil {
			insured = *e.SocialSecurity
		}
		if insured == "CH" {
			return ahvNumber(v)
		}
		return strings.TrimSpace(v), ""
	}
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, employeeKeys); err != nil {
		return err
	}
	settings, err := s.db.EmploymentSettings(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	e := store.Employee{ID: auth.NewID("emp"), EmploymentType: "permanent", EmployingEntity: sess.Workspace.Name,
		CreatedAt: s.now()}
	if settings.EmployingEntity != nil {
		e.EmployingEntity = *settings.EmployingEntity
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := s.apply(r, q, sess, &e, body, true); err != nil {
			return err
		}
		if err := q.CreateEmployee(r.Context(), sess.Workspace.ID, sess.User.ID, e); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.created", "employee", e.ID)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, e.ID)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, employeeKeys); err != nil {
		return err
	}
	id := r.PathValue("id")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, id, s.today(sess))
		if err != nil {
			return err
		}
		before := e
		if err := writable(e); err != nil {
			// a restriction can be lifted, and a legal hold set on an erased record; nothing else changes them
			allowed := e.Restricted && onlyKeys(body, "restricted") || !e.Restricted && onlyKeys(body, "legal_hold", "legal_hold_reason")
			if !allowed {
				return err
			}
		}
		if err := s.apply(r, q, sess, &e, body, false); err != nil {
			return err
		}
		if err := q.SaveEmployee(r.Context(), sess.Workspace.ID, e, s.now()); err != nil {
			return err
		}
		if before.LegalHold != e.LegalHold {
			if err := s.audit(r, q, sess, map[bool]string{true: "employee.legal_hold_set", false: "employee.legal_hold_lifted"}[e.LegalHold], "employee", id); err != nil {
				return err
			}
		}
		if before.Restricted != e.Restricted {
			if err := s.audit(r, q, sess, map[bool]string{true: "employee.restricted", false: "employee.unrestricted"}[e.Restricted], "employee", id); err != nil {
				return err
			}
		}
		if !same(before.EmploymentEnd, e.EmploymentEnd) || before.WorkCountry != e.WorkCountry || !same(before.WorkRegion, e.WorkRegion) ||
			before.EmployerCountry != e.EmployerCountry {
			return s.recomputeRetention(r, q, sess, e)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

// onlyKeys: the body has no field but these.
func onlyKeys(body map[string]json.RawMessage, keys ...string) bool {
	for k := range body {
		if !slices.Contains(keys, k) {
			return false
		}
	}
	return true
}

func same(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }

// apply sets the body's fields on e and validates the result; create requires names, start date and work country.
// The company's settings only pre-fill a form: the work country is always chosen for the employee.
func (s *Service) apply(r *http.Request, q store.Q, sess store.Session, e *store.Employee, body map[string]json.RawMessage, create bool) error {
	f := fields{}
	for k, raw := range body {
		switch k {
		case "member_user_id":
			e.MemberUserID = f.text(k, raw, 64, nil)
		case "employee_number":
			e.EmployeeNumber = f.text(k, raw, 32, nil)
		case "first_name":
			e.FirstName = f.required(k, raw, 100, "Enter the first name.")
		case "last_name":
			e.LastName = f.required(k, raw, 100, "Enter the last name.")
		case "email":
			e.Email = f.text(k, raw, 254, email)
		case "phone":
			e.Phone = f.text(k, raw, 40, nil)
		case "street":
			e.Street = f.text(k, raw, 200, nil)
		case "street_number":
			e.StreetNumber = f.text(k, raw, 20, nil)
		case "apt":
			e.Apt = f.text(k, raw, 100, nil)
		case "postal_code":
			e.PostalCode = f.text(k, raw, 20, nil)
		case "city":
			e.City = f.text(k, raw, 100, nil)
		case "address_country":
			e.AddressCountry = f.text(k, raw, 2, country)
		case "position":
			e.Position = f.text(k, raw, 100, nil)
		case "department":
			e.Department = f.text(k, raw, 100, nil)
		case "employment_type":
			if v := f.text(k, raw, 20, oneOf(employmentTypes...)); v != nil {
				e.EmploymentType = *v
			} else {
				f.fail(k, "Choose an employment type.")
			}
		case "working_time":
			e.WorkingTime = f.percent(k, raw)
		case "employment_start":
			if v := f.text(k, raw, 10, date); v != nil {
				e.EmploymentStart = *v
			} else {
				f.fail(k, "Enter the start date.")
			}
		case "employment_end":
			e.EmploymentEnd = f.text(k, raw, 10, date)
		case "employing_entity":
			e.EmployingEntity = f.required(k, raw, 200, "Enter the employing company.")
		case "employer_country":
			if v := f.text(k, raw, 2, country); v != nil {
				e.EmployerCountry = *v
			} else {
				f.fail(k, "Choose the employer's country.")
			}
		case "social_security_country":
			e.SocialSecurity = f.text(k, raw, 2, country)
		case "work_country":
			if v := f.text(k, raw, 2, country); v != nil {
				e.WorkCountry = *v
			} else {
				f.fail(k, "Choose the country of work.")
			}
		case "work_region":
			e.WorkRegion = f.text(k, raw, 100, nil)
		case "work_locality":
			e.WorkLocality = f.text(k, raw, 100, nil)
		case "place_of_work":
			e.PlaceOfWork = f.text(k, raw, 200, nil)
		case "residence_country":
			e.ResidenceCountry = f.text(k, raw, 2, country)
		case "cross_border":
			e.CrossBorder = f.flag(k, raw)
		case "cross_border_note":
			e.CrossBorderNote = f.text(k, raw, 500, nil)
		case "legal_hold", "restricted":
			if sess.Role != "owner" {
				return errOwnerOnly
			}
			if k == "legal_hold" {
				e.LegalHold = f.flag(k, raw)
			} else {
				e.Restricted = f.flag(k, raw)
			}
		case "legal_hold_reason":
			e.LegalHoldReason = f.text(k, raw, 500, nil)
		case "weekly_hours":
			e.WeeklyHours = f.hours(k, raw)
		case "notice_period":
			e.NoticePeriod = f.text(k, raw, 100, nil)
		case "thirteenth_salary":
			e.ThirteenthSalary = f.flag(k, raw)
		case "withholding_tax":
			e.WithholdingTax = f.flag(k, raw)
		case "withholding_tax_canton":
			e.WithholdingTaxCanton = f.text(k, raw, 2, canton)
		case "pension_insurer":
			e.PensionInsurer = f.text(k, raw, 200, nil)
		case "accident_insurer":
			e.AccidentInsurer = f.text(k, raw, 200, nil)
		case "sickness_insurer":
			e.SicknessInsurer = f.text(k, raw, 200, nil)
		case "free_transport":
			e.FreeTransport = f.flag(k, raw)
		case "canteen_meals":
			e.CanteenMeals = f.flag(k, raw)
		}
	}
	if e.EmploymentType == "fixed_term" && e.EmploymentEnd == nil {
		f.fail("employment_end", "A fixed-term contract needs its end date.")
	}
	switch {
	case !e.WithholdingTax:
		e.WithholdingTaxCanton = nil
	case e.WorkCountry != "CH":
		f.fail("withholding_tax", "Withholding tax (Quellensteuer) is recorded for work in Switzerland only.")
	case e.WithholdingTaxCanton == nil:
		f.fail("withholding_tax_canton", "Choose the canton the withholding tax is settled with.")
	}
	if create {
		for _, k := range []string{"first_name", "last_name", "employment_start", "work_country", "employer_country"} {
			if body[k] == nil {
				f.fail(k, map[string]string{"first_name": "Enter the first name.", "last_name": "Enter the last name.",
					"employment_start": "Enter the start date.", "work_country": "Choose the country of work.",
					"employer_country": "Choose the employer's country."}[k])
			}
		}
	}
	if e.EmploymentEnd != nil && *e.EmploymentEnd < e.EmploymentStart {
		f.fail("employment_end", "The end date cannot be before the start date.")
	}
	if c, ok := employment.CountryOf(e.WorkCountry); ok && c.RegionLabel != "" && e.WorkRegion != nil {
		code := strings.ToUpper(*e.WorkRegion)
		if _, ok := c.RegionOf(code); !ok {
			f.fail("work_region", "Choose a "+strings.ToLower(c.RegionLabel)+" of "+c.Name+".")
		}
		e.WorkRegion = &code
	}
	if e.LegalHold && e.LegalHoldReason == nil {
		f.fail("legal_hold_reason", "Say why the data must be kept.")
	}
	if !e.LegalHold {
		e.LegalHoldReason = nil
	}
	if e.MemberUserID != nil {
		if _, err := q.MemberRole(r.Context(), sess.Workspace.ID, *e.MemberUserID); errors.Is(err, store.ErrNotFound) {
			f.fail("member_user_id", "Choose a member of this workspace.")
		} else if err != nil {
			return err
		}
	}
	for _, p := range []struct {
		key    string
		sealed *[]byte
		hint   **string
		max    int
		check  func(string) (string, string)
	}{{"bank_account", &e.BankAccountSealed, &e.BankAccountHint, 64, bankAccount}, {"tax_id", &e.TaxIDSealed, &e.TaxIDHint, 32, nil},
		{"social_security_number", &e.SocialSecuritySealed, &e.SocialSecurityHint, 32, socialSecurityCheck(e)}} {
		raw, ok := body[p.key]
		if !ok {
			continue
		}
		v := f.text(p.key, raw, p.max, p.check)
		if v == nil {
			*p.sealed, *p.hint = nil, nil
			continue
		}
		plain := *v
		if p.key == "tax_id" {
			plain = strings.ToUpper(strings.Join(strings.Fields(plain), ""))
		}
		sealed, err := s.seal.seal(sess.Workspace.ID, e.ID, p.key, plain)
		if err != nil {
			return err
		}
		h := hint(plain)
		*p.sealed, *p.hint = sealed, &h
	}
	if len(f) > 0 {
		return validationFailed(f)
	}
	return nil
}

func (s *Service) archive(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.setArchived(w, r, sess, true)
}

func (s *Service) unarchive(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.setArchived(w, r, sess, false)
}

// setArchived archives (ending nothing and deleting nothing) or restores an employee; twice is no error.
func (s *Service) setArchived(w http.ResponseWriter, r *http.Request, sess store.Session, archive bool) error {
	id := r.PathValue("id")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, id, s.today(sess))
		if err != nil || (e.ArchivedAt != nil) == archive {
			return err
		}
		if archive {
			if err := q.ArchiveEmployee(r.Context(), sess.Workspace.ID, id, s.now()); err != nil {
				return err
			}
			return s.audit(r, q, sess, "employee.archived", "employee", id)
		}
		if err := q.UnarchiveEmployee(r.Context(), sess.Workspace.ID, id, s.now()); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.unarchived", "employee", id)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

// delete removes an employee entered by mistake: one without payroll, documents or pay terms. Anyone else is archived.
func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	id := r.PathValue("id")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, id, s.today(sess))
		if err != nil {
			return err
		}
		if e.LegalHold {
			return conflict("legal_hold", "This employee's data is under a legal hold.")
		}
		payroll, docs, terms, err := q.EmployeeHistoryCounts(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if payroll+docs+terms > 0 {
			return conflict("has_history", "This employee has payroll, documents or pay terms. Archive them instead.")
		}
		if err := q.DeleteEmployee(r.Context(), sess.Workspace.ID, id); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.deleted", "employee", id)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// erase answers an erasure request for a former employee: contact details, protected fields and the member link are
// cleared, documents whose retention has passed are deleted. Pay terms, payroll and documents still under a retention
// duty or legal hold stay (with only the name and employment dates left on the record). Consent is not the basis.
func (s *Service) erase(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if sess.Role != "owner" { // it restricts processing and deletes files: an owner's decision, like a legal hold
		return auth.Error(http.StatusForbidden, "forbidden", "Only an owner can erase an employee's personal data.", nil)
	}
	id, today := r.PathValue("id"), s.today(sess)
	var deleted []string
	kept := 0
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		deleted, kept = nil, 0
		e, err := q.EmployeeForUpdate(r.Context(), sess.Workspace.ID, id, today)
		if err != nil {
			return err
		}
		switch {
		case e.LegalHold:
			return conflict("legal_hold", "This employee's data is under a legal hold and cannot be erased.")
		case e.Restricted:
			return errRestricted
		case e.ErasedAt != nil:
			return conflict("erased", "This employee's personal data was already erased.")
		case e.EmploymentEnd == nil || *e.EmploymentEnd >= today:
			return conflict("employment_not_ended", "Personal data can be erased once the employment has ended.")
		}
		docs, err := q.EmployeeDocuments(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		for _, d := range docs {
			if d.LegalHold || d.RetainUntil == nil || *d.RetainUntil >= today {
				kept++
				continue
			}
			key, err := q.DeleteHRFile(r.Context(), sess.Workspace.ID, d.ID)
			if err != nil {
				return err
			}
			deleted = append(deleted, key)
		}
		now := s.now()
		// An erasure request restricts the record as well: what a retention duty keeps is blocked, not processed (ES LOPDGDD art. 32).
		e.Restricted = true
		e.MemberUserID, e.Email, e.Phone, e.Street, e.PostalCode, e.City, e.AddressCountry = nil, nil, nil, nil, nil, nil, nil
		e.StreetNumber, e.Apt = nil, nil
		e.PlaceOfWork, e.CrossBorderNote, e.WorkLocality = nil, nil, nil
		e.BankAccountSealed, e.BankAccountHint, e.TaxIDSealed, e.TaxIDHint = nil, nil, nil, nil
		e.SocialSecuritySealed, e.SocialSecurityHint = nil, nil
		e.ErasedAt = &now
		if err := q.SaveEmployee(r.Context(), sess.Workspace.ID, e, now); err != nil {
			return err
		}
		return s.audit(r, q, sess, "employee.erased", "employee", id)
	})
	if err != nil {
		return err
	}
	for _, key := range deleted {
		s.files.RemoveObject(r.Context(), key)
	}
	e, err := s.db.Employee(r.Context(), sess.Workspace.ID, id, today)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": hideHints(sess, e), "deleted_documents": len(deleted), "kept_documents": kept})
	return nil
}

// protected reveals the sealed fields to an owner or someone with payroll edit (checked by the guard), and logs each
// reveal in the audit log, with who and when but never the values.
func (s *Service) protected(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.db.Employee(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess))
	if err != nil {
		return err
	}
	if err := s.audit(r, s.db.Q, sess, "employee.protected_viewed", "employee", e.ID); err != nil {
		return err
	}
	out := map[string]*string{"bank_account": nil, "tax_id": nil, "social_security_number": nil}
	for k, sealed := range map[string][]byte{"bank_account": e.BankAccountSealed, "tax_id": e.TaxIDSealed,
		"social_security_number": e.SocialSecuritySealed} {
		if sealed == nil {
			continue
		}
		v, err := s.seal.open(sess.Workspace.ID, e.ID, k, sealed)
		if err != nil {
			return err
		}
		out[k] = &v
	}
	w.Header().Set("Cache-Control", "no-store")
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func resolve(e store.Employee, on time.Time) employment.Resolution {
	in := employment.Input{EmployerCountry: e.EmployerCountry, WorkCountry: e.WorkCountry, CrossBorder: e.CrossBorder, On: on}
	for dst, src := range map[*string]*string{&in.WorkRegion: e.WorkRegion, &in.WorkLocality: e.WorkLocality,
		&in.ResidenceCountry: e.ResidenceCountry, &in.SocialSecurityCountry: e.SocialSecurity} {
		if src != nil {
			*dst = *src
		}
	}
	return employment.Resolve(in)
}

// jurisdiction says what the module supports for the employee's situation on a date (default today).
func (s *Service) jurisdiction(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.db.Employee(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess))
	if err != nil {
		return err
	}
	on, err := time.Parse(time.DateOnly, s.today(sess))
	if err != nil {
		return err
	}
	if v := r.URL.Query().Get("on"); v != "" {
		if on, err = time.Parse(time.DateOnly, v); err != nil {
			return badRequest("on must be a date YYYY-MM-DD.")
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(resolve(e, on)))
	return nil
}

func (s *Service) history(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	id := r.PathValue("id")
	if _, err := s.db.Employee(r.Context(), sess.Workspace.ID, id, s.today(sess)); err != nil {
		return err
	}
	list, err := s.db.EmployeeHistory(r.Context(), sess.Workspace.ID, id, permissions.Allows(sess.Role, sess.Scopes, "read:payroll"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

// settings answers the company's employment profile and how many members may approve payroll, so the screens can
// say when four-eyes approval has nobody to approve.
func (s *Service) settings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	set, err := s.db.EmploymentSettings(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	n, err := s.db.PayrollApprovers(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(struct {
		store.EmploymentSettings
		PayrollApprovers int `json:"payroll_approvers"`
	}{set, n}))
	return nil
}

// putSettings stores the company's employment profile, which pre-fills new employees and never decides for them.
func (s *Service) putSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := known(body, []string{"employing_entity", "country", "region", "require_second_approver"}); err != nil {
		return err
	}
	old, err := s.db.EmploymentSettings(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	f := fields{}
	set := store.EmploymentSettings{EmployingEntity: f.text("employing_entity", body["employing_entity"], 200, nil),
		Country: f.text("country", body["country"], 2, country), Region: f.text("region", body["region"], 100, nil),
		RequireSecondApprover: old.RequireSecondApprover}
	if raw, ok := body["require_second_approver"]; ok {
		set.RequireSecondApprover = f.flag("require_second_approver", raw)
	}
	if set.Region != nil && set.Country != nil {
		if c, ok := employment.CountryOf(*set.Country); ok && c.RegionLabel != "" {
			code := strings.ToUpper(*set.Region)
			if _, ok := c.RegionOf(code); !ok {
				f.fail("region", "Choose a "+strings.ToLower(c.RegionLabel)+" of "+c.Name+".")
			}
			set.Region = &code
		}
	}
	if len(f) > 0 {
		return validationFailed(f)
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.PutEmploymentSettings(r.Context(), sess.Workspace.ID, set, s.now()); err != nil {
			return err
		}
		if set.RequireSecondApprover == old.RequireSecondApprover {
			return nil
		}
		return s.audit(r, q, sess, map[bool]string{true: "payroll.four_eyes_on", false: "payroll.four_eyes_off"}[set.RequireSecondApprover],
			"employment_settings", sess.Workspace.ID)
	})
	if err != nil {
		return err
	}
	return s.settings(w, r, sess)
}

// jurisdictions lists the modelled countries and every rule version with its source, check date and status.
func (s *Service) jurisdictions(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"countries": employment.Countries(),
		"rules": employment.Rules()}})
	return nil
}
