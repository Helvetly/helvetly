package invoices

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// newDraft: an empty invoice draft with the defaults of the settings and the client (nil for a preview without
// one); also returns the payment terms in days.
func newDraft(client *store.Client, set Settings, today string) (store.Invoice, int) {
	inv := store.Invoice{ID: auth.NewID("inv"), Kind: "invoice", Status: "draft", IssueDate: today, Currency: set.Currency,
		Language: set.Language, VATMode: set.DefaultVATMode, Footer: set.Footer, Lines: []store.InvoiceLine{},
		VATBreakdown: []invoicecalc.Group{}, Payments: []store.Payment{}, RemindersEnabled: set.Instalments.RemindersEnabled}
	if !set.VATRegistered {
		inv.VATMode = invoicecalc.None
	}
	terms := set.DefaultTermsDays
	if client != nil {
		inv.ClientID, inv.Client = client.ID, store.InvoiceClient{ID: client.ID, Number: client.Number, Name: client.Name}
		if client.Currency != nil {
			inv.Currency = *client.Currency
		}
		if client.Language != nil {
			inv.Language = *client.Language
		}
		if client.PaymentTermsDays != nil {
			terms = *client.PaymentTermsDays
		}
		inv.Reference = client.LeitwegID // a German public body's routing ID is the buyer reference (BT-10)
	}
	inv.DueDate = addDays(today, terms)
	return inv, terms
}

// clientFor reads the live client an input names; a missing one is a validation error on client_id.
func clientFor(ctx context.Context, q store.Q, workspaceID string, body map[string]json.RawMessage) (*store.Client, error) {
	p := newParser()
	id := p.required("client_id", body["client_id"], 100, nil, "Choose a client.")
	if err := p.err(); err != nil {
		return nil, err
	}
	c, err := q.Client(ctx, workspaceID, id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, validationFailed(map[string]string{"client_id": "Choose one of your clients."})
	}
	return &c, err
}

// draftFromInput builds a new draft from an InvoiceInput; withClient false allows a preview without a client.
func (s *Service) draftFromInput(ctx context.Context, sess store.Session, body map[string]json.RawMessage, withClient bool) (store.Invoice, error) {
	set, err := loadSettings(ctx, s.db.Q, sess.Workspace.ID)
	if err != nil {
		return store.Invoice{}, err
	}
	var client *store.Client
	if _, ok := body["client_id"]; ok || withClient {
		if client, err = clientFor(ctx, s.db.Q, sess.Workspace.ID, body); err != nil {
			return store.Invoice{}, err
		}
	}
	inv, terms := newDraft(client, set, s.today(sess.Workspace))
	if raw, ok := body["kind"]; ok {
		if json.Unmarshal(raw, &inv.Kind) != nil || !slices.Contains(creatable, inv.Kind) {
			return inv, validationFailed(map[string]string{"kind": "Choose one of " + strings.Join(creatable, ", ") +
				"; credit notes, debit notes and corrections come from an issued invoice."})
		}
	}
	if err := applyInput(&inv, body, set); err != nil {
		return inv, err
	}
	if err := resolveContractDocument(ctx, s.db.Q, sess.Workspace.ID, &inv, body); err != nil {
		return inv, err
	}
	if err := s.resolvePrepayments(ctx, s.db.Q, sess, &inv, body); err != nil {
		return inv, err
	}
	if _, ok := body["due_date"]; !ok {
		inv.DueDate = addDays(inv.IssueDate, terms)
	}
	if _, ok := body["payment_methods"]; !ok {
		inv.PaymentMethods = defaultMethods(set, inv.Currency)
	}
	inv.PaymentMethods = usableMethods(inv.PaymentMethods, set, inv.Currency)
	compute(&inv)
	syncSchedule(&inv)
	allocate(&inv, s.today(sess.Workspace))
	draftPayment(&inv, set)
	return inv, nil
}

func (s *Service) decodeInput(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool, error) {
	var raw json.RawMessage
	if !s.auth.Decode(w, r, &raw) {
		return nil, false, nil
	}
	body, err := object(raw, "the invoice", invoiceKeys...)
	return body, err == nil, err
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok, err := s.decodeInput(w, r)
	if !ok {
		return err
	}
	inv, err := s.draftFromInput(r.Context(), sess, body, true)
	if err != nil {
		return err
	}
	if err := s.db.Tx(r.Context(), func(q store.Q) error { return saveDraft(r.Context(), q, sess, inv, s.now()) }); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, inv.ID)
}

// preview runs the computation on an input without writing anything.
func (s *Service) preview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok, err := s.decodeInput(w, r)
	if !ok {
		return err
	}
	inv, err := s.draftFromInput(r.Context(), sess, body, false)
	if err != nil {
		return err
	}
	inv.ID = ""
	auth.WriteJSON(w, http.StatusOK, data(withCode(inv)))
	return nil
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok, err := s.decodeInput(w, r)
	if !ok {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockInvoiceSettings(ctx, sess.Workspace.ID); err != nil {
			return err
		}
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if inv.Status != "draft" {
			if _, ok := body["reminders_enabled"]; ok && len(body) == 1 {
				return setReminders(ctx, q, sess.Workspace.ID, inv.ID, body["reminders_enabled"])
			}
			return errLocked
		}
		if planned, err := planSource(ctx, q, sess.Workspace.ID, inv); err != nil {
			return err
		} else if planned {
			return errPlanned
		}
		set, err := loadSettings(ctx, q, sess.Workspace.ID)
		if err != nil {
			return err
		}
		clientID := inv.ClientID
		if err := applyInput(&inv, body, set); err != nil {
			return err
		}
		if inv.ClientID != clientID {
			if _, err := clientFor(ctx, q, sess.Workspace.ID, body); err != nil {
				return err
			}
		}
		if err := resolveContractDocument(ctx, q, sess.Workspace.ID, &inv, body); err != nil {
			return err
		}
		if err := s.resolvePrepayments(ctx, q, sess, &inv, body); err != nil {
			return err
		}
		inv.PaymentMethods = usableMethods(inv.PaymentMethods, set, inv.Currency)
		compute(&inv)
		syncSchedule(&inv)
		if err := saveDraft(ctx, q, sess, inv, s.now()); err != nil {
			return err
		}
		if _, ok := body["reminders_enabled"]; ok && len(body) == 1 { // not what was approved
			return nil
		}
		return s.approvals.Reset(ctx, q, sess, approvalDoc(inv))
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

// resolveContractDocument names the document the input's contract_document_id links: a document of the workspace,
// not in the trash and not an HR file; anything else is a field error that does not tell whether the id exists.
func resolveContractDocument(ctx context.Context, q store.Q, workspaceID string, inv *store.Invoice,
	body map[string]json.RawMessage) error {
	if _, ok := body["contract_document_id"]; !ok || inv.ContractDocument == nil {
		return nil
	}
	d, err := q.Document(ctx, workspaceID, inv.ContractDocument.ID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && d.DeletedAt != nil) {
		return validationFailed(map[string]string{"contract_document_id": "Choose a document of this workspace."})
	}
	if err != nil {
		return err
	}
	inv.ContractDocument.Name = d.Name
	return nil
}

// resolvePrepayments reads the prepayments the input picked (when it has prepayment_ids); an id that is not a
// prepayment invoice of the workspace is a field error. Paid, client and currency are checked on issue.
func (s *Service) resolvePrepayments(ctx context.Context, q store.Q, sess store.Session, inv *store.Invoice,
	body map[string]json.RawMessage) error {
	if _, ok := body["prepayment_ids"]; !ok {
		return nil
	}
	for i, ref := range inv.Prepayments {
		p, err := q.Invoice(ctx, sess.Workspace.ID, ref.ID, s.today(sess.Workspace), false)
		if errors.Is(err, store.ErrNotFound) {
			return validationFailed(map[string]string{"prepayment_ids": "Choose prepayment invoices of this workspace."})
		}
		if err != nil {
			return err
		}
		if ok, err := isPrepayment(ctx, q, sess.Workspace.ID, s.today(sess.Workspace), p); err != nil {
			return err
		} else if !ok {
			return validationFailed(map[string]string{"prepayment_ids": "Choose prepayment invoices of this workspace."})
		}
		inv.Prepayments[i] = store.PrepaymentRef{ID: p.ID, Number: p.Number, PayableTotal: p.Payable(), Status: p.Status,
			VATBreakdown: p.VATBreakdown}
	}
	compute(inv)
	return validateTotals(*inv)
}

// isPrepayment: a prepayment invoice, or a correction that replaced one (it carries the prepayment on).
func isPrepayment(ctx context.Context, q store.Q, workspaceID, today string, p store.Invoice) (bool, error) {
	if p.Kind != "corrected" || p.CreditedInvoice == nil {
		return p.Kind == "prepayment", nil
	}
	original, err := q.Invoice(ctx, workspaceID, p.CreditedInvoice.ID, today, false)
	if err != nil {
		return false, err
	}
	return isPrepayment(ctx, q, workspaceID, today, original)
}

// setReminders: the one change an issued invoice takes, its reminders on or off.
func setReminders(ctx context.Context, q store.Q, workspaceID, id string, raw json.RawMessage) error {
	var on bool
	if isNull(raw) || json.Unmarshal(raw, &on) != nil {
		return validationFailed(map[string]string{"reminders_enabled": "Choose true or false."})
	}
	if on {
		if err := q.RequireFeature(ctx, workspaceID, store.FeatureInvoiceReminders); err != nil {
			return err
		}
	}
	return q.SetRemindersEnabled(ctx, id, on)
}

// saveDraft saves the draft, its reminders switch, its schedule and its prepayment basis together, including a full
// credit of a final invoice.
// wrote records the session's person as an author of the draft: an author never approves it (internal/approvals).
func wrote(ctx context.Context, q store.Q, sess store.Session, id string) error {
	if sess.User.ID == "" { // a job
		return nil
	}
	return q.AddApprovalAuthor(ctx, sess.Workspace.ID, id, sess.User.ID)
}

func saveDraft(ctx context.Context, q store.Q, sess store.Session, inv store.Invoice, now time.Time) error {
	if err := q.SaveDraft(ctx, sess.Workspace.ID, inv, now); err != nil {
		return err
	}
	if err := wrote(ctx, q, sess, inv.ID); err != nil {
		return err
	}
	if err := q.SetRemindersEnabled(ctx, inv.ID, inv.RemindersEnabled); err != nil {
		return err
	}
	interval, items := "", []store.InstalmentItem(nil)
	if inv.Instalments != nil {
		interval, items = inv.Instalments.Interval, inv.Instalments.Items
	}
	if len(items) > 0 { // a schedule issues its instalments by itself: an instalment plan
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureInvoiceInstalments); err != nil {
			return err
		}
	}
	if err := q.SetInstalments(ctx, inv.ID, interval, items); err != nil {
		return err
	}
	ids := make([]string, len(inv.Prepayments))
	for i, p := range inv.Prepayments {
		ids[i] = p.ID
	}
	return q.SetPrepayments(ctx, inv.ID, ids)
}

// draftFrom: a new draft of the kind from an issued document, with its client, currency, language, VAT mode,
// discount, lines and payment methods, dated today with the same payment terms; a debit note or a correction
// refers to it as the preceding invoice.
func (s *Service) draftFrom(src store.Invoice, kind string) store.Invoice {
	// shortcut: today in Europe/Zurich (the signature has no workspace); callers with a session may redate it.
	today := store.Workspace{Timezone: "Europe/Zurich"}.Today(s.now())
	inv := store.Invoice{ID: auth.NewID("inv"), Kind: kind, Status: "draft", ClientID: src.ClientID, Client: src.Client,
		IssueDate: today, DueDate: addDays(today, daysBetween(src.IssueDate, src.DueDate)), Currency: src.Currency,
		Language: src.Language, VATMode: src.VATMode, DiscountPercent: src.DiscountPercent, Footer: src.Footer,
		Lines: copyLines(src.Lines), PaymentMethods: src.PaymentMethods, Payments: []store.Payment{}}
	if needsPreceding(kind) {
		inv.CreditedInvoice = &store.InvoiceRef{ID: src.ID, Number: deref(src.Number)}
	}
	if kind == "corrected" { // the correction deducts the same prepayments, taken over when it is issued
		inv.Prepayments = src.Prepayments
	}
	compute(&inv)
	return inv
}

func daysBetween(from, to string) int {
	f, err1 := time.Parse(time.DateOnly, from)
	t, err2 := time.Parse(time.DateOnly, to)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(t.Sub(f).Hours() / 24)
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockInvoiceSettings(ctx, sess.Workspace.ID); err != nil {
			return err
		}
		inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if inv.Status != "draft" {
			return errLocked
		}
		if planned, err := planSource(ctx, q, sess.Workspace.ID, inv); err != nil {
			return err
		} else if planned {
			return errPlanned
		}
		deleted, err := q.DeleteDraft(ctx, sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if !deleted {
			return errLocked
		}
		return s.approvals.Forget(ctx, q, sess.Workspace.ID, id)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- list, export, summary ----

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f, err := parseFilter(q)
	if err != nil {
		return err
	}
	page, err := intParam(q, "page", 1, 1, 1_000_000)
	if err != nil {
		return err
	}
	size, err := intParam(q, "page_size", 50, 1, 200)
	if err != nil {
		return err
	}
	list, total, err := s.db.ListInvoices(r.Context(), sess.Workspace.ID, s.today(sess.Workspace), f, size, (page-1)*size)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": withCodes(list),
		"meta": map[string]int{"page": page, "page_size": size, "total": total, "total_pages": (total + size - 1) / size}})
	return nil
}

func intParam(q url.Values, key string, fallback, lo, hi int) (int, error) {
	v := q.Get(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		return 0, badRequest(key + " must be a whole number from " + strconv.Itoa(lo) + " to " + strconv.Itoa(hi) + ".")
	}
	return n, nil
}

// listParam: a repeatable parameter, also accepting comma-separated values.
func listParam(q url.Values, key string) []string {
	var out []string
	for _, v := range q[key] {
		for part := range strings.SplitSeq(v, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

// parseFilter reads the list query shared by the list and the export.
func parseFilter(q url.Values) (store.InvoiceFilter, error) {
	f := store.InvoiceFilter{Search: q.Get("search"), Kind: q.Get("kind"), ClientID: q.Get("client_id"), Sort: q.Get("sort"),
		Credited:   q.Get("credited_invoice_id"),
		IssuedFrom: q.Get("issued_from"), IssuedTo: q.Get("issued_to"), IDs: listParam(q, "ids"), Unlinked: q.Get("unlinked") == "1"}
	for _, v := range listParam(q, "status") {
		if !slices.Contains([]string{"draft", "open", "paid", "void", "replaced", "overdue", "refund_due"}, v) {
			return f, badRequest("status must be draft, open, paid, void, replaced, overdue or refund_due.")
		}
		f.Statuses = append(f.Statuses, v)
	}
	if f.Kind != "" && !validKind(f.Kind) {
		return f, badRequest("kind must be invoice, partial, prepayment, debit_note, corrected, credit_note, proforma or self_billed.")
	}
	for _, d := range []string{f.IssuedFrom, f.IssuedTo} {
		if _, msg := date(d); d != "" && msg != "" {
			return f, badRequest("issued_from and issued_to must be dates as YYYY-MM-DD.")
		}
	}
	if _, ok := store.InvoiceSorts[strings.TrimPrefix(f.Sort, "-")]; f.Sort != "" && !ok {
		return f, badRequest("sort must be one of number, issue_date, due_date, total, client, created_at, optionally prefixed with -.")
	}
	return f, nil
}

var csvHeader = []string{"number", "kind", "type_code", "status", "client_number", "client", "issue_date", "due_date", "currency", "net_total",
	"vat_total", "total", "rounding_amount", "payable_total", "amount_paid", "amount_due", "refund_due", "reference", "sent_at"}

func (s *Service) export(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	f, err := parseFilter(r.URL.Query())
	if err != nil {
		return err
	}
	out := csv.NewWriter(w)
	started := false
	start := func() {
		if started {
			return
		}
		started = true
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="invoices-`+s.today(sess.Workspace)+`.csv"`)
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("\uFEFF")) // a BOM, so spreadsheet apps read UTF-8
		_ = out.Write(csvHeader)
	}

	err = s.db.EachInvoice(r.Context(), sess.Workspace.ID, s.today(sess.Workspace), f, 0, 0, func(i store.InvoiceListItem) error {
		start()
		status := i.Status
		if i.IsOverdue {
			status = "overdue"
		}
		sent := ""
		if i.SentAt != nil {
			sent = i.SentAt.Format(time.RFC3339)
		}
		row := []string{deref(i.Number), i.Kind, TypeCode(i.Kind), status, strconv.FormatInt(i.Client.Number, 10), i.Client.Name, i.IssueDate, i.DueDate,
			i.Currency, i.NetTotal.String(), i.VATTotal.String(), i.Total.String(), i.RoundingAmount.String(), i.PayableTotal.String(), i.Paid.String(), i.AmountDue.String(), i.RefundDue.String(),
			deref(i.Reference), sent}
		for k := range row {
			row[k] = cell(row[k])
		}
		return out.Write(row) // a write error means the client left
	})
	if err != nil && started {
		panic(http.ErrAbortHandler) // the CSV is half sent: cut the connection, so it does not look complete
	}
	if err != nil {
		return err
	}
	start()
	out.Flush()
	return nil
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// cell keeps a spreadsheet from running a value as a formula: text starting with = + - @ tab or CR gets a
// leading apostrophe, unless it is just a number.
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}

func (s *Service) summary(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	currency := r.URL.Query().Get("currency")
	if currency == "" {
		set, err := loadSettings(r.Context(), s.db.Q, sess.Workspace.ID)
		if err != nil {
			return err
		}
		currency = set.Currency
	}
	currency, msg := clients.NormaliseCurrency(currency)
	if msg != "" {
		return badRequest("currency must be a three-letter ISO code such as CHF.")
	}
	today := s.today(sess.Workspace)
	clientID := r.URL.Query().Get("client_id")
	sum, err := s.db.InvoiceSummary(r.Context(), sess.Workspace.ID, currency, today, clientID)
	if err != nil {
		return err
	}
	if name := r.URL.Query().Get("period"); name != "" {
		date, _ := time.Parse(time.DateOnly, today)
		from, to, prevFrom, prevTo, ok := period(name, date)
		if !ok {
			return badRequest("period must be this_month, last_month, this_quarter, this_year or last_12_months.")
		}
		sum.Period = &store.PeriodSummary{Name: name, From: from.Format(time.DateOnly), To: to.Format(time.DateOnly)}
		if err := s.db.InvoicePeriod(r.Context(), sess.Workspace.ID, currency, clientID, sum.Period,
			prevFrom.Format(time.DateOnly), prevTo.Format(time.DateOnly)); err != nil {
			return err
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(sum))
	return nil
}
