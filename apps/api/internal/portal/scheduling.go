package portal

import (
	"context"
	"errors"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
)

// Sessions in the portal (scheduling-contract.md, "Portal"): the client's own sessions, its requests and booking,
// plus the public booking links' page (owner's answer 2026-11-23), which has no session.

// SetScheduling is startup wiring; without it the scheduling routes do not exist.
func (s *Service) SetScheduling(sch *scheduling.Service) { s.sched = sch }

const schedBase = "/api/v1/public/portal/scheduling"

func (s *Service) registerScheduling(mux *http.ServeMux, handle func(string, handler)) {
	if s.sched == nil {
		return
	}
	handle("GET "+schedBase+"/occurrences", s.sessions)
	handle("GET "+schedBase+"/occurrences/{id}/ics", s.ics(s.sched.ClientOccurrenceICS, "session.ics"))
	handle("GET "+schedBase+"/series/{id}/ics", s.ics(s.sched.ClientSeriesICS, "series.ics"))
	handle("POST "+schedBase+"/occurrences/{id}/cancel-request", s.limited(s.cancelRequest))
	handle("POST "+schedBase+"/occurrences/{id}/reschedule-request", s.limited(s.rescheduleRequest))
	handle("POST "+schedBase+"/requests/{id}/accept", s.limited(s.answer("accept")))
	handle("POST "+schedBase+"/requests/{id}/decline", s.limited(s.answer("decline")))
	handle("DELETE "+schedBase+"/requests/{id}", s.limited(s.answer("withdraw")))
	handle("GET "+schedBase+"/booking", s.booking)
	handle("GET "+schedBase+"/booking/slots", s.bookingSlots)
	handle("POST "+schedBase+"/booking", s.limited(s.book))
	mux.HandleFunc("GET "+schedBase+"/link", s.public(s.link))
	mux.HandleFunc("GET "+schedBase+"/link/slots", s.public(s.linkSlots))
	mux.HandleFunc("POST "+schedBase+"/link/book", s.public(s.linkBook))
}

// schedFail: a plan without Scheduling is the portal's 404, so the client is never told the workspace's plan.
func schedFail(err error) error {
	err = scheduling.ClientError(err)
	if errors.Is(err, store.ErrFeatureDenied) || errors.Is(err, store.ErrNotFound) {
		return auth.ErrNotFound
	}
	return err
}

// limited caps the requests and bookings of one session.
func (s *Service) limited(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
		if !s.schedWrites.AllowKey(sess.ID) {
			return errTooMany
		}
		return schedFail(h(w, r, sess))
	}
}

// public lets a booking link's request through within the per-address and per-link limits.
func (s *Service) public(h func(http.ResponseWriter, *http.Request, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("link")
		if !s.linkByIP.Allow(r) || token != "" && !s.linkByToken.AllowKey(hashToken(token)) {
			s.fail(w, r, errTooMany)
			return
		}
		if err := h(w, r, token); err != nil {
			s.fail(w, r, schedFail(err))
		}
	}
}

func lang(r *http.Request) string {
	if l := r.URL.Query().Get("lang"); l != "" {
		return l
	}
	return r.Header.Get("Accept-Language")
}

func (s *Service) sessions(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	when := r.URL.Query().Get("when")
	if when == "" {
		when = "upcoming"
	}
	if when != "upcoming" && when != "past" {
		return auth.Error(http.StatusBadRequest, "bad_request", "when is upcoming or past.", nil)
	}
	zone, err := s.db.Q.ClientTimeZone(r.Context(), sess.Workspace.ID, sess.ClientID)
	if err != nil {
		return err
	}
	list, err := s.sched.ClientSessions(r.Context(), sess.Workspace, sess.ClientID, deref(zone), when)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ics serves the client's own session or series (by the path's id) as a PUBLISH .ics.
func (s *Service) ics(load func(context.Context, store.Workspace, string, string) ([]byte, error), name string) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
		ics, err := load(r.Context(), sess.Workspace, sess.ClientID, r.PathValue("id"))
		if err != nil {
			return schedFail(err)
		}
		w.Header().Set("Content-Type", "text/calendar; charset=utf-8; method=PUBLISH")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		w.Header().Set("Cache-Control", "private, no-store")
		_, err = w.Write(ics)
		return err
	}
}

func (s *Service) cancelRequest(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	var body struct {
		Note *string `json:"note"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	note, err := requestNote(body.Note)
	if err != nil {
		return err
	}
	req, cancelled, err := s.sched.RequestCancel(r.Context(), sess.Workspace, sess.ClientID, r.PathValue("id"), sess.Email, note)
	if err != nil {
		return err
	}
	status := http.StatusCreated
	if cancelled { // on time and auto-approved: the session is cancelled already, the request says so (approved)
		status = http.StatusOK
	}
	auth.WriteJSON(w, status, data(req))
	return nil
}

func (s *Service) rescheduleRequest(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	var body struct {
		ProposedTimes []time.Time `json:"proposed_times"`
		Note          *string     `json:"note"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	note, err := requestNote(body.Note)
	if err != nil {
		return err
	}
	req, err := s.sched.RequestReschedule(r.Context(), sess.Workspace, sess.ClientID, r.PathValue("id"), sess.Email, body.ProposedTimes, note)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(req))
	return nil
}

// requestNote: the client's note on a request, at most 500 characters; blank is none.
func requestNote(note *string) (*string, error) {
	if note == nil || *note == "" {
		return nil, nil
	}
	if len([]rune(*note)) > 500 {
		return nil, auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
			map[string]any{"fields": map[string]string{"note": "Keep the note to 500 characters."}})
	}
	return note, nil
}

func (s *Service) answer(action string) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
		req, err := s.sched.Answer(r.Context(), sess.Workspace, sess.ClientID, r.PathValue("id"), action)
		if err != nil {
			return err
		}
		if action == "withdraw" {
			w.WriteHeader(http.StatusNoContent)
			return nil
		}
		auth.WriteJSON(w, http.StatusOK, data(req))
		return nil
	}
}

func (s *Service) booking(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	info, err := s.sched.Booking(r.Context(), sess.Workspace, sess.ClientID, lang(r))
	if err != nil {
		return schedFail(err)
	}
	auth.WriteJSON(w, http.StatusOK, info)
	return nil
}

// slotRange reads from and to (RFC 3339) of a slots call.
func slotRange(r *http.Request) (time.Time, time.Time, error) {
	from, err1 := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	to, err2 := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if err := errors.Join(err1, err2); err != nil {
		return from, to, auth.Error(http.StatusBadRequest, "bad_request", "from and to are RFC 3339 instants.", nil)
	}
	return from, to, nil
}

func (s *Service) bookingSlots(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	from, to, err := slotRange(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	slots, err := s.sched.Slots(r.Context(), sess.Workspace, q.Get("event_type_id"), q.Get("host_id"), from, to)
	if err != nil {
		return schedFail(err)
	}
	auth.WriteJSON(w, http.StatusOK, data(slots))
	return nil
}

type bookBody struct {
	EventTypeID  string    `json:"event_type_id"`
	HostID       string    `json:"host_id"`
	StartsAt     time.Time `json:"starts_at"`
	EngagementID string    `json:"engagement_id"`
	Note         *string   `json:"note"`
}

func (b bookBody) input() (scheduling.BookInput, error) {
	note, err := requestNote(b.Note)
	return scheduling.BookInput{EventTypeID: b.EventTypeID, HostID: b.HostID, StartsAt: b.StartsAt, EngagementID: b.EngagementID, Note: note}, err
}

// booked is what the client learns of a booking: the session, scheduled or waiting for the business (requested).
type booked struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Status   string    `json:"status"`
	HostName *string   `json:"host_name"`
}

func bookedOf(o scheduling.Occurrence) booked {
	b := booked{ID: o.ID, Title: o.Title, StartsAt: o.StartsAt, EndsAt: o.EndsAt, Status: o.Status}
	if o.Host != nil {
		b.HostName = &o.Host.Name
	}
	return b
}

func (s *Service) book(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	var body bookBody
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	in, err := body.input()
	if err != nil {
		return err
	}
	o, err := s.sched.Book(r.Context(), sess.Workspace, sess.ClientID, sess.Email, in)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(bookedOf(o)))
	return nil
}

func (s *Service) link(w http.ResponseWriter, r *http.Request, token string) error {
	info, err := s.sched.Link(r.Context(), token, lang(r))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, info)
	return nil
}

func (s *Service) linkSlots(w http.ResponseWriter, r *http.Request, token string) error {
	from, to, err := slotRange(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	slots, err := s.sched.LinkSlots(r.Context(), token, q.Get("event_type_id"), q.Get("host_id"), from, to)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(slots))
	return nil
}

func (s *Service) linkBook(w http.ResponseWriter, r *http.Request, token string) error {
	var body struct {
		bookBody
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	in, err := body.input()
	if err != nil {
		return err
	}
	o, err := s.sched.BookWithLink(r.Context(), token, scheduling.PublicBooking{BookInput: in, Name: body.Name, Email: body.Email})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(bookedOf(o)))
	return nil
}
