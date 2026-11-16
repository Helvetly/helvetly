package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/instalcalc"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// Instalment schedules on one invoice and plans of partial invoices (docs/invoices-contract.md "Instalments",
// "Instalment plans").

var intervalNames = []string{"weekly", "biweekly", "monthly", "quarterly", "yearly"}

// InstalmentSettings: the defaults for schedules, plans and reminders (settings "instalments"; store.DueReminders
// reads the reminder fields by these JSON names).
type InstalmentSettings struct {
	Count            int    `json:"count"`
	Interval         string `json:"interval"`
	Mode             string `json:"mode"`
	PlanLeadDays     int    `json:"plan_lead_days"`
	PlanAutoSend     bool   `json:"plan_auto_send"`
	RemindersEnabled bool   `json:"reminders_enabled"`
	RemindBeforeDays int    `json:"remind_before_days"`
	RemindAfterDays  []int  `json:"remind_after_days"`
}

func defaultInstalmentSettings() InstalmentSettings {
	return InstalmentSettings{Count: 3, Interval: "monthly", Mode: "schedule", PlanLeadDays: 10, PlanAutoSend: true,
		RemindersEnabled: true, RemindBeforeDays: 5, RemindAfterDays: []int{3, 10}}
}

// parseInstalmentSettings applies the fields present in raw; the others keep their value.
func parseInstalmentSettings(p *parser, raw json.RawMessage, in *InstalmentSettings) error {
	m, err := object(raw, "instalments", "count", "interval", "mode", "plan_lead_days", "plan_auto_send", "reminders_enabled",
		"remind_before_days", "remind_after_days")
	if err != nil {
		return err
	}
	for _, f := range []struct {
		key    string
		into   *int
		lo, hi int
	}{{"count", &in.Count, instalcalc.MinCount, instalcalc.MaxCount}, {"plan_lead_days", &in.PlanLeadDays, 0, 60},
		{"remind_before_days", &in.RemindBeforeDays, 0, 30}} {
		if v, ok := m[f.key]; ok && (json.Unmarshal(v, f.into) != nil || *f.into < f.lo || *f.into > f.hi) {
			p.fail("instalments."+f.key, fmt.Sprintf("Enter a whole number from %d to %d.", f.lo, f.hi))
		}
	}
	if v, ok := m["interval"]; ok {
		in.Interval = p.required("instalments.interval", v, 10, oneOf(intervalNames...), "Choose an interval.")
	}
	if v, ok := m["mode"]; ok {
		in.Mode = p.required("instalments.mode", v, 10, oneOf("schedule", "plan"), "Choose schedule or plan.")
	}
	for key, into := range map[string]*bool{"plan_auto_send": &in.PlanAutoSend, "reminders_enabled": &in.RemindersEnabled} {
		if v, ok := m[key]; ok && (isNull(v) || json.Unmarshal(v, into) != nil) {
			p.fail("instalments."+key, "Choose true or false.")
		}
	}
	if v, ok := m["remind_after_days"]; ok {
		var days []int
		if isNull(v) || json.Unmarshal(v, &days) != nil || len(days) > 3 {
			p.fail("instalments.remind_after_days", "Enter up to three numbers of days.")
			return nil
		}
		slices.Sort(days)
		for i, d := range days {
			if d < 1 || d > 90 || (i > 0 && d == days[i-1]) {
				p.fail("instalments.remind_after_days", "Enter up to three different numbers of days from 1 to 90.")
				return nil
			}
		}
		in.RemindAfterDays = days
	}
	return nil
}

// parseSchedule reads InvoiceInput.instalments; null clears the schedule. Items left out or empty are generated:
// their dates now, their amounts (left 0) by syncSchedule.
func parseSchedule(p *parser, raw json.RawMessage, kind string) (*store.InstalmentSchedule, error) {
	if isNull(raw) {
		return nil, nil
	}
	if !Receivable(kind) {
		p.fail("instalments", "Only invoices, partial, prepayment and debit notes and corrections can be paid in instalments.")
		return nil, nil
	}
	m, err := object(raw, "instalments", "count", "interval", "first_due_date", "items")
	if err != nil {
		return nil, err
	}
	var count int
	if json.Unmarshal(m["count"], &count) != nil || count < instalcalc.MinCount || count > instalcalc.MaxCount {
		p.fail("instalments.count", "Enter 2 to 12 instalments.")
	}
	interval := p.required("instalments.interval", m["interval"], 10, oneOf(intervalNames...), "Choose an interval.")
	first := p.required("instalments.first_due_date", m["first_due_date"], 10, date, "Enter the first due date.")
	var given []json.RawMessage
	if v, ok := m["items"]; ok && !isNull(v) && json.Unmarshal(v, &given) != nil {
		p.fail("instalments.items", "Enter a list of instalments.")
	}
	if len(p.invalid) > 0 {
		return nil, nil
	}
	sched := &store.InstalmentSchedule{Interval: interval, Items: make([]store.InstalmentItem, count)}
	if len(given) == 0 {
		start, _ := time.Parse(time.DateOnly, first)
		dates, err := instalcalc.Dates(start, interval, count)
		if err != nil {
			return nil, err
		}
		for i, d := range dates {
			sched.Items[i] = store.InstalmentItem{Seq: i + 1, DueDate: d.Format(time.DateOnly)}
		}
		return sched, nil
	}
	if len(given) != count {
		p.fail("instalments.items", fmt.Sprintf("Enter exactly %d instalments, or none to split the total evenly.", count))
		return nil, nil
	}
	for i, item := range given {
		im, err := object(item, fmt.Sprintf("instalments.items[%d]", i), "due_date", "amount")
		if err != nil {
			return nil, err
		}
		key := func(f string) string { return fmt.Sprintf("instalments.items.%d.%s", i, f) }
		it := store.InstalmentItem{Seq: i + 1, DueDate: p.required(key("due_date"), im["due_date"], 10, date, "Enter the due date.")}
		if i > 0 && it.DueDate != "" && it.DueDate <= sched.Items[i-1].DueDate {
			p.fail(key("due_date"), "Each instalment falls due after the one before.")
		}
		if n, ok := p.decimal(key("amount"), im["amount"], parseMoney, "Enter an amount with at most two decimals."); ok {
			if it.Amount = invoicecalc.Money(n); n <= 0 || it.Amount > maxPayable {
				p.fail(key("amount"), "Enter an amount above 0.")
			}
		}
		sched.Items[i] = it
	}
	return sched, nil
}

// markGenerated clears a saved schedule's amounts while they are still the even split of the saved total, so
// syncSchedule splits the new one; amounts entered by hand are kept. Call it before the totals are recomputed.
func markGenerated(inv *store.Invoice) {
	if inv.Instalments == nil || len(inv.Instalments.Items) == 0 {
		return
	}
	items := inv.Instalments.Items
	amounts := make([]invoicecalc.Money, len(items))
	for i, it := range items {
		amounts[i] = it.Amount
	}
	if slices.Equal(amounts, instalcalc.Split(inv.Payable(), len(items), inv.Currency)) {
		for i := range items {
			items[i].Amount = 0
		}
	}
}

// syncSchedule splits payable_total over generated instalments (amounts still 0) and makes the invoice fall due
// with its last instalment.
func syncSchedule(inv *store.Invoice) {
	if inv.Instalments == nil || len(inv.Instalments.Items) == 0 {
		return
	}
	items := inv.Instalments.Items
	if !slices.ContainsFunc(items, func(it store.InstalmentItem) bool { return it.Amount != 0 }) {
		for i, a := range instalcalc.Split(inv.Payable(), len(items), inv.Currency) {
			items[i].Amount = a
		}
	}
	inv.DueDate = items[len(items)-1].DueDate
}

// allocate derives each instalment's effective, paid and open amount and its status: credit notes reduce from the
// last instalment, payments fill the oldest first.
func allocate(inv *store.Invoice, today string) {
	if inv.Instalments == nil {
		return
	}
	items := inv.Instalments.Items
	amounts := make([]invoicecalc.Money, len(items))
	for i, it := range items {
		amounts[i] = it.Amount
	}
	effective, paid := instalcalc.Allocate(amounts, inv.AmountCredited, inv.AmountPaid)
	for i := range items {
		it := &items[i]
		it.Effective, it.Paid, it.Open = effective[i], paid[i], effective[i]-paid[i]
		switch {
		case it.Open == 0:
			it.Status = "paid"
		case it.DueDate < today:
			it.Status = "overdue"
		case it.Paid > 0:
			it.Status = "part_paid"
		default:
			it.Status = "open"
		}
	}
}

// scheduleReasons: an issued schedule adds up to payable_total and starts on or after the issue date.
func scheduleReasons(inv store.Invoice) []reason {
	if inv.Instalments == nil {
		return nil
	}
	var out []reason
	var sum invoicecalc.Money
	for i, it := range inv.Instalments.Items {
		sum += it.Amount
		if it.DueDate < inv.IssueDate {
			out = append(out, reason{"due_before_issue", fmt.Sprintf("instalments.items.%d.due_date", i),
				fmt.Sprintf("Instalment %d falls due before the issue date.", i+1)})
		}
	}
	if sum != inv.Payable() {
		out = append(out, reason{"instalments_sum", "instalments", "The instalments add up to " + inv.Currency + " " + sum.String() +
			", not the total of " + inv.Currency + " " + inv.Payable().String() + "."})
	}
	return out
}

// setInstalmentReferences gives each instalment its own reference: the invoice's body plus the instalment's seq.
func setInstalmentReferences(inv *store.Invoice, iban string, year int, seq int64) {
	if inv.Instalments == nil {
		return
	}
	for i := range inv.Instalments.Items {
		it := &inv.Instalments.Items[i]
		_, ref := reference(iban, fmt.Sprintf("%d%06d%02d", year, seq, it.Seq))
		it.Reference = &ref
	}
}

var errPlanned = auth.Error(http.StatusConflict, "planned",
	"This draft is the source of an instalment plan: the plan issues its partial invoices.", nil)

// planSource: the draft is (or was) the source of an instalment plan, which keeps it locked for good.
func planSource(ctx context.Context, q store.Q, workspaceID string, inv store.Invoice) (bool, error) {
	if inv.Plan != nil {
		return inv.Plan.Seq == 0, nil
	}
	// a cancelled plan is not joined on the invoice; look among the client's plans
	plans, err := q.Plans(ctx, workspaceID, inv.ClientID)
	return slices.ContainsFunc(plans, func(p store.Plan) bool { return p.SourceInvoiceID == inv.ID }), err
}

func (s *Service) createPlan(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var raw json.RawMessage
	if !s.auth.Decode(w, r, &raw) {
		return nil
	}
	body, err := object(raw, "the plan", "count", "interval", "first_due_date", "lead_days", "auto_send")
	if err != nil {
		return err
	}
	ctx, today := r.Context(), s.today(sess.Workspace)
	var plan store.Plan
	err = s.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), today, true)
		if err != nil {
			return err
		}
		planned, err := planSource(ctx, q, sess.Workspace.ID, inv)
		switch {
		case err != nil:
			return err
		case inv.Status != "draft":
			return invalidState("Only drafts can become an instalment plan.")
		case planned:
			return invalidState("This draft already has an instalment plan.")
		case inv.Instalments != nil:
			return invalidState("This draft has an instalment schedule: remove it to plan partial invoices instead.")
		}
		if len(inv.Prepayments) > 0 { // the partials could not share the deduction
			return cannotIssue([]reason{{Code: "planned_with_prepayments", Field: "prepayment_ids",
				Message: "A draft that deducts prepayments cannot become an instalment plan: remove the prepayments first."}})
		}
		set, err := loadSettings(ctx, q, sess.Workspace.ID)
		if err != nil {
			return err
		}
		p := newParser()
		if !Receivable(inv.Kind) {
			p.fail("kind", "Only invoices, partial, prepayment and debit notes and corrections can be paid in instalments.")
		}
		var count int
		if json.Unmarshal(body["count"], &count) != nil || count < instalcalc.MinCount || count > instalcalc.MaxCount {
			p.fail("count", "Enter 2 to 12 instalments.")
		}
		interval := p.required("interval", body["interval"], 10, oneOf(intervalNames...), "Choose an interval.")
		first := p.required("first_due_date", body["first_due_date"], 10, date, "Enter the first due date.")
		if first != "" && first < today {
			p.fail("first_due_date", "The first instalment cannot fall due before today.")
		}
		lead, autoSend := set.Instalments.PlanLeadDays, set.Instalments.PlanAutoSend
		if v, ok := body["lead_days"]; ok && (json.Unmarshal(v, &lead) != nil || lead < 0 || lead > 60) {
			p.fail("lead_days", "Enter a whole number of days from 0 to 60.")
		}
		if v, ok := body["auto_send"]; ok && (isNull(v) || json.Unmarshal(v, &autoSend) != nil) {
			p.fail("auto_send", "Choose true or false.")
		}
		if err := p.err(); err != nil {
			return err
		}
		start, _ := time.Parse(time.DateOnly, first)
		dates, err := instalcalc.Dates(start, interval, count)
		if err != nil {
			return err
		}
		now := s.now()
		plan = store.Plan{ID: auth.NewID("pln"), WorkspaceID: sess.Workspace.ID, SourceInvoiceID: inv.ID, ClientID: inv.ClientID,
			Count: count, Interval: interval, FirstDueDate: first, LeadDays: lead, AutoSend: autoSend, Status: "active",
			RemindersEnabled: inv.RemindersEnabled, CreatedBy: &sess.User.ID, CreatedAt: now}
		for i, d := range dates {
			plan.Items = append(plan.Items, store.PlanItem{Seq: i + 1, DueDate: d.Format(time.DateOnly),
				IssueOn: d.AddDate(0, 0, -lead).Format(time.DateOnly)})
		}
		if err := q.CreatePlan(ctx, plan); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{"source_invoice_id": inv.ID, "count": count, "interval": interval,
			"first_due_date": first})
		if err != nil {
			return err
		}
		if err := q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "plan.created", SubjectType: "plan",
			SubjectID: plan.ID, ActorID: &sess.User.ID, At: now, Payload: payload}); err != nil {
			return err
		}
		plan, err = q.Plan(ctx, sess.Workspace.ID, plan.ID, false)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(PresentPlan(plan)))
	return nil
}

// PlanItemView is a plan item as the contract shows it: scheduled, issued or cancelled (never issued, the plan was).
type PlanItemView struct {
	Seq       int     `json:"seq"`
	DueDate   string  `json:"due_date"`
	IssueOn   string  `json:"issue_on"`
	InvoiceID *string `json:"invoice_id"`
	Number    *string `json:"number"`
	Status    string  `json:"status"`
}

// PlanView is store.Plan with the contract's items (the shallower Items wins in JSON).
type PlanView struct {
	store.Plan
	Items []PlanItemView `json:"items"`
}

// PresentPlan: the plan as every endpoint answers it.
func PresentPlan(p store.Plan) PlanView {
	v := PlanView{Plan: p, Items: []PlanItemView{}}
	for _, it := range p.Items {
		status := "scheduled"
		switch {
		case it.InvoiceID != nil:
			status = "issued"
		case p.Status == "cancelled":
			status = "cancelled"
		}
		v.Items = append(v.Items, PlanItemView{Seq: it.Seq, DueDate: it.DueDate, IssueOn: it.IssueOn, InvoiceID: it.InvoiceID,
			Number: it.Number, Status: status})
	}
	return v
}

// ErrAlreadyIssued: the plan item has its partial invoice already.
var ErrAlreadyIssued = errors.New("plan item already issued")

// IssuePlanItem issues the partial invoice of one plan item in one transaction: a draft with one line per VAT group
// of the source (its share of the group's net), issued through the normal flow and recorded on the plan. A second
// call for the same item gives ErrAlreadyIssued.
func (s *Service) IssuePlanItem(ctx context.Context, ws store.Workspace, plan store.Plan, item store.PlanItem) (store.Invoice, error) {
	sess, today := store.Session{Workspace: ws}, s.today(ws)
	var id, pdf string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, ws.ID, store.FeatureInvoiceInstalments); err != nil {
			return err // the job checked first; a plan change since then wins
		}
		locked, err := q.Plan(ctx, ws.ID, plan.ID, true)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(locked.Items, func(it store.PlanItem) bool { return it.Seq == item.Seq })
		switch {
		case i < 0:
			return fmt.Errorf("no item %d", item.Seq)
		case locked.Items[i].InvoiceID != nil:
			return ErrAlreadyIssued
		case locked.Status != "active":
			return fmt.Errorf("plan is %s", locked.Status)
		}
		src, err := q.Invoice(ctx, ws.ID, locked.SourceInvoiceID, today, false)
		if err != nil {
			return err
		}
		compute(&src)
		set, err := loadSettings(ctx, q, ws.ID)
		if err != nil {
			return err
		}
		inv := planPartial(src, locked, locked.Items[i], today, set)
		id = inv.ID
		if err := saveDraft(ctx, q, sess, inv, s.now()); err != nil {
			return err
		}
		if ok, err := q.MarkPlanItemIssued(ctx, locked.ID, item.Seq, inv.ID, s.now()); err != nil {
			return err
		} else if !ok {
			return ErrAlreadyIssued
		}
		draft, err := q.Invoice(ctx, ws.ID, inv.ID, today, true) // now with its plan, which the PDF prints
		if err != nil {
			return err
		}
		if err := s.issueDraft(ctx, q, sess, draft, &pdf); err != nil {
			return err
		}
		issued, err := q.Invoice(ctx, ws.ID, inv.ID, today, false)
		if err != nil {
			return err
		}
		return notifications.Notify(ctx, q, ws.ID, "instalment.issued", map[string]any{"invoice_id": issued.ID,
			"number": deref(issued.Number), "client": issued.Client.Name, "position": item.Seq, "count": locked.Count,
			"amount": issued.PayableTotal.String(), "currency": issued.Currency}, store.NotifyTo{Roles: notifications.Managers}, s.now())
	})
	if err := s.settlePDF(ctx, pdf, err); err != nil {
		return store.Invoice{}, fmt.Errorf("issue plan %s item %d: %w", plan.ID, item.Seq, err)
	}
	inv, err := s.db.Invoice(ctx, ws.ID, id, today, false)
	allocate(&inv, today)
	return inv, err
}

// planPartial: the draft partial invoice of one plan item, "Instalment 2/6 – <first line of the source>" once per
// VAT group, net and exclusive of VAT (each partial computes its own VAT).
func planPartial(src store.Invoice, plan store.Plan, item store.PlanItem, today string, set Settings) store.Invoice {
	inv := store.Invoice{ID: auth.NewID("inv"), Kind: "partial", Status: "draft", ClientID: src.ClientID, Client: src.Client,
		IssueDate: today, DueDate: item.DueDate, Currency: src.Currency, Language: src.Language, VATMode: invoicecalc.Exclusive,
		Reference: src.Reference, Footer: src.Footer, PaymentMethods: usableMethods(src.PaymentMethods, set, src.Currency),
		RemindersEnabled: plan.RemindersEnabled, Lines: []store.InvoiceLine{}, Payments: []store.Payment{}}
	if src.VATMode == invoicecalc.None {
		inv.VATMode = invoicecalc.None
	}
	if inv.DueDate < today { // a late item (plan paused, failed runs) still issues, with fresh terms
		inv.DueDate = addDays(today, set.DefaultTermsDays)
	}
	desc := fmt.Sprintf("Instalment %d/%d", item.Seq, plan.Count)
	if len(src.Lines) > 0 {
		if first, _, _ := strings.Cut(src.Lines[0].Description, "\n"); strings.TrimSpace(first) != "" {
			desc += " – " + strings.TrimSpace(first)
		}
	}
	for _, g := range instalcalc.SplitGroups(src.VATBreakdown, plan.Count)[item.Seq-1] {
		if g.TaxableAmount <= 0 {
			continue
		}
		l := store.InvoiceLine{ID: auth.NewID("lin"), Position: len(inv.Lines) + 1, Description: desc, Quantity: 1000,
			UnitPrice: g.TaxableAmount, VATCategory: g.Category, VATRate: g.Rate}
		if k := slices.IndexFunc(src.Lines, func(s store.InvoiceLine) bool { return s.VATCategory == g.Category && s.VATRate == g.Rate }); k >= 0 {
			l.VATExemptionCode, l.VATExemptionReason = src.Lines[k].VATExemptionCode, src.Lines[k].VATExemptionReason
		}
		inv.Lines = append(inv.Lines, l)
	}
	compute(&inv)
	return inv
}

// SendIssued emails an issued invoice like POST /send with its defaults: to the client's billing email, the default
// subject and message, the stored PDF attached.
func (s *Service) SendIssued(ctx context.Context, ws store.Workspace, inv store.Invoice) error {
	if s.mail == nil {
		return fmt.Errorf("send invoice %s: no mail server configured", inv.ID)
	}
	var to *string
	if c, err := s.db.Client(ctx, ws.ID, inv.ClientID); err == nil {
		to = buyerOf(c).Email
	} else if !errors.Is(err, store.ErrNotFound) {
		return fmt.Errorf("send invoice %s: %w", inv.ID, err)
	}
	if to == nil && inv.Buyer != nil {
		to = inv.Buyer.Email
	}
	if to == nil {
		return fmt.Errorf("send invoice %s: the client has no email address", inv.ID)
	}
	pdf, err := s.files.Get(ctx, deref(inv.PDFKey))
	if err != nil {
		return fmt.Errorf("send invoice %s: %w", inv.ID, err)
	}
	subject, message := defaultEmail(inv)
	m := mail.Message{To: []string{*to}, Subject: subject, Text: message,
		HTML:        "<p>" + strings.ReplaceAll(html.EscapeString(message), "\n", "<br>\n") + "</p>",
		Attachments: []mail.Attachment{{Name: fileName(inv), ContentType: "application/pdf", Data: pdf}}}
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	}
	if err := s.mail.Send(ctx, m); err != nil {
		return fmt.Errorf("send invoice %s: %w", inv.ID, err)
	}
	return s.recordDelivery(ctx, inv.ID, nil, []string{*to}, []string{})
}

// defaultEmail: the subject and message POST /send uses when none are given.
func defaultEmail(inv store.Invoice) (string, string) {
	text := emailTexts[inv.Language]
	seller := ""
	if inv.Seller != nil {
		seller = inv.Seller.Name
	}
	subject := strings.TrimSpace(Title(inv) + " " + deref(inv.Number) + " " + text.from + " " + seller)
	if sentence := map[string]string{"credit_note": text.creditNote, "proforma": text.proforma}[inv.Kind]; sentence != "" {
		return subject, text.greeting + "\n\n" + fmt.Sprintf(sentence, deref(inv.Number), inv.Currency, inv.Payable().Swiss("'")) +
			"\n\n" + text.signOff + "\n" + seller
	}
	message := text.greeting + "\n\n" + fmt.Sprintf(text.invoice, deref(inv.Number), inv.Currency, inv.Payable().Swiss("'"),
		swissDate(inv.DueDate)) + "\n\n"
	if inv.Payment.RevolutURL != nil {
		message += text.revolut + ": " + *inv.Payment.RevolutURL + "\n\n"
	}
	return subject, message + text.signOff + "\n" + seller
}
