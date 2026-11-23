package scheduling

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// thisFields may change on one occurrence of a series alone; the others belong to the series.
var thisFields = []string{"title", "location", "meeting", "starts_local", "time_zone", "duration_minutes", "host_id"}

func scopeOf(body map[string]json.RawMessage) (string, error) {
	raw, ok := body["scope"]
	if !ok {
		return "this", nil
	}
	var scope string
	if json.Unmarshal(raw, &scope) != nil || !slices.Contains([]string{"this", "following", "all"}, scope) {
		return "", validationFailed(map[string]string{"scope": "Choose this, following or all."})
	}
	return scope, nil
}

// lockOccurrence locks the occurrence's event, then the occurrence (always in this order, so edits of one series
// serialise without deadlocks).
func lockOccurrence(ctx context.Context, q store.Q, workspaceID, id string) (store.SchedEvent, store.SchedOccurrence, error) {
	o, err := q.SchedOccurrence(ctx, workspaceID, id, false)
	if err != nil {
		return store.SchedEvent{}, o, err
	}
	e, err := q.SchedEvent(ctx, workspaceID, o.EventID, true)
	if err != nil {
		return e, o, err
	}
	o, err = q.SchedOccurrence(ctx, workspaceID, id, true)
	return e, o, err
}

// edit is one write's bookkeeping: the occurrences it touched, cancelled and added, for the calendar and the client.
type edit struct {
	touched, cancelled, added []string
	kept                      int
	ended                     string // a "following" split: the old series, which now ends before it
}

func (s *Service) patchOccurrence(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, append(slices.Clone(eventFields), "notify", "scope", "allow_day_off")...); err != nil {
		return err
	}
	allowDayOff := flagOf(body, "allow_day_off")
	_, moves := body["starts_local"]
	delete(body, "allow_day_off")
	scope, err := scopeOf(body)
	if err != nil {
		return err
	}
	notify := notifyOf(body)
	delete(body, "notify")
	delete(body, "scope")
	ctx := r.Context()
	var out Occurrence
	var ed edit
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		e, o, err := lockOccurrence(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		if !isOpen(o.Status) {
			return errClosed
		}
		switch {
		case e.RRule == nil:
			ed, err = s.editOneOff(ctx, q, sess, e, o, body)
		case scope == "this":
			ed, err = s.editThis(ctx, q, sess, e, o, body)
		case scope == "following" && o.OriginalStart.After(startsLocal(e).In(loadZone(e.TimeZone))):
			ed, err = s.editFollowing(ctx, q, sess, e, o, body)
		default: // "following" from the first session is the whole series
			ed, err = s.editAll(ctx, q, sess, e, o, body)
		}
		if err != nil {
			return err
		}
		// Moving one session onto another day that is a day off needs the same deliberate yes as creating it there.
		if moves && !allowDayOff && (e.RRule == nil || scope == "this") {
			moved, err := q.SchedOccurrence(ctx, sess.Workspace.ID, o.ID, false)
			if err != nil {
				return err
			}
			zone := sess.Workspace.Location()
			if recur.DateOf(moved.StartsAt.In(zone)) != recur.DateOf(o.StartsAt.In(zone)) {
				if err := refuseDayOff(ctx, q, sess.Workspace, moved.StartsAt); err != nil {
					return err
				}
			}
		}
		if err := s.cal.Enqueue(ctx, q, sess.Workspace.ID, slices.Concat(ed.touched, ed.cancelled, ed.added)); err != nil {
			return err
		}
		out, err = s.occurrenceView(ctx, q, sess.Workspace.ID, o.ID)
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
	s.tell(ctx, ed.changes(sess.Workspace.ID, out.EventID, sess.User.ID, notify))
	details := map[string]any{}
	if scope == "all" {
		details["kept"] = ed.kept
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out, "details": details})
	return nil
}

func (ed edit) changes(workspaceID, eventID, actor string, notify bool) changes {
	return changes{
		{Kind: ChangeUpdated, WorkspaceID: workspaceID, EventID: eventID, OccurrenceIDs: ed.touched, EndedEventID: ed.ended, ActorID: actor, Notify: notify},
		{Kind: ChangeCancelled, WorkspaceID: workspaceID, EventID: eventID, OccurrenceIDs: ed.cancelled, ActorID: actor, Notify: notify},
		{Kind: ChangeInvited, WorkspaceID: workspaceID, EventID: eventID, OccurrenceIDs: ed.added, ActorID: actor, Notify: notify},
	}
}

// retime sets the occurrence's start and end; a new start of an upcoming session is a reschedule.
func (s *Service) retime(o *store.SchedOccurrence, start, end time.Time) {
	if !start.Equal(o.StartsAt) {
		o.TimedAt = s.now()
		if o.Status == store.SchedScheduled {
			o.Status = store.SchedRescheduled
		}
	}
	o.StartsAt, o.EndsAt = start, end
}

func duration(e store.SchedEvent) time.Duration {
	return time.Duration(e.DurationMinutes) * time.Minute
}

func (s *Service) editOneOff(ctx context.Context, q store.Q, sess store.Session, e store.SchedEvent, o store.SchedOccurrence,
	body map[string]json.RawMessage) (edit, error) {
	if _, err := s.applyEvent(ctx, q, sess, &e, body, false); err != nil {
		return edit{}, err
	}
	e.Sequence++
	e.UpdatedAt = s.now()
	if err := q.SaveSchedEvent(ctx, e); err != nil {
		return edit{}, err
	}
	start := startsLocal(e).In(loadZone(e.TimeZone))
	s.retime(&o, start, start.Add(duration(e)))
	o.HostUserID, o.EngagementID = e.HostUserID, e.EngagementID
	o.Title, o.Location, o.MeetingURL = nil, nil, nil
	o.Sequence++
	o.UpdatedAt = s.now()
	if err := q.SaveSchedOccurrence(ctx, o); err != nil {
		return edit{}, err
	}
	return edit{touched: []string{o.ID}}, s.makeMeeting(ctx, q, &e, o)
}

func (s *Service) editThis(ctx context.Context, q store.Q, sess store.Session, e store.SchedEvent, o store.SchedOccurrence,
	body map[string]json.RawMessage) (edit, error) {
	f := form{}
	for k := range body {
		if !slices.Contains(thisFields, k) {
			f.fail(k, "This applies to every session of the series: choose this and following, or all sessions.")
		}
	}
	if err := f.err(); err != nil {
		return edit{}, err
	}
	c := e // read through the event's rules, keep only what the occurrence may hold
	in, err := s.applyEvent(ctx, q, sess, &c, body, false)
	if err != nil {
		return edit{}, err
	}
	if in.set["meeting"] {
		if c.MeetingProvider == nil || e.MeetingProvider == nil || *c.MeetingProvider != *e.MeetingProvider || *c.MeetingProvider != "manual" {
			return edit{}, validationFailed(map[string]string{"meeting": "Only a manual link can differ for one session."})
		}
		o.MeetingURL = c.MeetingURL
	}
	if in.set["title"] {
		o.Title = &c.Title
	}
	if in.set["location"] {
		o.Location = c.Location
	}
	if in.set["host_id"] {
		o.HostUserID = c.HostUserID
	}
	start, end := o.StartsAt, o.EndsAt
	if in.set["starts_local"] {
		start = startsLocal(c).In(loadZone(c.TimeZone))
		end = start.Add(o.EndsAt.Sub(o.StartsAt))
	}
	if in.set["duration_minutes"] {
		end = start.Add(duration(c))
	}
	s.retime(&o, start, end)
	o.IsException = true
	o.Sequence++
	o.UpdatedAt = s.now()
	return edit{touched: []string{o.ID}}, q.SaveSchedOccurrence(ctx, o)
}

// seriesTime reads starts_local on an occurrence of a series as the series' new time of day; moving to another day
// is a change of the repeat rule.
func seriesTime(e *store.SchedEvent, old store.SchedEvent, o store.SchedOccurrence, set map[string]bool) error {
	if !set["starts_local"] {
		return nil
	}
	given := startsLocal(*e)
	if given.Date != recur.DateOf(o.OriginalStart.In(loadZone(old.TimeZone))) {
		return validationFailed(map[string]string{"starts_local": "To move the series to other days, change its repeat rule."})
	}
	e.StartsLocal = wall(startsLocal(old).Date.At(given.Hour, given.Minute))
	return nil
}

func changesRule(set map[string]bool) bool {
	return slices.ContainsFunc(ruleFields, func(k string) bool { return set[k] })
}

func (s *Service) editAll(ctx context.Context, q store.Q, sess store.Session, e store.SchedEvent, o store.SchedOccurrence,
	body map[string]json.RawMessage) (edit, error) {
	old := e
	in, err := s.applyEvent(ctx, q, sess, &e, body, false)
	if err != nil {
		return edit{}, err
	}
	if err := seriesTime(&e, old, o, in.set); err != nil {
		return edit{}, err
	}
	if in.set["starts_local"] && !in.set["recurrence"] {
		setRule(&e, ruleOf(old))
	}
	e.Sequence++
	e.UpdatedAt = s.now()
	if err := q.SaveSchedEvent(ctx, e); err != nil {
		return edit{}, err
	}
	now := s.now()
	rows, err := q.SchedOccurrences(ctx, e.WorkspaceID, store.SchedOccurrenceFilter{EventID: e.ID, From: &now})
	if err != nil {
		return edit{}, err
	}
	first := slices.IndexFunc(rows, func(x store.SchedOccurrence) bool { return isOpen(x.Status) })
	ed, err := s.reconcile(ctx, q, sess.User.ID, old, e, rows, now, in.set)
	if err != nil {
		return ed, err
	}
	if first >= 0 {
		err = s.makeMeeting(ctx, q, &e, rows[first])
	}
	return ed, err
}

func (s *Service) editFollowing(ctx context.Context, q store.Q, sess store.Session, old store.SchedEvent, o store.SchedOccurrence,
	body map[string]json.RawMessage) (edit, error) {
	oldZone := loadZone(old.TimeZone)
	from := recur.DateOf(o.OriginalStart.In(oldZone))
	n := old
	n.ID, n.Sequence, n.CreatedBy, n.CreatedAt, n.UpdatedAt = auth.NewID("sev"), 0, &sess.User.ID, s.now(), s.now()
	n.MeetingURL, n.MeetingRef = old.MeetingURL, old.MeetingRef
	n.StartsLocal = wall(from.At(startsLocal(old).Hour, startsLocal(old).Minute))
	in, err := s.applyEvent(ctx, q, sess, &n, body, false)
	if err != nil {
		return edit{}, err
	}
	holidays, err := holidaySet(ctx, q, old.WorkspaceID)
	if err != nil {
		return edit{}, err
	}
	rule := ruleOf(old)
	before := len(slotStarts(old, holidays, time.Time{}, o.OriginalStart))
	if !in.set["recurrence"] {
		r := *rule
		if r.Count > 0 {
			r.Count = max(r.Count-before, 1)
		}
		setRule(&n, &r)
	}
	// The old series ends the day before: its RRULE gets UNTIL (or the count it had made), sequence + 1.
	if rule.Count > 0 {
		rule.Count = max(before, 1)
	} else {
		until := from.AddDays(-1)
		rule.Until = &until
	}
	setRule(&old, rule)
	old.Sequence++
	old.UpdatedAt = s.now()
	if err := q.SaveSchedEvent(ctx, old); err != nil {
		return edit{}, err
	}
	if err := q.InsertSchedEvent(ctx, n); err != nil {
		return edit{}, err
	}
	rows, err := q.SchedOccurrences(ctx, old.WorkspaceID, store.SchedOccurrenceFilter{EventID: old.ID})
	if err != nil {
		return edit{}, err
	}
	rows = slices.DeleteFunc(rows, func(x store.SchedOccurrence) bool { return x.OriginalStart.Before(o.OriginalStart) })
	ed, err := s.reconcile(ctx, q, sess.User.ID, old, n, rows, o.OriginalStart, in.set)
	if err != nil {
		return ed, err
	}
	ed.ended = old.ID
	moved, err := q.SchedOccurrence(ctx, old.WorkspaceID, o.ID, false)
	if err != nil {
		return ed, err
	}
	return ed, s.makeMeeting(ctx, q, &n, moved)
}

// reconcile fits rows (an event's occurrences from from on) to target's rule: each open row keeps its id and takes
// the new slot of its date (a row changed on its own keeps its time), a row whose date has no slot any more is
// cancelled (the business's change, not counted), closed rows stay as they are, and dates without a row get new
// occurrences. Rows move to target when it is another event (a "following" split). Fields set in the change reach
// every open row, those changed on their own included.
func (s *Service) reconcile(ctx context.Context, q store.Q, actor string, old, target store.SchedEvent, rows []store.SchedOccurrence,
	from time.Time, set map[string]bool) (edit, error) {
	var ed edit
	holidays, err := holidaySet(ctx, q, target.WorkspaceID)
	if err != nil {
		return ed, err
	}
	oldZone, zone := loadZone(old.TimeZone), loadZone(target.TimeZone)
	slots := map[recur.Date]time.Time{}
	if changesRule(set) || old.ID != target.ID {
		for _, t := range slotStarts(target, holidays, from, s.horizon()) {
			slots[recur.DateOf(t.In(zone))] = t
		}
	}
	taken := map[recur.Date]bool{}
	now := s.now()
	final := make([]store.SchedOccurrence, 0, len(rows))
	for _, row := range rows {
		d := recur.DateOf(row.OriginalStart.In(oldZone))
		taken[d] = true
		row.EventID = target.ID
		if !isOpen(row.Status) {
			final = append(final, row)
			continue
		}
		if changesRule(set) || old.ID != target.ID {
			t, ok := slots[d]
			switch {
			case !ok:
				row.Status, row.Late, row.StatusChangedBy, row.StatusChangedAt = store.SchedCancelledOnTime, false, &actor, &now
				ed.cancelled = append(ed.cancelled, row.ID)
			case row.IsException:
				row.OriginalStart = t
				ed.kept++
			default:
				row.OriginalStart = t
				s.retime(&row, t, t.Add(duration(target)))
			}
		}
		if isOpen(row.Status) {
			ed.touched = append(ed.touched, row.ID)
		}
		row.HostUserID, row.EngagementID = target.HostUserID, target.EngagementID
		if set["title"] {
			row.Title = nil
		}
		if set["location"] {
			row.Location = nil
		}
		if set["meeting"] {
			row.MeetingURL = nil
		}
		row.Sequence++
		row.UpdatedAt = now
		final = append(final, row)
	}
	// Two passes: a row may take the slot another row of the event still holds (UNIQUE (event_id, original_start)).
	for _, row := range final {
		parked := row
		parked.OriginalStart = row.OriginalStart.AddDate(1000, 0, 0)
		if err := q.SaveSchedOccurrence(ctx, parked); err != nil {
			return ed, err
		}
	}
	for _, row := range final {
		if err := q.SaveSchedOccurrence(ctx, row); err != nil {
			return ed, err
		}
	}
	if err := closeRequests(ctx, q, target.WorkspaceID, ed.cancelled, actor, now); err != nil {
		return ed, err
	}
	if !changesRule(set) && old.ID == target.ID {
		return ed, nil
	}
	before, err := q.SchedOccurrences(ctx, target.WorkspaceID, store.SchedOccurrenceFilter{EventID: target.ID})
	if err != nil {
		return ed, err
	}
	if _, err := s.materialise(ctx, q, target, from, taken, store.SchedScheduled); err != nil {
		return ed, err
	}
	after, err := q.SchedOccurrences(ctx, target.WorkspaceID, store.SchedOccurrenceFilter{EventID: target.ID})
	if err != nil {
		return ed, err
	}
	for _, x := range after {
		if !slices.ContainsFunc(before, func(b store.SchedOccurrence) bool { return b.ID == x.ID }) {
			ed.added = append(ed.added, x.ID)
		}
	}
	return ed, nil
}

// closeRequests ends the open requests of occurrences the business cancelled: a cancel request is granted, the
// others declined.
func closeRequests(ctx context.Context, q store.Q, workspaceID string, occurrenceIDs []string, actor string, now time.Time) error {
	for _, id := range occurrenceIDs {
		r, err := q.OpenSchedRequest(ctx, workspaceID, id)
		if err != nil {
			if isNotFound(err) {
				continue
			}
			return err
		}
		r.Status = "declined"
		if r.Kind == "cancel" {
			r.Status = "approved"
		}
		r.DecidedAt, r.DecidedBy = &now, &actor
		if err := q.SaveSchedRequest(ctx, r); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) cancelOccurrence(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, "scope", "as", "reason", "notify"); err != nil {
		return err
	}
	scope, err := scopeOf(body)
	if err != nil {
		return err
	}
	f := form{}
	as := ""
	if raw, ok := body["as"]; ok && (json.Unmarshal(raw, &as) != nil || as != "on_time" && as != "late") {
		f.fail("as", "Choose on_time or late.")
	}
	var reason *string
	if raw, ok := body["reason"]; ok {
		reason = f.text("reason", raw, 0, 500)
	}
	if err := f.err(); err != nil {
		return err
	}
	ctx, now := r.Context(), s.now()
	var out Occurrence
	var ed edit
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		e, o, err := lockOccurrence(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		if !isOpen(o.Status) {
			return errClosed
		}
		set, err := q.SchedulingSettings(ctx, sess.Workspace.ID)
		if err != nil {
			return err
		}
		late := as == "late"
		if as == "" {
			deadline, err := s.deadline(ctx, q, sess.Workspace, set, o.StartsAt)
			if err != nil {
				return err
			}
			late = now.After(deadline)
		}
		actor := actorOf(sess)
		if err := s.cancelOne(ctx, q, actor, &o, late); err != nil {
			return err
		}
		ed.cancelled = append(ed.cancelled, o.ID)
		if e.RRule != nil && scope != "this" {
			more, err := s.endSeries(ctx, q, actor.id, e, o, scope)
			if err != nil {
				return err
			}
			ed.cancelled = append(ed.cancelled, more...)
		}
		if err := closeRequests(ctx, q, e.WorkspaceID, ed.cancelled, actor.id, now); err != nil {
			return err
		}
		if err := s.audit(ctx, q, sess.Workspace.ID, &actor.id, "scheduling.cancelled", o.ID, map[string]any{"occurrence_id": o.ID,
			"as": map[bool]string{true: "late", false: "on_time"}[late], "by": "staff", "scope": scope, "reason": reason}); err != nil {
			return err
		}
		if err := s.cal.Enqueue(ctx, q, e.WorkspaceID, ed.cancelled); err != nil {
			return err
		}
		out, err = s.occurrenceView(ctx, q, sess.Workspace.ID, o.ID)
		return err
	})
	if err != nil {
		return err
	}
	s.tell(ctx, ed.changes(sess.Workspace.ID, out.EventID, sess.User.ID, notifyOf(body)))
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// deadline is the last moment an occurrence starting at start can be cancelled on time under the settings.
func (s *Service) deadline(ctx context.Context, q store.Q, ws store.Workspace, set store.SchedSettings, start time.Time) (time.Time, error) {
	holidays, err := holidaySet(ctx, q, ws.ID)
	if err != nil {
		return time.Time{}, err
	}
	return schedpolicy.Deadline(start, policyOf(set), holidays, ws.Location()), nil
}

func policyOf(set store.SchedSettings) schedpolicy.Policy {
	p := schedpolicy.Policy{NoticeMinutes: set.NoticeMinutes, CutoffSkipsHolidays: set.CutoffSkipsHolidays}
	if set.CutoffTime != nil {
		if c, err := schedpolicy.ParseClock(*set.CutoffTime); err == nil {
			p.Cutoff = &c
		}
	}
	for _, d := range set.CutoffDays {
		p.CutoffDays = append(p.CutoffDays, time.Weekday(d%7))
	}
	return p
}

// cancelOne cancels an open occurrence on time or late; a late one that counts logs its engagement entry.
func (s *Service) cancelOne(ctx context.Context, q store.Q, a actor, o *store.SchedOccurrence, late bool) error {
	now := s.now()
	o.Status, o.Late = store.SchedCancelledOnTime, false
	if late {
		o.Status, o.Late = store.SchedCancelledLate, true
	}
	o.StatusChangedBy, o.StatusChangedAt = a.ref(), &now
	o.Sequence++
	o.UpdatedAt = now
	if err := q.SaveSchedOccurrence(ctx, *o); err != nil {
		return err
	}
	return s.syncEntries(ctx, q, a, *o)
}

// endSeries cancels the series' open occurrences after o ("following") or from now on ("all"), on time, and ends
// its rule so the daily job makes no more.
func (s *Service) endSeries(ctx context.Context, q store.Q, actor string, e store.SchedEvent, o store.SchedOccurrence, scope string) ([]string, error) {
	now := s.now()
	rows, err := q.SchedOccurrences(ctx, e.WorkspaceID, store.SchedOccurrenceFilter{EventID: e.ID})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, row := range rows {
		after := row.OriginalStart.After(o.OriginalStart)
		if scope == "all" {
			after = row.StartsAt.After(now)
		}
		if row.ID == o.ID || !after || !isOpen(row.Status) {
			continue
		}
		row.Status, row.StatusChangedBy, row.StatusChangedAt = store.SchedCancelledOnTime, &actor, &now
		row.Sequence++
		row.UpdatedAt = now
		if err := q.SaveSchedOccurrence(ctx, row); err != nil {
			return nil, err
		}
		out = append(out, row.ID)
	}
	zone := loadZone(e.TimeZone)
	end := recur.DateOf(o.OriginalStart.In(zone))
	if scope == "all" {
		end = recur.DateOf(now.In(zone))
	}
	if first := startsLocal(e).Date; end.Before(first) {
		end = first
	}
	rule := ruleOf(e)
	rule.Count, rule.Until = 0, &end
	setRule(&e, rule)
	e.Sequence++
	e.UpdatedAt = now
	return out, q.SaveSchedEvent(ctx, e)
}
