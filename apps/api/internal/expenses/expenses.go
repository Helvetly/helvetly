// Package expenses is a workspace's expenses: drafts booked into an immutable record, VAT lines with the
// deductible input tax, foreign currencies, payments, receipts and categories (docs/expenses-contract.md).
package expenses

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage keeps the receipts (internal/storage in production, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	storage.Source // Open, PresignDownload, ProxyDownloads
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

type Service struct {
	db        *store.Store
	auth      Auth
	files     Storage
	approvals *approvals.Service // nil: nothing is gated
	log       *slog.Logger
	now       func() time.Time
}

// SetApprovals is startup wiring: draft expenses whose policy applies are approved before they are booked.
func (s *Service) SetApprovals(a *approvals.Service) { s.approvals = a }

func approvalDoc(e store.Expense) approvals.Doc {
	supplier := ""
	if e.SupplierName != nil {
		supplier = *e.SupplierName
	} else if e.Description != nil {
		supplier = *e.Description
	}
	return approvals.Doc{Type: "expense", Subject: "expense", Resource: "expenses", ID: e.ID, Draft: e.Status == "draft",
		Kind: "expense", Client: supplier, Currency: e.Currency, Total: e.Total}
}

func (s *Service) approvalLoad(ctx context.Context, q store.Q, sess store.Session, id string, lock bool) (approvals.Doc, error) {
	e, err := q.Expense(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), lock)
	return approvalDoc(e), err
}

// changed: the session's person changed the locked draft: they become one of its authors, who never approve it, and
// its open approval request ends (internal/approvals).
func (s *Service) changed(ctx context.Context, q store.Q, sess store.Session, e store.Expense) error {
	if e.Status != "draft" {
		return nil
	}
	if err := q.AddApprovalAuthor(ctx, sess.Workspace.ID, e.ID, sess.User.ID); err != nil {
		return err
	}
	return s.approvals.Reset(ctx, q, sess, approvalDoc(e))
}

func New(db *store.Store, a Auth, files Storage, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// today is the civil date in the workspace's time zone.
func (s *Service) today(ws store.Workspace) string { return ws.Today(s.now()) }

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				switch {
				case errors.Is(err, store.ErrNotFound):
					err = auth.ErrNotFound
				case errors.Is(err, store.ErrPeriodClosed):
					err = errPeriodClosed
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/expenses", s.list)
	handle("GET /api/v1/expenses/summary", s.summary)
	handle("GET /api/v1/expenses/export", s.export)
	handle("POST /api/v1/expenses/preview", s.preview)
	handle("POST /api/v1/expenses", s.create)
	handle("POST /api/v1/expenses/bulk", s.bulk)
	handle("GET /api/v1/expenses/{id}", s.get)
	handle("PATCH /api/v1/expenses/{id}", s.update)
	handle("DELETE /api/v1/expenses/{id}", s.delete)
	handle("POST /api/v1/expenses/{id}/book", s.book)
	handle("POST /api/v1/expenses/{id}/void", s.void)
	handle("POST /api/v1/expenses/{id}/duplicate", s.duplicate)
	handle("GET /api/v1/expenses/{id}/receipts", s.listReceipts)
	handle("POST /api/v1/expenses/{id}/receipts", s.uploadReceipts)
	handle("GET /api/v1/expenses/{id}/receipts/{receipt_id}", s.downloadReceipt)
	handle("DELETE /api/v1/expenses/{id}/receipts/{receipt_id}", s.deleteReceipt)
	handle("GET /api/v1/expense-categories", s.categories)
	handle("POST /api/v1/expense-categories", s.createCategory)
	handle("PATCH /api/v1/expense-categories/{id}", s.updateCategory)
	if s.approvals != nil {
		s.approvals.Routes(func(p string, h func(http.ResponseWriter, *http.Request, store.Session) error) { handle(p, h) },
			"/api/v1/expenses/{id}/approval", s.approvalLoad)
	}
}

var (
	errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can do this.", nil)
	errLocked    = auth.Error(http.StatusConflict, "expense_locked",
		"A booked expense keeps its amounts: void it and book a corrected copy.", nil)
)

var errPeriodClosed = auth.Error(http.StatusConflict, "period_closed",
	"This expense's date is in a closed period: reopen the month first.", nil)

func invalidState(msg string) error {
	return auth.Error(http.StatusConflict, "invalid_state", msg, nil)
}

func canManage(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	e, err := s.db.Expense(r.Context(), sess.Workspace.ID, id, s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if e.DuplicateOf, err = s.db.DuplicateOf(r.Context(), sess.Workspace.ID, e); err != nil {
		return err
	}
	localize(language(r), e.Category)
	auth.WriteJSON(w, status, data(e))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

// checkRefs: each named category, the expense's and its lines', is the workspace's and active (unless the expense
// already had it), and the named member belongs to the workspace. before lists the categories the expense had.
func (s *Service) checkRefs(ctx context.Context, q store.Q, sess store.Session, e *store.Expense, before []string, rf refs) error {
	invalid := map[string]string{}
	var failed error
	category := func(key, id string) *store.CategoryRef {
		c, err := q.ExpenseCategory(ctx, sess.Workspace.ID, id)
		switch {
		case errors.Is(err, store.ErrNotFound):
			invalid[key] = "Choose one of the workspace's categories."
		case err != nil:
			failed = err
		case c.IsArchived && !slices.Contains(before, c.ID):
			invalid[key] = "This category is archived: choose another."
		default:
			return &c.CategoryRef
		}
		return nil
	}
	if rf.category && rf.categoryID != nil {
		e.Category = category("category_id", *rf.categoryID)
	}
	if rf.lines {
		for i := range e.Lines {
			if l := &e.Lines[i]; l.CategoryID != nil {
				l.Category = category(fmt.Sprintf("lines.%d.category_id", i), *l.CategoryID)
			}
		}
	}
	if failed != nil {
		return failed
	}
	if rf.member && rf.memberID != nil {
		name, err := q.MemberName(ctx, sess.Workspace.ID, *rf.memberID)
		switch {
		case errors.Is(err, store.ErrNotFound):
			invalid["paid_by_member_id"] = "Choose a member of this workspace."
		case err != nil:
			return err
		default:
			e.PaidByMember = &store.Person{ID: *rf.memberID, Name: name}
		}
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}
	return nil
}

func (s *Service) decode(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil, false
	}
	if body == nil {
		body = map[string]json.RawMessage{}
	}
	return body, true
}

func (s *Service) preview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok := s.decode(w, r)
	if !ok {
		return nil
	}
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	e := newDraft(d, sess.User)
	e.ID = ""
	rf, err := applyInput(&e, body, d, s.today(sess.Workspace))
	if err != nil {
		return err
	}
	if err := s.checkRefs(r.Context(), s.db.Q, sess, &e, nil, rf); err != nil {
		return err
	}
	e.Derive(s.today(sess.Workspace))
	auth.WriteJSON(w, http.StatusOK, data(e))
	return nil
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok := s.decode(w, r)
	if !ok {
		return nil
	}
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	e := newDraft(d, sess.User)
	rf, err := applyInput(&e, body, d, s.today(sess.Workspace))
	if err != nil {
		return err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := s.checkRefs(r.Context(), q, sess, &e, nil, rf); err != nil {
			return err
		}
		return q.CreateExpense(r.Context(), sess.Workspace.ID, &e, s.now())
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, e.ID)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok := s.decode(w, r)
	if !ok {
		return nil
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		d, err := q.Defaults(r.Context(), sess.Workspace.ID)
		if err != nil {
			return err
		}
		if e.Status != "draft" { // a booked expense keeps the base currency and amounts it was booked with
			d.Currency = e.Base.Currency
		}
		before, paid := categoriesOf(e), paymentOf(e)
		old := e
		rf, err := applyInput(&e, body, d, s.today(sess.Workspace))
		if err != nil {
			return err
		}
		if err := s.checkRefs(r.Context(), q, sess, &e, before, rf); err != nil {
			return err
		}
		if err := s.save(r.Context(), q, sess, e, paid); err != nil {
			return err
		}
		if err := s.changed(r.Context(), q, sess, e); err != nil {
			return err
		}
		return s.refile(r.Context(), q, sess, old, e)
	})
	if err != nil {
		return err
	}
	return s.get(w, r, sess)
}

// refile moves the expense's linked files that still sit in the folder Expenses/<year>/<category> its old category and
// date gave to the new one (moving tags it anew); a file the user moved elsewhere stays.
func (s *Service) refile(ctx context.Context, q store.Q, sess store.Session, old, e store.Expense) error {
	oldYear, year := store.ExpenseYear(old.DocumentDate, s.today(sess.Workspace)), store.ExpenseYear(e.DocumentDate, s.today(sess.Workspace))
	if equalRef(old.CategoryID, e.CategoryID) && oldYear == year {
		return nil
	}
	from, err := q.ExistingExpenseYearFolder(ctx, sess.Workspace.ID, old.CategoryID, oldYear)
	if err != nil {
		return err
	}
	docs, err := q.ExpenseDocuments(ctx, sess.Workspace.ID, e.ID)
	if err != nil {
		return err
	}
	for _, d := range docs { // the category and year tags follow, also where the file was moved elsewhere
		if err := q.AutoTag(ctx, sess.Workspace.ID, d.ID, s.now()); err != nil {
			return err
		}
	}
	var to *string
	for _, d := range docs {
		if d.FolderID == nil || *d.FolderID != from {
			continue
		}
		if to == nil {
			id, err := q.ExpenseYearFolder(ctx, sess.Workspace.ID, e.CategoryID, year, sess.User.ID, s.now())
			if err != nil {
				return err
			}
			to = &id
		}
		name, err := q.FreeFileName(ctx, sess.Workspace.ID, to, d.Name)
		if err != nil {
			return err
		}
		if err := q.UpdateDocument(ctx, sess.Workspace.ID, d.ID, name, to, s.now()); err != nil {
			return err
		}
	}
	return nil
}

func equalRef(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.db.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if e.Status != "draft" {
		return invalidState("Only drafts can be deleted: void a booked expense instead.")
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if _, err := q.DeleteDraftExpense(r.Context(), sess.Workspace.ID, e.ID, s.now()); err != nil {
			return err
		}
		return s.approvals.Forget(r.Context(), q, sess.Workspace.ID, e.ID)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) book(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if e.Status != "draft" {
			return invalidState("This expense is already booked.")
		}
		if reasons := bookReasons(e, s.today(sess.Workspace)); len(reasons) > 0 {
			return auth.Error(http.StatusUnprocessableEntity, "cannot_book", "This expense cannot be booked yet.",
				map[string]any{"reasons": reasons})
		}
		if err := s.approvals.Gate(r.Context(), q, sess.Workspace.ID, approvalDoc(e)); err != nil {
			return err
		}
		return s.bookOne(r.Context(), q, sess, e)
	})
	if err != nil {
		return err
	}
	s.retainReceipts(r.Context(), r.PathValue("id"))
	return s.get(w, r, sess)
}

func (s *Service) void(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	reason := strings.TrimSpace(body.Reason)
	if n := len([]rune(reason)); n < 1 || n > 500 {
		return validationFailed(map[string]string{"reason": "Say why, in up to 500 characters."})
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if e.Status != "booked" {
			return invalidState("Only a booked expense can be voided; delete a draft instead.")
		}
		if err := q.CheckOpen(r.Context(), sess.Workspace.ID, *e.DocumentDate); err != nil {
			return err
		}
		if err := q.VoidExpense(r.Context(), e.ID, sess.User.ID, reason, s.now()); err != nil {
			return err
		}
		return s.logEvent(r.Context(), q, sess, "expense.voided", e, map[string]any{"number": e.Number, "reason": reason})
	})
	if err != nil {
		return err
	}
	return s.get(w, r, sess)
}

// bookOne books a complete draft dated in an open month and logs expense.booked; the caller retains its receipts
// (retainReceipts) after the commit.
func (s *Service) bookOne(ctx context.Context, q store.Q, sess store.Session, e store.Expense) error {
	if err := q.CheckOpen(ctx, sess.Workspace.ID, *e.DocumentDate); err != nil {
		return err
	}
	if err := q.BookExpense(ctx, e.ID, sess.User.ID, s.now()); err != nil {
		return err
	}
	receipts, err := q.Receipts(ctx, e.ID)
	if err != nil {
		return err
	}
	for _, f := range receipts {
		if err := retention.Request(ctx, q, s.files, sess.Workspace.ID, f.ObjectKey, *e.DocumentDate, s.now()); err != nil {
			return err
		}
	}
	return s.logEvent(ctx, q, sess, "expense.booked", e, map[string]any{"number": e.Number, "document_date": e.DocumentDate,
		"currency": e.Currency, "total": e.Total, "base_currency": e.Base.Currency, "base_total": e.Base.Total,
		"deductible_vat": e.Base.DeductibleVAT})
}

func (s *Service) logEvent(ctx context.Context, q store.Q, sess store.Session, kind string, e store.Expense, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("%s payload: %w", kind, err)
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind, SubjectType: "expense",
		SubjectID: e.ID, ActorID: &sess.User.ID, At: s.now(), Payload: raw})
}

// payment is what expense.payment_changed records.
type payment struct {
	Status       string  `json:"payment_status"`
	PaidOn       *string `json:"paid_on"`
	Method       *string `json:"payment_method"`
	PaidBy       *string `json:"paid_by_member_id"`
	ReimbursedOn *string `json:"reimbursed_on"`
}

func paymentOf(e store.Expense) payment {
	return payment{e.PaymentStatus, e.PaidOn, e.PaymentMethod, e.PaidByID, e.ReimbursedOn}
}

func (p payment) same(o payment) bool {
	eq := func(a, b *string) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }
	return p.Status == o.Status && eq(p.PaidOn, o.PaidOn) && eq(p.Method, o.Method) && eq(p.PaidBy, o.PaidBy) &&
		eq(p.ReimbursedOn, o.ReimbursedOn)
}

// save writes e and, when a booked expense's payment changed from before, logs expense.payment_changed. A booked
// expense's payment dates are in the books, so neither the old nor the new ones may fall in a closed month.
func (s *Service) save(ctx context.Context, q store.Q, sess store.Session, e store.Expense, before payment) error {
	if after := paymentOf(e); e.Status != "draft" && !after.same(before) {
		for _, d := range []*string{before.PaidOn, before.ReimbursedOn, after.PaidOn, after.ReimbursedOn} {
			if d == nil {
				continue
			}
			if err := q.CheckOpen(ctx, sess.Workspace.ID, *d); err != nil {
				return err
			}
		}
	}
	if err := q.SaveExpense(ctx, sess.Workspace.ID, e, s.now()); err != nil {
		return err
	}
	if e.PaidByID != nil && before.ReimbursedOn == nil && e.ReimbursedOn != nil {
		description := ""
		if e.Description != nil {
			description = *e.Description
		}
		if err := notifications.Notify(ctx, q, sess.Workspace.ID, "expense.reimbursed", map[string]any{"expense_id": e.ID,
			"description": description, "amount": e.Total.String(), "currency": e.Currency, "reimbursed_on": *e.ReimbursedOn,
			"actor": notifications.Actor(sess.User)}, store.NotifyTo{UserIDs: []string{*e.PaidByID}, Except: sess.User.ID}, s.now()); err != nil {
			return err
		}
	}
	if after := paymentOf(e); e.Status == "booked" && !after.same(before) {
		return s.logEvent(ctx, q, sess, "expense.payment_changed", e, after)
	}
	return nil
}

// retainReceipts locks booked expenses' receipts for the GeBüV's ten years (when retention is configured), after
// the booking committed: a rolled-back booking must leave its draft's receipts deletable.
func (s *Service) retainReceipts(ctx context.Context, expenseIDs ...string) {
	for _, id := range expenseIDs {
		list, err := s.db.Receipts(ctx, id)
		if err != nil {
			s.log.ErrorContext(ctx, "booked expense receipts not retained", "expense", id, "error", err)
			continue
		}
		for _, f := range list {
			s.retain(ctx, f.ObjectKey)
		}
	}
}

// retain locks one receipt of a committed booked expense; the booking stands either way, and the pending row written
// with it makes the retention job retry a failure.
func (s *Service) retain(ctx context.Context, key string) {
	retention.Settle(ctx, s.db, s.files, s.log, key)
}

func (s *Service) duplicate(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	src, err := s.db.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	e := newDraft(d, sess.User)
	e.SupplierName, e.SupplierVATNumber, e.Description, e.CategoryID = src.SupplierName, src.SupplierVATNumber, src.Description, src.CategoryID
	e.SupplierCountry, e.ReverseCharge, e.InputTaxBox = src.SupplierCountry, src.ReverseCharge, src.InputTaxBox
	e.Currency, e.AmountMode, e.InputTax, e.DeductiblePercent = src.Currency, src.AmountMode, src.InputTax, src.DeductiblePercent
	e.EntryMode = src.EntryMode
	if e.Currency != d.Currency {
		e.ExchangeRate = src.ExchangeRate // a starting point; its date and source must be entered again
	}
	for _, l := range src.Lines {
		l.ID = auth.NewID("exl")
		e.Lines = append(e.Lines, l)
	}
	compute(&e, d.Currency)
	if err := s.db.Tx(r.Context(), func(q store.Q) error { return q.CreateExpense(r.Context(), sess.Workspace.ID, &e, s.now()) }); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, e.ID)
}

type skipped struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

func (s *Service) bulk(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		IDs           []string `json:"ids"`
		Action        string   `json:"action"`
		PaidOn        *string  `json:"paid_on"`
		PaymentMethod *string  `json:"payment_method"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	today := s.today(sess.Workspace)
	invalid := map[string]string{}
	if len(body.IDs) < 1 || len(body.IDs) > 500 {
		invalid["ids"] = "Choose 1 to 500 expenses."
	}
	actions := []string{"book", "mark_paid", "mark_unpaid", "mark_reimbursed", "delete"}
	if !slices.Contains(actions, body.Action) {
		invalid["action"] = "Choose one of " + strings.Join(actions, ", ") + "."
	}
	paidOn, method := today, "bank_transfer"
	if body.PaidOn != nil {
		if _, msg := date(*body.PaidOn); msg != "" || *body.PaidOn > today {
			invalid["paid_on"] = "Enter a date as YYYY-MM-DD, not in the future."
		}
		paidOn = *body.PaidOn
	}
	if body.PaymentMethod != nil {
		if !slices.Contains(paymentMethods, *body.PaymentMethod) {
			invalid["payment_method"] = "Choose one of " + strings.Join(paymentMethods, ", ") + "."
		}
		method = *body.PaymentMethod
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}

	updated, skips, booked := 0, []skipped{}, []string{}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if body.Action != "delete" { // removing what a workspace has stays in every plan; changing the module does not
			if err := q.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureExpenses); err != nil {
				return err
			}
		}
		if err := q.LockExpenseBatch(r.Context(), sess.Workspace.ID, body.IDs, body.Action == "book"); err != nil {
			return err
		}
		for _, id := range body.IDs {
			e, err := q.Expense(r.Context(), sess.Workspace.ID, id, today, true)
			if errors.Is(err, store.ErrNotFound) {
				skips = append(skips, skipped{id, "Not found."})
				continue
			}
			if err != nil {
				return err
			}
			reason, err := s.apply(r.Context(), q, sess, &e, body.Action, paidOn, method, today)
			if err != nil {
				return err
			}
			if reason != "" {
				skips = append(skips, skipped{id, reason})
				continue
			}
			updated++
			if body.Action == "book" {
				booked = append(booked, id)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.retainReceipts(r.Context(), booked...)
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"updated": updated, "skipped": skips}))
	return nil
}

// apply runs one bulk action on a locked expense; a non-empty reason means it was skipped.
func (s *Service) apply(ctx context.Context, q store.Q, sess store.Session, e *store.Expense, action, paidOn, method, today string) (string, error) {
	now := s.now()
	switch action {
	case "book":
		if e.Status != "draft" {
			return "Already booked.", nil
		}
		if reasons := bookReasons(*e, today); len(reasons) > 0 {
			return strings.Join(reasons, " "), nil
		}
		if err := s.approvals.Gate(ctx, q, sess.Workspace.ID, approvalDoc(*e)); errors.Is(err, approvals.ErrRequired) {
			return "Needs approval.", nil
		} else if err != nil {
			return "", err
		}
		err := s.bookOne(ctx, q, sess, *e)
		if errors.Is(err, store.ErrPeriodClosed) {
			return "period_closed", nil
		}
		return "", err
	case "delete":
		if e.Status != "draft" {
			return "Only drafts can be deleted.", nil
		}
		if _, err := q.DeleteDraftExpense(ctx, sess.Workspace.ID, e.ID, now); err != nil {
			return "", err
		}
		return "", s.approvals.Forget(ctx, q, sess.Workspace.ID, e.ID)
	}
	if e.Status == "void" {
		return "Voided.", nil
	}
	paid := paymentOf(*e)
	switch action {
	case "mark_paid":
		if e.PaymentStatus == "paid" {
			return "Already paid.", nil
		}
		e.PaymentStatus, e.PaidOn, e.PaymentMethod = "paid", &paidOn, &method
	case "mark_unpaid":
		if e.PaymentStatus == "unpaid" {
			return "Already unpaid.", nil
		}
		e.PaymentStatus, e.PaidOn, e.PaymentMethod, e.PaidByID, e.ReimbursedOn = "unpaid", nil, nil, nil, nil
	case "mark_reimbursed":
		if e.PaidByID == nil || e.ReimbursedOn != nil {
			return "Not owed to a member.", nil
		}
		e.ReimbursedOn = &paidOn
	}
	err := s.save(ctx, q, sess, *e, paid)
	if errors.Is(err, store.ErrPeriodClosed) {
		return "period_closed", nil
	}
	return "", err
}

// ---- list, summary, export ----

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

func parseFilter(q url.Values) (store.ExpenseFilter, error) {
	f := store.ExpenseFilter{Search: q.Get("search"), Sort: q.Get("sort"), IDs: listParam(q, "ids"),
		CategoryIDs: listParam(q, "category_id"), Payment: q.Get("payment"), Incomplete: q.Get("incomplete") == "true"}
	for _, v := range listParam(q, "status") {
		if !slices.Contains([]string{"draft", "booked", "void"}, v) {
			return f, badRequest("status must be draft, booked or void.")
		}
		f.Statuses = append(f.Statuses, v)
	}
	if f.Payment != "" && !slices.Contains([]string{"unpaid", "paid", "overdue", "to_reimburse"}, f.Payment) {
		return f, badRequest("payment must be unpaid, paid, overdue or to_reimburse.")
	}
	for _, c := range listParam(q, "currency") {
		f.Currencies = append(f.Currencies, strings.ToUpper(c))
	}
	for key, v := range map[string]*string{"from": &f.From, "to": &f.To} {
		if *v = q.Get(key); *v != "" {
			if _, msg := date(*v); msg != "" {
				return f, badRequest(key + " must be a date as YYYY-MM-DD.")
			}
		}
	}
	for key, dst := range map[string]**int64{"total_min": &f.TotalMin, "total_max": &f.TotalMax} {
		if v := q.Get(key); v != "" {
			n, ok := parseMoney(v)
			if !ok {
				return f, badRequest(key + " must be an amount such as 100 or 99.50.")
			}
			*dst = &n
		}
	}
	if f.Receipt = q.Get("receipt"); f.Receipt != "" && f.Receipt != "attached" && f.Receipt != "missing" {
		return f, badRequest("receipt must be attached or missing.")
	}
	if f.Sort == "" {
		f.Sort = "-document_date"
	}
	if _, ok := store.ExpenseSorts[strings.TrimPrefix(f.Sort, "-")]; !ok {
		return f, badRequest("sort must be one of number, document_date, supplier, total, created_at, optionally prefixed with -.")
	}
	return f, nil
}

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
	list, total, err := s.db.ListExpenses(r.Context(), sess.Workspace.ID, s.today(sess.Workspace), f, size, (page-1)*size)
	if err != nil {
		return err
	}
	lang := language(r)
	for i := range list {
		localize(lang, list[i].Category)
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": list,
		"meta": map[string]int{"page": page, "page_size": size, "total": total, "total_pages": (total + size - 1) / size}})
	return nil
}

func (s *Service) summary(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	sum, err := s.db.ExpenseSummary(r.Context(), sess.Workspace.ID, d.Currency, s.today(sess.Workspace))
	if err != nil {
		return err
	}
	lang := language(r)
	for i := range sum.ByCategory {
		localize(lang, sum.ByCategory[i].Category)
	}
	auth.WriteJSON(w, http.StatusOK, data(sum))
	return nil
}

var csvHeader = []string{"number", "status", "document_date", "supplier", "supplier_vat_number", "supplier_country", "reference", "description",
	"account_code", "category", "currency", "net_total", "vat_total", "total", "exchange_rate", "exchange_rate_date",
	"exchange_rate_source", "base_currency", "base_net_total", "base_vat_total", "base_total", "input_tax", "deductible_vat",
	"base_deductible_vat", "payment_status", "paid_on", "payment_method", "paid_by", "reimbursed_on", "receipts", "booked_at",
	"created_at"}

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
		w.Header().Set("Content-Disposition", `attachment; filename="expenses-`+s.today(sess.Workspace)+`.csv"`)
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("\uFEFF")) // a BOM, so spreadsheet apps read UTF-8
		_ = out.Write(csvHeader)
	}

	lang := language(r)
	err = s.db.EachExpense(r.Context(), sess.Workspace.ID, s.today(sess.Workspace), f, 0, 0, func(e store.Expense) error {
		start()
		localize(lang, e.Category)
		code, category, paidBy, booked := "", "", "", ""
		if e.Category != nil {
			code, category = e.Category.AccountCode, e.Category.Name
		}
		if e.PaidByMember != nil {
			paidBy = e.PaidByMember.Name
		}
		if e.BookedAt != nil {
			booked = e.BookedAt.Format(time.RFC3339)
		}
		row := []string{strconv.FormatInt(e.Number, 10), e.Status, str(e.DocumentDate), str(e.SupplierName),
			str(e.SupplierVATNumber), e.SupplierCountry, str(e.Reference), str(e.Description), code, category, e.Currency, e.NetTotal.String(),
			e.VATTotal.String(), e.Total.String(), e.ExchangeRate.String(), str(e.ExchangeRateDate), str(e.ExchangeRateSource),
			e.Base.Currency, e.Base.NetTotal.String(), e.Base.VATTotal.String(), e.Base.Total.String(), e.InputTax,
			e.DeductibleVAT.String(), e.Base.DeductibleVAT.String(), e.PaymentStatus, str(e.PaidOn), str(e.PaymentMethod), paidBy,
			str(e.ReimbursedOn), strconv.Itoa(e.ReceiptsCount), booked, e.CreatedAt.Format(time.RFC3339)}
		for i := range row {
			row[i] = cell(row[i])
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

func str(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// cell keeps a spreadsheet from running a value as a formula (as in internal/clients): text starting with
// = + - @ tab or CR gets a leading apostrophe, unless it is just a number.
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}

// ---- categories ----

func (s *Service) categories(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.db.SeedExpenseCategories(r.Context(), sess.Workspace.ID, func() string { return auth.NewID("exc") }, s.now()); err != nil {
		return err
	}
	list, err := s.db.ExpenseCategories(r.Context(), sess.Workspace.ID, r.URL.Query().Get("include_archived") == "1")
	if err != nil {
		return err
	}
	lang := language(r)
	for i := range list {
		localize(lang, &list[i].CategoryRef)
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

type categoryInput struct {
	Name        *string `json:"name"`
	AccountCode *string `json:"account_code"`
	// VATTreatment only suggests a line's rate, so booked categories may change it.
	VATTreatment *string `json:"vat_treatment"`
	IsArchived   *bool   `json:"is_archived"`
}

func (c *categoryInput) validate(create bool) error {
	invalid := map[string]string{}
	if c.Name != nil {
		*c.Name = strings.TrimSpace(*c.Name)
	}
	if c.AccountCode != nil {
		*c.AccountCode = strings.TrimSpace(*c.AccountCode)
	}
	if (create && c.Name == nil) || (c.Name != nil && (*c.Name == "" || len([]rune(*c.Name)) > 100)) {
		invalid["name"] = "Enter a name of up to 100 characters."
	}
	if (create && c.AccountCode == nil) || (c.AccountCode != nil && !accountCode(*c.AccountCode)) {
		invalid["account_code"] = "Enter the account number: 3 to 10 digits, such as 6640."
	}
	if c.VATTreatment != nil && !slices.Contains([]string{"standard", "reduced", "lodging", "exempt", "none"}, *c.VATTreatment) {
		invalid["vat_treatment"] = "Choose standard, reduced, accommodation, no VAT or exempt."
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}
	return nil
}

func accountCode(v string) bool {
	if len(v) < 3 || len(v) > 10 {
		return false
	}
	for _, r := range v {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

var errCategoryTaken = validationFailed(map[string]string{"name": "Another category already has this name."})

func (s *Service) createCategory(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	var in categoryInput
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if err := in.validate(true); err != nil {
		return err
	}
	id := auth.NewID("exc")
	if err := s.db.CreateExpenseCategory(r.Context(), sess.Workspace.ID, id, *in.Name, *in.AccountCode, in.VATTreatment, s.now()); err != nil {
		if errors.Is(err, store.ErrCategoryTaken) {
			return errCategoryTaken
		}
		return err
	}
	c, err := s.db.ExpenseCategory(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	localize(language(r), &c.CategoryRef)
	auth.WriteJSON(w, http.StatusCreated, data(c))
	return nil
}

func (s *Service) updateCategory(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	var in categoryInput
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if err := in.validate(false); err != nil {
		return err
	}
	var found bool
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		var err error
		found, err = q.UpdateExpenseCategory(r.Context(), sess.Workspace.ID, r.PathValue("id"), in.Name, in.AccountCode, in.VATTreatment, in.IsArchived, s.now())
		if err != nil || !found || in.Name == nil {
			return err
		}
		return q.RenameCategoryFolder(r.Context(), sess.Workspace.ID, r.PathValue("id"), *in.Name, s.now())
	})
	if errors.Is(err, store.ErrCategoryTaken) {
		return errCategoryTaken
	}
	if errors.Is(err, store.ErrCategoryLocked) {
		return auth.Error(http.StatusConflict, "category_locked", "Booked expenses keep their category and account. Archive this category and create another instead.", nil)
	}
	if err != nil {
		return err
	}
	if !found {
		return store.ErrNotFound
	}
	c, err := s.db.ExpenseCategory(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	localize(language(r), &c.CategoryRef)
	auth.WriteJSON(w, http.StatusOK, data(c))
	return nil
}
