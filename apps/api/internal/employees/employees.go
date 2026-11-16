// Package employees is the workspace company's own staff (docs/planning/2026-11-15-employees.md): employee records,
// pay terms with history, private employee documents and the payroll register with approval, payment status,
// corrections and a controlled payroll journal. An employee is not a member: no user, no access, no seat.
//
// Every route is behind the HR scopes (internal/permissions), which a member's "*" never reaches. Nothing here is a
// public API operation, an MCP tool, a Heidi answer or part of the workspace export. Field values of employees and
// payroll never go into errors, logs or the audit log's payload.
package employees

import (
	"context"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Files is what employee documents use of internal/documents: one document system, its HR side.
type Files interface {
	UploadEmployeeFile(w http.ResponseWriter, r *http.Request, sess store.Session, employeeID string, record documents.HRRecord) (string, error)
	ServeHRFile(w http.ResponseWriter, r *http.Request, workspaceID string, d store.Document) error
	RemoveObject(ctx context.Context, key string)
}

type Service struct {
	db    *store.Store
	auth  Auth
	files Files
	seal  sealer
	log   *slog.Logger
	now   func() time.Time
}

func New(db *store.Store, a Auth, files Files, secret []byte, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, seal: newSealer(secret), log: log, now: func() time.Time { return time.Now().UTC() }}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

var (
	errNumberTaken  = validationFailed(map[string]string{"employee_number": "Another employee already has this number."})
	errMemberLinked = validationFailed(map[string]string{"member_user_id": "Another employee is already linked to this member."})
	errTermsDate    = validationFailed(map[string]string{"effective_from": "There are already pay terms from this date."})
	errOwnerOnly    = auth.Error(http.StatusForbidden, "forbidden", "Only an owner can set a legal hold or restrict processing.", nil)
	errRestricted   = conflict("restricted", "Processing of this employee's data is restricted: it can be read, not changed.")
	errErased       = conflict("erased", "This employee's personal data was erased; the record is kept read-only.")
	// errSecondApprover: four-eyes approval is on and the approver entered the entry's current figures.
	errSecondApprover = auth.Error(http.StatusForbidden, "second_approver_required",
		"You entered the current figures of this entry. Another person with Payroll edit access must approve it.", nil)
)

// planAllows refuses the module where the plan lacks it (403 feature_not_in_plan), except an owner's reads: after a
// downgrade the data stays, readable and exportable by the owner, not editable.
func (s *Service) planAllows(r *http.Request, sess store.Session) error {
	if sess.Role == "owner" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		return nil
	}
	return s.db.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureEmployees)
}

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			err := s.planAllows(r, sess)
			if err == nil {
				err = h(w, r, sess)
			}
			if err != nil {
				switch {
				case errors.Is(err, store.ErrNotFound):
					err = auth.ErrNotFound
				case errors.Is(err, store.ErrEmployeeNumberTaken):
					err = errNumberTaken
				case errors.Is(err, store.ErrMemberLinked):
					err = errMemberLinked
				case errors.Is(err, store.ErrPayTermsDate):
					err = errTermsDate
				case errors.Is(err, store.ErrPeriodClosed):
					err = errPeriodClosed
				case errors.Is(err, errNoKey):
					err = conflict("protected_fields_unavailable", "Bank account and tax id cannot be stored: the server has no SECRET_KEY.")
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/employees", s.list)
	handle("POST /api/v1/employees", s.create)
	handle("GET /api/v1/employees/{id}", s.get)
	handle("PATCH /api/v1/employees/{id}", s.update)
	handle("DELETE /api/v1/employees/{id}", s.delete)
	handle("POST /api/v1/employees/{id}/archive", s.archive)
	handle("POST /api/v1/employees/{id}/unarchive", s.unarchive)
	handle("POST /api/v1/employees/{id}/erase", s.erase)
	handle("GET /api/v1/employees/{id}/protected", s.protected)
	handle("GET /api/v1/employees/{id}/jurisdiction", s.jurisdiction)
	handle("GET /api/v1/employees/{id}/history", s.history)
	handle("GET /api/v1/employees/{id}/pay-terms", s.payTerms)
	handle("POST /api/v1/employees/{id}/pay-terms", s.addPayTerms)
	handle("DELETE /api/v1/employees/{id}/pay-terms/{terms}", s.deletePayTerms)
	handle("GET /api/v1/employees/{id}/documents", s.documents)
	handle("POST /api/v1/employees/{id}/documents", s.upload)
	handle("PATCH /api/v1/employees/{id}/documents/{doc}", s.updateDocument)
	handle("DELETE /api/v1/employees/{id}/documents/{doc}", s.deleteDocument)
	handle("GET /api/v1/employees/{id}/documents/{doc}/download", s.download)
	handle("GET /api/v1/employment/settings", s.settings)
	handle("PUT /api/v1/employment/settings", s.putSettings)
	handle("GET /api/v1/employment/jurisdictions", s.jurisdictions)
	handle("GET /api/v1/employment/retention", s.retentionReview)
	handle("GET /api/v1/payroll/entries", s.entries)
	handle("POST /api/v1/payroll/entries", s.createEntry)
	handle("GET /api/v1/payroll/entries/{id}", s.entry)
	handle("PATCH /api/v1/payroll/entries/{id}", s.updateEntry)
	handle("DELETE /api/v1/payroll/entries/{id}", s.deleteEntry)
	handle("POST /api/v1/payroll/entries/{id}/approve", s.approve)
	handle("POST /api/v1/payroll/entries/{id}/payment", s.payment)
	handle("POST /api/v1/payroll/entries/{id}/correct", s.correct)
	handle("GET /api/v1/payroll/summary", s.summary)
	handle("GET /api/v1/payroll/export", s.export)
	handle("GET /api/v1/payroll/bookings", s.bookings)
	handle("POST /api/v1/payroll/bookings", s.book)
	handle("GET /api/v1/payroll/bookings/preview", s.preview)
	handle("GET /api/v1/payroll/bookings/{id}/export", s.bookingExport)
}

func data(v any) map[string]any { return map[string]any{"data": v} }

func (s *Service) today(sess store.Session) string { return sess.Workspace.Today(s.now()) }

// audit appends an entry to the workspace's audit log in the caller's transaction. The payload stays empty: the log
// is readable with read:settings and by API tokens, which never include the HR scopes.
func (s *Service) audit(r *http.Request, q store.Q, sess store.Session, kind, subjectType, subjectID string) error {
	actor := sess.User.ID
	return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind, SubjectType: subjectType,
		SubjectID: subjectID, ActorID: &actor, At: s.now()})
}

// writable refuses changes to a restricted or erased employee.
func writable(e store.Employee) error {
	switch {
	case e.Restricted:
		return errRestricted
	case e.ErasedAt != nil:
		return errErased
	}
	return nil
}

func formValue(form *multipart.Form, key string) string {
	if v := form.Value[key]; len(v) > 0 {
		return v[0]
	}
	return ""
}
