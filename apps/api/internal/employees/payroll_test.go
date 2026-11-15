package employees

import (
	"context"
	"encoding/csv"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func october(id string, kv ...any) map[string]any {
	return with(map[string]any{"employee_id": id, "period_start": "2026-10-01", "period_end": "2026-10-31", "currency": "CHF",
		"gross": "6000.00", "deductions": "820.00", "net": "5180.00", "employer_costs": "710.00"}, kv...)
}

func TestPayrollEntryRules(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	for _, c := range []struct {
		name string
		body map[string]any
		key  string
	}{
		{"net does not add up", october(id, "net", "5180.01"), "net"},
		{"three decimals", october(id, "gross", "6000.005"), "gross"},
		{"negative", october(id, "deductions", "-1"), "deductions"},
		{"float-like text", october(id, "gross", "6e3"), "gross"},
		{"zero-decimal currency", october(id, "currency", "JPY"), "currency"},
		{"unknown currency", october(id, "currency", "XXX"), "currency"},
		{"period backwards", october(id, "period_end", "2026-09-30"), "period_end"},
		{"before employment", october(id, "period_start", "2023-11-01", "period_end", "2023-11-30"), "period_start"},
		{"nothing at all", october(id, "gross", nil, "deductions", nil, "net", nil, "employer_costs", nil), "gross"},
		{"components disagree", october(id, "components", []map[string]any{{"kind": "earning", "label": "Salary", "amount": "5900.00"}}), "gross"},
		{"no employee", october("emp_nope"), "employee_id"},
	} {
		if status, m := e.send(owner, "POST", "/api/v1/payroll/entries", c.body); status != 422 || field(m, c.key) == "" {
			t.Errorf("%s: %d %v", c.name, status, m)
		}
	}
	// A number is read as its decimal text, never through a float: 0.1 + 0.2 stays exact.
	got := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id, "gross", 0.3, "deductions", 0.1, "net", 0.2,
		"employer_costs", nil, "components", []map[string]any{{"kind": "earning", "label": "Salary", "amount": "0.30"}}))
	if got["gross"] != "0.30" || got["net"] != "0.20" || got["employer_costs"] != nil || got["complete"] != false || got["total_cost"] != nil {
		t.Fatalf("exact amounts, missing employer costs stay missing: %v", got)
	}
	if status, m := e.send(owner, "POST", "/api/v1/payroll/entries", october(id)); status != 422 || field(m, "period_start") == "" {
		t.Fatalf("a second entry for the same period: %d %v", status, m)
	}
	// Period boundaries: an entry belongs to the month its period ends in.
	e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id, "period_start", "2026-11-01", "period_end", "2026-11-01",
		"gross", "100.00", "deductions", nil, "net", nil, "employer_costs", nil))
	if n := len(e.list(owner, "/api/v1/payroll/entries?month=2026-10")); n != 1 {
		t.Fatalf("October holds %d entries", n)
	}
	if n := len(e.list(owner, "/api/v1/payroll/entries?month=2026-11")); n != 1 {
		t.Fatalf("November holds %d entries", n)
	}
	sum := e.must(owner, 200, "GET", "/api/v1/payroll/summary?month=2026-11", nil)
	cur := sum["currencies"].([]any)[0].(map[string]any)
	if cur["gross"] != "100.00" || cur["net"] != "0.00" || cur["missing_net"] != float64(1) || cur["missing_employer_costs"] != float64(1) {
		t.Fatalf("a missing value is counted as missing, not summed as 0: %v", cur)
	}
}

func TestSummaryKeepsCurrenciesApart(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	a := e.employee(owner, anna)
	b := e.employee(owner, with(anna, "employee_number", "E-2", "first_name", "Ben", "work_country", "DE", "work_region", nil))
	e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(a))
	e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(b, "currency", "EUR", "gross", "5000.00", "deductions", "1000.00",
		"net", "4000.00", "employer_costs", "1050.00"))
	sum := e.must(owner, 200, "GET", "/api/v1/payroll/summary?month=2026-10", nil)
	list := sum["currencies"].([]any)
	if len(list) != 2 {
		t.Fatalf("currencies: %v", list)
	}
	chf, eur := list[0].(map[string]any), list[1].(map[string]any)
	if chf["currency"] != "CHF" || chf["total_cost"] != "6710.00" || eur["currency"] != "EUR" || eur["total_cost"] != "6050.00" {
		t.Fatalf("per-currency totals, never converted: %v %v", chf, eur)
	}
}

func TestConcurrentApprovalsAndPayment(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	entry := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id))["id"].(string)
	if status, m := e.send(owner, "POST", "/api/v1/payroll/entries/"+entry+"/payment", map[string]any{"version": 1, "status": "paid",
		"paid_on": "2026-10-25"}); status != 409 || code(m) != "not_approved" {
		t.Fatalf("paying an unapproved entry: %d %v", status, m)
	}
	approver := e.join(owner.workspace, "member", []string{"read:payroll", "write:payroll-approval"})
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i, b := range []*browser{owner, approver} {
		wg.Go(func() {
			statuses[i], _ = e.send(b, "POST", "/api/v1/payroll/entries/"+entry+"/approve", map[string]any{"version": 1})
		})
	}
	wg.Wait()
	if statuses[0]+statuses[1] != 200+409 {
		t.Fatalf("two concurrent approvals answered %v, want one 200 and one 409", statuses)
	}
	got := e.must(owner, 200, "GET", "/api/v1/payroll/entries/"+entry, nil)
	if got["status"] != "approved" || got["payment_status"] != "unpaid" || got["approved_by"] == nil {
		t.Fatalf("approved is not paid: %v", got)
	}
	version := int(got["version"].(float64))
	if status, m := e.send(owner, "PATCH", "/api/v1/payroll/entries/"+entry, map[string]any{"version": version, "gross": "1.00"}); status != 409 ||
		code(m) != "approved" {
		t.Fatalf("editing an approved entry: %d %v", status, m)
	}
	if status, _ := e.send(owner, "POST", "/api/v1/payroll/entries/"+entry+"/payment", map[string]any{"version": version - 1,
		"status": "paid", "paid_on": "2026-10-25"}); status != 409 {
		t.Fatal("a stale payment update went through")
	}
	paid := e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+entry+"/payment", map[string]any{"version": version, "status": "paid",
		"paid_on": "2026-10-25"})
	if paid["payment_status"] != "paid" || paid["paid_on"] != "2026-10-25" || paid["status"] != "approved" {
		t.Fatalf("paid: %v", paid)
	}
	if status, m := e.send(owner, "DELETE", "/api/v1/payroll/entries/"+entry, nil); status != 409 {
		t.Fatalf("deleting an approved entry: %d %v", status, m)
	}
	if _, err := e.raw.Exec(context.Background(), `UPDATE payroll_entries SET gross = 1 WHERE id = $1`, entry); err == nil {
		t.Fatal("the database let an approved entry's figures change")
	}
	if _, err := e.raw.Exec(context.Background(), `DELETE FROM payroll_components WHERE entry_id = $1`, entry); err != nil {
		t.Fatal(err) // no components: nothing to refuse
	}
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO payroll_components VALUES ($1, 0, 'earning', 'x', 1)`, entry); err == nil {
		t.Fatal("the database let a component be added to an approved entry")
	}
}

func TestClosedPeriodRefusesApproval(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	entry := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id))["id"].(string)
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO closed_periods (workspace_id, month, closed_at) VALUES ($1, '2026-10', now())`,
		owner.workspace); err != nil {
		t.Fatal(err)
	}
	if status, m := e.send(owner, "POST", "/api/v1/payroll/entries/"+entry+"/approve", map[string]any{"version": 1}); status != 409 ||
		code(m) != "period_closed" {
		t.Fatalf("approving into a closed month: %d %v", status, m)
	}
}

func TestCorrectionKeepsTheOriginal(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	original := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id))["id"].(string)
	if status, _ := e.send(owner, "POST", "/api/v1/payroll/entries/"+original+"/correct", nil); status != 409 {
		t.Fatal("a draft was corrected instead of edited")
	}
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+original+"/approve", map[string]any{"version": 1})
	correction := e.must(owner, 201, "POST", "/api/v1/payroll/entries/"+original+"/correct", nil)
	cid := correction["id"].(string)
	if correction["supersedes_id"] != original || correction["status"] != "draft" || correction["gross"] != "6000.00" {
		t.Fatalf("correction: %v", correction)
	}
	if status, m := e.send(owner, "POST", "/api/v1/payroll/entries/"+original+"/correct", nil); status != 409 || code(m) != "correction_exists" {
		t.Fatalf("a second correction: %d %v", status, m)
	}
	other := e.employee(owner, with(anna, "employee_number", "E-9"))
	if status, _ := e.send(owner, "PATCH", "/api/v1/payroll/entries/"+cid, map[string]any{"version": 1, "employee_id": other}); status != 422 {
		t.Fatal("a correction moved to another employee")
	}
	e.must(owner, 200, "PATCH", "/api/v1/payroll/entries/"+cid, map[string]any{"version": 1, "gross": "6100.00", "net": "5280.00"})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+cid+"/approve", map[string]any{"version": 2})
	was := e.must(owner, 200, "GET", "/api/v1/payroll/entries/"+original, nil)
	if was["superseded_by"] != cid || was["gross"] != "6000.00" || was["status"] != "approved" {
		t.Fatalf("the original after its correction: %v", was)
	}
	if n := len(e.list(owner, "/api/v1/payroll/entries?month=2026-10")); n != 1 {
		t.Fatalf("current entries: %d", n)
	}
	if n := len(e.list(owner, "/api/v1/payroll/entries?month=2026-10&superseded=true")); n != 2 {
		t.Fatalf("with history: %d", n)
	}
	kinds := []string{}
	for _, h := range e.list(owner, "/api/v1/employees/"+id+"/history") {
		kinds = append(kinds, h.(map[string]any)["kind"].(string))
	}
	joined := strings.Join(kinds, ",")
	if !strings.Contains(joined, "payroll.approved") || !strings.Contains(joined, "payroll.corrected") || !strings.Contains(joined, "employee.created") {
		t.Fatalf("history: %s", joined)
	}
	var payloads []string
	rows, err := e.raw.Query(context.Background(), `SELECT payload::text FROM financial_events WHERE workspace_id = $1`, owner.workspace)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var p string
		_ = rows.Scan(&p)
		payloads = append(payloads, p)
	}
	rows.Close()
	for _, p := range payloads {
		if p != "{}" {
			t.Fatalf("the audit log carries data: %s", p)
		}
	}
}

func TestBookingOnceAndExport(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	approve := func(body map[string]any) string {
		p := e.must(owner, 201, "POST", "/api/v1/payroll/entries", body)
		e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+p["id"].(string)+"/approve", map[string]any{"version": 1})
		return p["id"].(string)
	}
	oct := approve(october(id))
	incomplete := approve(october(id, "period_start", "2026-09-01", "period_end", "2026-09-30", "employer_costs", nil))
	b := e.employee(owner, with(anna, "employee_number", "E-2", "first_name", "Ben"))
	eur := approve(october(b, "currency", "EUR"))

	preview := e.must(owner, 200, "GET", "/api/v1/payroll/bookings/preview?to=2026-10-31", nil)
	blocked := map[string]string{}
	for _, it := range preview["items"].([]any) {
		m := it.(map[string]any)
		blocked[m["entry"].(map[string]any)["id"].(string)] = m["blocked"].(string)
	}
	if blocked[oct] != "" || !strings.Contains(blocked[incomplete], "missing") || !strings.Contains(blocked[eur], "EUR") {
		t.Fatalf("preview: %v", blocked)
	}
	// Two bookings at once: one books, the other finds nothing left (or loses the race), never a second booking.
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i := range 2 {
		wg.Go(func() {
			statuses[i], _ = e.send(owner, "POST", "/api/v1/payroll/bookings", map[string]any{"to": "2026-10-31"})
		})
	}
	wg.Wait()
	if statuses[0]+statuses[1] != 201+409 {
		t.Fatalf("concurrent bookings answered %v", statuses)
	}
	bookings := e.list(owner, "/api/v1/payroll/bookings")
	if len(bookings) != 1 || bookings[0].(map[string]any)["items"] != float64(1) {
		t.Fatalf("bookings: %v", bookings)
	}
	bid := bookings[0].(map[string]any)["id"].(string)
	res, body := e.do(owner, "GET", "/api/v1/payroll/bookings/"+bid+"/export?format=csv", nil, "")
	rows, err := csv.NewReader(strings.NewReader(string(body))).ReadAll()
	if res.StatusCode != 200 || err != nil || len(rows) != 4 {
		t.Fatalf("journal: %d %v %q", res.StatusCode, err, body)
	}
	debits := map[string]string{}
	for _, r := range rows[1:] {
		debits[r[3]+">"+r[4]] = r[5]
	}
	if debits["5000>2279"] != "5180.00" || debits["5000>2270"] != "820.00" || debits["5700>2270"] != "710.00" {
		t.Fatalf("the accrual expenses gross and employer costs apart from what is owed: %v", debits)
	}

	// The correction of a booked entry books the reversal and the new accrual; the payment books the net once.
	c := e.must(owner, 201, "POST", "/api/v1/payroll/entries/"+oct+"/correct", nil)["id"].(string)
	e.must(owner, 200, "PATCH", "/api/v1/payroll/entries/"+c, map[string]any{"version": 1, "gross": "6100.00", "net": "5280.00"})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+c+"/approve", map[string]any{"version": 2})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+c+"/payment", map[string]any{"version": 3, "status": "paid", "paid_on": "2026-10-28"})
	second := e.must(owner, 201, "POST", "/api/v1/payroll/bookings", map[string]any{"to": "2026-10-31"})
	if second["items"] != float64(3) {
		t.Fatalf("reversal, accrual and payment: %v", second)
	}
	if status, m := e.send(owner, "POST", "/api/v1/payroll/bookings", map[string]any{"to": "2026-10-31"}); status != 409 || code(m) != "nothing_to_book" {
		t.Fatalf("booking again: %d %v", status, m)
	}
	if status, m := e.send(owner, "POST", "/api/v1/payroll/entries/"+c+"/payment", map[string]any{"version": 4, "status": "unpaid"}); status != 409 ||
		code(m) != "booked" {
		t.Fatalf("unpaying a booked payment: %d %v", status, m)
	}

	res, body = e.do(owner, "GET", "/api/v1/payroll/export?month=2026-10", nil, "")
	if res.StatusCode != 200 || !strings.Contains(string(body), "5280.00") || !strings.Contains(string(body), "superseded_by") {
		t.Fatalf("register export: %d %q", res.StatusCode, body)
	}
	var exported int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'payroll.exported'`,
		owner.workspace).Scan(&exported); err != nil || exported != 2 {
		t.Fatalf("exports recorded: %d %v", exported, err)
	}
	if strings.Contains(fmt.Sprint(blocked), "5180") {
		t.Fatal("block reasons carry amounts")
	}
}

// TestWorkspacePurgeRemovesHRData: deleting a whole workspace (helvetly.purge set for its transaction) removes approved
// and booked payroll, pay terms and HR files despite the triggers that protect them otherwise.
func TestWorkspacePurgeRemovesHRData(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	e.must(owner, 200, "POST", "/api/v1/employees/"+id+"/pay-terms", map[string]any{"effective_from": "2024-01-01", "basis": "monthly",
		"amount": "6000.00", "currency": "CHF", "frequency": "monthly"})
	entry := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id))["id"].(string)
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+entry+"/approve", map[string]any{"version": 1})
	e.must(owner, 201, "POST", "/api/v1/payroll/bookings", map[string]any{"to": "2026-10-31"})
	if status, m := e.upload(owner, "/api/v1/employees/"+id+"/documents", "c.pdf", pdf, map[string]string{"type": "employment_contract"}); status != 201 {
		t.Fatalf("upload: %d %v", status, m)
	}
	ctx := context.Background()
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL helvetly.purge = 'on'`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM workspaces WHERE id = $1`, owner.workspace); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := e.raw.QueryRow(ctx, `SELECT (SELECT count(*) FROM employees) + (SELECT count(*) FROM payroll_entries)
		+ (SELECT count(*) FROM employee_pay_terms) + (SELECT count(*) FROM documents WHERE hr_private)`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("left after the purge: %d %v", left, err)
	}
}

// TestEntryLinksAnEmployeeDocument: an entry may point at the HR file behind its figures, of the same employee only.
func TestEntryLinksAnEmployeeDocument(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	other := e.employee(owner, with(anna, "employee_number", "E-2"))
	status, m := e.upload(owner, "/api/v1/employees/"+id+"/documents", "payslip-oct.pdf", pdf, map[string]string{"type": "payslip"})
	if status != 201 {
		t.Fatalf("upload: %d %v", status, m)
	}
	doc := m["data"].(map[string]any)["id"].(string)
	if status, m := e.send(owner, "POST", "/api/v1/payroll/entries", october(other, "document_id", doc)); status != 422 || field(m, "document_id") == "" {
		t.Fatalf("another employee's document: %d %v", status, m)
	}
	got := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id, "document_id", doc))
	if got["document_id"] != doc || got["document_name"] != "payslip-oct.pdf" {
		t.Fatalf("linked document: %v", got)
	}
}

// TestSimultaneousUploadsStoreOnce: the same bytes uploaded twice at once for one employee are stored once.
func TestSimultaneousUploadsStoreOnce(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i := range 2 {
		wg.Go(func() {
			statuses[i], _ = e.upload(owner, "/api/v1/employees/"+id+"/documents", fmt.Sprintf("copy-%d.pdf", i), pdf,
				map[string]string{"type": "other"})
		})
	}
	wg.Wait()
	if statuses[0]+statuses[1] != 201+409 {
		t.Fatalf("simultaneous uploads answered %v", statuses)
	}
	if n := len(e.list(owner, "/api/v1/employees/"+id+"/documents")); n != 1 {
		t.Fatalf("%d documents stored", n)
	}
	e.files.mu.Lock()
	objects := len(e.files.objects)
	e.files.mu.Unlock()
	if objects != 1 {
		t.Fatalf("%d objects left in storage; the refused upload's object must be removed", objects)
	}
}

// TestPaymentBeforeCorrectionIsBooked: an entry paid and then corrected before any booking still has its payment
// booked, and the correction's payment books only the difference, so net pay owed ends at zero.
func TestPaymentBeforeCorrectionIsBooked(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	original := e.must(owner, 201, "POST", "/api/v1/payroll/entries", october(id))["id"].(string)
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+original+"/approve", map[string]any{"version": 1})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+original+"/payment", map[string]any{"version": 2, "status": "paid", "paid_on": "2026-10-25"})
	c := e.must(owner, 201, "POST", "/api/v1/payroll/entries/"+original+"/correct", nil)["id"].(string)
	e.must(owner, 200, "PATCH", "/api/v1/payroll/entries/"+c, map[string]any{"version": 1, "gross": "6100.00", "net": "5280.00"})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+c+"/approve", map[string]any{"version": 2})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+c+"/payment", map[string]any{"version": 3, "status": "paid", "paid_on": "2026-11-05"})
	b := e.must(owner, 201, "POST", "/api/v1/payroll/bookings", map[string]any{"to": "2026-11-30"})
	res, body := e.do(owner, "GET", "/api/v1/payroll/bookings/"+b["id"].(string)+"/export?format=csv", nil, "")
	rows, err := csv.NewReader(strings.NewReader(string(body))).ReadAll()
	if res.StatusCode != 200 || err != nil {
		t.Fatalf("journal: %d %v", res.StatusCode, err)
	}
	balance := map[string]int{}
	for _, r := range rows[1:] {
		var cents int
		if _, err := fmt.Sscanf(strings.Replace(r[5], ".", "", 1), "%d", &cents); err != nil {
			t.Fatal(err)
		}
		balance[r[3]] += cents
		balance[r[4]] -= cents
	}
	if balance["2279"] != 0 || balance["1020"] != -528000 {
		t.Fatalf("net pay owed %d, bank %d: %v", balance["2279"], balance["1020"], rows)
	}
}
