package scheduling

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// horizonDays: occurrences are materialised this far ahead; the daily job (PR 4) extends open series.
const horizonDays = 400

func (s *Service) horizon() time.Time { return s.now().AddDate(0, 0, horizonDays) }

// holidays is the workspace's holiday list as a set of dates.
func holidaySet(ctx context.Context, q store.Q, workspaceID string) (schedpolicy.DateSet, error) {
	list, err := q.SchedulingHolidays(ctx, workspaceID, "", "")
	if err != nil {
		return nil, err
	}
	set := schedpolicy.DateSet{}
	for _, h := range list {
		if d, err := recur.ParseDate(h.Day); err == nil {
			set[d] = true
		}
	}
	return set, nil
}

// slotStarts are the event's slot starts in [from, to): its one start for a one-off, else the rule's expansion in
// the series' zone, holidays left out when it skips them.
func slotStarts(e store.SchedEvent, holidays schedpolicy.DateSet, from, to time.Time) []time.Time {
	zone := loadZone(e.TimeZone)
	start := startsLocal(e)
	r := ruleOf(e)
	if r == nil {
		t := start.In(zone)
		if t.Before(from) || !t.Before(to) {
			return nil
		}
		return []time.Time{t}
	}
	var skip func(recur.Date) bool
	if e.SkipHolidays {
		skip = holidays.Has
	}
	return recur.Expand(*r, start, zone, skip, from, to, recur.MaxOccurrences)
}

// materialise adds the event's missing occurrences from from up to the horizon with status, and returns the rows
// added. Dates in taken (the local dates of rows the series has, in any status) get none, so a cancelled or moved
// session is never made again.
func (s *Service) materialise(ctx context.Context, q store.Q, e store.SchedEvent, from time.Time, taken map[recur.Date]bool,
	status string) (int64, error) {
	holidays, err := holidaySet(ctx, q, e.WorkspaceID)
	if err != nil {
		return 0, err
	}
	horizon := s.horizon()
	zone := loadZone(e.TimeZone)
	var slots []store.SchedSlot
	for _, t := range slotStarts(e, holidays, from, horizon) {
		if taken[recur.DateOf(t.In(zone))] {
			continue
		}
		slots = append(slots, store.SchedSlot{ID: auth.NewID("soc"), OriginalStart: t, StartsAt: t,
			EndsAt: t.Add(time.Duration(e.DurationMinutes) * time.Minute)})
	}
	var until *time.Time
	if e.RRule != nil {
		until = &horizon
	}
	return q.MaterialiseOccurrences(ctx, e.WorkspaceID, e.ID, slots, status, until, s.now())
}

// hours is the host's availability; a host who never saved hours has none (and gets no "outside hours" warnings).
func hostHours(ctx context.Context, q store.Q, ws store.Workspace, hostID string) (schedpolicy.Hours, store.SchedHost, error) {
	h, err := q.SchedulingHost(ctx, ws.ID, hostID)
	if errors.Is(err, store.ErrNotFound) {
		return schedpolicy.Hours{Zone: ws.Location()}, store.SchedHost{UserID: hostID, Bookable: true}, nil
	}
	if err != nil {
		return schedpolicy.Hours{}, h, err
	}
	zone := ws.Location()
	if h.TimeZone != nil {
		zone = loadZone(*h.TimeZone)
	}
	hours := schedpolicy.Hours{Zone: zone, Overrides: map[recur.Date]schedpolicy.Override{}}
	for _, w := range h.Weekly {
		start, err1 := schedpolicy.ParseClock(w.Start)
		end, err2 := schedpolicy.ParseClock(w.End)
		if err1 == nil && err2 == nil {
			hours.Weekly = append(hours.Weekly, schedpolicy.Window{Day: time.Weekday(w.Weekday % 7), Start: start, End: end})
		}
	}
	for _, o := range h.Overrides {
		d, err := recur.ParseDate(o.Day)
		if err != nil {
			continue
		}
		if o.Start == nil || o.End == nil {
			hours.Overrides[d] = schedpolicy.Override{Off: true}
			continue
		}
		start, err1 := schedpolicy.ParseClock(*o.Start)
		end, err2 := schedpolicy.ParseClock(*o.End)
		if err1 == nil && err2 == nil {
			hours.Overrides[d] = schedpolicy.Override{Start: start, End: end}
		}
	}
	return hours, h, nil
}

// taken are the host's open sessions (with their titles) and busy times around [from, to).
func (s *Service) taken(ctx context.Context, q store.Q, workspaceID, hostID string, from, to time.Time) ([]schedpolicy.Session, []schedpolicy.Block, error) {
	occs, err := q.HostSessions(ctx, workspaceID, []string{hostID}, from, to)
	if err != nil {
		return nil, nil, err
	}
	ids := make([]string, len(occs))
	for i, o := range occs {
		ids[i] = o.EventID
	}
	events, err := q.SchedEventsByID(ctx, workspaceID, ids)
	if err != nil {
		return nil, nil, err
	}
	sessions := make([]schedpolicy.Session, len(occs))
	for i, o := range occs {
		title := events[o.EventID].Title
		if o.Title != nil {
			title = *o.Title
		}
		sessions[i] = schedpolicy.Session{ID: o.ID, Title: title, Start: o.StartsAt, End: o.EndsAt}
	}
	busy, err := s.cal.Busy(ctx, q, workspaceID, []string{hostID}, from, to)
	return sessions, busy, err
}

// conflicts are the warnings for the host at [start, end), its own occurrence exclude left out.
func (s *Service) conflicts(ctx context.Context, q store.Q, ws store.Workspace, hostID *string, start, end time.Time, exclude string) ([]Conflict, error) {
	if hostID == nil {
		return []Conflict{}, nil
	}
	from, to := schedpolicy.QueryRange(start, end, 0)
	sessions, busy, err := s.taken(ctx, q, ws.ID, *hostID, from, to)
	if err != nil {
		return nil, err
	}
	hours, _, err := hostHours(ctx, q, ws, *hostID)
	if err != nil {
		return nil, err
	}
	holidays, err := holidaySet(ctx, q, ws.ID)
	if err != nil {
		return nil, err
	}
	return conflictViews(schedpolicy.Conflicts(schedpolicy.Candidate{Start: start, End: end, Exclude: exclude}, sessions, busy, hours, holidays)), nil
}

// conflictsOf collects the warnings of occurrences, each once.
func (s *Service) conflictsOf(ctx context.Context, q store.Q, ws store.Workspace, occs []store.SchedOccurrence) ([]Conflict, error) {
	out := []Conflict{}
	seen := map[Conflict]bool{}
	for _, o := range occs {
		cs, err := s.conflicts(ctx, q, ws, o.HostUserID, o.StartsAt, o.EndsAt, o.ID)
		if err != nil {
			return nil, err
		}
		for _, c := range cs {
			if c.OccurrenceID != "" && slices.ContainsFunc(occs, func(x store.SchedOccurrence) bool { return x.ID == c.OccurrenceID }) {
				continue
			}
			if !seen[c] {
				seen[c] = true
				out = append(out, c)
			}
		}
	}
	return out, nil
}

// makeMeeting creates a provider's meeting link through the host's calendar once per event and stores it.
func (s *Service) makeMeeting(ctx context.Context, q store.Q, e *store.SchedEvent, first store.SchedOccurrence) error {
	if e.Mode != "online" || e.MeetingProvider == nil || *e.MeetingProvider == "manual" || e.MeetingURL != nil {
		return nil
	}
	if e.HostUserID == nil {
		return ErrNoConnection
	}
	mctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	u, ref, err := s.cal.CreateMeeting(mctx, e.WorkspaceID, *e.HostUserID, *e.MeetingProvider, first)
	if err != nil {
		return err
	}
	e.MeetingURL, e.MeetingRef = &u, &ref
	return q.SaveSchedEvent(ctx, *e)
}

func (s *Service) createEvent(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, append(slices.Clone(eventFields), "notify")...); err != nil {
		return err
	}
	notify := notifyOf(body)
	ctx, now := r.Context(), s.now()
	var out map[string]any
	var occIDs []string
	var eventID string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		e := store.SchedEvent{ID: auth.NewID("sev"), WorkspaceID: sess.Workspace.ID, CreatedBy: &sess.User.ID, CreatedAt: now, UpdatedAt: now}
		if _, err := s.applyEvent(ctx, q, sess, &e, body, true); err != nil {
			return err
		}
		if err := q.CreateSchedEvent(ctx, e); err != nil {
			return err
		}
		if _, err := s.materialise(ctx, q, e, time.Time{}, nil, store.SchedScheduled); err != nil {
			return err
		}
		occs, err := q.SchedOccurrences(ctx, e.WorkspaceID, store.SchedOccurrenceFilter{EventID: e.ID})
		if err != nil {
			return err
		}
		if len(occs) == 0 {
			return validationFailed(map[string]string{"recurrence": "No session falls within the series: check its start, end and holidays."})
		}
		if err := s.makeMeeting(ctx, q, &e, occs[0]); err != nil {
			return err
		}
		eventID = e.ID
		for _, o := range occs {
			occIDs = append(occIDs, o.ID)
		}
		if err := s.cal.Enqueue(ctx, q, e.WorkspaceID, occIDs); err != nil {
			return err
		}
		first := occs[:min(len(occs), 20)]
		res, err := s.resolve(ctx, q, e.WorkspaceID, []store.SchedEvent{e}, first)
		if err != nil {
			return err
		}
		cs, err := s.conflictsOf(ctx, q, sess.Workspace, first)
		if err != nil {
			return err
		}
		views := make([]Occurrence, len(first))
		for i, o := range first {
			views[i] = res.occurrence(o)
		}
		out = map[string]any{"event": res.event(e), "occurrences": views, "conflicts": cs}
		return nil
	})
	if err != nil {
		return err
	}
	s.tell(ctx, changes{{Kind: ChangeInvited, WorkspaceID: sess.Workspace.ID, EventID: eventID, OccurrenceIDs: occIDs,
		ActorID: sess.User.ID, Notify: notify}})
	auth.WriteJSON(w, http.StatusCreated, data(out))
	return nil
}

func notifyOf(body map[string]json.RawMessage) bool {
	var b bool
	if raw, ok := body["notify"]; ok && json.Unmarshal(raw, &b) == nil {
		return b
	}
	return true
}

func (s *Service) getEvent(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	var out Event
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.SchedEvent(ctx, sess.Workspace.ID, r.PathValue("id"), false)
		if err != nil {
			return err
		}
		res, err := s.resolve(ctx, q, e.WorkspaceID, []store.SchedEvent{e}, nil)
		out = res.event(e)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) getOccurrence(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	var out Occurrence
	err := s.db.Tx(ctx, func(q store.Q) (err error) {
		out, err = s.occurrenceView(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		out.Conflicts = []Conflict{}
		if isOpen(out.Status) && out.Host != nil {
			out.Conflicts, err = s.conflicts(ctx, q, sess.Workspace, &out.Host.ID, out.StartsAt, out.EndsAt, out.ID)
		}
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// rangeOf reads from and to (RFC 3339, at most maxDays apart); unset, from is the start of today in the workspace
// zone and to defaults days later.
func (s *Service) rangeOf(r *http.Request, ws store.Workspace, days, maxDays int) (time.Time, time.Time, error) {
	f := form{}
	now := s.now().In(ws.Location())
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, ws.Location()).UTC()
	if v := r.URL.Query().Get("from"); v != "" {
		from, _ = f.instant("from", json.RawMessage(`"`+v+`"`))
	}
	to := from.AddDate(0, 0, days)
	if v := r.URL.Query().Get("to"); v != "" {
		to, _ = f.instant("to", json.RawMessage(`"`+v+`"`))
	}
	if len(f) == 0 && (!from.Before(to) || to.Sub(from) > time.Duration(maxDays)*24*time.Hour) {
		f.fail("to", "Choose an end after the start, at most "+strconv.Itoa(maxDays)+" days later.")
	}
	return from, to, f.err()
}

// hostsOf reads ?host=: me, all (default) or member ids separated by commas; nil means every host.
func hostsOf(r *http.Request, sess store.Session) []string {
	v := r.URL.Query().Get("host")
	if v == "" || v == "all" {
		return nil
	}
	var out []string
	for _, h := range strings.Split(v, ",") {
		if h == "me" {
			h = sess.User.ID
		}
		if h = strings.TrimSpace(h); h != "" {
			out = append(out, h)
		}
	}
	return out
}

func listOf(v string) []string {
	if v == "" {
		return nil
	}
	return strings.Split(v, ",")
}

func (s *Service) listOccurrences(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	query := r.URL.Query()
	toMark := query.Get("to_mark") == "true"
	days := 31
	if toMark && query.Get("from") == "" {
		query.Set("from", s.now().AddDate(0, 0, -100).Format(time.RFC3339))
		r.URL.RawQuery = query.Encode()
		days = 100
	}
	from, to, err := s.rangeOf(r, sess.Workspace, days, 100)
	if err != nil {
		return err
	}
	statuses := listOf(query.Get("status"))
	for _, st := range statuses {
		if !slices.Contains([]string{store.SchedRequested, store.SchedScheduled, store.SchedRescheduled, store.SchedAttended,
			store.SchedNoShow, store.SchedCancelledOnTime, store.SchedCancelledLate, store.SchedDeclined}, st) {
			return validationFailed(map[string]string{"status": "Unknown status " + st + "."})
		}
	}
	if toMark {
		statuses = []string{store.SchedScheduled, store.SchedRescheduled}
	}
	ctx := r.Context()
	var out []Occurrence
	err = s.db.Tx(ctx, func(q store.Q) error {
		occs, err := q.SchedOccurrences(ctx, sess.Workspace.ID, store.SchedOccurrenceFilter{From: &from, To: &to, HostIDs: hostsOf(r, sess),
			ClientID: query.Get("client_id"), EngagementID: query.Get("engagement_id"), Statuses: statuses})
		if err != nil {
			return err
		}
		if toMark {
			now := s.now()
			occs = slices.DeleteFunc(occs, func(o store.SchedOccurrence) bool { return o.EndsAt.After(now) })
		}
		out, err = s.occurrenceViews(ctx, q, sess.Workspace.ID, occs)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) listBusy(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	from, to, err := s.rangeOf(r, sess.Workspace, 7, 100)
	if err != nil {
		return err
	}
	ctx := r.Context()
	out := []BusyBlock{}
	err = s.db.Tx(ctx, func(q store.Q) error {
		hosts := hostsOf(r, sess)
		if hosts == nil {
			members, err := q.SchedMembers(ctx, sess.Workspace.ID)
			if err != nil {
				return err
			}
			hosts = slices.Sorted(maps.Keys(members))
		}
		for _, h := range hosts {
			blocks, err := s.cal.Busy(ctx, q, sess.Workspace.ID, []string{h}, from, to)
			if err != nil {
				return err
			}
			for _, b := range blocks {
				out = append(out, BusyBlock{HostID: h, StartsAt: b.Start, EndsAt: b.End})
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	slices.SortStableFunc(out, func(a, b BusyBlock) int { return a.StartsAt.Compare(b.StartsAt) })
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) getConflicts(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	query := r.URL.Query()
	f := form{}
	host := query.Get("host_id")
	if host == "" {
		f.fail("host_id", "Choose a host.")
	}
	start, _ := f.instant("starts_at", json.RawMessage(`"`+query.Get("starts_at")+`"`))
	end, _ := f.instant("ends_at", json.RawMessage(`"`+query.Get("ends_at")+`"`))
	if len(f) == 0 && (!end.After(start) || end.Sub(start) > schedpolicy.MaxDuration) {
		f.fail("ends_at", "End after the start, at most 24 hours later.")
	}
	if err := f.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var out []Conflict
	err := s.db.Tx(ctx, func(q store.Q) (err error) {
		out, err = s.conflicts(ctx, q, sess.Workspace, &host, start, end, query.Get("exclude"))
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}
