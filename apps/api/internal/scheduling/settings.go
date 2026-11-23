package scheduling

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// settingsView is the settings with the policy as the portal words it.
type settingsView struct {
	store.SchedSettings
	PolicyText string `json:"policy_text"`
}

func (s *Service) getSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	set, err := s.db.SchedulingSettings(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(settingsView{set, schedpolicy.PolicyText(policyOf(set), langOf(r))}))
	return nil
}

func langOf(r *http.Request) string {
	if l := r.URL.Query().Get("lang"); l != "" {
		return l
	}
	return r.Header.Get("Accept-Language")
}

var clockRe = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func validSettings(set store.SchedSettings) error {
	f := form{}
	if set.BookingMode != "staff" && set.BookingMode != "clients" {
		f.fail("booking_mode", "Choose staff or clients.")
	}
	if set.Confirmation != "auto" && set.Confirmation != "manual" {
		f.fail("confirmation", "Choose auto or manual.")
	}
	if set.NoticeMinutes < 0 || set.NoticeMinutes > 20160 {
		f.fail("notice_minutes", "Enter 0 to 20160 minutes (14 days).")
	}
	if set.CutoffTime != nil && !clockRe.MatchString(*set.CutoffTime) {
		f.fail("cutoff_time", "Enter a time such as 14:00.")
	}
	days := slices.Clone(set.CutoffDays)
	slices.Sort(days)
	if len(slices.Compact(days)) != len(set.CutoffDays) || slices.ContainsFunc(days, func(d int) bool { return d < 1 || d > 7 }) ||
		set.CutoffTime != nil && len(days) == 0 {
		f.fail("cutoff_days", "Choose the weekdays (1 = Monday … 7 = Sunday), each once.")
	}
	for k, list := range map[string][]int{"client_reminders": set.ClientReminders, "host_reminders": set.HostReminders} {
		sorted := slices.Clone(list)
		slices.Sort(sorted)
		if len(list) > 5 || len(slices.Compact(sorted)) != len(list) || slices.ContainsFunc(list, func(m int) bool { return m < 1 || m > 20160 }) {
			f.fail(k, "Choose up to 5 different reminders, 1 minute to 14 days before.")
		}
	}
	if a := set.AutoAttendedAfterHours; a != nil && (*a < 1 || *a > 720) {
		f.fail("auto_attended_after_hours", "Enter 1 to 720 hours, or none.")
	}
	if set.FeedDetails != "full" && set.FeedDetails != "busy" {
		f.fail("feed_details", "Choose full or busy.")
	}
	if l := set.DefaultLocation; l != nil && len([]rune(*l)) > 500 {
		f.fail("default_location", "Use at most 500 characters.")
	}
	return f.err()
}

func (s *Service) putSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errOwnerAdmin
	}
	ctx := r.Context()
	set, err := s.db.SchedulingSettings(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	if !s.auth.Decode(w, r, &set) { // fields left out keep their value
		return nil
	}
	if set.CutoffDays == nil {
		set.CutoffDays = []int{}
	}
	if err := validSettings(set); err != nil {
		return err
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		if err := q.SaveSchedulingSettings(ctx, sess.Workspace.ID, set, sess.User.ID, s.now()); err != nil {
			return err
		}
		return s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.settings_changed", sess.Workspace.ID, set)
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(settingsView{set, schedpolicy.PolicyText(policyOf(set), langOf(r))}))
	return nil
}

func (s *Service) getHolidays(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	query := r.URL.Query()
	if query.Get("suggest") != "" {
		year, err := strconv.Atoi(query.Get("year"))
		if query.Get("suggest") != "CH" || err != nil || year < 2000 || year > 2100 {
			return validationFailed(map[string]string{"suggest": "Ask for suggest=CH and a year from 2000 to 2100."})
		}
		list, err := schedpolicy.SwissHolidays(year, query.Get("canton"), langOf(r))
		if err != nil {
			return validationFailed(map[string]string{"canton": "Choose a canton code such as ZH."})
		}
		days := make([]store.SchedHoliday, len(list))
		for i, h := range list {
			days[i] = store.SchedHoliday{Day: h.Date.String(), Name: h.Name}
		}
		auth.WriteJSON(w, http.StatusOK, data(map[string]any{"days": days}))
		return nil
	}
	days, err := s.db.SchedulingHolidays(r.Context(), sess.Workspace.ID, "", "")
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"days": days}))
	return nil
}

func (s *Service) putHolidays(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errOwnerAdmin
	}
	var in struct {
		Days []store.SchedHoliday `json:"days"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	f := form{}
	seen := map[string]bool{}
	if len(in.Days) > 400 {
		f.fail("days", "List at most 400 holidays.")
	}
	for i, d := range in.Days {
		k := "days." + strconv.Itoa(i)
		if _, err := recur.ParseDate(d.Day); err != nil || seen[d.Day] {
			f.fail(k+".date", "Enter each date once, such as 2027-08-01.")
		}
		seen[d.Day] = true
		if n := len([]rune(d.Name)); n < 1 || n > 100 {
			f.fail(k+".name", "Name the holiday (up to 100 characters).")
		}
	}
	if err := f.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var ed edit
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		if err := q.ReplaceSchedulingHolidays(ctx, sess.Workspace.ID, in.Days); err != nil {
			return err
		}
		if err := s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.holidays_changed", sess.Workspace.ID,
			map[string]any{"days": len(in.Days)}); err != nil {
			return err
		}
		var err error
		ed, err = s.refitHolidays(ctx, q, sess.User.ID, sess.Workspace.ID)
		if err != nil {
			return err
		}
		return s.cal.Enqueue(ctx, q, sess.Workspace.ID, slices.Concat(ed.touched, ed.cancelled, ed.added))
	})
	if err != nil {
		return err
	}
	s.tell(ctx, changes{
		{Kind: ChangeCancelled, WorkspaceID: sess.Workspace.ID, OccurrenceIDs: ed.cancelled, ActorID: sess.User.ID, Notify: true},
		{Kind: ChangeInvited, WorkspaceID: sess.Workspace.ID, OccurrenceIDs: ed.added, ActorID: sess.User.ID, Notify: true},
	})
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"days": in.Days}))
	return nil
}

// refitHolidays recomputes the upcoming sessions of series that skip holidays: a new holiday cancels its session, a
// removed one gets its session back. Sessions changed on their own keep their time.
func (s *Service) refitHolidays(ctx context.Context, q store.Q, actor, workspaceID string) (edit, error) {
	now := s.now()
	open, err := q.SchedOccurrences(ctx, workspaceID, store.SchedOccurrenceFilter{From: &now})
	if err != nil {
		return edit{}, err
	}
	var all edit
	seen := map[string]bool{}
	for _, o := range open {
		if seen[o.EventID] {
			continue
		}
		seen[o.EventID] = true
		e, err := q.SchedEvent(ctx, workspaceID, o.EventID, true)
		if err != nil {
			return all, err
		}
		if e.RRule == nil || !e.SkipHolidays {
			continue
		}
		rows, err := q.SchedOccurrences(ctx, workspaceID, store.SchedOccurrenceFilter{EventID: e.ID, From: &now})
		if err != nil {
			return all, err
		}
		ed, err := s.reconcile(ctx, q, actor, e, e, rows, now, map[string]bool{"skip_holidays": true}, 0)
		if err != nil {
			return all, err
		}
		all.touched, all.cancelled, all.added = append(all.touched, ed.touched...), append(all.cancelled, ed.cancelled...), append(all.added, ed.added...)
	}
	return all, nil
}

func (s *Service) listEventTypes(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.SchedEventTypes(r.Context(), sess.Workspace.ID, r.URL.Query().Get("archived") == "true")
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

var eventTypeFields = []string{"name", "description", "duration_minutes", "mode", "meeting_provider", "location", "product_id", "unit_price",
	"currency", "host_ids", "buffer_before", "buffer_after", "min_notice_minutes", "max_horizon_days", "slot_step_minutes", "bookable", "color"}

// applyEventType reads body onto t, each field checked; create requires a name and a duration.
func applyEventType(ctx context.Context, q store.Q, workspaceID string, t *store.SchedEventType, body map[string]json.RawMessage, create bool) error {
	if err := decode(body, eventTypeFields...); err != nil {
		return err
	}
	f := form{}
	if raw, ok := body["name"]; ok {
		if n := f.text("name", raw, 1, 100); n != nil {
			t.Name = *n
		}
	} else if create {
		f.fail("name", "Name the event type.")
	}
	if raw, ok := body["description"]; ok {
		t.Description = f.text("description", raw, 0, 2000)
	}
	if raw, ok := body["duration_minutes"]; ok {
		t.DurationMinutes, _ = f.integer("duration_minutes", raw, 5, 720)
	} else if create {
		f.fail("duration_minutes", "Enter a duration of 5 to 720 minutes.")
	}
	if raw, ok := body["mode"]; ok {
		if json.Unmarshal(raw, &t.Mode) != nil || t.Mode != "online" && t.Mode != "live" {
			f.fail("mode", "Choose online or live.")
		}
	}
	if raw, ok := body["meeting_provider"]; ok {
		t.MeetingProvider = nil
		var p string
		if !isNull(raw) && (json.Unmarshal(raw, &p) != nil || !slices.Contains([]string{"manual", "google_meet", "teams"}, p)) {
			f.fail("meeting_provider", "Choose manual, google_meet or teams.")
		} else if p != "" {
			t.MeetingProvider = &p
		}
	}
	if raw, ok := body["location"]; ok {
		t.Location = f.text("location", raw, 0, 500)
	}
	if raw, ok := body["product_id"]; ok {
		t.ProductID = nil
		if !isNull(raw) {
			var id string
			_ = json.Unmarshal(raw, &id)
			if _, err := q.Product(ctx, workspaceID, id); err != nil {
				if !isNotFound(err) {
					return err
				}
				f.fail("product_id", "Choose a product of this workspace.")
			} else {
				t.ProductID = &id
			}
		}
	}
	if raw, ok := body["unit_price"]; ok {
		t.UnitPrice = nil
		if !isNull(raw) {
			if m, ok := invoicecalc.ParseMoney(literal(raw)); ok && m >= 0 && m <= 99_999_999_999 {
				t.UnitPrice = &m
			} else {
				f.fail("unit_price", "Enter a price with at most two decimals.")
			}
		}
	}
	if raw, ok := body["currency"]; ok {
		t.Currency = nil
		var c string
		if !isNull(raw) && (json.Unmarshal(raw, &c) != nil || !currencyRe.MatchString(c)) {
			f.fail("currency", "Enter a currency code such as CHF.")
		} else if c != "" {
			t.Currency = &c
		}
	}
	if raw, ok := body["host_ids"]; ok {
		var ids []string
		if json.Unmarshal(raw, &ids) != nil || len(ids) > 100 {
			f.fail("host_ids", "Choose members as hosts.")
		}
		for _, id := range ids {
			if _, err := q.MemberRole(ctx, workspaceID, id); err != nil {
				if !isNotFound(err) {
					return err
				}
				f.fail("host_ids", "Choose members of this workspace.")
			}
		}
		slices.Sort(ids)
		t.HostIDs = slices.Compact(ids)
	}
	for k, p := range map[string]struct {
		dst    *int
		lo, hi int
	}{"buffer_before": {&t.BufferBefore, 0, 240}, "buffer_after": {&t.BufferAfter, 0, 240},
		"min_notice_minutes": {&t.MinNoticeMinutes, 0, 525600}, "max_horizon_days": {&t.MaxHorizonDays, 1, 365}} {
		if raw, ok := body[k]; ok {
			if n, ok := f.integer(k, raw, p.lo, p.hi); ok {
				*p.dst = n
			}
		}
	}
	if raw, ok := body["slot_step_minutes"]; ok {
		t.SlotStepMinutes = nil
		if !isNull(raw) {
			if n, ok := f.integer("slot_step_minutes", raw, 5, 720); ok {
				t.SlotStepMinutes = &n
			}
		}
	}
	if raw, ok := body["bookable"]; ok {
		t.Bookable, _ = f.boolean("bookable", raw)
	}
	if raw, ok := body["color"]; ok {
		t.Color = f.text("color", raw, 0, 20)
	}
	if t.Mode == "live" {
		t.MeetingProvider = nil
	}
	return f.err()
}

func (s *Service) createEventType(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errOwnerAdmin
	}
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, now := r.Context(), s.now()
	t := store.SchedEventType{ID: auth.NewID("set"), WorkspaceID: sess.Workspace.ID, Mode: "online", MinNoticeMinutes: 720,
		MaxHorizonDays: 60, Bookable: true, HostIDs: []string{}, CreatedAt: now, UpdatedAt: now}
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		if err := applyEventType(ctx, q, sess.Workspace.ID, &t, body, true); err != nil {
			return err
		}
		if err := q.CreateSchedEventType(ctx, t); err != nil {
			return err
		}
		return s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.event_type_changed", t.ID, map[string]any{"event_type_id": t.ID, "change": "created"})
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(t))
	return nil
}

func (s *Service) patchEventType(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errOwnerAdmin
	}
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx := r.Context()
	var t store.SchedEventType
	err := s.db.Tx(ctx, func(q store.Q) (err error) {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		if t, err = q.SchedEventType(ctx, sess.Workspace.ID, r.PathValue("id")); err != nil {
			return err
		}
		if err := applyEventType(ctx, q, sess.Workspace.ID, &t, body, false); err != nil {
			return err
		}
		t.UpdatedAt = s.now()
		if err := q.SaveSchedEventType(ctx, t); err != nil {
			return err
		}
		return s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.event_type_changed", t.ID, map[string]any{"event_type_id": t.ID, "change": "updated"})
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(t))
	return nil
}

func (s *Service) deleteEventType(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errOwnerAdmin
	}
	ctx := r.Context()
	err := s.db.Tx(ctx, func(q store.Q) error {
		archived, err := q.DeleteSchedEventType(ctx, sess.Workspace.ID, r.PathValue("id"), s.now())
		if err != nil {
			return err
		}
		change := map[bool]string{true: "archived", false: "deleted"}[archived]
		return s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.event_type_changed", r.PathValue("id"),
			map[string]any{"event_type_id": r.PathValue("id"), "change": change})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// hostAccess: a member reads and sets their own hours; owners and admins anyone's. Someone not in the workspace is 404.
func (s *Service) hostAccess(ctx context.Context, sess store.Session, userID string) error {
	if userID != sess.User.ID && !canManage(sess) {
		return errOwnerAdmin
	}
	_, err := s.db.MemberRole(ctx, sess.Workspace.ID, userID)
	return err
}

func (s *Service) getHost(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("user_id")
	if id == "me" {
		id = sess.User.ID
	}
	if err := s.hostAccess(ctx, sess, id); err != nil {
		return err
	}
	h, err := s.db.SchedulingHost(ctx, sess.Workspace.ID, id)
	if isNotFound(err) {
		h, err = store.SchedHost{UserID: id, Bookable: true, Weekly: []store.SchedWindow{}, Overrides: []store.SchedOverride{}}, nil
	}
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(h))
	return nil
}

func (s *Service) putHost(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("user_id")
	if id == "me" {
		id = sess.User.ID
	}
	if err := s.hostAccess(ctx, sess, id); err != nil {
		return err
	}
	h := store.SchedHost{Bookable: true, Weekly: []store.SchedWindow{}, Overrides: []store.SchedOverride{}}
	var in struct {
		TimeZone  *string               `json:"time_zone"`
		Bookable  *bool                 `json:"bookable"`
		Color     *string               `json:"color"`
		Weekly    []store.SchedWindow   `json:"weekly"`
		Overrides []store.SchedOverride `json:"overrides"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	f := form{}
	if in.TimeZone != nil {
		raw, _ := json.Marshal(*in.TimeZone)
		if z, ok := f.zone("time_zone", raw); ok {
			h.TimeZone = &z
		}
	}
	if in.Bookable != nil {
		h.Bookable = *in.Bookable
	}
	if in.Color != nil && len(*in.Color) > 20 {
		f.fail("color", "Use at most 20 characters.")
	}
	h.UserID, h.Color = id, in.Color
	if len(in.Weekly) > 50 || len(in.Overrides) > 400 {
		f.fail("weekly", "Too many windows.")
	}
	for i, wd := range in.Weekly {
		if wd.Weekday < 1 || wd.Weekday > 7 || !clockRe.MatchString(wd.Start) || !clockRe.MatchString(wd.End) || wd.Start >= wd.End {
			f.fail("weekly."+strconv.Itoa(i), "Enter a weekday 1–7 and a start before the end (HH:MM).")
		}
	}
	h.Weekly = append(h.Weekly, in.Weekly...)
	seen := map[string]bool{}
	for i, o := range in.Overrides {
		_, err := time.Parse(time.DateOnly, o.Day)
		bad := err != nil || seen[o.Day] || (o.Start == nil) != (o.End == nil)
		if o.Start != nil && o.End != nil {
			bad = bad || !clockRe.MatchString(*o.Start) || !clockRe.MatchString(*o.End) || *o.Start >= *o.End
		}
		if bad {
			f.fail("overrides."+strconv.Itoa(i), "Enter each date once, with a start before the end or neither (the day off).")
		}
		seen[o.Day] = true
	}
	h.Overrides = append(h.Overrides, in.Overrides...)
	if err := f.err(); err != nil {
		return err
	}
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		return q.SaveSchedulingHost(ctx, sess.Workspace.ID, h, s.now())
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(h))
	return nil
}
