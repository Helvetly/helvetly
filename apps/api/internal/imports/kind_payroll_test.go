package imports

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func (e *env) staff(number string) string {
	e.t.Helper()
	id := "emp_" + strings.ToLower(number)
	err := e.db.CreateEmployee(context.Background(), "ws_a", "usr_a", store.Employee{ID: id, FirstName: "Anna", LastName: number,
		EmployeeNumber: &number, EmploymentType: "permanent", EmploymentStart: "2024-01-01", EmployingEntity: "Acme AG",
		EmployerCountry: "CH", WorkCountry: "CH", CreatedAt: time.Now()})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

const payrollCSV = "employee_number;period_start;period_end;currency;gross;deductions;net;employer_costs\n" +
	"E-1;2026-10-01;2026-10-31;CHF;6000,00;820,00;5180,00;710,00\n" + // valid, decimal commas
	"E-2;2026-10-01;2026-10-31;CHF;5000.00;800.00;4300.00;\n" + // net does not add up
	"E-9;2026-10-01;2026-10-31;CHF;100.00;;;\n" + // no such employee
	"E-3;2026-10-01;2026-10-31;CHF;4000.00;;;\n" // valid, missing values stay missing

func TestPayrollImportWithoutTheModel(t *testing.T) {
	e := newEnv(t)
	for _, n := range []string{"E-1", "E-2", "E-3"} {
		e.staff(n)
	}
	full := e.person("ws_a", "usr_full", "member", []string{"*:*"})
	if w := e.as(full).upload("payroll", map[string][]byte{"oct.csv": []byte(payrollCSV)}); w.Code != 403 {
		t.Fatalf("a member with full access imported payroll: %d %s", w.Code, w.Body)
	}
	clerk := e.person("ws_a", "usr_clerk", "member", []string{"write:payroll"})
	w := e.as(clerk).upload("payroll", map[string][]byte{"oct.csv": []byte(payrollCSV)})
	if w.Code != 201 {
		t.Fatalf("payroll upload without write:documents: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	if e.model.calls.Load() != 0 {
		t.Fatal("the payroll file went to the AI model")
	}
	if len(b.Records) != 4 {
		t.Fatalf("records: %+v", b.Records)
	}
	issues := map[string]string{}
	for _, r := range b.Records {
		for k := range r.Issues {
			issues[rawText(r.Data["employee_number"])] = k
		}
	}
	if issues["E-1"] != "" || issues["E-3"] != "" || issues["E-2"] != "net" || issues["E-9"] != "employee_number" {
		t.Fatalf("issues: %v", issues)
	}
	// The file is an HR file: not a document anyone with read:documents could list.
	if docs, _, err := e.db.ListDocuments(context.Background(), "ws_a", store.DocumentFilter{}, 50, 0); err != nil || len(docs) != 0 {
		t.Fatalf("the payroll file is listed in Documents: %v %v", docs, err)
	}

	ids := []string{}
	for _, r := range b.Records {
		ids = append(ids, r.ID)
	}
	w = e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids})
	if w.Code != 200 {
		t.Fatalf("commit: %d %s", w.Code, w.Body)
	}
	created := 0
	for _, r := range decode[commitOut](t, w).Results {
		if r.Status == "created" {
			created++
		}
	}
	if created != 2 {
		t.Fatalf("a partly bad file creates only its good rows: %s", w.Body)
	}
	entries, err := e.db.ListPayrollEntries(context.Background(), "ws_a", store.PayrollFilter{Month: "2026-10"})
	if err != nil || len(entries) != 2 {
		t.Fatalf("entries: %v %v", entries, err)
	}
	for _, p := range entries {
		if p.Source != "import" || p.Status != "draft" {
			t.Fatalf("an import creates unapproved drafts: %+v", p)
		}
		if p.EmployeeNumber != nil && *p.EmployeeNumber == "E-3" && (p.Net != nil || p.Deductions != nil || p.Gross == nil) {
			t.Fatalf("empty cells must stay missing: %+v", p)
		}
		if p.EmployeeNumber != nil && *p.EmployeeNumber == "E-1" && p.Gross.String() != "6000.00" {
			t.Fatalf("decimal comma: %+v", p)
		}
	}

	// The same file again: nothing is created twice. A draft may be overwritten, an approved entry only corrected.
	w = e.upload("payroll", map[string][]byte{"oct-again.csv": []byte(payrollCSV)})
	again := e.extracted(decode[store.ImportBatch](t, w).ID)
	first := again.Records[0].ID
	w = e.do("POST", "/api/v1/imports/"+again.ID+"/commit", map[string]any{"record_ids": []string{first}})
	res := decode[commitOut](t, w).Results
	if len(res) != 1 || res[0].Status != "conflict" || !res[0].Conflict.CanOverwrite {
		t.Fatalf("a repeated row: %s", w.Body)
	}
	var e1 store.PayrollEntry
	for _, p := range entries {
		if *p.EmployeeNumber == "E-1" {
			e1 = p
		}
	}
	if ok, err := e.db.ApprovePayrollEntry(context.Background(), "ws_a", e1.ID, e1.Version, "usr_a", time.Now()); err != nil || !ok {
		t.Fatal(err)
	}
	w = e.do("POST", "/api/v1/imports/"+again.ID+"/commit", map[string]any{"record_ids": []string{first},
		"resolutions": map[string]string{first: Overwrite}})
	res = decode[commitOut](t, w).Results
	if res[0].Status == "created" || res[0].Status == "overwritten" {
		t.Fatalf("an approved entry was overwritten by an import: %s", w.Body)
	}
	if after, _ := e.db.ListPayrollEntries(context.Background(), "ws_a", store.PayrollFilter{Month: "2026-10", Superseded: true}); len(after) != 2 {
		t.Fatalf("entries after the repeated import: %d", len(after))
	}
}

func TestPayrollImportRefusesBadFiles(t *testing.T) {
	for _, c := range []struct{ name, data, want string }{
		{"pay.csv", "employee;period_start;period_end;currency\nE-1;2026-10-01;2026-10-31;CHF\n", "Unknown columns: employee"},
		{"pay.csv", "employee_number,period_start,currency\nE-1,2026-10-01,CHF\n", "period_end is missing"},
		{"pay.csv", "employee_number,period_start,period_end,currency\n", "no payroll rows"},
		{"pay.pdf", "%PDF-1.4", "CSV file"},
	} {
		if _, err := parsePayroll(c.name, "", []byte(c.data)); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want %q", c.data, err, c.want)
		}
	}
	rows, err := parsePayroll("pay.csv", "text/csv", []byte("\xef\xbb\xbfEmail,Period Start,period_end,currency,gross\nann@x.ch,2026-10-01,2026-10-31,CHF,\n"))
	if err != nil || len(rows) != 1 || rows[0]["gross"] != nil || rawText(rows[0]["email"]) != "ann@x.ch" {
		t.Fatalf("header normalised, empty cell left out: %v %v", rows, err)
	}
}

func TestHeidiIsNotOfferedPayroll(t *testing.T) {
	if slices.Contains(Offered(func(string) bool { return true }), "Payroll") {
		t.Fatal("Heidi offers the payroll import")
	}
}

// Discarding a payroll batch deletes its HR file with what was read from it; two employees sharing an email are
// never guessed between.
func TestPayrollBatchDiscardAndAmbiguousEmail(t *testing.T) {
	e := newEnv(t)
	a, b := e.staff("E-1"), e.staff("E-2")
	ctx := context.Background()
	for _, id := range []string{a, b} {
		mail := "shared@example.test"
		emp, err := e.db.Employee(ctx, "ws_a", id, "2026-11-16")
		if err != nil {
			t.Fatal(err)
		}
		emp.Email = &mail
		if err := e.db.SaveEmployee(ctx, "ws_a", emp, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	w := e.upload("payroll", map[string][]byte{"p.csv": []byte("email,period_start,period_end,currency,gross\nshared@example.test,2026-10-01,2026-10-31,CHF,1.00\n")})
	batch := e.extracted(decode[store.ImportBatch](t, w).ID)
	if len(batch.Records) != 1 || batch.Records[0].Issues["email"] == "" {
		t.Fatalf("ambiguous email: %+v", batch.Records)
	}
	before := len(e.files.objects)
	if w := e.do("DELETE", "/api/v1/imports/"+batch.ID, nil); w.Code >= 300 {
		t.Fatalf("discard: %d %s", w.Code, w.Body)
	}
	if len(e.files.objects) != before-1 {
		t.Fatalf("the payroll file stayed after discarding its batch: %d -> %d objects", before, len(e.files.objects))
	}
}
