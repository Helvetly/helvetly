package invoices

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/swissqr"
	"helvetly.com/api/internal/uploads"
)

func (s *Service) issue(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	var pdf string
	err := s.db.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if inv.Status != "draft" {
			return invalidState("Only drafts can be issued.")
		}
		if planned, err := planSource(ctx, q, sess.Workspace.ID, inv); err != nil {
			return err
		} else if planned {
			return errPlanned
		}
		return s.issueDraft(ctx, q, sess, inv, &pdf)
	})
	if err := s.settlePDF(ctx, pdf, err); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

// settlePDF runs after an issue's transaction: the stored PDF is locked (GeBüV, S3 Object Lock) only once the issue
// committed, so a rollback, which also returns the number, leaves no undeletable object behind; it is deleted instead.
func (s *Service) settlePDF(ctx context.Context, key string, txErr error) error {
	if key == "" {
		return txErr
	}
	if txErr != nil {
		ctx, cancel := uploads.CleanupContext(ctx)
		defer cancel()
		if err := s.files.Delete(ctx, key); err != nil {
			s.log.WarnContext(ctx, "orphaned invoice PDF", "key", key, "error", err)
		}
		return txErr
	}
	// the invoice is issued either way: a failed lock stays pending for the retention job
	retention.Settle(ctx, s.db, s.files, s.log, key)
	return nil
}

// issueDraft issues a locked draft inside the caller's transaction: checks, the next number, the snapshots,
// the payment reference, the PDF in storage, the credit note's application to its invoice, a final invoice's
// prepayments marked deducted and a correction taking over its original's payments. The PDF's key goes to pdf; the
// caller passes it to settlePDF after the transaction.
func (s *Service) issueDraft(ctx context.Context, q store.Q, sess store.Session, inv store.Invoice, pdf *string) error {
	if needsPreceding(inv.Kind) { // a correction drafted on a plan with them is issued only on one with them
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureInvoiceCorrections); err != nil {
			return err
		}
	}
	if inv.Instalments != nil && len(inv.Instalments.Items) > 0 { // so is a draft with an instalment schedule
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureInvoiceInstalments); err != nil {
			return err
		}
	}
	if err := checkOpen(ctx, q, sess.Workspace.ID, inv.IssueDate); err != nil {
		return err
	}
	var agreement *store.SelfBillingAgreement
	if inv.Kind == "self_billed" {
		a, err := q.AgreementCovering(ctx, sess.Workspace.ID, inv.ClientID, inv.IssueDate, s.now())
		if err != nil {
			return err
		}
		if a == nil {
			return errNoAgreement
		}
		agreement = a
	}
	set, err := loadSettings(ctx, q, sess.Workspace.ID)
	if err != nil {
		return err
	}
	var client *store.Client
	if c, err := q.Client(ctx, sess.Workspace.ID, inv.ClientID); err == nil {
		client = &c
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	var credited *store.Invoice
	if inv.CreditedInvoice != nil {
		c, err := q.Invoice(ctx, sess.Workspace.ID, inv.CreditedInvoice.ID, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		credited = &c
	}
	if inv.Kind == "corrected" { // the correction takes these payments over, which must not rewrite a closed month
		for _, p := range credited.Payments {
			if err := checkOpen(ctx, q, sess.Workspace.ID, p.PaidOn); err != nil {
				return err
			}
		}
	}
	prepaid := make([]store.Invoice, len(inv.Prepayments))
	order := make([]int, len(inv.Prepayments))
	for i := range order {
		order[i] = i
	}
	// locked, so a prepayment is deducted once; in id order, so two finals sharing prepayments never deadlock
	slices.SortFunc(order, func(a, b int) int { return strings.Compare(inv.Prepayments[a].ID, inv.Prepayments[b].ID) })
	for _, i := range order {
		if prepaid[i], err = q.Invoice(ctx, sess.Workspace.ID, inv.Prepayments[i].ID, s.today(sess.Workspace), true); err != nil {
			return err
		}
		if ok, err := isPrepayment(ctx, q, sess.Workspace.ID, s.today(sess.Workspace), prepaid[i]); err != nil {
			return err
		} else if ok {
			prepaid[i].Kind = "prepayment" // a correction of a prepayment deducts as one
		}
		p := prepaid[i]
		inv.Prepayments[i] = store.PrepaymentRef{ID: p.ID, Number: p.Number, PayableTotal: p.Payable(), Status: p.Status,
			VATBreakdown: p.VATBreakdown}
	}
	if len(prepaid) > 0 {
		markGenerated(&inv)
		compute(&inv)
		syncSchedule(&inv)
	}
	reasons := issueReasons(inv, set, client, credited, prepaid, s.today(sess.Workspace))
	if credited != nil && inv.Kind == "credit_note" {
		earlier, err := issuedCredits(ctx, q, sess.Workspace.ID, s.today(sess.Workspace), credited.ID)
		if err != nil {
			return err
		}
		reasons = append(reasons, creditRateReasons(inv, *credited, earlier)...)
	}
	if len(reasons) > 0 {
		return cannotIssue(reasons)
	}
	// counted before the number, the PDF and their locks; a refusal rolls back and keeps the draft
	if err := q.CountIssue(ctx, sess.Workspace.ID, inv, s.now()); err != nil {
		return err
	}
	if defaultExemptions(&inv) && len(prepaid) == 0 { // deduct saves the draft below
		if err := q.SaveDraft(ctx, sess.Workspace.ID, inv, s.now()); err != nil {
			return err
		}
	}
	if inv.Kind == "corrected" { // the correction takes over the prepayments its original deducted
		if err := q.ReleasePrepayments(ctx, sess.Workspace.ID, credited.ID); err != nil {
			return err
		}
	}
	if len(prepaid) > 0 {
		if err := s.deduct(ctx, q, sess, &inv); err != nil {
			return err
		}
	}

	// read from storage before the counter: its row lock serialises every issue of the series until commit
	logo, err := s.logoBytes(ctx, sess.Workspace.ID, set)
	if err != nil {
		return err
	}
	year, _ := strconv.Atoi(inv.IssueDate[:4])
	series, prefix := seriesOf(inv, credited)
	var seq int64
	var number string
	for used := true; used; { // skip a number an imported invoice took; the counter row stays locked meanwhile
		if seq, err = q.NextInvoiceSeq(ctx, sess.Workspace.ID, series, year); err != nil {
			return err
		}
		number = documentNumber(set.NumberFormat, prefix, inv.Kind, inv.IssueDate, seq)
		if used, err = q.InvoiceNumberUsed(ctx, sess.Workspace.ID, number); err != nil {
			return err
		}
	}
	inv.Number = &number
	inv.Seller = &set.Seller.Party
	buyer := snapshotBuyer(client, credited)
	inv.Buyer = &buyer
	inv.Payment = store.InvoicePaymentInfo{IBAN: set.IBAN, ReferenceType: "NON"}
	inv.PaymentMethods = usableMethods(inv.PaymentMethods, set, inv.Currency) // what the editor showed
	// all receivable kinds share the invoice series, so their references stay unique
	if Receivable(inv.Kind) {
		var ref string
		inv.Payment.ReferenceType, ref = paymentReference(*set.IBAN, year, seq)
		inv.Payment.Reference = &ref
		setInstalmentReferences(&inv, *set.IBAN, year, seq)
		inv.Payment.QRBill = inv.PaymentMethods.QRBill && inv.Payable() > 0
		if inv.PaymentMethods.Revolut {
			inv.Payment.RevolutURL = revolutURL(*set.RevolutUsername)
		}
	}
	doc := s.document(inv, set, false, credited)
	doc.Logo = logo
	body, err := invoicepdf.Render(doc)
	if err != nil {
		return err
	}
	key := "workspaces/" + sess.Workspace.ID + "/invoices/" + inv.ID + "/" + fileName(inv)
	inv.PDFKey = &key
	if err := q.ReserveObject(ctx, sess.Workspace.ID, key, int64(len(body)), false, s.now()); err != nil {
		return err
	}
	if err := s.files.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "application/pdf", fileName(inv)); err != nil {
		return err
	}
	*pdf = key
	if err := retention.Request(ctx, q, s.files, sess.Workspace.ID, key, inv.IssueDate, s.now()); err != nil {
		return err
	}
	if err := q.Issue(ctx, sess.Workspace.ID, inv, seq, s.now()); err != nil {
		return err
	}
	if inv.Instalments != nil {
		if err := q.SetInstalments(ctx, inv.ID, inv.Instalments.Interval, inv.Instalments.Items); err != nil {
			return err
		}
	}
	if err := q.RefreshBalance(ctx, inv.ID, s.now()); err != nil {
		return err
	}
	if err := s.logEvent(ctx, q, sess, "invoice.issued", inv.ID, map[string]any{"number": number, "kind": inv.Kind,
		"issue_date": inv.IssueDate, "currency": inv.Currency, "payable_total": inv.Payable()}); err != nil {
		return err
	}
	if agreement != nil {
		if err := q.MarkAgreementUsed(ctx, sess.Workspace.ID, agreement.ID, s.now()); errors.Is(err, store.ErrNotFound) {
			return errNoAgreement
		} else if err != nil {
			return err
		}
	}
	if len(prepaid) > 0 && inv.Kind != "credit_note" {
		ids := make([]string, len(prepaid))
		for i, p := range prepaid {
			ids[i] = p.ID
		}
		if err := q.MarkDeducted(ctx, sess.Workspace.ID, ids, inv.ID); errors.Is(err, store.ErrNotDeductible) {
			return cannotIssue([]reason{prepaymentUnavailable})
		} else if err != nil {
			return err
		}
	}
	switch {
	case inv.Kind == "corrected":
		if err := q.MovePayments(ctx, sess.Workspace.ID, credited.ID, inv.ID); err != nil {
			return err
		}
		if err := s.logEvent(ctx, q, sess, "invoice.replaced", credited.ID, map[string]any{"number": deref(credited.Number),
			"replaced_by": inv.ID, "replaced_by_number": number}); err != nil {
			return err
		}
		return q.MarkReplaced(ctx, sess.Workspace.ID, credited.ID, s.now())
	case credited != nil:
		if err := q.RefreshBalance(ctx, credited.ID, s.now()); err != nil {
			return err
		}
		if inv.Kind == "credit_note" {
			if err := s.logEvent(ctx, q, sess, "credit.issued", credited.ID, map[string]any{"number": deref(credited.Number),
				"credit_note_id": inv.ID, "credit_note_number": number, "amount": inv.Payable()}); err != nil {
				return err
			}
		}
		if inv.Kind == "credit_note" && credited.AmountCredited+inv.Payable() >= credited.Payable() {
			return q.ReleasePrepayments(ctx, sess.Workspace.ID, credited.ID)
		}
	}
	return nil
}

func cannotIssue(reasons []reason) error {
	return auth.Error(http.StatusUnprocessableEntity, "cannot_issue", "This document cannot be issued yet.",
		map[string]any{"reasons": reasons})
}

const prepaymentDeductedMessage = "Void the final invoice before adjusting this deducted prepayment."

var prepaymentUnavailable = reason{Code: "prepayment_unavailable", Field: "prepayment_ids",
	Message: "Deduct only paid prepayment invoices of this client and currency that are not deducted yet."}

// deduct recomputes a final invoice from its locked prepayments and saves its totals and prepaid_total.
func (s *Service) deduct(ctx context.Context, q store.Q, sess store.Session, inv *store.Invoice) error {
	compute(inv)
	return q.SaveDraft(ctx, sess.Workspace.ID, *inv, s.now())
}

// paymentReference: QRR with a QR-IBAN, else SCOR, from the number's year and sequence (unique per workspace).
func paymentReference(iban string, year int, seq int64) (string, string) {
	return reference(iban, fmt.Sprintf("%d%06d", year, seq))
}

func reference(iban, body string) (string, string) {
	if swissqr.IsQRIBAN(iban) {
		return "QRR", swissqr.QRR(body)
	}
	return "SCOR", swissqr.SCOR(body)
}

// draftReference: the reference a draft's QR bill shows. SIX requires a QRR with a QR-IBAN, so it gets the
// provisional one of the next number (what it becomes if issued next); with a normal IBAN a reference is
// optional (type NON), so none is shown rather than one that may later belong to another invoice.
func draftReference(ctx context.Context, q store.Q, workspaceID string, inv store.Invoice) (*string, error) {
	if inv.Payment.ReferenceType != "QRR" || inv.Payment.IBAN == nil {
		return nil, nil
	}
	year, _ := strconv.Atoi(inv.IssueDate[:4])
	series, _ := Series(inv.Kind)
	seq, err := q.PeekInvoiceSeq(ctx, workspaceID, series, year)
	if err != nil {
		return nil, err
	}
	_, ref := paymentReference(*inv.Payment.IBAN, year, seq)
	return &ref, nil
}

// reason is one thing blocking an issue: a stable code, the UI path it concerns (when there is one) and a
// sentence for the person.
type reason struct {
	Code    string `json:"code"`
	Field   string `json:"field,omitempty"`
	Message string `json:"message"`
}

// settingsReasons maps the settings' missing fields to reasons (IBAN and VAT number have their own codes).
var settingsReasons = map[string]reason{
	"iban":              {Code: "no_iban", Message: "Add the IBAN payments go to in the invoice settings."},
	"seller.vat_number": {Code: "seller_vat_missing", Message: "Add the seller's VAT number in the invoice settings, or issue without VAT."},
}

// issueReasons: every reason the draft cannot be issued; credited is its preceding invoice, prepaid the
// prepayments it deducts.
func issueReasons(inv store.Invoice, set Settings, client *store.Client, credited *store.Invoice, prepaid []store.Invoice,
	today string) []reason {
	reasons := []reason{}
	add := func(cond bool, code, field, message string) {
		if cond {
			reasons = append(reasons, reason{code, field, message})
		}
	}
	sellerVAT := false
	for _, f := range set.MissingFields {
		r, ok := settingsReasons[f]
		if !ok {
			r = reason{Code: "settings_incomplete", Message: "Complete the invoice settings: " + strings.ReplaceAll(f, "_", " ") + "."}
		}
		r.Field = "settings." + f
		sellerVAT = sellerVAT || r.Code == "seller_vat_missing"
		reasons = append(reasons, r)
	}
	add(!sellerVAT && inv.VATMode != invoicecalc.None && set.Seller.VATNumber == nil, "seller_vat_missing", "settings.seller.vat_number",
		settingsReasons["seller.vat_number"].Message)
	snapshot := client == nil && credited != nil && credited.Buyer != nil
	add(client == nil && !snapshot, "client_deleted", "client_id", "The client was deleted: choose another one.")
	if client != nil || snapshot {
		buyer := snapshotBuyer(client, credited)
		selfBilled := inv.Kind == "self_billed" || (credited != nil && credited.Kind == "self_billed")
		add(selfBilled && inv.VATMode != invoicecalc.None && buyer.VATNumber == nil, "supplier_vat_missing", "client.vat_number",
			"A self-billed VAT invoice needs the supplier's VAT number.")
		if client != nil {
			add(client.IsDraft, "client_draft", "client.address", "Complete the client's address: "+
				strings.ReplaceAll(strings.Join(client.MissingFields, ", "), "_", " ")+".")
		}
		hasReverse := false
		for _, l := range inv.Lines {
			hasReverse = hasReverse || l.VATCategory == "AE" || l.VATCategory == "K"
		}
		add(hasReverse && buyer.VATNumber == nil, "buyer_vat_missing", "client.vat_number",
			"Reverse-charge and intra-community lines need the client's VAT number.")
	}
	add(len(inv.Lines) == 0, "no_lines", "lines", "Add at least one line.")
	for i, l := range inv.Lines {
		add(strings.TrimSpace(l.Description) == "", "line_description_missing", fmt.Sprintf("lines.%d.description", i),
			fmt.Sprintf("Describe line %d.", i+1))
		add(l.Quantity <= 0, "line_quantity_zero", fmt.Sprintf("lines.%d.quantity", i), fmt.Sprintf("Line %d needs a quantity above 0.", i+1))
		add(slices.Contains(exemptCategories, l.VATCategory) && l.VATExemptionCode == nil, "line_exemption_missing",
			fmt.Sprintf("lines.%d.vat_exemption_code", i), fmt.Sprintf("Line %d needs a VAT exemption code (VATEX).", i+1))
	}
	market := unsupportedSeller(set.Seller.Country) // a seller saved before the country was refused
	add(market != "", "seller_country_unsupported", "settings.seller.country", market)
	add(inv.IssueDate > today, "issue_date_future", "issue_date", "The issue date cannot be in the future.")
	add(inv.DueDate < inv.IssueDate, "due_before_issue", "due_date", "The due date cannot be before the issue date.")
	add(inv.Total < 0, "prepayment_exceeds_invoice", "prepayment_ids", "The prepayments cannot exceed the final invoice's total.")
	if set.IBAN != nil && swissqr.IsQRIBAN(*set.IBAN) && Receivable(inv.Kind) {
		add(inv.Currency != "CHF", "qr_iban_currency", "currency",
			"A QR-IBAN only takes CHF: use a normal IBAN for "+inv.Currency+".")
	}
	add(needsPreceding(inv.Kind) && credited == nil, "preceding_required", "credited_invoice",
		"Choose the issued invoice this document refers to.")
	if credited != nil {
		add(credited.DeductedOn != nil && (inv.Kind == "credit_note" || inv.Kind == "corrected"),
			"prepayment_already_deducted", "credited_invoice", prepaymentDeductedMessage)
		add(credited.Status != "open" && credited.Status != "paid", "credited_invoice_state", "credited_invoice",
			"Only open or paid invoices can be credited, debited or corrected.")
		add(inv.Kind == "corrected" && credited.AmountCredited > 0, "credited_invoice_state", "credited_invoice",
			"An invoice with credit notes cannot be corrected: credit it instead.")
	}
	if credited != nil && inv.Kind == "credit_note" {
		left := credited.Payable() - credited.AmountCredited
		add(inv.Payable() > left, "credit_exceeds_invoice", "lines",
			"The credit note exceeds what is left to credit on the invoice ("+credited.Currency+" "+left.String()+").")
	}
	if slices.ContainsFunc(prepaid, func(p store.Invoice) bool {
		return p.Kind != "prepayment" || p.ClientID != inv.ClientID || p.Currency != inv.Currency || p.Status != "paid" ||
			(p.DeductedOn != nil && !((inv.Kind == "corrected" || inv.Kind == "credit_note") && credited != nil && p.DeductedOn.ID == credited.ID))
	}) {
		reasons = append(reasons, prepaymentUnavailable)
	}
	return append(reasons, scheduleReasons(inv)...)
}

// exemptCategories: the VAT categories whose lines must name their exemption (VATEX, BT-121) to be issued.
var exemptCategories = []string{"E", "AE", "K", "G"}

// defaultExemptions gives each category O line without a code VATEX-EU-O; true when a line changed.
func defaultExemptions(inv *store.Invoice) bool {
	changed := false
	for i := range inv.Lines {
		if l := &inv.Lines[i]; l.VATCategory == "O" && l.VATExemptionCode == nil {
			code := "VATEX-EU-O"
			l.VATExemptionCode, changed = &code, true
		}
	}
	return changed
}

// issuedCredits: the invoice's issued credit notes, with their VAT breakdowns.
func issuedCredits(ctx context.Context, q store.Q, workspaceID, today, invoiceID string) ([]store.Invoice, error) {
	items, _, err := q.ListInvoices(ctx, workspaceID, today, store.InvoiceFilter{Credited: invoiceID, Kind: "credit_note"}, 10_000, 0)
	if err != nil {
		return nil, err
	}
	var out []store.Invoice
	for _, it := range items {
		if it.Status == "draft" {
			continue
		}
		c, err := q.Invoice(ctx, workspaceID, it.ID, today, false)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// creditRateReasons: a credit note credits no VAT group (category and rate) beyond the net left of it on the invoice
// after its earlier credit notes.
func creditRateReasons(credit, credited store.Invoice, earlier []store.Invoice) []reason {
	type group struct {
		category string
		rate     invoicecalc.Percent
	}
	left := map[group]invoicecalc.Money{}
	for _, g := range credited.VATBreakdown {
		left[group{g.Category, g.Rate}] += g.TaxableAmount
	}
	for _, c := range earlier {
		for _, g := range c.VATBreakdown {
			left[group{g.Category, g.Rate}] -= g.TaxableAmount
		}
	}
	for _, g := range credit.VATBreakdown {
		if l := left[group{g.Category, g.Rate}]; g.TaxableAmount > l {
			return []reason{{Code: "credit_exceeds_rate", Field: "lines", Message: fmt.Sprintf(
				"The credit note credits more at %s %s%% than is left of it on the invoice (%s %s net).",
				g.Category, g.Rate.String(), credit.Currency, max(l, 0).String())}}
		}
	}
	return nil
}

// refunds: the credit note takes the credited invoice above its payable amount, so money goes back to the buyer.
func refunds(credit store.Invoice, credited *store.Invoice) bool {
	return credit.Kind == "credit_note" && credited != nil && credited.AmountPaid > 0 && credited.AmountPaid+credited.AmountCredited+credit.Payable() > credited.Payable()
}

func buyerOf(c store.Client) store.Party {
	email := c.BillingEmail
	if email == nil {
		email = c.Email
	}
	return store.Party{Name: c.Name, Street: deref(c.Street), StreetNumber: deref(c.StreetNumber), Apt: c.Apt, Zip: deref(c.Zip),
		City: deref(c.City), Country: deref(c.Country), VATNumber: c.VATNumber, Email: email, Phone: c.Phone,
		ElectronicAddress: c.ElectronicAddress, RegistrationNumber: c.RegistrationNumber, Region: c.Region}
}

// snapshotBuyer: the live client's party or, once the client is deleted, the buyer snapshot of the invoice the
// document refers to (issueReasons refuses a document with neither).
func snapshotBuyer(client *store.Client, credited *store.Invoice) store.Party {
	if client != nil {
		return buyerOf(*client)
	}
	return *credited.Buyer
}

// Title: "Rechnung", "Gutschrift"… in the document's language.
func Title(inv store.Invoice) string { return invoicepdf.TitleFor(inv) }

// document: what the PDF shows. Issued documents use their snapshots; drafts the current settings and client.
func (s *Service) document(inv store.Invoice, set Settings, draft bool, preceding *store.Invoice) invoicepdf.Document {
	d := invoicepdf.Document{Invoice: inv, Seller: set.Seller.Party, Phone: set.Seller.Phone, BankName: set.BankName, Draft: draft,
		Created: s.now(), Refund: refunds(inv, preceding), SelfBilled: preceding != nil && preceding.Kind == "self_billed"}
	if inv.Seller != nil {
		d.Seller = *inv.Seller
	}
	if inv.Buyer != nil {
		d.Buyer = *inv.Buyer
	}
	if inv.Kind == "self_billed" || d.SelfBilled {
		// Stored snapshots keep workspace/client roles; rendering needs the actual fiscal seller and buyer.
		d.Seller, d.Buyer = d.Buyer, d.Seller
	}
	if inv.Payment.QRBill && inv.Payment.IBAN != nil {
		addr := func(p store.Party) swissqr.Address {
			return swissqr.Address{Name: p.Name, Street: p.Street, Number: p.StreetNumber, Zip: p.Zip, City: p.City, Country: p.Country}
		}
		debtor := addr(d.Buyer)
		bill := swissqr.Bill{IBAN: *inv.Payment.IBAN, Creditor: addr(d.Seller), Amount: inv.Payable(), Currency: inv.Currency,
			Debtor: &debtor, ReferenceType: "NON", Message: strings.TrimSpace(Title(inv) + " " + deref(inv.Number))}
		if inv.Payment.Reference != nil {
			bill.ReferenceType, bill.Reference = inv.Payment.ReferenceType, *inv.Payment.Reference
		}
		d.Bill = &bill
	}
	return d
}

// ---- duplicate, credit note, void ----

func (s *Service) duplicate(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	src, err := s.db.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if !slices.Contains(creatable, src.Kind) {
		return invalidState("Credit notes, debit notes and corrections cannot be duplicated.")
	}
	client, err := s.db.Client(ctx, sess.Workspace.ID, src.ClientID)
	if errors.Is(err, store.ErrNotFound) {
		return invalidState("The client of this invoice was deleted.")
	} else if err != nil {
		return err
	}
	set, err := loadSettings(ctx, s.db.Q, sess.Workspace.ID)
	if err != nil {
		return err
	}
	inv, _ := newDraft(&client, set, s.today(sess.Workspace))
	inv.Kind = src.Kind
	terms := set.DefaultTermsDays
	if client.PaymentTermsDays != nil {
		terms = *client.PaymentTermsDays
	}
	inv.DueDate = addDays(inv.IssueDate, terms)
	inv.Currency, inv.Language, inv.VATMode, inv.DiscountPercent = src.Currency, src.Language, src.VATMode, src.DiscountPercent
	inv.ServiceDate, inv.ServiceDateEnd, inv.Reference, inv.Intro, inv.Footer, inv.Note = src.ServiceDate, src.ServiceDateEnd,
		src.Reference, src.Intro, src.Footer, src.Note
	inv.Lines = copyLines(src.Lines)
	inv.PaymentMethods = usableMethods(src.PaymentMethods, set, inv.Currency)
	if src.Instalments != nil { // the schedule without its references
		inv.Instalments = &store.InstalmentSchedule{Interval: src.Instalments.Interval}
		for _, it := range src.Instalments.Items {
			inv.Instalments.Items = append(inv.Instalments.Items, store.InstalmentItem{Seq: it.Seq, DueDate: it.DueDate, Amount: it.Amount})
		}
	}
	compute(&inv)
	syncSchedule(&inv)
	if err := s.db.Tx(ctx, func(q store.Q) error { return saveDraft(ctx, q, sess, inv, s.now()) }); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, inv.ID)
}

func copyLines(src []store.InvoiceLine) []store.InvoiceLine {
	lines := make([]store.InvoiceLine, len(src))
	for i, l := range src {
		l.ID = auth.NewID("lin")
		lines[i] = l
	}
	return lines
}

// creditDraft: a credit note draft against an issued invoice, for its lines (all when lines is nil). It keeps
// the invoice's client, currency, VAT mode and document discount; the reason becomes its intro.
func creditDraft(src store.Invoice, lines []store.InvoiceLine, reason *string, today string) store.Invoice {
	inv := store.Invoice{ID: auth.NewID("inv"), Kind: "credit_note", Status: "draft", ClientID: src.ClientID, Client: src.Client,
		CreditedInvoice: &store.InvoiceRef{ID: src.ID, Number: deref(src.Number)}, IssueDate: today, DueDate: today,
		ServiceDate: src.ServiceDate, ServiceDateEnd: src.ServiceDateEnd, Currency: src.Currency, Language: src.Language,
		VATMode: src.VATMode, Reference: src.Reference, Intro: reason, Footer: src.Footer, DiscountPercent: src.DiscountPercent,
		Lines: lines}
	if lines == nil {
		inv.Lines = copyLines(src.Lines)
		inv.Prepayments = src.Prepayments
	}
	compute(&inv)
	return inv
}

func (s *Service) creditNote(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Lines  json.RawMessage `json:"lines"`
		Reason json.RawMessage `json:"reason"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx := r.Context()
	var id string
	err := s.db.Tx(ctx, func(q store.Q) error {
		src, err := q.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if !Receivable(src.Kind) || (src.Status != "open" && src.Status != "paid") {
			return invalidState("Only open or paid invoices can be credited.")
		}
		if src.DeductedOn != nil {
			return invalidState(prepaymentDeductedMessage)
		}
		set, err := loadSettings(ctx, q, sess.Workspace.ID)
		if err != nil {
			return err
		}
		p := newParser()
		var reason *string
		if body.Reason != nil {
			reason = p.text("reason", body.Reason, 1000, nil)
		}
		var lines []store.InvoiceLine
		if body.Lines != nil {
			if lines, err = parseLines(p, body.Lines, src.VATMode, set); err != nil {
				return err
			}
			if lines == nil {
				lines = []store.InvoiceLine{}
			}
			if len(lines) == 0 {
				p.fail("lines", "Add at least one line, or leave lines out to credit the whole invoice.")
			}
		}
		if err := p.err(); err != nil {
			return err
		}
		inv := creditDraft(src, lines, reason, s.today(sess.Workspace))
		if left := src.Payable() - src.AmountCredited; inv.Payable() > left {
			return validationFailed(map[string]string{"lines": "The credit note exceeds what is left to credit (" + src.Currency + " " +
				left.String() + ")."})
		}
		id = inv.ID
		return saveDraft(ctx, q, sess, inv, s.now())
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}

// void ends an open document without payments or credits, in one transaction: a receivable or self-billed one by
// a full credit note (a final invoice's is net of its prepayments, which are then released; a fully prepaid final
// is "paid" without payments and can be voided too), a proforma by closing it directly. Credit notes cannot be voided.
func (s *Service) void(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	var body struct {
		Reason json.RawMessage `json:"reason"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, id := r.Context(), r.PathValue("id")
	var pdf string
	err := s.db.Tx(ctx, func(q store.Q) error {
		src, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		switch {
		case src.Kind == "credit_note" || (src.Status != "open" && !(src.Kind == "invoice" && src.Status == "paid" && len(src.Prepayments) > 0)):
			return invalidState("Only open invoices can be voided.")
		case src.AmountPaid > 0 || src.AmountCredited > 0:
			return invalidState("This invoice has payments or credit notes: correct it with a credit note instead.")
		}
		p := newParser()
		var reason *string
		if body.Reason != nil {
			reason = p.text("reason", body.Reason, 1000, nil)
		}
		if err := p.err(); err != nil {
			return err
		}
		if err := checkOpen(ctx, q, sess.Workspace.ID, s.today(sess.Workspace)); err != nil {
			return err
		}
		if err := s.logEvent(ctx, q, sess, "invoice.voided", id, map[string]any{"number": deref(src.Number), "reason": reason}); err != nil {
			return err
		}
		if src.Kind == "proforma" {
			return q.CloseVoid(ctx, sess.Workspace.ID, id, s.now())
		}
		credit := creditDraft(src, nil, reason, s.today(sess.Workspace))
		if err := saveDraft(ctx, q, sess, credit, s.now()); err != nil {
			return err
		}
		credit, err = q.Invoice(ctx, sess.Workspace.ID, credit.ID, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if err := s.issueDraft(ctx, q, sess, credit, &pdf); err != nil {
			return err
		}
		return q.ReleasePrepayments(ctx, sess.Workspace.ID, id)
	})
	err = s.settlePDF(ctx, pdf, err)
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}
