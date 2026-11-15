package employees

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// The payroll import (internal/imports, kind "payroll") reads a CSV without the AI model and creates draft entries
// through the same checks as the form. An empty cell is a missing value, never 0; an entry for a period the employee
// already has is a conflict for the person to resolve, so importing the same file twice creates nothing twice.

// ImportFields are the payroll import's columns; employee_number or email names the employee.
var ImportFields = []string{"employee_number", "email", "period_start", "period_end", "currency", "gross", "deductions", "net",
	"employer_costs", "pay_date", "source_ref", "note"}

// importEntry turns an import record into an entry, with a message per invalid field.
func importEntry(ctx context.Context, q store.Q, workspaceID string, data map[string]json.RawMessage) (store.PayrollEntry, map[string]string, error) {
	p := store.PayrollEntry{Source: "import"}
	body := map[string]json.RawMessage{}
	for _, k := range []string{"period_start", "period_end", "currency", "gross", "deductions", "net", "employer_costs", "pay_date",
		"source_ref", "note"} {
		if v, ok := data[k]; ok {
			body[k] = v
		}
	}
	f := parseEntry(&p, body)
	for k, msg := range map[string]string{"period_start": "Enter the date.", "period_end": "Enter the date.", "currency": "Choose a currency."} {
		if body[k] == nil {
			f.fail(k, msg)
		}
	}
	number, email := rawString(data["employee_number"]), rawString(data["email"])
	if number == "" && email == "" {
		f.fail("employee_number", "Name the employee by employee number or email.")
	} else {
		id, err := q.EmployeeIDByNumberOrEmail(ctx, workspaceID, number, email)
		switch {
		case errors.Is(err, store.ErrNotFound):
			f.fail("employee_number", "No employee of this workspace has this number or email.")
		case err != nil:
			return p, nil, err
		}
		p.EmployeeID = id
	}
	if len(f) == 0 {
		for k, v := range CheckEntry(p) {
			f.fail(k, v)
		}
	}
	return p, f, nil
}

func rawString(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return s
}

// CheckImport applies the entry rules to an import record, including the employee's employment.
func CheckImport(ctx context.Context, q store.Q, workspaceID string, data map[string]json.RawMessage) (map[string]string, error) {
	p, f, err := importEntry(ctx, q, workspaceID, data)
	if err != nil || len(f) > 0 {
		return f, err
	}
	e, err := q.Employee(ctx, workspaceID, p.EmployeeID, time.Now().UTC().Format(time.DateOnly))
	if err != nil {
		return nil, err
	}
	if err := checkEmployment(e, p); err != nil {
		if _, _, msg, ok := auth.Describe(err); ok {
			return map[string]string{"period_start": msg}, nil
		}
		return nil, err
	}
	return nil, nil
}

// ImportConflict names the employee's existing entry for the same period: a draft may be overwritten, an approved one
// only corrected.
func ImportConflict(ctx context.Context, q store.Q, workspaceID string, data map[string]json.RawMessage) (*store.ImportConflict, error) {
	p, f, err := importEntry(ctx, q, workspaceID, data)
	if err != nil || len(f) > 0 {
		return nil, err
	}
	existing, err := q.PayrollOriginal(ctx, workspaceID, p.EmployeeID, p.PeriodStart, p.PeriodEnd)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c := &store.ImportConflict{ID: existing.ID, Label: existing.EmployeeName + " · " + existing.PeriodStart + " – " + existing.PeriodEnd,
		Reason: "This employee already has an entry for this period.", CanOverwrite: existing.Status == "draft"}
	if !c.CanOverwrite {
		why := "It is approved: record a correction instead of overwriting it."
		c.Why = &why
	}
	return c, nil
}

// CreateImport creates the draft entry of a checked import record.
func CreateImport(ctx context.Context, q store.Q, sess store.Session, data map[string]json.RawMessage) (string, error) {
	p, f, err := importEntry(ctx, q, sess.Workspace.ID, data)
	if err != nil {
		return "", err
	}
	if len(f) > 0 {
		return "", validationFailed(f)
	}
	now := time.Now().UTC()
	return CreateEntry(ctx, q, sess, p, sess.Workspace.Today(now), now)
}

// OverwriteImport replaces a draft entry's figures with the import record's; an approved entry is refused.
func OverwriteImport(ctx context.Context, q store.Q, sess store.Session, data map[string]json.RawMessage, id string) (string, error) {
	p, f, err := importEntry(ctx, q, sess.Workspace.ID, data)
	if err != nil {
		return "", err
	}
	if len(f) > 0 {
		return "", validationFailed(f)
	}
	existing, err := q.PayrollEntryForUpdate(ctx, sess.Workspace.ID, id)
	if err != nil {
		return "", err
	}
	if existing.Status != "draft" {
		return "", errApproved
	}
	p.ID, p.EmployingEntity, p.SupersedesID = existing.ID, existing.EmployingEntity, nil
	if p.Components == nil {
		p.Components = []store.PayrollComponent{}
	}
	ok, err := q.SavePayrollDraft(ctx, sess.Workspace.ID, p, existing.Version, time.Now().UTC())
	if err != nil {
		return "", err
	}
	if !ok {
		return "", auth.Error(http.StatusConflict, "conflict", "The entry changed meanwhile.", nil)
	}
	return id, nil
}
