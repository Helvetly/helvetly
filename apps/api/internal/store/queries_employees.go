package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"helvetly.com/api/internal/invoicecalc"
)

// Employees: the workspace company's own staff (docs/planning/2026-11-15-employees.md). An employee is not a
// member: no user, no seat, no access. The struct is the API's JSON as well; the sealed fields never leave the store
// in JSON.

// ErrEmployeeNumberTaken: another employee of the workspace has this number.
var ErrEmployeeNumberTaken = errors.New("employee number taken")

// ErrMemberLinked: another employee is already linked to this member.
var ErrMemberLinked = errors.New("member already linked")

type EmploymentSettings struct {
	EmployingEntity *string `json:"employing_entity"`
	Country         *string `json:"country"`
	Region          *string `json:"region"`
	// RequireSecondApprover: the person who created or last changed a payroll entry cannot approve it.
	RequireSecondApprover bool       `json:"require_second_approver"`
	UpdatedAt             *time.Time `json:"updated_at"`
}

type Employee struct {
	ID                string               `json:"id"`
	MemberUserID      *string              `json:"member_user_id"`
	MemberName        *string              `json:"member_name"`
	MemberActive      bool                 `json:"member_active"` // the linked user is still a member of the workspace
	EmployeeNumber    *string              `json:"employee_number"`
	FirstName         string               `json:"first_name"`
	LastName          string               `json:"last_name"`
	Email             *string              `json:"email"`
	Phone             *string              `json:"phone"`
	Street            *string              `json:"street"`
	StreetNumber      *string              `json:"street_number"`
	Apt               *string              `json:"apt"`
	PostalCode        *string              `json:"postal_code"`
	City              *string              `json:"city"`
	AddressCountry    *string              `json:"address_country"`
	Position          *string              `json:"position"`
	Department        *string              `json:"department"`
	EmploymentType    string               `json:"employment_type"`
	WorkingTime       *invoicecalc.Percent `json:"working_time"`
	EmploymentStart   string               `json:"employment_start"`
	EmploymentEnd     *string              `json:"employment_end"`
	EmployingEntity   string               `json:"employing_entity"`
	EmployerCountry   string               `json:"employer_country"`
	SocialSecurity    *string              `json:"social_security_country"`
	WorkCountry       string               `json:"work_country"`
	WorkRegion        *string              `json:"work_region"`
	WorkLocality      *string              `json:"work_locality"`
	PlaceOfWork       *string              `json:"place_of_work"`
	ResidenceCountry  *string              `json:"residence_country"`
	CrossBorder       bool                 `json:"cross_border"`
	CrossBorderNote   *string              `json:"cross_border_note"`
	BankAccountHint   *string              `json:"bank_account_hint"` // last characters only; the value is sealed
	TaxIDHint         *string              `json:"tax_id_hint"`
	LegalHold         bool                 `json:"legal_hold"`
	LegalHoldReason   *string              `json:"legal_hold_reason"`
	Restricted        bool                 `json:"restricted"`
	Status            string               `json:"status"` // active, upcoming, ended, archived
	ErasedAt          *time.Time           `json:"erased_at"`
	ArchivedAt        *time.Time           `json:"archived_at"`
	CreatedAt         time.Time            `json:"created_at"`
	UpdatedAt         time.Time            `json:"updated_at"`
	BankAccountSealed []byte               `json:"-"`
	TaxIDSealed       []byte               `json:"-"`
	Details
}

// Details are the contract, Swiss payroll and insurance fields (salary certificate, form 11) and the sealed
// social-security number, written apart from the main record.
type Details struct {
	WeeklyHours          *invoicecalc.Quantity `json:"weekly_hours"`
	NoticePeriod         *string               `json:"notice_period"`
	ThirteenthSalary     bool                  `json:"thirteenth_salary"`
	WithholdingTax       bool                  `json:"withholding_tax"` // Swiss Quellensteuer
	WithholdingTaxCanton *string               `json:"withholding_tax_canton"`
	PensionInsurer       *string               `json:"pension_insurer"`  // BVG/LPP
	AccidentInsurer      *string               `json:"accident_insurer"` // UVG/LAA
	SicknessInsurer      *string               `json:"sickness_insurer"` // KTG daily sickness allowance
	FreeTransport        bool                  `json:"free_transport"`   // form 11 box F
	CanteenMeals         bool                  `json:"canteen_meals"`    // form 11 box G
	SocialSecurityHint   *string               `json:"social_security_number_hint"`
	SocialSecuritySealed []byte                `json:"-"`
}

// Derive sets the status from the dates on the workspace's day today (YYYY-MM-DD).
func (e *Employee) Derive(today string) {
	switch {
	case e.ArchivedAt != nil:
		e.Status = "archived"
	case e.EmploymentStart > today:
		e.Status = "upcoming"
	case e.EmploymentEnd != nil && *e.EmploymentEnd < today:
		e.Status = "ended"
	default:
		e.Status = "active"
	}
}

const employeeColumns = `e.id, e.member_user_id, coalesce(nullif(u.name, ''), u.email), m.user_id IS NOT NULL, e.employee_number, e.first_name,
	e.last_name, e.email, e.phone, e.street, e.postal_code, e.city, e.address_country, e.position, e.department,
	e.employment_type, e.working_time_percent, e.employment_start::text, e.employment_end::text, e.employing_entity,
	e.employer_country, e.social_security_country, e.work_country, e.work_region, e.work_locality, e.place_of_work, e.residence_country, e.cross_border,
	e.cross_border_note, e.bank_account_hint, e.tax_id_hint, e.legal_hold, e.legal_hold_reason, e.restricted,
	e.erased_at, e.archived_at, e.created_at, e.updated_at, e.bank_account_sealed, e.tax_id_sealed, e.weekly_hours_milli,
	e.notice_period, e.thirteenth_salary, e.withholding_tax, e.withholding_tax_canton, e.pension_insurer, e.accident_insurer,
	e.sickness_insurer, e.free_transport, e.canteen_meals, e.social_security_number_hint, e.social_security_number_sealed, e.street_number, e.apt`

const employeeFrom = ` FROM employees e LEFT JOIN users u ON u.id = e.member_user_id
	LEFT JOIN workspace_members m ON m.workspace_id = e.workspace_id AND m.user_id = e.member_user_id`

func scanEmployee(row interface{ Scan(...any) error }, today string) (Employee, error) {
	var e Employee
	var wt, hours *int64
	err := row.Scan(&e.ID, &e.MemberUserID, &e.MemberName, &e.MemberActive, &e.EmployeeNumber, &e.FirstName, &e.LastName,
		&e.Email, &e.Phone, &e.Street, &e.PostalCode, &e.City, &e.AddressCountry, &e.Position, &e.Department,
		&e.EmploymentType, &wt, &e.EmploymentStart, &e.EmploymentEnd, &e.EmployingEntity, &e.EmployerCountry, &e.SocialSecurity, &e.WorkCountry, &e.WorkRegion,
		&e.WorkLocality, &e.PlaceOfWork, &e.ResidenceCountry, &e.CrossBorder, &e.CrossBorderNote, &e.BankAccountHint,
		&e.TaxIDHint, &e.LegalHold, &e.LegalHoldReason, &e.Restricted, &e.ErasedAt, &e.ArchivedAt, &e.CreatedAt,
		&e.UpdatedAt, &e.BankAccountSealed, &e.TaxIDSealed, &hours, &e.NoticePeriod, &e.ThirteenthSalary, &e.WithholdingTax,
		&e.WithholdingTaxCanton, &e.PensionInsurer, &e.AccidentInsurer, &e.SicknessInsurer, &e.FreeTransport, &e.CanteenMeals,
		&e.SocialSecurityHint, &e.SocialSecuritySealed, &e.StreetNumber, &e.Apt)
	if hours != nil {
		h := invoicecalc.Quantity(*hours)
		e.WeeklyHours = &h
	}
	if wt != nil {
		p := invoicecalc.Percent(*wt)
		e.WorkingTime = &p
	}
	e.Derive(today)
	return e, err
}

func employeeErr(err error) error {
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		switch pg.ConstraintName {
		case "employees_number":
			return ErrEmployeeNumberTaken
		case "employees_member":
			return ErrMemberLinked
		}
	}
	return err
}

// EmployeeFilter narrows the list: a status (active, upcoming, ended, archived; "" for all not archived, "all" for
// every one), a department and a search over names, number, email, position and department.
type EmployeeFilter struct {
	Status, Department, Search string
	// Sort is one of the keys of employeeOrder ("" = by name); Desc reverses it.
	Sort string
	Desc bool
}

// employeeOrder maps a sort key to its SQL (a whitelist: the key never reaches the query itself). Only visible
// columns sort, never a sealed field.
var employeeOrder = map[string]string{
	"name":       "lower(e.last_name) %[1]s, lower(e.first_name) %[1]s",
	"position":   "lower(e.position) %[1]s NULLS LAST",
	"department": "lower(e.department) %[1]s NULLS LAST",
	"since":      "e.employment_start %[1]s",
}

// ValidEmployeeSort reports whether key names a sortable column.
func ValidEmployeeSort(key string) bool { _, ok := employeeOrder[key]; return ok }

// HasEmployees reports whether the workspace ever recorded an employee (archived ones included): HR data an owner
// may still read and export after a downgrade.
func (q Q) HasEmployees(ctx context.Context, workspaceID string) (bool, error) {
	var has bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM employees WHERE workspace_id = $1)`, workspaceID).Scan(&has)
	return has, err
}

func (q Q) ListEmployees(ctx context.Context, workspaceID string, f EmployeeFilter, today string, limit, offset int) ([]Employee, int, error) {
	where := []string{"e.workspace_id = $1", "$2::date IS NOT NULL"} // $2, today, is used by the status filters
	args := []any{workspaceID, today}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	switch f.Status {
	case "":
		where = append(where, "e.archived_at IS NULL")
	case "archived":
		where = append(where, "e.archived_at IS NOT NULL")
	case "upcoming":
		where = append(where, "e.archived_at IS NULL AND e.employment_start > $2::date")
	case "ended":
		where = append(where, "e.archived_at IS NULL AND e.employment_end < $2::date")
	case "active":
		where = append(where, "e.archived_at IS NULL AND e.employment_start <= $2::date AND (e.employment_end IS NULL OR e.employment_end >= $2::date)")
	}
	if f.Department != "" {
		where = append(where, "lower(e.department) = lower("+arg(f.Department)+")")
	}
	if f.Search != "" {
		p := arg("%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(f.Search) + "%")
		where = append(where, "(e.first_name || ' ' || e.last_name ILIKE "+p+" OR e.last_name || ' ' || e.first_name ILIKE "+p+
			" OR e.employee_number ILIKE "+p+" OR e.email ILIKE "+p+" OR e.position ILIKE "+p+" OR e.department ILIKE "+p+")")
	}
	cond := strings.Join(where, " AND ")
	var total int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM employees e WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	order := employeeOrder["name"]
	if f.Sort != "" {
		order = employeeOrder[f.Sort]
	}
	dir := "ASC"
	if f.Desc {
		dir = "DESC"
	}
	rows, err := q.db.Query(ctx, `SELECT `+employeeColumns+employeeFrom+` WHERE `+cond+`
		ORDER BY `+fmt.Sprintf(order, dir)+`, lower(e.last_name), lower(e.first_name), e.id LIMIT `+arg(limit)+` OFFSET `+arg(offset), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := []Employee{}
	for rows.Next() {
		e, err := scanEmployee(rows, today)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, e)
	}
	return list, total, rows.Err()
}

// EmployeeDepartments are the departments in use, for the list's filter.
func (q Q) EmployeeDepartments(ctx context.Context, workspaceID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT DISTINCT ON (lower(department)) department FROM employees
		WHERE workspace_id = $1 AND department IS NOT NULL ORDER BY lower(department)`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (q Q) Employee(ctx context.Context, workspaceID, id, today string) (Employee, error) {
	return scanEmployee(q.db.QueryRow(ctx, `SELECT `+employeeColumns+employeeFrom+` WHERE e.workspace_id = $1 AND e.id = $2`,
		workspaceID, id), today)
}

// EmployeeForUpdate locks the employee for the rest of the transaction.
func (q Q) EmployeeForUpdate(ctx context.Context, workspaceID, id, today string) (Employee, error) {
	return scanEmployee(q.db.QueryRow(ctx, `SELECT `+employeeColumns+employeeFrom+` WHERE e.workspace_id = $1 AND e.id = $2
		FOR UPDATE OF e`, workspaceID, id), today)
}

func workingTime(p *invoicecalc.Percent) *int64 {
	if p == nil {
		return nil
	}
	v := int64(*p)
	return &v
}

// CreateEmployee adds an employee. Employees are no seats and the current offer sets no employee limit, so nothing
// is admitted against the plan.
func (q Q) CreateEmployee(ctx context.Context, workspaceID, userID string, e Employee) error {
	_, err := q.db.Exec(ctx, `INSERT INTO employees (id, workspace_id, member_user_id, employee_number, first_name, last_name,
		email, phone, street, postal_code, city, address_country, position, department, employment_type,
		working_time_percent, employment_start, employment_end, employing_entity, work_country, work_region, work_locality,
		place_of_work, residence_country, cross_border, cross_border_note, bank_account_sealed, bank_account_hint,
		tax_id_sealed, tax_id_hint, created_by, created_at, updated_at, employer_country, social_security_country)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
		$24, $25, $26, $27, $28, $29, $30, $31, $32, $32, $33, $34)`,
		e.ID, workspaceID, e.MemberUserID, e.EmployeeNumber, e.FirstName, e.LastName, e.Email, e.Phone, e.Street,
		e.PostalCode, e.City, e.AddressCountry, e.Position, e.Department, e.EmploymentType, workingTime(e.WorkingTime),
		e.EmploymentStart, e.EmploymentEnd, e.EmployingEntity, e.WorkCountry, e.WorkRegion, e.WorkLocality, e.PlaceOfWork,
		e.ResidenceCountry, e.CrossBorder, e.CrossBorderNote, e.BankAccountSealed, e.BankAccountHint, e.TaxIDSealed,
		e.TaxIDHint, userID, e.CreatedAt, e.EmployerCountry, e.SocialSecurity)
	if err != nil {
		return employeeErr(err)
	}
	// an owner may set a legal hold or a restriction on the new record already
	if _, err := q.db.Exec(ctx, `UPDATE employees SET legal_hold = $3, legal_hold_reason = $4, restricted = $5
		WHERE workspace_id = $1 AND id = $2`, workspaceID, e.ID, e.LegalHold, e.LegalHoldReason, e.Restricted); err != nil {
		return err
	}
	return q.saveDetails(ctx, workspaceID, e)
}

// saveDetails writes e's Details.
func (q Q) saveDetails(ctx context.Context, workspaceID string, e Employee) error {
	var hours *int64
	if e.WeeklyHours != nil {
		h := int64(*e.WeeklyHours)
		hours = &h
	}
	_, err := q.db.Exec(ctx, `UPDATE employees SET weekly_hours_milli = $3, notice_period = $4, thirteenth_salary = $5,
		withholding_tax = $6, withholding_tax_canton = $7, pension_insurer = $8, accident_insurer = $9, sickness_insurer = $10,
		free_transport = $11, canteen_meals = $12, social_security_number_hint = $13, social_security_number_sealed = $14,
		street_number = $15, apt = $16
		WHERE workspace_id = $1 AND id = $2`, workspaceID, e.ID, hours, e.NoticePeriod, e.ThirteenthSalary, e.WithholdingTax,
		e.WithholdingTaxCanton, e.PensionInsurer, e.AccidentInsurer, e.SicknessInsurer, e.FreeTransport, e.CanteenMeals,
		e.SocialSecurityHint, e.SocialSecuritySealed, e.StreetNumber, e.Apt)
	return err
}

// SaveEmployee writes every editable field of e.
func (q Q) SaveEmployee(ctx context.Context, workspaceID string, e Employee, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE employees SET member_user_id = $3, employee_number = $4, first_name = $5, last_name = $6,
		email = $7, phone = $8, street = $9, postal_code = $10, city = $11, address_country = $12, position = $13,
		department = $14, employment_type = $15, working_time_percent = $16, employment_start = $17, employment_end = $18,
		employing_entity = $19, work_country = $20, work_region = $21, work_locality = $22, place_of_work = $23,
		residence_country = $24, cross_border = $25, cross_border_note = $26, bank_account_sealed = $27,
		bank_account_hint = $28, tax_id_sealed = $29, tax_id_hint = $30, legal_hold = $31, legal_hold_reason = $32,
		restricted = $33, erased_at = $34, updated_at = $35, employer_country = $36, social_security_country = $37
		WHERE workspace_id = $1 AND id = $2`,
		workspaceID, e.ID, e.MemberUserID, e.EmployeeNumber, e.FirstName, e.LastName, e.Email, e.Phone, e.Street,
		e.PostalCode, e.City, e.AddressCountry, e.Position, e.Department, e.EmploymentType, workingTime(e.WorkingTime),
		e.EmploymentStart, e.EmploymentEnd, e.EmployingEntity, e.WorkCountry, e.WorkRegion, e.WorkLocality, e.PlaceOfWork,
		e.ResidenceCountry, e.CrossBorder, e.CrossBorderNote, e.BankAccountSealed, e.BankAccountHint, e.TaxIDSealed,
		e.TaxIDHint, e.LegalHold, e.LegalHoldReason, e.Restricted, e.ErasedAt, now, e.EmployerCountry, e.SocialSecurity)
	if err != nil {
		return employeeErr(err)
	}
	return q.saveDetails(ctx, workspaceID, e)
}

// ArchiveEmployee archives; nothing is deleted.
func (q Q) ArchiveEmployee(ctx context.Context, workspaceID, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE employees SET archived_at = $3, updated_at = $3 WHERE workspace_id = $1 AND id = $2`,
		workspaceID, id, now)
	return err
}

func (q Q) UnarchiveEmployee(ctx context.Context, workspaceID, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE employees SET archived_at = NULL, updated_at = $3 WHERE workspace_id = $1 AND id = $2`,
		workspaceID, id, now)
	return err
}

// EmployeeHistoryCounts says what an employee has that deleting would lose.
func (q Q) EmployeeHistoryCounts(ctx context.Context, workspaceID, id string) (payroll, documents, terms int, err error) {
	err = q.db.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM payroll_entries WHERE workspace_id = $1 AND employee_id = $2),
		(SELECT count(*) FROM documents WHERE workspace_id = $1 AND employee_id = $2),
		(SELECT count(*) FROM employee_pay_terms WHERE workspace_id = $1 AND employee_id = $2)`, workspaceID, id).
		Scan(&payroll, &documents, &terms)
	return payroll, documents, terms, err
}

func (q Q) DeleteEmployee(ctx context.Context, workspaceID, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM employees WHERE workspace_id = $1 AND id = $2`, workspaceID, id)
	return err
}

func (q Q) EmploymentSettings(ctx context.Context, workspaceID string) (EmploymentSettings, error) {
	var s EmploymentSettings
	err := q.db.QueryRow(ctx, `SELECT employing_entity, country, region, require_second_approver, updated_at
		FROM employment_settings WHERE workspace_id = $1`, workspaceID).
		Scan(&s.EmployingEntity, &s.Country, &s.Region, &s.RequireSecondApprover, &s.UpdatedAt)
	if errors.Is(err, ErrNotFound) {
		return EmploymentSettings{}, nil
	}
	return s, err
}

func (q Q) PutEmploymentSettings(ctx context.Context, workspaceID string, s EmploymentSettings, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO employment_settings (workspace_id, employing_entity, country, region,
		require_second_approver, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (workspace_id) DO UPDATE SET employing_entity = EXCLUDED.employing_entity, country = EXCLUDED.country,
		region = EXCLUDED.region, require_second_approver = EXCLUDED.require_second_approver, updated_at = EXCLUDED.updated_at`,
		workspaceID, s.EmployingEntity, s.Country, s.Region, s.RequireSecondApprover, now)
	return err
}

// PayrollApprovers counts the members who may approve payroll: owners and those granted payroll edit.
func (q Q) PayrollApprovers(ctx context.Context, workspaceID string) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM workspace_members WHERE workspace_id = $1
		AND (role = 'owner' OR scopes && ARRAY['write:payroll', '*:payroll'])`, workspaceID).Scan(&n)
	return n, err
}

// ---- pay terms ----

type PayTerms struct {
	ID            string            `json:"id"`
	EmployeeID    string            `json:"employee_id"`
	EffectiveFrom string            `json:"effective_from"`
	Basis         string            `json:"basis"`
	Amount        invoicecalc.Money `json:"amount"`
	Currency      string            `json:"currency"`
	Frequency     string            `json:"frequency"`
	Note          *string           `json:"note"`
	Current       bool              `json:"current"` // the terms in effect today
	CreatedBy     *string           `json:"created_by"`
	CreatedAt     time.Time         `json:"created_at"`
}

// ErrPayTermsDate: the employee already has terms from that date.
var ErrPayTermsDate = errors.New("pay terms date taken")

// PayTermsHistory lists an employee's terms, newest effective date first, marking the one in effect today.
func (q Q) PayTermsHistory(ctx context.Context, workspaceID, employeeID, today string) ([]PayTerms, error) {
	rows, err := q.db.Query(ctx, `SELECT t.id, t.employee_id, t.effective_from::text, t.basis, t.amount, t.currency, t.frequency,
		t.note, coalesce(nullif(u.name, ''), u.email), t.created_at FROM employee_pay_terms t LEFT JOIN users u ON u.id = t.created_by
		WHERE t.workspace_id = $1 AND t.employee_id = $2 ORDER BY t.effective_from DESC`, workspaceID, employeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, current := []PayTerms{}, false
	for rows.Next() {
		var t PayTerms
		if err := rows.Scan(&t.ID, &t.EmployeeID, &t.EffectiveFrom, &t.Basis, &t.Amount, &t.Currency, &t.Frequency, &t.Note,
			&t.CreatedBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		if !current && t.EffectiveFrom <= today {
			t.Current, current = true, true
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func (q Q) AddPayTerms(ctx context.Context, workspaceID, userID string, t PayTerms) error {
	_, err := q.db.Exec(ctx, `INSERT INTO employee_pay_terms (id, workspace_id, employee_id, effective_from, basis, amount,
		currency, frequency, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		t.ID, workspaceID, t.EmployeeID, t.EffectiveFrom, t.Basis, t.Amount, t.Currency, t.Frequency, t.Note, userID, t.CreatedAt)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		return ErrPayTermsDate
	}
	return err
}

// DeleteFuturePayTerms removes terms that have not taken effect by today; false when there were none such.
func (q Q) DeleteFuturePayTerms(ctx context.Context, workspaceID, employeeID, id, today string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM employee_pay_terms WHERE workspace_id = $1 AND employee_id = $2 AND id = $3
		AND effective_from > $4::date`, workspaceID, employeeID, id, today)
	return tag.RowsAffected() == 1, err
}

// ---- employee documents (HR files with their employment metadata) ----

type EmployeeDocument struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Size          int64     `json:"size"`
	ContentType   string    `json:"content_type"`
	Type          string    `json:"type"`
	DocumentDate  *string   `json:"document_date"`
	RetainUntil   *string   `json:"retain_until"`
	RetentionRule *string   `json:"retention_rule"` // the rule that set retain_until; nil when a person set it
	LegalHold     bool      `json:"legal_hold"`
	UploadedBy    *string   `json:"uploaded_by"`
	CreatedAt     time.Time `json:"created_at"`
}

const employeeDocumentSelect = `SELECT d.id, d.name, d.size, d.content_type, x.type, x.document_date::text, x.retain_until::text,
	x.retention_rule, x.legal_hold, coalesce(nullif(u.name, ''), u.email), d.created_at
	FROM employee_documents x JOIN documents d ON d.id = x.document_id AND d.hr_private
	LEFT JOIN users u ON u.id = d.uploaded_by `

func scanEmployeeDocument(row interface{ Scan(...any) error }) (EmployeeDocument, error) {
	var d EmployeeDocument
	err := row.Scan(&d.ID, &d.Name, &d.Size, &d.ContentType, &d.Type, &d.DocumentDate, &d.RetainUntil, &d.RetentionRule,
		&d.LegalHold, &d.UploadedBy, &d.CreatedAt)
	return d, err
}

// EmployeeDocuments lists an employee's documents, newest document date first.
func (q Q) EmployeeDocuments(ctx context.Context, workspaceID, employeeID string) ([]EmployeeDocument, error) {
	rows, err := q.db.Query(ctx, employeeDocumentSelect+`WHERE x.workspace_id = $1 AND x.employee_id = $2
		ORDER BY coalesce(x.document_date, d.created_at::date) DESC, d.created_at DESC`, workspaceID, employeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmployeeDocument{}
	for rows.Next() {
		d, err := scanEmployeeDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (q Q) EmployeeDocument(ctx context.Context, workspaceID, employeeID, id string) (EmployeeDocument, error) {
	return scanEmployeeDocument(q.db.QueryRow(ctx, employeeDocumentSelect+`WHERE x.workspace_id = $1 AND x.employee_id = $2
		AND x.document_id = $3`, workspaceID, employeeID, id))
}

// SaveEmployeeDocument inserts or updates a document's employment metadata.
func (q Q) SaveEmployeeDocument(ctx context.Context, workspaceID, employeeID string, d EmployeeDocument) error {
	_, err := q.db.Exec(ctx, `INSERT INTO employee_documents (document_id, workspace_id, employee_id, type, document_date,
		retain_until, retention_rule, legal_hold) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (document_id) DO UPDATE SET type = EXCLUDED.type, document_date = EXCLUDED.document_date,
		retain_until = EXCLUDED.retain_until, retention_rule = EXCLUDED.retention_rule, legal_hold = EXCLUDED.legal_hold
		WHERE employee_documents.workspace_id = EXCLUDED.workspace_id AND employee_documents.employee_id = EXCLUDED.employee_id`,
		d.ID, workspaceID, employeeID, d.Type, d.DocumentDate, d.RetainUntil, d.RetentionRule, d.LegalHold)
	return err
}

// HistoryEvent is one audit entry about an employee or their payroll, without payload.
type HistoryEvent struct {
	Kind        string    `json:"kind"`
	SubjectType string    `json:"subject_type"`
	SubjectID   string    `json:"subject_id"`
	Actor       *string   `json:"actor"`
	At          time.Time `json:"at"`
}

// EmployeeHistory: the audit entries about the employee and, with payroll, their payroll entries, newest first (at
// most 200).
func (q Q) EmployeeHistory(ctx context.Context, workspaceID, employeeID string, payroll bool) ([]HistoryEvent, error) {
	rows, err := q.db.Query(ctx, `SELECT f.kind, f.subject_type, f.subject_id, coalesce(nullif(u.name, ''), u.email), f.at FROM financial_events f
		LEFT JOIN users u ON u.id = f.actor_id WHERE f.workspace_id = $1 AND (f.subject_type = 'employee' AND f.subject_id = $2
		OR $3 AND f.subject_type = 'payroll_entry' AND f.subject_id IN (SELECT id FROM payroll_entries WHERE workspace_id = $1 AND employee_id = $2))
		ORDER BY f.seq DESC LIMIT 200`, workspaceID, employeeID, payroll)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistoryEvent{}
	for rows.Next() {
		var e HistoryEvent
		if err := rows.Scan(&e.Kind, &e.SubjectType, &e.SubjectID, &e.Actor, &e.At); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
