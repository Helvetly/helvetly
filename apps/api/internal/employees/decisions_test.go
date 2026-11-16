package employees

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

// ---- plan: the module is on the Business plan; a downgraded workspace keeps its data, readable by the owner ----

func TestPlanGateOnEveryPath(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	hr := e.join(owner.workspace, "member", []string{"write:employees", "write:payroll"})
	id := e.employee(owner, anna)
	entry := e.must(owner, 201, "POST", "/api/v1/payroll/entries", map[string]any{"employee_id": id, "period_start": "2026-10-01",
		"period_end": "2026-10-31", "currency": "CHF", "gross": "6000.00"})["id"].(string)
	_, doc := e.upload(owner, "/api/v1/employees/"+id+"/documents", "contract.pdf", pdf, map[string]string{"type": "employment_contract"})
	docID := doc["data"].(map[string]any)["id"].(string)
	e.denied.Store(owner.workspace, true)

	reads := []string{"/api/v1/employees", "/api/v1/employees/" + id, "/api/v1/employees/" + id + "/protected",
		"/api/v1/employees/" + id + "/jurisdiction", "/api/v1/employees/" + id + "/history", "/api/v1/employees/" + id + "/pay-terms",
		"/api/v1/employees/" + id + "/documents", "/api/v1/employees/" + id + "/documents/" + docID + "/download",
		"/api/v1/employment/settings", "/api/v1/employment/jurisdictions", "/api/v1/employment/retention",
		"/api/v1/payroll/entries", "/api/v1/payroll/entries/" + entry, "/api/v1/payroll/summary?month=2026-10",
		"/api/v1/payroll/export?month=2026-10", "/api/v1/payroll/bookings", "/api/v1/payroll/bookings/preview"}
	writes := [][2]string{{"POST", "/api/v1/employees"}, {"PATCH", "/api/v1/employees/" + id}, {"DELETE", "/api/v1/employees/" + id},
		{"POST", "/api/v1/employees/" + id + "/archive"}, {"POST", "/api/v1/employees/" + id + "/unarchive"},
		{"POST", "/api/v1/employees/" + id + "/erase"}, {"POST", "/api/v1/employees/" + id + "/pay-terms"},
		{"DELETE", "/api/v1/employees/" + id + "/pay-terms/pt_1"}, {"POST", "/api/v1/employees/" + id + "/documents"},
		{"PATCH", "/api/v1/employees/" + id + "/documents/" + docID}, {"DELETE", "/api/v1/employees/" + id + "/documents/" + docID},
		{"PUT", "/api/v1/employment/settings"}, {"POST", "/api/v1/payroll/entries"}, {"PATCH", "/api/v1/payroll/entries/" + entry},
		{"DELETE", "/api/v1/payroll/entries/" + entry}, {"POST", "/api/v1/payroll/entries/" + entry + "/approve"},
		{"POST", "/api/v1/payroll/entries/" + entry + "/payment"}, {"POST", "/api/v1/payroll/entries/" + entry + "/correct"},
		{"POST", "/api/v1/payroll/bookings"}}
	refused := func(who string, b *browser, method, path string) {
		t.Helper()
		status, m := e.send(b, method, path, map[string]any{"version": 1})
		code, _ := m["error"].(map[string]any)["code"].(string)
		if status != 403 || code != "feature_not_in_plan" {
			t.Errorf("%s %s %s: %d %v, want 403 feature_not_in_plan", who, method, path, status, m)
		}
	}
	for _, path := range reads {
		if status, m := e.send(owner, "GET", path, nil); status == 403 {
			t.Errorf("owner reads %s after a downgrade: %d %v", path, status, m)
		}
		refused("member", hr, "GET", path)
	}
	for _, w := range writes {
		refused("owner", owner, w[0], w[1])
		refused("member", hr, w[0], w[1])
	}
}

// ---- four-eyes approval: optional, off by default ----

func TestFourEyesApproval(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	settings := func() map[string]any { return e.must(owner, 200, "GET", "/api/v1/employment/settings", nil) }
	if s := settings(); s["require_second_approver"] != false || s["payroll_approvers"] != float64(1) {
		t.Fatalf("defaults: %v", s)
	}
	entry := func(b *browser, month string) map[string]any {
		return e.must(b, 201, "POST", "/api/v1/payroll/entries", map[string]any{"employee_id": id, "period_start": month + "-01",
			"period_end": month + "-28", "currency": "CHF", "gross": "6000.00"})
	}
	approve := func(b *browser, p map[string]any) (int, map[string]any) {
		return e.send(b, "POST", "/api/v1/payroll/entries/"+p["id"].(string)+"/approve", map[string]any{"version": p["version"]})
	}

	// Off: a company run by one person approves its own entries.
	if status, m := approve(owner, entry(owner, "2026-01")); status != 200 {
		t.Fatalf("four-eyes off, sole owner approves: %d %v", status, m)
	}

	e.must(owner, 200, "PUT", "/api/v1/employment/settings", map[string]any{"employing_entity": "Acme AG", "country": "CH",
		"region": "ZH", "require_second_approver": true})
	if s := settings(); s["require_second_approver"] != true || s["payroll_approvers"] != float64(1) {
		t.Fatalf("on, nobody else may approve (the screens hint): %v", s)
	}
	own := entry(owner, "2026-02")
	status, m := approve(owner, own)
	if code := m["error"].(map[string]any)["code"]; status != 403 || code != "second_approver_required" {
		t.Fatalf("author approves under four-eyes: %d %v", status, m)
	}

	editor := e.join(owner.workspace, "member", []string{"write:payroll"})
	viewer := e.join(owner.workspace, "admin", nil) // payroll view only: never an approver
	if s := settings(); s["payroll_approvers"] != float64(2) {
		t.Fatalf("approvers with an editor and a viewing admin: %v", s["payroll_approvers"])
	}
	if status, _ := approve(viewer, own); status != 403 {
		t.Fatalf("a payroll viewer approves: %d", status)
	}
	if status, m := approve(editor, own); status != 200 {
		t.Fatalf("another person approves: %d %v", status, m)
	}
	got := e.must(owner, 200, "GET", "/api/v1/payroll/entries/"+own["id"].(string), nil)
	if got["created_by_id"] != owner.user || got["approved_by_id"] != editor.user {
		t.Fatalf("who created and who approved: %v %v", got["created_by_id"], got["approved_by_id"])
	}

	// The editor's change makes the editor the author: the owner, who reviews it, may approve, the editor not.
	draft := entry(owner, "2026-03")
	changed := e.must(editor, 200, "PATCH", "/api/v1/payroll/entries/"+draft["id"].(string), map[string]any{"version": draft["version"],
		"gross": "6100.00"})
	if status, _ := approve(editor, changed); status != 403 {
		t.Fatalf("the editor approves their own change: %d", status)
	}
	if status, m := approve(owner, changed); status != 200 {
		t.Fatalf("the owner approves the editor's change: %d %v", status, m)
	}

	// Off again: everything as before, and both switches are in the audit log.
	e.must(owner, 200, "PUT", "/api/v1/employment/settings", map[string]any{"employing_entity": "Acme AG", "country": "CH",
		"region": "ZH", "require_second_approver": false})
	if status, _ := approve(owner, entry(owner, "2026-04")); status != 200 {
		t.Fatal("four-eyes off again")
	}
	var switches int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE workspace_id = $1
		AND kind IN ('payroll.four_eyes_on', 'payroll.four_eyes_off')`, owner.workspace).Scan(&switches); err != nil || switches != 2 {
		t.Fatalf("audited switches: %d %v", switches, err)
	}
}

// ---- Swiss and EU fields ----

func TestSwissEmployeeFields(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	for _, c := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"AHV check digit", with(anna, "social_security_number", "756.9217.0769.86"), "social_security_number"},
		{"AHV format", with(anna, "social_security_number", "123"), "social_security_number"},
		{"IBAN checksum", with(anna, "bank_account", "CH93 0076 2011 6238 5295 8"), "bank_account"},
		{"QR-IBAN for salary", with(anna, "bank_account", "CH44 3199 9123 0008 8901 2"), "bank_account"},
		{"withholding tax canton", with(anna, "withholding_tax", true), "withholding_tax_canton"},
		{"withholding tax outside CH", with(anna, "work_country", "DE", "work_region", nil, "withholding_tax", true,
			"withholding_tax_canton", "ZH"), "withholding_tax"},
		{"unknown canton", with(anna, "withholding_tax", true, "withholding_tax_canton", "XX"), "withholding_tax_canton"},
		{"fixed term without end", with(anna, "employment_type", "fixed_term"), "employment_end"},
		{"weekly hours", with(anna, "weekly_hours", "169"), "weekly_hours"},
	} {
		status, m := e.send(owner, "POST", "/api/v1/employees", c.body)
		fields, _ := m["error"].(map[string]any)["details"].(map[string]any)["fields"].(map[string]any)
		if status != 422 || fields[c.field] == nil {
			t.Errorf("%s: %d %v, want 422 on %s", c.name, status, m, c.field)
		}
	}
	id := e.employee(owner, with(anna, "employee_number", "E-9", "social_security_number", "7569217076985",
		"bank_account", "ch93 0076 2011 6238 5295 7", "withholding_tax", true, "withholding_tax_canton", "zh",
		"employment_type", "hourly", "weekly_hours", "42.5", "notice_period", "3 months to the end of a month",
		"thirteenth_salary", true, "pension_insurer", "Pensionskasse X", "accident_insurer", "Suva",
		"sickness_insurer", "KTG Y", "free_transport", true, "canteen_meals", true))
	got := e.must(owner, 200, "GET", "/api/v1/employees/"+id, nil)
	for k, want := range map[string]any{"social_security_number_hint": "•••• 9.85", "withholding_tax_canton": "ZH",
		"weekly_hours": "42.5", "employment_type": "hourly", "thirteenth_salary": true, "accident_insurer": "Suva",
		"free_transport": true, "canteen_meals": true} {
		if got[k] != want {
			t.Errorf("%s = %v, want %v", k, got[k], want)
		}
	}
	p := e.must(owner, 200, "GET", "/api/v1/employees/"+id+"/protected", nil)
	if p["social_security_number"] != "756.9217.0769.85" || p["bank_account"] != "CH9300762011623852957" {
		t.Fatalf("protected: %v", p)
	}
	// Elsewhere the number is kept as given: rules.json defines no other national format.
	e.employee(owner, with(anna, "employee_number", "E-10", "work_country", "DE", "work_region", nil, "social_security_number", "12 150385 M 017"))

	status, m := e.send(owner, "POST", "/api/v1/employees/"+id+"/pay-terms", map[string]any{"effective_from": "2026-01-01",
		"basis": "monthly", "amount": "500000", "currency": "JPY", "frequency": "monthly"})
	if status != 422 || !strings.Contains(m["error"].(map[string]any)["details"].(map[string]any)["fields"].(map[string]any)["currency"].(string), "JPY") {
		t.Fatalf("a currency without minor units: %d %v", status, m)
	}
}

// ---- export: the owner's workspace export carries HR data, sealed fields opened ----

type recorder struct {
	table string
	rows  map[string][]map[string]any
}

func (r *recorder) Table(name string) error {
	r.table = name
	r.rows[name] = []map[string]any{}
	return nil
}
func (r *recorder) Row(v json.RawMessage) error {
	var m map[string]any
	if err := json.Unmarshal(v, &m); err != nil {
		return err
	}
	r.rows[r.table] = append(r.rows[r.table], m)
	return nil
}

func TestHRExport(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	owner, empty := e.workspace(), e.workspace()
	id := e.employee(owner, with(anna, "bank_account", "CH93 0076 2011 6238 5295 7", "social_security_number", "756.9217.0769.85"))
	e.must(owner, 201, "POST", "/api/v1/payroll/entries", map[string]any{"employee_id": id, "period_start": "2026-10-01",
		"period_end": "2026-10-31", "currency": "CHF", "gross": "6000.00"})
	e.upload(owner, "/api/v1/employees/"+id+"/documents", "contract.pdf", pdf, map[string]string{"type": "employment_contract"})

	for _, c := range []struct {
		name      string
		workspace string
		denied    bool
		included  bool
	}{
		{"Business", owner.workspace, false, true},
		{"downgraded, data kept", owner.workspace, true, true},
		{"Business, no employees yet", empty.workspace, false, true},
		{"never had the module", empty.workspace, true, false},
	} {
		if c.denied {
			e.denied.Store(c.workspace, true)
		} else {
			e.denied.Delete(c.workspace)
		}
		r := &recorder{rows: map[string][]map[string]any{}}
		files, included, err := e.svc.Export(ctx, c.workspace, r)
		if err != nil || included != c.included {
			t.Fatalf("%s: included %v, %v", c.name, included, err)
		}
		if c.workspace != owner.workspace || !included {
			continue
		}
		emp := r.rows["employees"]
		if len(emp) != 1 || emp[0]["bank_account"] != "CH9300762011623852957" || emp[0]["social_security_number"] != "756.9217.0769.85" {
			t.Fatalf("%s: employees %v", c.name, emp)
		}
		for k := range emp[0] {
			if strings.HasSuffix(k, "_sealed") {
				t.Fatalf("%s: sealed column %s exported", c.name, k)
			}
		}
		if len(r.rows["payroll_entries"]) != 1 || len(r.rows["documents"]) != 1 || len(files) != 1 ||
			!strings.HasPrefix(files[0].Path, id+"/") {
			t.Fatalf("%s: entries %d, documents %d, files %v", c.name, len(r.rows["payroll_entries"]), len(r.rows["documents"]), files)
		}
	}
	// The general part of the export still leaves HR data out (it would otherwise appear twice, sealed).
	for _, table := range store.WorkspaceExportTables {
		if strings.Contains(table.Query, "FROM employees") || strings.Contains(table.Query, "payroll_entries") {
			t.Fatalf("general export reads HR table: %s", table.Name)
		}
	}
}

// ---- retention: the dry run lists what erasure would delete and changes nothing ----

func TestRetentionReview(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	gone := e.employee(owner, with(anna, "employment_start", "2018-01-01", "employment_end", "2020-06-30"))
	held := e.employee(owner, with(anna, "employee_number", "E-2", "employment_start", "2018-01-01", "employment_end", "2020-06-30", "legal_hold", true,
		"legal_hold_reason", "court case"))
	e.employee(owner, with(anna, "employee_number", "E-3")) // still employed: not listed
	var docs []string
	for _, name := range []string{"old.pdf", "new.pdf"} {
		_, d := e.upload(owner, "/api/v1/employees/"+gone+"/documents", name, append(pdf, name...), map[string]string{"type": "personnel_file"})
		docs = append(docs, d["data"].(map[string]any)["id"].(string))
	}
	for i, until := range []string{"2021-01-01", "2099-01-01"} {
		if _, err := e.raw.Exec(context.Background(), `UPDATE employee_documents SET retain_until = $2 WHERE document_id = $1`, docs[i], until); err != nil {
			t.Fatal(err)
		}
	}
	member := e.join(owner.workspace, "member", []string{"write:employees"})
	if status, _ := e.send(member, "GET", "/api/v1/employment/retention", nil); status != 403 {
		t.Fatalf("a non-owner reviews retention: %d", status)
	}
	list := e.list(owner, "/api/v1/employment/retention")
	if len(list) != 2 {
		t.Fatalf("listed %d former employees: %v", len(list), list)
	}
	byID := map[string]map[string]any{}
	for _, it := range list {
		m := it.(map[string]any)
		byID[m["employee_id"].(string)] = m
	}
	g := byID[gone]
	due, _ := g["documents_due"].([]any)
	if g["blocked_by"] != nil || len(due) != 1 || due[0].(map[string]any)["id"] != docs[0] || g["documents_kept"] != float64(1) ||
		g["next_due"] != "2099-01-01" {
		t.Fatalf("former employee: %v", g)
	}
	if byID[held]["blocked_by"] != "legal_hold" {
		t.Fatalf("held: %v", byID[held])
	}
	if n := len(e.list(owner, "/api/v1/employees/"+gone+"/documents")); n != 2 {
		t.Fatalf("the dry run deleted documents: %d left", n)
	}
}
