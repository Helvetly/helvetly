package store

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func ptr[T any](v T) *T { return &v }

func setInstalments(t *testing.T, q Q, id string, due []string, amounts []int64) {
	t.Helper()
	items := make([]InstalmentItem, len(due))
	for i := range due {
		items[i] = InstalmentItem{Seq: i + 1, DueDate: due[i], Amount: Money(amounts[i]), Reference: ptr(fmt.Sprintf("ref-%s-%d", id, i+1))}
	}
	if err := q.SetInstalments(context.Background(), id, "monthly", items); err != nil {
		t.Fatal(err)
	}
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func TestInstalmentsRoundTrip(t *testing.T) {
	q, pool := typesDB(t)
	ctx := context.Background()
	seedInvoice(t, pool, "inv", "invoice", "draft", 900, "2026-12-31", 0)
	got, err := q.Invoice(ctx, "wsp_a", "inv", "2026-11-07", false)
	if err != nil || got.Instalments != nil || got.Plan != nil || !got.RemindersEnabled {
		t.Fatalf("defaults = %+v %+v %v, %v", got.Instalments, got.Plan, got.RemindersEnabled, err)
	}
	// Given out of order: they load in seq order.
	items := []InstalmentItem{
		{Seq: 3, DueDate: "2026-12-31", Amount: 300, Reference: ptr("r3")},
		{Seq: 1, DueDate: "2026-10-31", Amount: 300, Reference: ptr("r1")},
		{Seq: 2, DueDate: "2026-11-30", Amount: 300},
	}
	if err := q.SetInstalments(ctx, "inv", "monthly", items); err != nil {
		t.Fatal(err)
	}
	if err := q.SetRemindersEnabled(ctx, "inv", false); err != nil {
		t.Fatal(err)
	}
	got, err = q.Invoice(ctx, "wsp_a", "inv", "2026-11-07", false)
	if err != nil || got.Instalments == nil || got.Instalments.Interval != "monthly" || len(got.Instalments.Items) != 3 || got.RemindersEnabled {
		t.Fatalf("schedule = %+v reminders %v, %v", got.Instalments, got.RemindersEnabled, err)
	}
	for i, it := range got.Instalments.Items {
		if it.Seq != i+1 || it.Amount != 300 {
			t.Fatalf("item %d = %+v", i, it)
		}
	}
	if r := got.Instalments.Items; r[0].DueDate != "2026-10-31" || *r[0].Reference != "r1" || r[1].Reference != nil || *r[2].Reference != "r3" {
		t.Fatalf("items = %+v", r)
	}
	// Lines keep the VAT exemption code and reason through SaveDraft.
	got.Lines = []InvoiceLine{{ID: "lin_1", Position: 0, Description: "Export", Quantity: 1000, UnitPrice: 900, VATCategory: "G",
		Amount: 900, VATExemptionCode: ptr("VATEX-EU-G"), VATExemptionReason: ptr("Export outside the EU")}}
	if err := q.SaveDraft(ctx, "wsp_a", got, typesNow); err != nil {
		t.Fatal(err)
	}
	got, _ = q.Invoice(ctx, "wsp_a", "inv", "2026-11-07", false)
	if l := got.Lines[0]; l.VATExemptionCode == nil || *l.VATExemptionCode != "VATEX-EU-G" || *l.VATExemptionReason != "Export outside the EU" {
		t.Fatalf("line = %+v", l)
	}
	if got.RemindersEnabled || got.Instalments == nil {
		t.Fatal("SaveDraft must not touch the schedule or the reminders switch")
	}
	if err := q.SetInstalments(ctx, "inv", "", nil); err != nil {
		t.Fatal(err)
	}
	if got, _ = q.Invoice(ctx, "wsp_a", "inv", "2026-11-07", false); got.Instalments != nil {
		t.Fatalf("cleared = %+v", got.Instalments)
	}
}

func TestOverdueByInstalment(t *testing.T) {
	q, pool := typesDB(t)
	ctx := context.Background()
	const today = "2026-11-07"
	cases := []struct {
		name     string
		kind     string
		due      string
		schedule bool
		paid     int64
		credited int64
		want     bool
	}{
		{"first instalment past due, unpaid", "invoice", "2026-12-31", true, 0, 0, true},
		{"past-due instalment paid", "invoice", "2026-12-31", true, 300, 0, false},
		{"paid less than past due", "invoice", "2026-12-31", true, 299, 0, true},
		{"credit leaves only the past-due part, paid", "invoice", "2026-12-31", true, 300, 600, false},
		{"credit covers everything", "invoice", "2026-12-31", true, 0, 900, false},
		{"no schedule, past due", "invoice", "2026-10-31", false, 0, 0, true},
		{"no schedule, not due", "invoice", "2026-12-31", false, 0, 0, false},
		{"schedule beats a past invoice due date", "invoice", "2026-10-01", true, 300, 0, false},
		{"proforma never overdue", "proforma", "2026-12-31", true, 0, 0, false},
	}
	var wantOverdue []string
	for i, c := range cases {
		id := fmt.Sprint("inv_", i)
		seedInvoice(t, pool, id, c.kind, "open", 900, c.due, 0)
		if c.schedule {
			setInstalments(t, q, id, []string{"2026-10-31", "2026-11-30", "2026-12-31"}, []int64{300, 300, 300})
		}
		exec(t, pool, `UPDATE invoices SET amount_paid = $2, amount_credited = $3 WHERE id = $1`, id, c.paid, c.credited)
		if c.want {
			wantOverdue = append(wantOverdue, id)
		}
		got, err := q.Invoice(ctx, "wsp_a", id, today, false)
		if err != nil || got.IsOverdue != c.want {
			t.Errorf("%s: is_overdue = %v, want %v (%v)", c.name, got.IsOverdue, c.want, err)
		}
	}
	list, _, err := q.ListInvoices(ctx, "wsp_a", today, InvoiceFilter{Statuses: []string{"overdue"}, Sort: "created_at"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, i := range list {
		ids = append(ids, i.ID)
	}
	slices.Sort(ids)
	if !slices.Equal(ids, wantOverdue) {
		t.Fatalf("overdue filter = %v, want %v", ids, wantOverdue)
	}
	s, err := q.InvoiceSummary(ctx, "wsp_a", "CHF", today, "")
	if err != nil || s.Overdue.Count != len(wantOverdue) {
		t.Fatalf("summary overdue = %d, want %d (%v)", s.Overdue.Count, len(wantOverdue), err)
	}
}

func seedPlan(t *testing.T, q Q, pool *pgxpool.Pool, id string, issueOn []string) Plan {
	t.Helper()
	seedInvoice(t, pool, "src_"+id, "invoice", "draft", 900, "2026-12-31", 0)
	p := Plan{ID: id, WorkspaceID: "wsp_a", SourceInvoiceID: "src_" + id, ClientID: "cli_1", Count: len(issueOn), Interval: "monthly",
		FirstDueDate: "2026-11-15", LeadDays: 10, AutoSend: true, Status: "active", RemindersEnabled: true, CreatedAt: typesNow}
	for i, d := range issueOn {
		due, _ := time.Parse(time.DateOnly, d)
		p.Items = append(p.Items, PlanItem{Seq: i + 1, IssueOn: d, DueDate: due.AddDate(0, 0, 10).Format(time.DateOnly)})
	}
	if err := q.CreatePlan(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMarkPlanItemIssuedOnce(t *testing.T) {
	q, pool := typesDB(t)
	ctx := context.Background()
	seedPlan(t, q, pool, "pln_1", []string{"2026-11-05", "2026-12-05"})
	seedPlan(t, q, pool, "pln_paused", []string{"2026-11-01", "2026-12-01"})
	if ok, err := q.SetPlanStatus(ctx, "wsp_a", "pln_paused", "paused", []string{"active"}); err != nil || !ok {
		t.Fatalf("pause = %v, %v", ok, err)
	}
	if ok, _ := q.SetPlanStatus(ctx, "wsp_a", "pln_paused", "paused", []string{"active"}); ok {
		t.Fatal("pausing a paused plan must report false")
	}
	due, err := q.DuePlanItems(ctx, typesNow)
	if err != nil || len(due) != 1 || due[0].Plan.ID != "pln_1" || due[0].Item.Seq != 1 || due[0].Workspace.ID != "wsp_a" ||
		due[0].Workspace.Timezone != "UTC" || due[0].Plan.SourceInvoiceID != "src_pln_1" {
		t.Fatalf("due = %+v, %v", due, err)
	}
	seedInvoice(t, pool, "par_1", "partial", "open", 450, "2026-11-15", 0)
	seedInvoice(t, pool, "par_x", "partial", "open", 450, "2026-11-15", 0)
	if ok, err := q.MarkPlanItemIssued(ctx, "pln_1", 1, "par_1", typesNow); err != nil || !ok {
		t.Fatalf("first = %v, %v", ok, err)
	}
	if ok, err := q.MarkPlanItemIssued(ctx, "pln_1", 1, "par_x", typesNow); err != nil || ok {
		t.Fatalf("second = %v, %v; want false", ok, err)
	}
	if due, _ := q.DuePlanItems(ctx, typesNow); len(due) != 0 {
		t.Fatalf("due after issue = %+v", due)
	}
	inv, _ := q.Invoice(ctx, "wsp_a", "par_1", "2026-11-07", false)
	if inv.Plan == nil || *inv.Plan != (PlanRef{ID: "pln_1", Seq: 1, Count: 2}) {
		t.Fatalf("partial plan = %+v", inv.Plan)
	}
	if x, _ := q.Invoice(ctx, "wsp_a", "par_x", "2026-11-07", false); x.Plan != nil {
		t.Fatalf("refused partial plan = %+v", x.Plan)
	}
	src, _ := q.Invoice(ctx, "wsp_a", "src_pln_1", "2026-11-07", false)
	if src.Plan == nil || *src.Plan != (PlanRef{ID: "pln_1", Seq: 0, Count: 2}) {
		t.Fatalf("source plan = %+v", src.Plan)
	}
	plans, err := q.Plans(ctx, "wsp_a", "cli_1")
	if err != nil || len(plans) != 2 {
		t.Fatalf("plans = %+v, %v", plans, err)
	}
	p, err := q.Plan(ctx, "wsp_a", "pln_1", false)
	if err != nil || p.Status != "active" || len(p.Items) != 2 || p.Items[0].InvoiceID == nil || *p.Items[0].Number != "par_1" ||
		*p.Items[0].Status != "open" || p.Items[1].InvoiceID != nil || p.Items[0].IssueOn != "2026-11-05" || p.Items[0].DueDate != "2026-11-15" {
		t.Fatalf("plan = %+v, %v", p, err)
	}
	seedInvoice(t, pool, "par_2", "partial", "open", 450, "2026-12-15", 0)
	if ok, _ := q.MarkPlanItemIssued(ctx, "pln_1", 2, "par_2", typesNow); !ok {
		t.Fatal("second item not issued")
	}
	if p, _ := q.Plan(ctx, "wsp_a", "pln_1", false); p.Status != "done" {
		t.Fatalf("status after last item = %s, want done", p.Status)
	}
	if _, err := q.Plan(ctx, "wsp_b", "pln_1", false); err == nil {
		t.Fatal("other workspace must not see the plan")
	}
}

func TestLogReminderOnce(t *testing.T) {
	q, pool := typesDB(t)
	ctx := context.Background()
	seedInvoice(t, pool, "inv", "invoice", "open", 900, "2026-12-31", 0)
	r := ReminderTarget{WorkspaceID: "wsp_a", InvoiceID: "inv", Seq: 1, Kind: "before", OffsetDays: 5}
	if ok, err := q.LogReminder(ctx, r, typesNow); err != nil || !ok {
		t.Fatalf("first = %v, %v", ok, err)
	}
	if ok, err := q.LogReminder(ctx, r, typesNow.Add(time.Hour)); err != nil || ok {
		t.Fatalf("second = %v, %v; want false", ok, err)
	}
	r.OffsetDays = 3
	if ok, _ := q.LogReminder(ctx, r, typesNow); !ok {
		t.Fatal("another offset is another key")
	}
}

func TestDueRemindersOffsets(t *testing.T) {
	q, pool := typesDB(t)
	ctx := context.Background()
	exec(t, pool, `INSERT INTO client_contacts (id, client_id, workspace_id, name, email, is_primary, created_at, updated_at)
		VALUES ('con_1', 'cli_1', 'wsp_a', 'Ann', 'ann@example.com', true, now(), now())`)
	// today 2026-11-07: A1 3 days late, A2 due in 3 days, A3 far off; B1 late but paid, B2 due in 5 days;
	// C1 10 days late (only the 10-day reminder); D is a plan partial 3 days late.
	seedInvoice(t, pool, "A", "invoice", "open", 900, "2026-12-31", 0)
	setInstalments(t, q, "A", []string{"2026-11-04", "2026-11-10", "2026-12-31"}, []int64{300, 300, 300})
	seedInvoice(t, pool, "B", "invoice", "open", 600, "2026-11-12", 0)
	setInstalments(t, q, "B", []string{"2026-11-04", "2026-11-12"}, []int64{300, 300})
	exec(t, pool, `UPDATE invoices SET amount_paid = 300 WHERE id = 'B'`)
	seedInvoice(t, pool, "C", "invoice", "open", 600, "2026-12-28", 0)
	setInstalments(t, q, "C", []string{"2026-10-28", "2026-12-28"}, []int64{300, 300})
	seedPlan(t, q, pool, "pln_1", []string{"2026-10-25", "2026-11-25"})
	seedInvoice(t, pool, "D", "partial", "open", 450, "2026-11-04", 0)
	if ok, err := q.MarkPlanItemIssued(ctx, "pln_1", 1, "D", typesNow); err != nil || !ok {
		t.Fatal(ok, err)
	}
	keys := func() []string {
		t.Helper()
		list, err := q.DueReminders(ctx, typesNow)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, r := range list {
			out = append(out, fmt.Sprintf("%s%d %s %d %d %s", r.InvoiceID, r.Seq, r.Kind, r.OffsetDays, r.Open, r.DueDate))
			if r.ClientEmail != "ann@example.com" || r.Language != "de" || r.Number != r.InvoiceID || r.WorkspaceID != "wsp_a" ||
				r.Today != "2026-11-07" {
				t.Errorf("target = %+v", r)
			}
		}
		slices.Sort(out)
		return out
	}
	want := []string{"A1 after 3 300 2026-11-04", "A2 before 5 300 2026-11-10", "B2 before 5 300 2026-11-12",
		"C1 after 10 300 2026-10-28", "D1 after 3 450 2026-11-04"}
	if got := keys(); !slices.Equal(got, want) {
		t.Fatalf("targets = %q\nwant      %q", got, want)
	}
	if ok, _ := q.LogReminder(ctx, ReminderTarget{WorkspaceID: "wsp_a", InvoiceID: "A", Seq: 1, Kind: "after", OffsetDays: 3}, typesNow); !ok {
		t.Fatal("log")
	}
	if err := q.SetRemindersEnabled(ctx, "B", false); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, `UPDATE instalment_plans SET reminders_enabled = false WHERE id = 'pln_1'`)
	if got, want := keys(), []string{"A2 before 5 300 2026-11-10", "C1 after 10 300 2026-10-28"}; !slices.Equal(got, want) {
		t.Fatalf("after log and switches = %q, want %q", got, want)
	}
	// Workspace settings: custom days, then off.
	if err := q.PutInvoiceSettings(ctx, "wsp_a", map[string]any{"instalments": map[string]any{"remind_before_days": 2, "remind_after_days": []int{}}}, typesNow); err != nil {
		t.Fatal(err)
	}
	if got := keys(); len(got) != 0 {
		t.Fatalf("2 days before, no after = %q", got)
	}
	if err := q.PutInvoiceSettings(ctx, "wsp_a", map[string]any{"instalments": map[string]any{"reminders_enabled": false}}, typesNow); err != nil {
		t.Fatal(err)
	}
	if got := keys(); len(got) != 0 {
		t.Fatalf("workspace off = %q", got)
	}
}

func TestDigestRows(t *testing.T) {
	q, pool := typesDB(t)
	ctx := context.Background()
	// today 2026-11-07: A1 overdue, A2 due in 3 days, A3 far off; D the partial of pln_1 item 1, 3 days late and issued
	// within the last 24 hours; pln_2 item 1 not issued although its day came; pln_2 item 2 not due yet.
	seedInvoice(t, pool, "A", "invoice", "open", 900, "2026-12-31", 0)
	setInstalments(t, q, "A", []string{"2026-11-04", "2026-11-10", "2026-12-31"}, []int64{300, 300, 300})
	seedPlan(t, q, pool, "pln_1", []string{"2026-10-25", "2026-11-25"})
	seedInvoice(t, pool, "D", "partial", "open", 450, "2026-11-04", 0)
	if ok, err := q.MarkPlanItemIssued(ctx, "pln_1", 1, "D", typesNow.Add(-time.Hour)); err != nil || !ok {
		t.Fatal(ok, err)
	}
	seedPlan(t, q, pool, "pln_2", []string{"2026-11-01", "2026-12-01"})
	got, err := q.DigestRows(ctx, "wsp_a", typesNow)
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, r := range got {
		keys = append(keys, fmt.Sprintf("%s %s%d/%d %d %s %q", r.Kind, r.InvoiceID, r.Seq, r.Count, r.Open, r.DueDate, r.Number))
		if r.ClientName == "" || r.WorkspaceID != "wsp_a" {
			t.Errorf("row = %+v", r)
		}
	}
	want := []string{`overdue A1/3 300 2026-11-04 "A"`, `overdue D1/2 450 2026-11-04 "D"`, `due A2/3 300 2026-11-10 "A"`,
		`not_issued src_pln_21/2 0 2026-11-11 ""`, `issued D1/2 0 2026-11-04 "D"`}
	if !slices.Equal(keys, want) {
		t.Fatalf("rows = %q\nwant   %q", keys, want)
	}
	if later, _ := q.DigestRows(ctx, "wsp_a", typesNow.Add(24*time.Hour)); slices.ContainsFunc(later, func(r DigestRow) bool { return r.Kind == "issued" }) {
		t.Fatal("issued more than 24 hours ago is still listed")
	}
	if other, err := q.DigestRows(ctx, "wsp_other", typesNow); err != nil || len(other) != 0 {
		t.Fatalf("other workspace = %+v, %v", other, err)
	}
	ws, err := q.InstalmentDigestWorkspaces(ctx, typesNow)
	if err != nil || len(ws) != 1 || ws[0].ID != "wsp_a" || ws[0].Timezone != "UTC" {
		t.Fatalf("workspaces = %+v, %v", ws, err)
	}
	exec(t, pool, `INSERT INTO engagement_settings (workspace_id, digest, updated_at) VALUES ('wsp_a', false, now())`)
	if ws, err := q.InstalmentDigestWorkspaces(ctx, typesNow); err != nil || len(ws) != 0 {
		t.Fatalf("digest off = %+v, %v", ws, err)
	}
}
