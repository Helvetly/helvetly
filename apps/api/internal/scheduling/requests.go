package scheduling

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func isPending(r store.SchedRequest) bool { return r.Status == "pending" || r.Status == "proposed" }

func (s *Service) listRequests(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	statuses := listOf(r.URL.Query().Get("status"))
	if statuses == nil {
		statuses = []string{"pending", "proposed"}
	}
	ctx := r.Context()
	out := []RequestItem{}
	err := s.db.Tx(ctx, func(q store.Q) error {
		reqs, err := q.SchedRequests(ctx, sess.Workspace.ID, statuses, hostsOf(r, sess))
		if err != nil {
			return err
		}
		occs := make([]store.SchedOccurrence, 0, len(reqs))
		for _, x := range reqs {
			o, err := q.SchedOccurrence(ctx, sess.Workspace.ID, x.OccurrenceID, false)
			if err != nil {
				return err
			}
			occs = append(occs, o)
		}
		views, err := s.occurrenceViews(ctx, q, sess.Workspace.ID, occs)
		if err != nil {
			return err
		}
		for i, x := range reqs {
			v := views[i]
			out = append(out, RequestItem{Request: requestView(x), Occurrence: OccurrenceSummary{ID: v.ID, Title: v.Title,
				StartsAt: v.StartsAt, EndsAt: v.EndsAt, Status: v.Status, Client: v.Client, Host: v.Host}})
		}
		return nil
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// lockRequest locks an open request and its occurrence (event first, as every edit does).
func lockRequest(ctx context.Context, q store.Q, workspaceID, id string) (store.SchedRequest, store.SchedEvent, store.SchedOccurrence, error) {
	req, err := q.SchedRequest(ctx, workspaceID, id, false)
	if err != nil {
		return req, store.SchedEvent{}, store.SchedOccurrence{}, err
	}
	e, o, err := lockOccurrence(ctx, q, workspaceID, req.OccurrenceID)
	if err != nil {
		return req, e, o, err
	}
	if req, err = q.SchedRequest(ctx, workspaceID, id, true); err != nil {
		return req, e, o, err
	}
	if !isPending(req) {
		return req, e, o, errRequestClosed
	}
	return req, e, o, nil
}

// moveTo moves the occurrence to start (its length kept): same row and UID, rescheduled, sequence + 1. A late
// reschedule counts the original slot first when the settings say so.
func (s *Service) moveTo(ctx context.Context, q store.Q, a actor, e store.SchedEvent, o *store.SchedOccurrence, start time.Time, late bool) error {
	set, err := q.SchedulingSettings(ctx, a.ws.ID)
	if err != nil {
		return err
	}
	if late && set.LateRescheduleCounts && o.EngagementID != nil {
		links, err := q.SchedEntryLinks(ctx, o.ID)
		if err != nil {
			return err
		}
		if !slices.ContainsFunc(links, func(l store.SchedEntryLink) bool { return l.Reason == "late_reschedule" }) {
			if err := s.addEntry(ctx, q, a, *o, "late_reschedule"); err != nil {
				return err
			}
		}
	}
	s.retime(o, start, start.Add(o.EndsAt.Sub(o.StartsAt)))
	if o.Status == store.SchedScheduled {
		o.Status = store.SchedRescheduled
	}
	o.IsException = e.RRule != nil
	o.Sequence++
	o.UpdatedAt = s.now()
	return q.SaveSchedOccurrence(ctx, *o)
}

// takenAt reports whether start (for the occurrence's length) collides with another open session or busy time of
// its host; holidays and hours do not block staff.
func (s *Service) takenAt(ctx context.Context, q store.Q, ws store.Workspace, o store.SchedOccurrence, start time.Time) (bool, error) {
	cs, err := s.conflicts(ctx, q, ws, o.HostUserID, start, start.Add(o.EndsAt.Sub(o.StartsAt)), o.ID)
	return slices.ContainsFunc(cs, func(c Conflict) bool { return c.Kind == "event" || c.Kind == "busy" }), err
}

func (s *Service) decide(ctx context.Context, q store.Q, req *store.SchedRequest, status, actorID string, reason *string) error {
	now := s.now()
	req.Status, req.DecidedAt, req.Reason = status, &now, reason
	if actorID != "" {
		req.DecidedBy = &actorID
	}
	if err := q.SaveSchedRequest(ctx, *req); err != nil {
		return err
	}
	return s.audit(ctx, q, req.WorkspaceID, req.DecidedBy, "scheduling.request_decided", req.OccurrenceID,
		map[string]any{"request_id": req.ID, "occurrence_id": req.OccurrenceID, "kind": req.Kind, "decision": status})
}

func (s *Service) approveRequest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, "starts_at", "as"); err != nil {
		return err
	}
	f := form{}
	var start *time.Time
	if raw, ok := body["starts_at"]; ok {
		if t, ok := f.instant("starts_at", raw); ok {
			start = &t
		}
	}
	as := ""
	if raw, ok := body["as"]; ok && (json.Unmarshal(raw, &as) != nil || as != "on_time" && as != "late") {
		f.fail("as", "Choose on_time or late.")
	}
	if err := f.err(); err != nil {
		return err
	}
	force := r.URL.Query().Get("force") == "true"
	ctx, now := r.Context(), s.now()
	var out Occurrence
	var cs changes
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		req, e, o, err := lockRequest(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		a := actorOf(sess)
		ch := Change{WorkspaceID: sess.Workspace.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, ActorID: sess.User.ID, Notify: true}
		switch req.Kind {
		case "cancel":
			late := req.Late
			if as != "" {
				late = as == "late"
			}
			if err := s.cancelOne(ctx, q, a, &o, late); err != nil {
				return err
			}
			ch.Kind = ChangeCancelled
		default: // reschedule, booking
			if start == nil && req.Kind == "reschedule" && len(req.ProposedTimes) == 1 {
				start = &req.ProposedTimes[0]
			}
			if start == nil && req.Kind == "reschedule" {
				return validationFailed(map[string]string{"starts_at": "Choose the new time."})
			}
			if start != nil {
				if !start.After(now) {
					return validationFailed(map[string]string{"starts_at": "Choose a time in the future."})
				}
				if taken, err := s.takenAt(ctx, q, sess.Workspace, o, *start); err != nil {
					return err
				} else if taken && !force {
					return errSlotTaken
				}
				if err := s.moveTo(ctx, q, a, e, &o, *start, req.Late && req.Kind == "reschedule"); err != nil {
					return err
				}
				req.Chosen = start
			}
			ch.Kind = ChangeUpdated
			if req.Kind == "booking" {
				o.Status, o.StatusChangedBy, o.StatusChangedAt, o.TimedAt = store.SchedScheduled, &sess.User.ID, &now, now
				o.Sequence++
				if err := q.SaveSchedOccurrence(ctx, o); err != nil {
					return err
				}
				ch.Kind = ChangeInvited
			}
		}
		if err := s.decide(ctx, q, &req, "approved", sess.User.ID, nil); err != nil {
			return err
		}
		cs = changes{ch, {Kind: ChangeAnswered, WorkspaceID: sess.Workspace.ID, EventID: e.ID, RequestID: req.ID, ActorID: sess.User.ID, Notify: true}}
		if err := s.cal.Enqueue(ctx, q, sess.Workspace.ID, []string{o.ID}); err != nil {
			return err
		}
		out, err = s.occurrenceView(ctx, q, sess.Workspace.ID, o.ID)
		return err
	})
	if err != nil {
		return err
	}
	s.tell(ctx, cs)
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) declineRequest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, "reason"); err != nil {
		return err
	}
	f := form{}
	var reason *string
	if raw, ok := body["reason"]; ok {
		reason = f.text("reason", raw, 0, 500)
	}
	if err := f.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var out Request
	var cs changes
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		req, e, o, err := lockRequest(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		if req.Kind == "booking" {
			if err := s.declineBooking(ctx, q, sess.User.ID, &o); err != nil {
				return err
			}
			cs.add(Change{Kind: ChangeCancelled, WorkspaceID: sess.Workspace.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, ActorID: sess.User.ID, Notify: true})
		}
		if err := s.decide(ctx, q, &req, "declined", sess.User.ID, reason); err != nil {
			return err
		}
		cs.add(Change{Kind: ChangeAnswered, WorkspaceID: sess.Workspace.ID, EventID: e.ID, RequestID: req.ID, ActorID: sess.User.ID, Notify: true})
		out = requestView(req)
		return s.cal.Enqueue(ctx, q, sess.Workspace.ID, []string{o.ID})
	})
	if err != nil {
		return err
	}
	s.tell(ctx, cs)
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// declineBooking turns a booking's held slot down: the occurrence is declined and frees the slot.
func (s *Service) declineBooking(ctx context.Context, q store.Q, actorID string, o *store.SchedOccurrence) error {
	now := s.now()
	o.Status, o.StatusChangedAt = store.SchedDeclined, &now
	if actorID != "" {
		o.StatusChangedBy = &actorID
	}
	o.Sequence++
	o.UpdatedAt = now
	return q.SaveSchedOccurrence(ctx, *o)
}

func (s *Service) proposeRequest(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, "starts_at"); err != nil {
		return err
	}
	f := form{}
	start, _ := f.instant("starts_at", body["starts_at"])
	if len(f) == 0 && !start.After(s.now()) {
		f.fail("starts_at", "Choose a time in the future.")
	}
	if err := f.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var out Request
	var eventID string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		req, e, _, err := lockRequest(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		eventID = e.ID
		req.StaffProposal = &start
		if err := s.decide(ctx, q, &req, "proposed", sess.User.ID, nil); err != nil {
			return err
		}
		req.DecidedAt = nil // a proposal waits for the client
		out = requestView(req)
		return nil
	})
	if err != nil {
		return err
	}
	s.tell(ctx, changes{{Kind: ChangeAnswered, WorkspaceID: sess.Workspace.ID, EventID: eventID, RequestID: out.ID, ActorID: sess.User.ID, Notify: true}})
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// clientOccurrence locks the client's own occurrence; another client's is ErrNotFound. Only open, future sessions
// can be asked about (409 not_open, started).
func (s *Service) clientOccurrence(ctx context.Context, q store.Q, ws store.Workspace, clientID, occurrenceID string) (store.SchedEvent, store.SchedOccurrence, error) {
	if err := q.RequireFeature(ctx, ws.ID, store.FeatureScheduling); err != nil {
		return store.SchedEvent{}, store.SchedOccurrence{}, err
	}
	e, o, err := lockOccurrence(ctx, q, ws.ID, occurrenceID)
	switch {
	case err != nil:
		return e, o, err
	case o.ClientID != clientID:
		return e, o, store.ErrNotFound
	case !isOpen(o.Status):
		return e, o, errNotOpen
	case !o.StartsAt.After(s.now()):
		return e, o, errStarted
	}
	return e, o, nil
}

// RequestCancel is the client's cancel request from the portal. Lateness is fixed now, from the policy. An on-time
// request with auto_approve_on_time cancels at once (cancelled is true, the request is recorded as approved);
// otherwise the request waits for the business.
func (s *Service) RequestCancel(ctx context.Context, ws store.Workspace, clientID, occurrenceID, email string, note *string) (Request, bool, error) {
	var out Request
	var cancelled bool
	var cs changes
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, o, err := s.clientOccurrence(ctx, q, ws, clientID, occurrenceID)
		if err != nil {
			return err
		}
		set, err := q.SchedulingSettings(ctx, ws.ID)
		if err != nil {
			return err
		}
		deadline, err := s.deadline(ctx, q, ws, set, o.StartsAt)
		if err != nil {
			return err
		}
		now := s.now()
		req := store.SchedRequest{ID: auth.NewID("srq"), WorkspaceID: ws.ID, OccurrenceID: o.ID, ClientID: clientID, Kind: "cancel",
			Status: "pending", Late: now.After(deadline), Note: note, RequestedByEmail: nonEmpty(email), CreatedAt: now}
		if err := q.CreateSchedRequest(ctx, req); err != nil {
			return err
		}
		cs.add(Change{Kind: ChangeRequested, WorkspaceID: ws.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, RequestID: req.ID, Notify: true})
		if !req.Late && set.AutoApproveOnTime {
			if err := s.cancelOne(ctx, q, clientActor(ws), &o, false); err != nil {
				return err
			}
			if err := s.decide(ctx, q, &req, "approved", "", nil); err != nil {
				return err
			}
			if err := s.audit(ctx, q, ws.ID, nil, "scheduling.cancelled", o.ID, map[string]any{"occurrence_id": o.ID, "as": "on_time", "by": "client"}); err != nil {
				return err
			}
			cancelled = true
			cs = changes{{Kind: ChangeCancelled, WorkspaceID: ws.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, RequestID: req.ID, Notify: true}}
			if err := s.cal.Enqueue(ctx, q, ws.ID, []string{o.ID}); err != nil {
				return err
			}
		}
		out = requestView(req)
		return nil
	})
	if err != nil {
		return Request{}, false, err
	}
	s.tell(ctx, cs)
	return out, cancelled, nil
}

// RequestReschedule is the client's request to move a session to one of 1–3 times, each in the future and within
// the booking horizon.
func (s *Service) RequestReschedule(ctx context.Context, ws store.Workspace, clientID, occurrenceID, email string, times []time.Time,
	note *string) (Request, error) {
	var out Request
	var eventID string
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, o, err := s.clientOccurrence(ctx, q, ws, clientID, occurrenceID)
		if err != nil {
			return err
		}
		eventID = e.ID
		horizon := 365
		if e.EventTypeID != nil {
			if t, err := q.SchedEventType(ctx, ws.ID, *e.EventTypeID); err == nil {
				horizon = t.MaxHorizonDays
			}
		}
		now := s.now()
		if len(times) == 0 || len(times) > 3 {
			return validationFailed(map[string]string{"proposed_times": "Propose 1 to 3 times."})
		}
		for _, t := range times {
			if !t.After(now) || t.After(now.AddDate(0, 0, horizon)) {
				return validationFailed(map[string]string{"proposed_times": "Propose times in the future, at most " + strconv.Itoa(horizon) + " days ahead."})
			}
		}
		set, err := q.SchedulingSettings(ctx, ws.ID)
		if err != nil {
			return err
		}
		deadline, err := s.deadline(ctx, q, ws, set, o.StartsAt)
		if err != nil {
			return err
		}
		req := store.SchedRequest{ID: auth.NewID("srq"), WorkspaceID: ws.ID, OccurrenceID: o.ID, ClientID: clientID, Kind: "reschedule",
			Status: "pending", Late: now.After(deadline), ProposedTimes: times, Note: note, RequestedByEmail: nonEmpty(email), CreatedAt: now}
		if err := q.CreateSchedRequest(ctx, req); err != nil {
			return err
		}
		out = requestView(req)
		return nil
	})
	if err != nil {
		return Request{}, err
	}
	s.tell(ctx, changes{{Kind: ChangeRequested, WorkspaceID: ws.ID, EventID: eventID, OccurrenceIDs: []string{occurrenceID}, RequestID: out.ID, Notify: true}})
	return out, nil
}

// Answer is the client's answer on their own request: "accept" or "decline" a proposal of the business, or
// "withdraw" a pending request (a withdrawn booking frees its slot).
func (s *Service) Answer(ctx context.Context, ws store.Workspace, clientID, requestID, action string) (Request, error) {
	var out Request
	var cs changes
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, ws.ID, store.FeatureScheduling); err != nil {
			return err
		}
		req, e, o, err := lockRequest(ctx, q, ws.ID, requestID)
		if err != nil {
			if req.ClientID != clientID {
				return store.ErrNotFound
			}
			return err
		}
		if req.ClientID != clientID {
			return store.ErrNotFound
		}
		a := clientActor(ws)
		base := Change{WorkspaceID: ws.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, RequestID: req.ID, Notify: true}
		switch {
		case action == "withdraw" && req.Status == "pending":
			if req.Kind == "booking" {
				if err := s.declineBooking(ctx, q, "", &o); err != nil {
					return err
				}
			}
			err = s.decide(ctx, q, &req, "withdrawn", "", nil)
		case action == "accept" && req.Status == "proposed":
			if !req.StaffProposal.After(s.now()) {
				return errStarted
			}
			if err = s.moveTo(ctx, q, a, e, &o, *req.StaffProposal, req.Late && req.Kind == "reschedule"); err != nil {
				return err
			}
			if req.Kind == "booking" {
				o.Status, o.TimedAt = store.SchedScheduled, s.now()
				if err := q.SaveSchedOccurrence(ctx, o); err != nil {
					return err
				}
			}
			req.Chosen = req.StaffProposal
			base.Kind = ChangeUpdated
			cs.add(base)
			err = s.decide(ctx, q, &req, "accepted", "", nil)
		case action == "decline" && req.Status == "proposed":
			if req.Kind == "booking" {
				if err := s.declineBooking(ctx, q, "", &o); err != nil {
					return err
				}
			}
			err = s.decide(ctx, q, &req, "declined", "", nil)
		default:
			return errRequestClosed
		}
		if err != nil {
			return err
		}
		cs.add(Change{Kind: ChangeRequested, WorkspaceID: ws.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, RequestID: req.ID, Notify: true})
		out = requestView(req)
		return s.cal.Enqueue(ctx, q, ws.ID, []string{o.ID})
	})
	if err != nil {
		return Request{}, err
	}
	s.tell(ctx, cs)
	return out, nil
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
