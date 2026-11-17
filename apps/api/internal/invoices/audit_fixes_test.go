package invoices

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// agreement records an accepted, open-ended self-billing agreement with the supplier from 2000 on.
func (e *env) agreement(b *browser, clientID string) string {
	e.t.Helper()
	now := time.Now()
	id := auth.NewID("sba")
	if err := e.st.CreateAgreement(context.Background(), store.SelfBillingAgreement{ID: id, WorkspaceID: b.workspace,
		ClientID: clientID, StartsOn: "2000-01-01", AcceptedAt: &now, CreatedAt: now}); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func rated(qty, price, category, rate string) map[string]any {
	l := line(qty, price)
	l["vat_category"], l["vat_rate"] = category, rate
	return l
}

func TestCreditLimitPerRate(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	src := e.issued(b, client, map[string]any{"lines": []any{rated("1", "1000.00", "S", "8.1"), rated("1", "500.00", "S", "2.6")}})
	cases := []struct {
		name  string
		lines []any
		want  int
	}{
		{"more at 2.6% than invoiced", []any{rated("1", "600.00", "S", "2.6")}, http.StatusUnprocessableEntity},
		{"a rate the invoice does not have", []any{rated("1", "10.00", "S", "3.8")}, http.StatusUnprocessableEntity},
		{"within each rate", []any{rated("1", "300.00", "S", "2.6")}, http.StatusOK},
		{"more than is left at 2.6% after the first credit", []any{rated("1", "300.00", "S", "2.6")}, http.StatusUnprocessableEntity},
	}
	for _, c := range cases {
		credit := e.invoice(b, "POST", path(src.ID, "credit-note"), map[string]any{"lines": c.lines}, http.StatusCreated)
		if c.want == http.StatusOK {
			e.invoice(b, "POST", path(credit.ID, "issue"), nil, http.StatusOK)
			continue
		}
		out := e.fails(b, "POST", path(credit.ID, "issue"), nil, c.want, "cannot_issue")
		if !slices.Contains(reasonCodes(out), "credit_exceeds_rate") {
			t.Errorf("%s: reasons %v, want credit_exceeds_rate", c.name, reasonCodes(out))
		}
	}
}

func TestCorrectedPrepaymentDeductible(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.paidPrepayment(b, client, nil)
	correction := e.invoice(b, "POST", path(pre.ID, "correct"), nil, http.StatusCreated)
	correction = e.invoice(b, "POST", path(correction.ID, "issue"), nil, http.StatusOK)
	if correction.Status != "paid" {
		t.Fatalf("correction %s, want paid with the prepayment's payment", correction.Status)
	}
	var picker struct{ Data []Invoice }
	e.do(b, "GET", "/api/v1/invoices?kind=prepayment&status=paid", nil, http.StatusOK, &picker)
	if len(picker.Data) != 1 || picker.Data[0].ID != correction.ID {
		t.Fatalf("picker %+v, want the correction", picker.Data)
	}
	normal := e.issued(b, client, nil)
	normalFix := e.invoice(b, "POST", path(normal.ID, "correct"), nil, http.StatusCreated)
	normalFix = e.invoice(b, "POST", path(normalFix.ID, "issue"), nil, http.StatusOK)
	e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": client, "lines": []any{line("1", "5000.00")},
		"prepayment_ids": []string{normalFix.ID}}, http.StatusUnprocessableEntity, "validation_failed", "prepayment_ids")
	if err := e.st.MarkDeducted(context.Background(), b.workspace, []string{normalFix.ID}, pre.ID); !errors.Is(err, store.ErrNotDeductible) {
		t.Fatalf("correction of an invoice deducted: %v", err)
	}
	final := e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{correction.ID}})
	if final.PrepaidTotal != "1081.00" {
		t.Fatalf("prepaid %s, want 1081.00", final.PrepaidTotal)
	}
	final = e.invoice(b, "POST", path(final.ID, "issue"), nil, http.StatusOK)
	if final.AmountDue != "4324.00" {
		t.Errorf("due %s, want 4324.00", final.AmountDue)
	}
	// the replaced original cannot be deducted any more
	other := e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}})
	out := e.fails(b, "POST", path(other.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
	if !slices.Contains(reasonCodes(out), "prepayment_unavailable") {
		t.Errorf("reasons %v, want prepayment_unavailable", reasonCodes(out))
	}
}

func TestTwoFinalsSamePrepaymentsNoDeadlock(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	one, two := e.paidPrepayment(b, client, nil), e.paidPrepayment(b, client, nil)
	finals := []Invoice{
		e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{one.ID, two.ID}}),
		e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{two.ID, one.ID}}),
	}
	statuses := make([]int, len(finals))
	var wg sync.WaitGroup
	for i, f := range finals {
		wg.Go(func() {
			res, _ := e.send(b, "POST", path(f.ID, "issue"), nil)
			statuses[i] = res.StatusCode
		})
	}
	wg.Wait()
	slices.Sort(statuses)
	if !slices.Equal(statuses, []int{http.StatusOK, http.StatusUnprocessableEntity}) {
		t.Fatalf("statuses %v, want one issued and one refused (no deadlock)", statuses)
	}
}

func TestExemptionCodeRequired(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	exempt := rated("1", "100.00", "E", "0")
	draft := e.draft(b, client, map[string]any{"lines": []any{exempt}})
	out := e.fails(b, "POST", path(draft.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
	if i := slices.IndexFunc(out.Error.Details.Reasons, func(r reason) bool { return r.Code == "line_exemption_missing" }); i < 0 ||
		out.Error.Details.Reasons[i].Field != "lines.0.vat_exemption_code" {
		t.Fatalf("reasons %+v, want line_exemption_missing on lines.0.vat_exemption_code", out.Error.Details.Reasons)
	}
	for _, code := range []string{"VATEX-CH-18", "VATEX-EU-999", "exempt"} {
		exempt["vat_exemption_code"] = code
		e.fails(b, "PATCH", path(draft.ID), map[string]any{"lines": []any{exempt}}, http.StatusUnprocessableEntity,
			"validation_failed", "lines.0.vat_exemption_code")
	}
	exempt["vat_exemption_code"], exempt["vat_exemption_reason"] = "vatex-eu-132-1i", "Education"
	e.invoice(b, "PATCH", path(draft.ID), map[string]any{"lines": []any{exempt, rated("1", "50.00", "O", "0")}}, http.StatusOK)
	e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
	inv, err := e.st.Invoice(context.Background(), b.workspace, draft.ID, e.today(), false)
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{deref(inv.Lines[0].VATExemptionCode), deref(inv.Lines[1].VATExemptionCode)}; !slices.Equal(got,
		[]string{"VATEX-EU-132-1I", "VATEX-EU-O"}) {
		t.Errorf("codes %v, want the given one and VATEX-EU-O by default", got)
	}
	if deref(inv.Lines[0].VATExemptionReason) != "Education" {
		t.Errorf("reason %v", inv.Lines[0].VATExemptionReason)
	}
}

func TestDescriptionFitsCatalogueItem(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	long := line("1", "10.00")
	long["description"] = strings.Repeat("n", 200) + "\n" + strings.Repeat("d", 1000)
	e.draft(b, client, map[string]any{"lines": []any{long}})
	long["description"] = strings.Repeat("x", 1202)
	e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": client, "lines": []any{long}},
		http.StatusUnprocessableEntity, "validation_failed", "lines.0.description")
}

func TestPeriodClosedRefusesIssuePaymentVoid(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	ctx := context.Background()
	today, _ := time.Parse(time.DateOnly, e.today())
	lastMonth := time.Date(today.Year(), today.Month()-1, 1, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
	paid := e.issued(b, client, nil)
	e.do(b, "POST", path(paid.ID, "payments"), map[string]any{"amount": "10.00", "paid_on": lastMonth, "method": "cash"},
		http.StatusCreated, nil)
	payments, err := e.st.Payments(ctx, paid.ID)
	if err != nil || len(payments) != 1 {
		t.Fatal(payments, err)
	}
	open := e.issued(b, client, nil)
	backdated := e.draft(b, client, map[string]any{"issue_date": lastMonth, "due_date": e.today()})
	if _, err := e.st.ClosePeriod(ctx, b.workspace, lastMonth[:7], nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.fails(b, "POST", path(backdated.ID, "issue"), nil, http.StatusConflict, "period_closed")
	e.fails(b, "POST", path(paid.ID, "payments"), map[string]any{"amount": "1.00", "paid_on": lastMonth, "method": "cash"},
		http.StatusConflict, "period_closed")
	e.fails(b, "POST", path(paid.ID, "mark-paid"), map[string]any{"paid_on": lastMonth}, http.StatusConflict, "period_closed")
	e.fails(b, "DELETE", path(paid.ID, "payments", payments[0].ID), nil, http.StatusConflict, "period_closed")
	e.do(b, "POST", path(paid.ID, "payments"), map[string]any{"amount": "1.00", "method": "cash"}, http.StatusCreated, nil)

	if _, err := e.st.ClosePeriod(ctx, b.workspace, e.today()[:7], nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.fails(b, "POST", path(open.ID, "void"), map[string]any{}, http.StatusConflict, "period_closed")
	if got := e.invoice(b, "GET", path(open.ID), nil, http.StatusOK); got.Status != "open" {
		t.Errorf("status %s after a refused void", got.Status)
	}
}

func TestEventsLoggedOnIssuePayVoid(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	ctx := context.Background()
	inv := e.issued(b, client, nil)
	e.do(b, "POST", path(inv.ID, "payments"), map[string]any{"amount": "10.00", "method": "cash"}, http.StatusCreated, nil)
	payments, err := e.st.Payments(ctx, inv.ID)
	if err != nil {
		t.Fatal(err)
	}
	e.do(b, "DELETE", path(inv.ID, "payments", payments[0].ID), nil, http.StatusNoContent, nil)
	e.invoice(b, "POST", path(inv.ID, "void"), map[string]any{"reason": "Wrong client"}, http.StatusOK)
	original := e.issued(b, client, nil)
	correction := e.invoice(b, "POST", path(original.ID, "correct"), nil, http.StatusCreated)
	e.invoice(b, "POST", path(correction.ID, "issue"), nil, http.StatusOK)

	events, err := e.st.Events(ctx, b.workspace, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for _, ev := range events {
		kinds = append(kinds, ev.Kind+":"+ev.SubjectID)
		if ev.ActorID == nil {
			t.Errorf("%s has no actor", ev.Kind)
		}
	}
	credits := e.creditNotes(b)
	if len(credits) != 1 {
		t.Fatalf("credit notes %d", len(credits))
	}
	want := []string{"invoice.issued:" + inv.ID, "payment.added:" + inv.ID, "payment.deleted:" + inv.ID, "invoice.voided:" + inv.ID,
		"invoice.issued:" + credits[0].ID, "credit.issued:" + inv.ID, "invoice.issued:" + original.ID,
		"invoice.issued:" + correction.ID, "invoice.replaced:" + original.ID}
	if !slices.Equal(kinds, want) {
		t.Errorf("events\n %v\nwant\n %v", kinds, want)
	}
	if ok, at, err := e.st.VerifyChain(ctx, b.workspace); err != nil || !ok {
		t.Errorf("chain ok=%v broken at %d: %v", ok, at, err)
	}
}

func TestSelfBilledNeedsAgreement(t *testing.T) {
	e := newEnv(t)
	b, _ := e.ready()
	ctx := context.Background()
	supplier := e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	draft := e.draft(b, supplier, map[string]any{"kind": "self_billed"})
	e.fails(b, "POST", path(draft.ID, "issue"), nil, http.StatusConflict, "self_billing_agreement_missing")

	future, now := time.Now().AddDate(1, 0, 0).Format(time.DateOnly), time.Now()
	unaccepted, later := auth.NewID("sba"), auth.NewID("sba")
	for _, a := range []store.SelfBillingAgreement{
		{ID: unaccepted, WorkspaceID: b.workspace, ClientID: supplier, StartsOn: "2000-01-01", CreatedAt: now},
		{ID: later, WorkspaceID: b.workspace, ClientID: supplier, StartsOn: future, AcceptedAt: &now, CreatedAt: now},
	} {
		if err := e.st.CreateAgreement(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	e.fails(b, "POST", path(draft.ID, "issue"), nil, http.StatusConflict, "self_billing_agreement_missing")

	id := e.agreement(b, supplier)
	e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
	list, err := e.st.Agreements(ctx, b.workspace, supplier)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range list {
		if used := a.FirstUsedAt != nil; used != (a.ID == id) {
			t.Errorf("agreement %s used=%v", a.ID, used)
		}
	}
}

func TestCurrencyTwoDecimalsOnly(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	for _, c := range []string{"JPY", "BHD", "XAU"} {
		e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": client, "currency": c},
			http.StatusUnprocessableEntity, "validation_failed", "currency")
		e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"currency": c},
			http.StatusUnprocessableEntity, "validation_failed", "currency")
	}
	e.draft(b, client, map[string]any{"currency": "eur"})
}

func TestCurrencyLockedOnceIssued(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"currency": "EUR"}, http.StatusOK, nil)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"currency": "CHF"}, http.StatusOK, nil)
	e.issued(b, client, nil)
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"currency": "EUR"}, http.StatusConflict, "currency_locked")
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"currency": "CHF", "footer": "Danke"}, http.StatusOK, nil)
}

func TestSendIssuedRecordsSystemDelivery(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	ctx := context.Background()
	issued := e.issued(b, client, nil)
	inv, err := e.st.Invoice(ctx, b.workspace, issued.ID, e.today(), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SendIssued(ctx, store.Workspace{ID: b.workspace, Timezone: zone.String()}, inv); err != nil {
		t.Fatal(err)
	}
	list, err := e.st.Deliveries(ctx, inv.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].SentBy != nil || !slices.Equal(list[0].To, []string{"ap@kunde.ch"}) {
		t.Fatalf("deliveries %+v, want one by the system to the client", list)
	}
	subject, message, err := e.svc.draft(ctx, e.st.Q, b.workspace, inv)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.mail.sent) != 1 || e.mail.sent[0].Subject != subject || e.mail.sent[0].Text != message {
		t.Errorf("mail %+v, want the default subject and message", e.mail.sent)
	}
}

func TestPlanRefusesPrepayments(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.paidPrepayment(b, client, nil)
	final := e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}})
	var out apiErr
	e.do(b, "POST", path(final.ID, "plan"), map[string]any{"count": 3, "interval": "monthly", "first_due_date": e.today()},
		http.StatusUnprocessableEntity, &out)
	if len(out.Error.Details.Reasons) != 1 || out.Error.Details.Reasons[0].Code != "planned_with_prepayments" ||
		out.Error.Details.Reasons[0].Field != "prepayment_ids" {
		t.Fatalf("error %+v, want planned_with_prepayments on prepayment_ids", out.Error)
	}
}

func TestPlanResponseItemStatus(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	src := e.draft1081(b, client, nil)
	var out struct {
		Data struct {
			Status string
			Items  []struct {
				Seq    int
				Status string
			}
		}
	}
	e.do(b, "POST", path(src.ID, "plan"), map[string]any{"count": 3, "interval": "monthly", "first_due_date": e.today()},
		http.StatusCreated, &out)
	if len(out.Data.Items) != 3 || out.Data.Status != "active" {
		t.Fatalf("plan %+v", out.Data)
	}
	for _, it := range out.Data.Items {
		if it.Status != "scheduled" {
			t.Errorf("item %d status %q, want scheduled", it.Seq, it.Status)
		}
	}
	got := PresentPlan(store.Plan{Status: "cancelled", Items: []store.PlanItem{{Seq: 1, InvoiceID: &src.ID}, {Seq: 2}}})
	if got.Items[0].Status != "issued" || got.Items[1].Status != "cancelled" {
		t.Errorf("cancelled plan items %+v", got.Items)
	}
}

func TestPlanCreatedWakesTheJobOnce(t *testing.T) {
	e := newEnv(t)
	woken := 0
	e.svc.SetPlanCreated(func() { woken++ })
	b, client := e.ready()
	src := e.draft1081(b, client, nil)
	body := map[string]any{"count": 3, "interval": "monthly", "first_due_date": e.today()}
	e.do(b, "POST", path(src.ID, "plan"), body, http.StatusCreated, nil)
	e.do(b, "POST", path(src.ID, "plan"), body, http.StatusConflict, nil)
	if woken != 1 {
		t.Errorf("woken %d times, want once: for the created plan, not the refused one", woken)
	}
}
