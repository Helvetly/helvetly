// Package scheduling is the Scheduling service (scheduling-contract.md): one-off and recurring sessions with clients,
// edits of a series (this, following, all), attendance that counts through engagement entries, invoicing of
// sessions without an engagement, clients' cancel and reschedule requests, self-booking and public booking links,
// and the settings, holidays, event types and hosts' hours behind them. Emails and jobs (PR 4) and calendar sync
// (PR 5) plug in through Notifier and Calendar.
package scheduling

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Invoices is what invoicing sessions uses of invoices.Service: a draft made inside the caller's transaction.
type Invoices interface {
	CreateDraft(ctx context.Context, q store.Q, sess store.Session, clientID string, fill func(*store.Invoice)) (string, error)
}

// Calendar is the hosts' calendar sync (internal/calsync). Without one (noCalendar) nothing is pushed, there are no
// busy times and no meeting links can be made.
type Calendar interface {
	// Enqueue records pushes for the occurrences in the caller's transaction.
	Enqueue(ctx context.Context, q store.Q, workspaceID string, occurrenceIDs []string) error
	// CreateMeeting makes a Meet/Teams link through the host's connection (10 s), once per event.
	CreateMeeting(ctx context.Context, workspaceID, hostUserID, provider string, first store.SchedOccurrence) (url, ref string, err error)
	// Busy returns imported busy blocks of hosts in a range.
	Busy(ctx context.Context, q store.Q, workspaceID string, hostIDs []string, from, to time.Time) ([]schedpolicy.Block, error)
}

// ErrNoConnection: the host has no calendar connection of the meeting's provider (422 meeting_provider).
var ErrNoConnection = errors.New("no calendar connection for the meeting provider")

type noCalendar struct{}

func (noCalendar) Enqueue(context.Context, store.Q, string, []string) error { return nil }
func (noCalendar) CreateMeeting(context.Context, string, string, string, store.SchedOccurrence) (string, string, error) {
	return "", "", ErrNoConnection
}
func (noCalendar) Busy(context.Context, store.Q, string, []string, time.Time, time.Time) ([]schedpolicy.Block, error) {
	return nil, nil
}

// Change is what happened to sessions, told to the Notifier after the write committed: the emails to the client
// and the notifications to the host (PR 4) follow from it.
type Change struct {
	Kind          string // ChangeInvited, ChangeUpdated, ChangeCancelled, ChangeRequested, ChangeAnswered
	WorkspaceID   string
	EventID       string
	OccurrenceIDs []string
	RequestID     string
	EndedEventID  string // a "following" split: the old series, whose calendar entry now ends before EventID's
	ActorID       string // the member, or "" for the client
	Notify        bool   // staff's notify flag: false sends no email to the client
}

const (
	ChangeInvited   = "invited"   // new sessions (staff's, or a booking confirmed)
	ChangeUpdated   = "updated"   // time, place, meeting or title changed, a reschedule approved or accepted
	ChangeCancelled = "cancelled" // cancelled any way, a booking declined, a slot gone from a rule change
	ChangeRequested = "requested" // a client asked (cancel, reschedule, booking) or answered a proposal
	ChangeAnswered  = "answered"  // the business decided or proposed on a request
)

// Notifier hears every committed change; the default does nothing.
type Notifier interface {
	Changed(ctx context.Context, c Change)
}

type noNotifier struct{}

func (noNotifier) Changed(context.Context, Change) {}

type Service struct {
	db        *store.Store
	auth      Auth
	inv       Invoices
	cal       Calendar
	notifier  Notifier
	seal      sealer
	uidHost   string // PUBLIC_URL's host: the domain of every iCalendar UID
	portalURL string
	log       *slog.Logger
	now       func() time.Time
}

// New wires the service; secret is SECRET_KEY (booking links' tokens are sealed with a key derived from it).
func New(db *store.Store, a Auth, inv Invoices, secret []byte, publicURL, portalURL string, log *slog.Logger) *Service {
	host := "helvetly"
	if u, err := url.Parse(publicURL); err == nil && u.Hostname() != "" {
		host = u.Hostname()
	}
	return &Service{db: db, auth: a, inv: inv, cal: noCalendar{}, notifier: noNotifier{}, seal: newSealer(secret), uidHost: host,
		portalURL: portalURL, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// SetCalendar is startup wiring (calsync).
func (s *Service) SetCalendar(c Calendar) { s.cal = c }

// SetNotifier is startup wiring (emails and notifications).
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				s.writeError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/scheduling/occurrences", s.listOccurrences)
	handle("GET /api/v1/scheduling/occurrences/{id}", s.getOccurrence)
	handle("PATCH /api/v1/scheduling/occurrences/{id}", s.patchOccurrence)
	handle("POST /api/v1/scheduling/occurrences/{id}/cancel", s.cancelOccurrence)
	handle("POST /api/v1/scheduling/occurrences/{id}/attendance", s.setAttendance)
	handle("GET /api/v1/scheduling/occurrences/{id}/ics", s.occurrenceICS)
	handle("POST /api/v1/scheduling/occurrences/invoice", s.invoiceOccurrences)
	handle("GET /api/v1/scheduling/busy", s.listBusy)
	handle("GET /api/v1/scheduling/conflicts", s.getConflicts)
	handle("POST /api/v1/scheduling/events", s.createEvent)
	handle("GET /api/v1/scheduling/events/{id}", s.getEvent)
	handle("GET /api/v1/scheduling/requests", s.listRequests)
	handle("POST /api/v1/scheduling/requests/{id}/approve", s.approveRequest)
	handle("POST /api/v1/scheduling/requests/{id}/decline", s.declineRequest)
	handle("POST /api/v1/scheduling/requests/{id}/propose", s.proposeRequest)
	handle("GET /api/v1/scheduling/settings", s.getSettings)
	handle("PUT /api/v1/scheduling/settings", s.putSettings)
	handle("GET /api/v1/scheduling/holidays", s.getHolidays)
	handle("PUT /api/v1/scheduling/holidays", s.putHolidays)
	handle("GET /api/v1/scheduling/event-types", s.listEventTypes)
	handle("POST /api/v1/scheduling/event-types", s.createEventType)
	handle("PATCH /api/v1/scheduling/event-types/{id}", s.patchEventType)
	handle("DELETE /api/v1/scheduling/event-types/{id}", s.deleteEventType)
	handle("GET /api/v1/scheduling/hosts/{user_id}", s.getHost)
	handle("PUT /api/v1/scheduling/hosts/{user_id}", s.putHost)
	handle("GET /api/v1/scheduling/booking-links", s.listBookingLinks)
	handle("POST /api/v1/scheduling/booking-links", s.createBookingLink)
	handle("DELETE /api/v1/scheduling/booking-links/{id}", s.revokeBookingLink)
}

func (s *Service) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		err = auth.ErrNotFound
	case errors.Is(err, store.ErrSchedRequestOpen):
		err = errRequestOpen
	case errors.Is(err, store.ErrSchedNameTaken):
		err = validationFailed(map[string]string{"name": "An event type with this name exists already."})
	case errors.Is(err, ErrNoConnection):
		err = errMeetingProvider
	}
	s.auth.WriteError(w, r, err)
}

var (
	errClosed          = auth.Error(http.StatusConflict, "occurrence_closed", "This session is closed: it was attended, missed, cancelled or declined.", nil)
	errNotStarted      = auth.Error(http.StatusConflict, "not_started", "This session has not started yet.", nil)
	errNotOpen         = auth.Error(http.StatusConflict, "not_open", "This session is no longer open.", nil)
	errStarted         = auth.Error(http.StatusConflict, "started", "This session has already started.", nil)
	errRequestOpen     = auth.Error(http.StatusConflict, "request_open", "This session already has an open request.", nil)
	errRequestClosed   = auth.Error(http.StatusConflict, "request_closed", "This request has been answered already.", nil)
	errSlotTaken       = auth.Error(http.StatusConflict, "slot_taken", "This time has just been taken: pick another.", nil)
	errBookingOff      = auth.Error(http.StatusConflict, "booking_off", "Booking is not available.", nil)
	errBookingLimit    = auth.Error(http.StatusConflict, "booking_unavailable", "Booking is not available right now.", nil)
	errAlreadyInvoiced = auth.Error(http.StatusConflict, "already_invoiced", "A session is on an invoice already.", nil)
	errNotBillable     = auth.Error(http.StatusConflict, "not_billable", "Only sessions that count, without an engagement and with a price, can be invoiced.", nil)
	errMeetingProvider = auth.Error(http.StatusUnprocessableEntity, "meeting_provider", "Connect the host's calendar of this provider first.", nil)
	errOwnerAdmin      = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can do that.", nil)
	errNeedEngagements = auth.Error(http.StatusForbidden, "forbidden", "Counting this session logs it on the engagement: you need write access to engagements.",
		map[string]any{"scope": "write:engagements"})
)

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

func canManage(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

// changes collects what a write did, told to the Notifier once it committed.
type changes []Change

func (c *changes) add(ch Change) { *c = append(*c, ch) }

func (s *Service) tell(ctx context.Context, cs changes) {
	for _, c := range cs {
		if len(c.OccurrenceIDs) > 0 || c.RequestID != "" {
			s.notifier.Changed(context.WithoutCancel(ctx), c)
		}
	}
}
