package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// An invoice issued elsewhere is one an AI import brought in from another system as already issued: it keeps the
// document's number (never invoice_counters, so the Helvetly series stays gapless), its legal original is the uploaded
// Document, and Helvetly never re-renders, sends, exports or delivers it (docs/invoices-contract.md).

var (
	errNumberTaken = auth.Error(http.StatusConflict, "number_taken",
		"Another invoice already has this number: skip this row or overwrite that invoice.", nil)
	// ErrIssuedElsewhere refuses rendering, sending and e-invoicing an invoice issued in another system.
	ErrIssuedElsewhere = auth.Error(http.StatusConflict, "issued_elsewhere",
		"This invoice was issued in another system. Send it from there, or download its original.", nil)
	errNoOriginal = validationFailed(map[string]string{"issued_elsewhere": "Upload this invoice as a file of its own, " +
		"not inside a ZIP: its original is kept as a Document."})
)

// issuedElsewhere: what an import record adds when the document is an invoice already issued in another system.
type issuedElsewhere struct {
	on     bool
	number string
	paid   []store.Payment // what was already paid, before the import: one per paid instalment, else one
}

// importedInstalment is one row of a payment schedule the document shows.
type importedInstalment struct {
	Amount  json.RawMessage `json:"amount"`
	DueDate *string         `json:"due_date"`
	Paid    *bool           `json:"paid"`
	PaidOn  *string         `json:"paid_on"`
}

// checkIssuedElsewhere reads issued_elsewhere, paid_amount, paid_on and instalments into invalid's messages: an
// invoice issued elsewhere needs its own number and a past issue date. What was paid is one payment per paid
// instalment when they make up paid_amount (or paid_amount is not given), else paid_amount once on paid_on. A payment without
// its date was made on its instalment's due date, else the invoice's stated due date, else its issue date.
func checkIssuedElsewhere(inv store.Invoice, data map[string]json.RawMessage, today string, invalid map[string]string) issuedElsewhere {
	var out issuedElsewhere
	if raw, ok := data["issued_elsewhere"]; ok && json.Unmarshal(raw, &out.on) != nil {
		invalid["issued_elsewhere"] = "Choose yes or no."
	}
	rawAmount, hasAmount := data["paid_amount"]
	rawOn, hasOn := data["paid_on"]
	if !out.on {
		if hasAmount || hasOn {
			invalid["paid_amount"] = "Only an invoice issued elsewhere can be imported as paid: clear the payment or mark it issued."
		}
		return out
	}
	p := newParser()
	if raw, ok := data["number"]; ok {
		out.number = deref(p.text("number", raw, 100, nil))
	}
	if out.number == "" {
		invalid["number"] = "Enter the invoice's own number: it keeps it."
	}
	if _, ok := data["issue_date"]; !ok {
		invalid["issue_date"] = "Enter the date it was issued."
	} else if inv.IssueDate > today {
		invalid["issue_date"] = "The issue date cannot be in the future."
	}
	fallback := inv.IssueDate
	if _, ok := data["due_date"]; ok && inv.DueDate != "" {
		fallback = inv.DueDate
	}
	note := "Paid before the import"
	payment := func(key string, amount invoicecalc.Money, on string) store.Payment {
		if on > today {
			p.fail(key, "The payment date cannot be in the future.")
		}
		return store.Payment{Method: "other", Amount: amount, PaidOn: on, Note: &note}
	}
	instalments := paidInstalments(p, data["instalments"], fallback, payment)
	var stated invoicecalc.Money
	if hasAmount {
		if n, ok := p.decimal("paid_amount", rawAmount, parseMoney, "Enter the amount with at most two decimals."); ok {
			stated = invoicecalc.Money(n)
			if n <= 0 {
				p.fail("paid_amount", "Enter an amount above 0, or clear it.")
			}
		}
	}
	switch {
	case len(instalments) > 0 && (!hasAmount || stated == sumPayments(instalments)):
		out.paid = instalments
	case hasOn && !hasAmount:
		invalid["paid_amount"] = "Enter how much was paid."
	case hasAmount:
		on := fallback
		if hasOn {
			on = p.required("paid_on", rawOn, 10, date, "Enter when it was paid.")
		}
		out.paid = []store.Payment{payment("paid_on", stated, on)}
	}
	if total := sumPayments(out.paid); total > inv.Payable() {
		p.fail("paid_amount", "The paid amount exceeds the invoice's total ("+inv.Currency+" "+inv.Payable().String()+").")
	}
	for k, v := range p.invalid {
		invalid[k] = v
	}
	return out
}

// paidInstalments: a payment per instalment of raw the document marks paid, dated as it states, else on the
// instalment's due date, else on fallback.
func paidInstalments(p *parser, raw json.RawMessage, fallback string, payment func(string, invoicecalc.Money, string) store.Payment) []store.Payment {
	var rows []importedInstalment
	if len(raw) == 0 || isNull(raw) {
		return nil
	}
	if json.Unmarshal(raw, &rows) != nil {
		p.fail("instalments", "The instalments could not be read.")
		return nil
	}
	var out []store.Payment
	for i, row := range rows {
		if !(row.Paid != nil && *row.Paid) && row.PaidOn == nil {
			continue
		}
		key := fmt.Sprintf("instalments.%d", i)
		n, ok := p.decimal(key+".amount", row.Amount, parseMoney, "Enter the amount with at most two decimals.")
		if !ok || n <= 0 {
			p.fail(key+".amount", "Enter an amount above 0.")
			continue
		}
		on := fallback
		for _, d := range []*string{row.PaidOn, row.DueDate} {
			if d != nil {
				if _, msg := date(*d); msg != "" {
					p.fail(key, msg)
					break
				}
				on = *d
				break
			}
		}
		out = append(out, payment(key, invoicecalc.Money(n), on))
	}
	return out
}

func sumPayments(ps []store.Payment) invoicecalc.Money {
	var total invoicecalc.Money
	for _, p := range ps {
		total += p.Amount
	}
	return total
}

// issueImported records a checked import as issued elsewhere, in q: the draft saved, then issued with its own number
// (no counter), the snapshots, the Document linked as its legal original (a business record, so it cannot be
// trashed), the payment already received and the audit events. Its issue and payment dates must be in open months.
func issueImported(ctx context.Context, q store.Q, sess store.Session, inv store.Invoice, in issuedElsewhere, documentID *string,
	now time.Time, event string, extra map[string]any) error {
	if documentID == nil {
		return errNoOriginal
	}
	if err := checkOpen(ctx, q, sess.Workspace.ID, inv.IssueDate); err != nil {
		return err
	}
	for _, p := range in.paid {
		if err := checkOpen(ctx, q, sess.Workspace.ID, p.PaidOn); err != nil {
			return err
		}
	}
	set, err := loadSettings(ctx, q, sess.Workspace.ID)
	if err != nil {
		return err
	}
	client, err := q.Client(ctx, sess.Workspace.ID, inv.ClientID)
	if err != nil {
		return err
	}
	buyer := buyerOf(client)
	inv.Number, inv.Seller, inv.Buyer, inv.SourceDocumentID = &in.number, &set.Seller.Party, &buyer, documentID
	inv.Payment = store.InvoicePaymentInfo{IBAN: set.IBAN, ReferenceType: "NON"}
	if err := saveDraft(ctx, q, sess, inv, now); err != nil {
		return err
	}
	if err := q.IssueImported(ctx, inv, now); errors.Is(err, store.ErrNumberTaken) {
		return errNumberTaken
	} else if err != nil {
		return err
	}
	if err := q.AddDocumentLink(ctx, sess.Workspace.ID, *documentID, "invoice", inv.ID, sess.User.ID, now); err != nil {
		return err
	}
	if err := q.RefreshBalance(ctx, inv.ID, now); err != nil {
		return err
	}
	payload := map[string]any{"number": in.number, "kind": inv.Kind, "issue_date": inv.IssueDate, "currency": inv.Currency,
		"payable_total": inv.Payable(), "origin": "imported", "document_id": *documentID}
	for k, v := range extra {
		payload[k] = v
	}
	if err := logEventAt(ctx, q, sess, now, event, inv.ID, payload); err != nil {
		return err
	}
	for _, p := range in.paid {
		p.ID, p.CreatedAt = auth.NewID("pay"), now
		if err := q.CreatePayment(ctx, inv.ID, sess.User.ID, p); err != nil {
			return err
		}
		if err := logEventAt(ctx, q, sess, now, "payment.added", inv.ID, map[string]any{"number": in.number, "payment_id": p.ID,
			"amount": p.Amount, "paid_on": p.PaidOn, "method": p.Method}); err != nil {
			return err
		}
	}
	if len(in.paid) == 0 {
		return nil
	}
	return q.RefreshBalance(ctx, inv.ID, now)
}

// importedNumber: the number of a record marked issued elsewhere, "" for a draft import.
func importedNumber(data map[string]json.RawMessage) string {
	var on bool
	var number string
	if json.Unmarshal(data["issued_elsewhere"], &on) != nil || !on || json.Unmarshal(data["number"], &number) != nil {
		return ""
	}
	return strings.TrimSpace(number)
}

// NumberConflict: the workspace's invoice already carrying the number of a record marked issued elsewhere (nil when
// free or for a draft import), and whether the record may overwrite it.
func NumberConflict(ctx context.Context, q store.Q, workspaceID string, data map[string]json.RawMessage) (*store.ImportConflict, error) {
	number := importedNumber(data)
	if number == "" {
		return nil, nil
	}
	use, err := q.InvoiceNumberUse(ctx, workspaceID, "invoice", number)
	if use == nil || err != nil {
		return nil, err
	}
	why, err := whyNotOverwrite(ctx, q, workspaceID, *use)
	if err != nil {
		return nil, err
	}
	c := &store.ImportConflict{ID: use.ID, Label: number + " · " + use.ClientName, Reason: "number already used", CanOverwrite: why == ""}
	if why != "" {
		c.Why = &why
	}
	return c, nil
}

// whyNotOverwrite: why an import may not replace the invoice, "" when it may. Only an untouched invoice issued
// elsewhere in an open month can be replaced; one issued in Helvetly is immutable (GeBüV).
func whyNotOverwrite(ctx context.Context, q store.Q, workspaceID string, use store.NumberUse) (string, error) {
	switch {
	case use.Origin != "imported":
		return "It was issued in Helvetly and cannot be changed. Skip this row; to correct that invoice, issue a credit note.", nil
	case use.Payments:
		return "It already has payments recorded.", nil
	case use.Credits:
		return "It already has a credit note or correction.", nil
	case use.Dunning:
		return "A payment reminder was already sent for it.", nil
	case use.Transmissions:
		return "It was already sent as an e-invoice.", nil
	case use.Status != "open":
		return "It is no longer open.", nil
	}
	if err := q.CheckOpen(ctx, workspaceID, use.IssueDate); errors.Is(err, store.ErrPeriodClosed) {
		return "Its month is closed in the books.", nil
	} else if err != nil {
		return "", err
	}
	return "", nil
}

// OverwriteImport replaces the invoice id, issued elsewhere and still untouched, with the record (data and lines),
// keeping its id, in q; 409 when it may not be replaced.
func OverwriteImport(ctx context.Context, q store.Q, sess store.Session, id, clientID string, data map[string]json.RawMessage,
	documentID *string) (string, error) {
	now := time.Now().UTC()
	old, err := q.Invoice(ctx, sess.Workspace.ID, id, sess.Workspace.Today(now), true)
	if err != nil {
		return "", err
	}
	inv, elsewhere, invalid, err := checkImport(ctx, q, sess.Workspace.ID, sess.Workspace.Today(now), clientID, data)
	if err != nil {
		return "", err
	}
	if len(invalid) > 0 {
		return "", validationFailed(invalid)
	}
	if !elsewhere.on || old.Kind != inv.Kind || deref(old.Number) != elsewhere.number {
		return "", invalidState("Only an invoice with the same number can be overwritten.")
	}
	use, err := q.InvoiceNumberUse(ctx, sess.Workspace.ID, old.Kind, elsewhere.number)
	if err != nil {
		return "", err
	}
	if why, err := whyNotOverwrite(ctx, q, sess.Workspace.ID, *use); err != nil {
		return "", err
	} else if why != "" {
		return "", auth.Error(http.StatusConflict, "cannot_overwrite", why, nil)
	}
	if err := q.ReopenImported(ctx, sess.Workspace.ID, id, now); err != nil {
		return "", err
	}
	inv.ID = id
	return id, issueImported(ctx, q, sess, inv, elsewhere, documentID, now, "invoice.import_overwritten",
		map[string]any{"previous_issue_date": old.IssueDate, "previous_payable_total": old.Payable(),
			"previous_document_id": deref(old.SourceDocumentID)})
}
