package invoices

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

// schedInvoice is the part of an invoice response the instalment tests read.
type schedInvoice struct {
	ID, Kind, Status string
	DueDate          string      `json:"due_date"`
	PayableTotal     store.Money `json:"payable_total"`
	RemindersEnabled bool        `json:"reminders_enabled"`
	Payment          struct {
		Reference *string `json:"reference"`
	} `json:"payment"`
	Instalments *store.InstalmentSchedule `json:"instalments"`
	Plan        *store.PlanRef            `json:"plan"`
}

func (e *env) sched(b *browser, method, path string, body any, want int) schedInvoice {
	e.t.Helper()
	var out struct{ Data schedInvoice }
	e.do(b, method, path, body, want, &out)
	return out.Data
}

func amounts(inv schedInvoice, field func(store.InstalmentItem) store.Money) []string {
	var out []string
	for _, it := range inv.Instalments.Items {
		out = append(out, field(it).String())
	}
	return out
}

func amountOf(it store.InstalmentItem) store.Money { return it.Amount }

// draft1081: a draft of CHF 1'000.00 net at 8.1 %, 1'081.00 payable.
func (e *env) draft1081(b *browser, clientID string, extra map[string]any) schedInvoice {
	e.t.Helper()
	body := map[string]any{"client_id": clientID, "lines": []any{line("1", "1000.00")}}
	for k, v := range extra {
		body[k] = v
	}
	return e.sched(b, "POST", "/api/v1/invoices", body, http.StatusCreated)
}

var monthly3 = map[string]any{"count": 3, "interval": "monthly", "first_due_date": "2099-01-31"}

func TestInstalmentScheduleGenerated(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.draft1081(b, clientID, nil)
	inv = e.sched(b, "PATCH", path(inv.ID), map[string]any{"instalments": monthly3}, http.StatusOK)
	if got := amounts(inv, amountOf); !slices.Equal(got, []string{"360.35", "360.35", "360.30"}) {
		t.Fatalf("amounts %v", got)
	}
	var dates []string
	for _, it := range inv.Instalments.Items {
		dates = append(dates, it.DueDate)
	}
	if !slices.Equal(dates, []string{"2099-01-31", "2099-02-28", "2099-03-31"}) || inv.DueDate != "2099-03-31" {
		t.Fatalf("dates %v, due %s", dates, inv.DueDate)
	}
	// generated amounts follow the total on the next save
	inv = e.sched(b, "PATCH", path(inv.ID), map[string]any{"lines": []any{line("2", "1000.00")}}, http.StatusOK)
	if got := amounts(inv, amountOf); !slices.Equal(got, []string{"720.65", "720.65", "720.70"}) {
		t.Fatalf("after total change %v", got)
	}
	// given items are kept
	given := map[string]any{"count": 2, "interval": "monthly", "first_due_date": "2099-01-31", "items": []any{
		map[string]any{"due_date": "2099-01-31", "amount": "2000.00"}, map[string]any{"due_date": "2099-06-30", "amount": "162.00"}}}
	inv = e.sched(b, "PATCH", path(inv.ID), map[string]any{"instalments": given}, http.StatusOK)
	if got := amounts(inv, amountOf); !slices.Equal(got, []string{"2000.00", "162.00"}) || inv.DueDate != "2099-06-30" {
		t.Fatalf("given %v due %s", got, inv.DueDate)
	}
	// null clears
	if inv = e.sched(b, "PATCH", path(inv.ID), map[string]any{"instalments": nil}, http.StatusOK); inv.Instalments != nil {
		t.Fatalf("not cleared: %+v", inv.Instalments)
	}
	// preview computes it too, and bad input names its field
	prev := e.sched(b, "POST", "/api/v1/invoices/preview", map[string]any{"client_id": clientID, "lines": []any{line("1", "1000.00")},
		"instalments": monthly3}, http.StatusOK)
	if prev.Instalments == nil || prev.Instalments.Items[2].Amount.String() != "360.30" {
		t.Fatalf("preview %+v", prev.Instalments)
	}
	for _, tc := range []struct {
		name  string
		in    map[string]any
		field string
	}{
		{"count", map[string]any{"count": 13, "interval": "monthly", "first_due_date": "2099-01-31"}, "instalments.count"},
		{"interval", map[string]any{"count": 3, "interval": "daily", "first_due_date": "2099-01-31"}, "instalments.interval"},
		{"first", map[string]any{"count": 3, "interval": "monthly", "first_due_date": "31.01.2099"}, "instalments.first_due_date"},
		{"items count", map[string]any{"count": 3, "interval": "monthly", "first_due_date": "2099-01-31",
			"items": []any{map[string]any{"due_date": "2099-01-31", "amount": "1.00"}}}, "instalments.items"},
		{"descending", map[string]any{"count": 2, "interval": "monthly", "first_due_date": "2099-01-31", "items": []any{
			map[string]any{"due_date": "2099-02-01", "amount": "1.00"}, map[string]any{"due_date": "2099-01-01", "amount": "1.00"}}},
			"instalments.items.1.due_date"},
		{"zero", map[string]any{"count": 2, "interval": "monthly", "first_due_date": "2099-01-31", "items": []any{
			map[string]any{"due_date": "2099-01-01", "amount": "0"}, map[string]any{"due_date": "2099-02-01", "amount": "1.00"}}},
			"instalments.items.0.amount"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e.fails(b, "PATCH", path(inv.ID), map[string]any{"instalments": tc.in}, http.StatusUnprocessableEntity, "validation_failed", tc.field)
		})
	}
}

func TestInstalmentsSumMustMatch422(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	today := e.today()
	inv := e.draft1081(b, clientID, map[string]any{"instalments": map[string]any{"count": 2, "interval": "monthly",
		"first_due_date": today, "items": []any{map[string]any{"due_date": "2000-01-01", "amount": "500.00"},
			map[string]any{"due_date": "2099-01-01", "amount": "500.00"}}}})
	out := e.fails(b, "POST", path(inv.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
	var fields []string
	for _, r := range out.Error.Details.Reasons {
		fields = append(fields, r.Code+"@"+r.Field)
	}
	for _, want := range []string{"instalments_sum@instalments", "due_before_issue@instalments.items.0.due_date"} {
		if !slices.Contains(fields, want) {
			t.Fatalf("reasons %v, want %s", fields, want)
		}
	}
}

func TestInstalmentsOnlyReceivable(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	for _, kind := range []string{"proforma", "self_billed"} {
		e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "kind": kind, "lines": []any{line("1", "10.00")},
			"instalments": monthly3}, http.StatusUnprocessableEntity, "validation_failed", "instalments")
	}
	for _, kind := range []string{"invoice", "partial", "prepayment"} {
		e.draft1081(b, clientID, map[string]any{"kind": kind, "instalments": monthly3})
	}
}

// issuedSchedule: an issued CHF 1'081.00 invoice in three monthly instalments from today.
func (e *env) issuedSchedule(b *browser, clientID string) schedInvoice {
	e.t.Helper()
	inv := e.draft1081(b, clientID, map[string]any{"instalments": map[string]any{"count": 3, "interval": "monthly", "first_due_date": e.today()}})
	return e.sched(b, "POST", path(inv.ID, "issue"), nil, http.StatusOK)
}

func (e *env) today() string { return store.Workspace{Timezone: "Europe/Zurich"}.Today(e.svc.now()) }

func TestPaymentAllocatedOldestFirst(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.issuedSchedule(b, clientID)
	refs := map[string]bool{*inv.Payment.Reference: true}
	for _, it := range inv.Instalments.Items {
		if it.Reference == nil || refs[*it.Reference] {
			t.Fatalf("instalment %d reference %v", it.Seq, it.Reference)
		}
		refs[*it.Reference] = true
	}
	inv = e.sched(b, "POST", path(inv.ID, "payments"), map[string]any{"amount": "500.00", "method": "bank_transfer"}, http.StatusCreated)
	var statuses []string
	for _, it := range inv.Instalments.Items {
		statuses = append(statuses, it.Status)
	}
	if !slices.Equal(statuses, []string{"paid", "part_paid", "open"}) || inv.Instalments.Items[1].Open.String() != "220.70" ||
		inv.Instalments.Items[0].Reference == nil {
		t.Fatalf("statuses %v, open %v", statuses, amounts(inv, func(it store.InstalmentItem) store.Money { return it.Open }))
	}
}

func TestCreditReducesFromLast(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.issuedSchedule(b, clientID)
	credit := e.invoice(b, "POST", path(inv.ID, "credit-note"), map[string]any{"lines": []any{line("1", "400.00")}}, http.StatusCreated)
	e.invoice(b, "POST", path(credit.ID, "issue"), nil, http.StatusOK) // 432.40
	inv = e.sched(b, "GET", path(inv.ID), nil, http.StatusOK)
	if got := amounts(inv, func(it store.InstalmentItem) store.Money { return it.Effective }); !slices.Equal(got, []string{"360.35", "288.25", "0.00"}) {
		t.Fatalf("effective %v", got)
	}
	if inv.Instalments.Items[2].Status != "credited" || inv.Instalments.Items[1].Status != "open" || inv.Instalments.Items[0].Status != "open" {
		t.Fatalf("statuses %+v", inv.Instalments.Items)
	}
}

func (e *env) plan(b *browser, id string, body map[string]any, want int) store.Plan {
	e.t.Helper()
	var out struct{ Data store.Plan }
	e.do(b, "POST", path(id, "plan"), body, want, &out)
	return out.Data
}

func TestPlanSourceCannotIssue(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	src := e.draft1081(b, clientID, nil)
	body := map[string]any{"count": 3, "interval": "monthly", "first_due_date": e.today()}
	plan := e.plan(b, src.ID, body, http.StatusCreated)
	if plan.Status != "active" || len(plan.Items) != 3 || plan.LeadDays != 10 || !plan.AutoSend || plan.Items[0].IssueOn != addDays(e.today(), -10) {
		t.Fatalf("plan %+v", plan)
	}
	got := e.sched(b, "GET", path(src.ID), nil, http.StatusOK)
	if got.Plan == nil || got.Plan.ID != plan.ID || got.Plan.Seq != 0 || got.Plan.Count != 3 {
		t.Fatalf("source plan ref %+v", got.Plan)
	}
	e.fails(b, "POST", path(src.ID, "issue"), nil, http.StatusConflict, "planned")
	e.fails(b, "PATCH", path(src.ID), map[string]any{"note": "x"}, http.StatusConflict, "planned")
	e.fails(b, "DELETE", path(src.ID), nil, http.StatusConflict, "planned")
	e.fails(b, "POST", path(src.ID, "plan"), body, http.StatusConflict, "invalid_state")

	withSchedule := e.draft1081(b, clientID, map[string]any{"instalments": monthly3})
	e.fails(b, "POST", path(withSchedule.ID, "plan"), body, http.StatusConflict, "invalid_state")
	other := e.draft1081(b, clientID, nil)
	e.fails(b, "POST", path(other.ID, "plan"), map[string]any{"count": 1, "interval": "daily", "first_due_date": "2000-01-01",
		"lead_days": 61}, http.StatusUnprocessableEntity, "validation_failed", "count", "interval", "first_due_date", "lead_days")
	proforma := e.draft(b, clientID, map[string]any{"kind": "proforma"})
	e.fails(b, "POST", path(proforma.ID, "plan"), body, http.StatusUnprocessableEntity, "validation_failed", "kind")
}

func TestIssuePlanItemOnce(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	e.join(b.workspace, "admin")
	e.join(b.workspace, "member")
	// two VAT groups: 1'000.00 at 8.1 % and 100.00 at 2.6 %
	src := e.sched(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "lines": []any{line("1", "1000.00"),
		map[string]any{"description": "Bücher", "unit_price": "100.00", "vat_rate": "2.6"}}}, http.StatusCreated)
	plan := e.plan(b, src.ID, map[string]any{"count": 3, "interval": "monthly", "first_due_date": e.today()}, http.StatusCreated)
	ws := store.Workspace{ID: b.workspace, Timezone: "Europe/Zurich"}
	ctx := context.Background()
	var nets []string
	for _, item := range plan.Items {
		inv, err := e.svc.IssuePlanItem(ctx, ws, plan, item)
		if err != nil {
			t.Fatal(err)
		}
		if inv.Kind != "partial" || inv.Status != "open" || inv.Plan == nil || inv.Plan.Seq != item.Seq || inv.Plan.Count != 3 ||
			inv.DueDate != item.DueDate || len(inv.Lines) != 2 || !strings.HasPrefix(inv.Lines[0].Description, "Instalment ") ||
			!strings.HasSuffix(inv.Lines[0].Description, "/3 – Beratung") {
			t.Fatalf("partial %d: %+v", item.Seq, inv)
		}
		for _, l := range inv.Lines {
			nets = append(nets, l.Amount.String())
		}
		if _, err := e.svc.IssuePlanItem(ctx, ws, plan, item); !errors.Is(err, ErrAlreadyIssued) {
			t.Fatalf("second issue of item %d: %v", item.Seq, err)
		}
	}
	if !slices.Equal(nets, []string{"333.33", "33.33", "333.33", "33.33", "333.34", "33.34"}) {
		t.Fatalf("nets %v", nets)
	}
	// The job issues them: every manager hears of each instalment once, a member does not.
	members, err := e.st.ListMembers(ctx, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range members {
		got, err := e.st.Notifications(ctx, b.workspace, m.UserID, store.NotificationFilter{Limit: 50, Events: []string{"instalment.issued"}})
		if err != nil {
			t.Fatal(err)
		}
		if want := map[string]int{"owner": 3, "admin": 3}[m.Role]; len(got) != want {
			t.Fatalf("%s: %d notifications, want %d", m.Role, len(got), want)
		}
	}
	done, err := e.st.Plan(ctx, b.workspace, plan.ID, false)
	if err != nil || done.Status != "done" {
		t.Fatalf("plan after last item: %s %v", done.Status, err)
	}
	first, err := e.st.Invoice(ctx, b.workspace, *done.Items[0].InvoiceID, e.today(), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SendIssued(ctx, ws, first); err != nil {
		t.Fatal(err)
	}
	if len(e.mail.sent) != 1 || e.mail.sent[0].To[0] != "ap@kunde.ch" || len(e.mail.sent[0].Attachments) != 1 {
		t.Fatalf("sent %+v", e.mail.sent)
	}
}

func TestSettingsInstalmentsValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var got struct{ Data Settings }
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
	if d := got.Data.Instalments; d.Count != 3 || d.Interval != "monthly" || d.Mode != "schedule" || d.PlanLeadDays != 10 ||
		!d.PlanAutoSend || !d.RemindersEnabled || d.RemindBeforeDays != 5 || !slices.Equal(d.RemindAfterDays, []int{3, 10}) {
		t.Fatalf("defaults %+v", d)
	}
	for _, tc := range []struct {
		field string
		value any
	}{
		{"count", 1}, {"count", 13}, {"interval", "daily"}, {"mode", "both"}, {"plan_lead_days", 61}, {"plan_lead_days", -1},
		{"plan_auto_send", nil}, {"reminders_enabled", "yes"}, {"remind_before_days", 31}, {"remind_after_days", []int{1, 2, 3, 4}},
		{"remind_after_days", []int{0}}, {"remind_after_days", []int{91}}, {"remind_after_days", []int{5, 5}},
	} {
		e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"instalments": map[string]any{tc.field: tc.value}},
			http.StatusUnprocessableEntity, "validation_failed", "instalments."+tc.field)
	}
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"instalments": map[string]any{"nope": 1}}, http.StatusBadRequest, "invalid_request")
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"instalments": map[string]any{"plan_lead_days": 0, "remind_after_days": []int{30, 7},
		"reminders_enabled": false}}, http.StatusOK, &got)
	if d := got.Data.Instalments; d.PlanLeadDays != 0 || !slices.Equal(d.RemindAfterDays, []int{7, 30}) || d.RemindersEnabled || d.Count != 3 {
		t.Fatalf("saved %+v", d)
	}
	// new invoices start with the workspace's reminders switch; an issued one takes {reminders_enabled} alone
	e.do(b, "PUT", "/api/v1/invoice-settings", completeSettings, http.StatusOK, nil)
	clientID := e.client(b, nil)
	inv := e.draft1081(b, clientID, nil)
	if inv.RemindersEnabled {
		t.Fatal("draft reminders on, want the workspace's off")
	}
	inv = e.sched(b, "POST", path(inv.ID, "issue"), nil, http.StatusOK)
	if inv = e.sched(b, "PATCH", path(inv.ID), map[string]any{"reminders_enabled": true}, http.StatusOK); !inv.RemindersEnabled {
		t.Fatal("reminders not switched on")
	}
	e.fails(b, "PATCH", path(inv.ID), map[string]any{"reminders_enabled": true, "note": "x"}, http.StatusConflict, "invoice_locked")
}

func TestFinalInvoiceScheduleAfterDeduction(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	pre := e.paidPrepayment(b, clientID, nil)
	final := e.sched(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "lines": []any{line("1", "5000.00")},
		"prepayment_ids": []string{pre.ID}, "instalments": map[string]any{"count": 2, "interval": "monthly", "first_due_date": e.today()}},
		http.StatusCreated)
	if got := amounts(final, amountOf); final.PayableTotal.String() != "4324.00" || !slices.Equal(got, []string{"2162.00", "2162.00"}) {
		t.Fatalf("payable %s, instalments %v", final.PayableTotal, got)
	}
	final = e.sched(b, "POST", path(final.ID, "issue"), nil, http.StatusOK)
	if final.Status != "open" || final.Instalments.Items[1].Reference == nil {
		t.Fatalf("issued %+v", final)
	}
}
