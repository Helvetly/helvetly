package scheduling

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// What the client portal reads (scheduling-contract.md, "Portal"): the client's own sessions and what it may book,
// never an internal description, an engagement's price or another client's session.

// ClientSession is a session as its client sees it.
type ClientSession struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	StartsAt   time.Time `json:"starts_at"`
	EndsAt     time.Time `json:"ends_at"`
	TimeZone   string    `json:"time_zone"` // the client's zone, else the workspace's
	Status     string    `json:"status"`
	Late       bool      `json:"late"`
	Mode       string    `json:"mode"`
	MeetingURL *string   `json:"meeting_url"` // open sessions only, from 24 h before the start
	Location   *string   `json:"location"`
	HostName   *string   `json:"host_name"`
	ClientNote *string   `json:"client_note"`
	Request    *Request  `json:"request"`
	// Deadline is the last moment a cancellation is on time (open sessions only).
	Deadline      *time.Time `json:"deadline"`
	CanCancel     bool       `json:"can_cancel"`
	CanReschedule bool       `json:"can_reschedule"`
	// LateCancelCounts and LateRescheduleCounts say whether a late request would use a session (the warning).
	LateCancelCounts     bool `json:"late_cancel_counts"`
	LateRescheduleCounts bool `json:"late_reschedule_counts"`
}

// meetingLead is how long before the start the client sees the meeting link.
const meetingLead = 24 * time.Hour

// ClientSessions are the client's sessions: "upcoming" (open, not yet ended, by start) or "past" (ended or closed,
// the last 12 months, newest first). Without the plan's Scheduling the client still reads them but asks nothing.
func (s *Service) ClientSessions(ctx context.Context, ws store.Workspace, clientID, zone, when string) ([]ClientSession, error) {
	now := s.now()
	from, to := now.Add(-24*time.Hour), now.AddDate(0, 0, horizonDays+1)
	if when == "past" {
		from = now.AddDate(-1, 0, 0)
	}
	out := []ClientSession{}
	err := s.db.Tx(ctx, func(q store.Q) error {
		occs, err := q.SchedOccurrences(ctx, ws.ID, store.SchedOccurrenceFilter{From: &from, To: &to, ClientID: clientID})
		if err != nil {
			return err
		}
		occs = slices.DeleteFunc(occs, func(o store.SchedOccurrence) bool {
			upcoming := isOpen(o.Status) && o.EndsAt.After(now)
			return upcoming != (when != "past")
		})
		if len(occs) == 0 {
			return nil
		}
		r, err := s.resolve(ctx, q, ws.ID, nil, occs)
		if err != nil {
			return err
		}
		allowed, err := q.FeatureAllowed(ctx, ws.ID, store.FeatureScheduling)
		if err != nil {
			return err
		}
		holidays, err := holidaySet(ctx, q, ws.ID)
		if err != nil {
			return err
		}
		policy := policyOf(r.settings)
		for _, o := range occs {
			v := r.occurrence(o)
			e := r.events[o.EventID]
			c := ClientSession{ID: o.ID, Title: v.Title, StartsAt: o.StartsAt, EndsAt: o.EndsAt, TimeZone: cmp.Or(zone, ws.Zone()),
				Status: o.Status, Late: o.Late, Mode: e.Mode, Location: v.Location, ClientNote: e.ClientNote, Request: v.Request,
				LateCancelCounts: r.settings.LateCancelCounts, LateRescheduleCounts: r.settings.LateRescheduleCounts}
			if v.Host != nil {
				c.HostName = &v.Host.Name
			}
			if isOpen(o.Status) {
				if v.Meeting != nil && !now.Before(o.StartsAt.Add(-meetingLead)) {
					c.MeetingURL = v.Meeting.URL
				}
				d := schedpolicy.Deadline(o.StartsAt, policy, holidays, ws.Location())
				c.Deadline = &d
				asking := allowed && v.Request == nil && o.StartsAt.After(now)
				c.CanCancel = asking && o.Status != store.SchedRequested // a pending booking is withdrawn instead
				c.CanReschedule = c.CanCancel
			}
			out = append(out, c)
		}
		if when == "past" {
			slices.Reverse(out)
		}
		return nil
	})
	return out, err
}

// ClientOccurrenceICS is the client's own session as a PUBLISH .ics; another client's is ErrNotFound.
func (s *Service) ClientOccurrenceICS(ctx context.Context, ws store.Workspace, clientID, occurrenceID string) ([]byte, error) {
	var out []byte
	err := s.db.Tx(ctx, func(q store.Q) error {
		o, err := q.SchedOccurrence(ctx, ws.ID, occurrenceID, false)
		if err == nil && o.ClientID != clientID {
			err = store.ErrNotFound
		}
		if err != nil {
			return err
		}
		out, err = s.OccurrenceICS(ctx, q, ws.ID, o.ID, "PUBLISH")
		return err
	})
	return out, err
}

// BookableType is an event type the client can book, with its hosts and, when several of the client's packages fit,
// those packages to choose from.
type BookableType struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Description     *string      `json:"description"`
	DurationMinutes int          `json:"duration_minutes"`
	Mode            string       `json:"mode"`
	Price           *store.Money `json:"price"`
	Currency        *string      `json:"currency"`
	Hosts           []Ref        `json:"hosts"`
	Engagements     []Ref        `json:"engagements"`
}

// BookingInfo is what the portal's Book page shows: whether clients may book, the policy in words and the types.
type BookingInfo struct {
	Mode         string         `json:"mode"`
	Confirmation string         `json:"confirmation"`
	PolicyText   string         `json:"policy_text"`
	EventTypes   []BookableType `json:"event_types"`
}

// Booking is the client's Book page; ErrFeatureDenied without the plan's Scheduling. With booking_mode staff the
// list is empty.
func (s *Service) Booking(ctx context.Context, ws store.Workspace, clientID, lang string) (BookingInfo, error) {
	var out BookingInfo
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, ws.ID, store.FeatureScheduling); err != nil {
			return err
		}
		set, err := q.SchedulingSettings(ctx, ws.ID)
		if err != nil {
			return err
		}
		out = BookingInfo{Mode: set.BookingMode, Confirmation: set.Confirmation, PolicyText: schedpolicy.PolicyText(policyOf(set), lang),
			EventTypes: []BookableType{}}
		if set.BookingMode != "clients" {
			return nil
		}
		out.EventTypes, err = s.bookableTypes(ctx, q, ws, clientID, "", "")
		return err
	})
	return out, err
}

// bookableTypes lists the live, bookable event types that have a host to book (narrowed to one type or one host
// when given); with clientID, the client's packages to choose from when several fit.
func (s *Service) bookableTypes(ctx context.Context, q store.Q, ws store.Workspace, clientID, onlyType, onlyHost string) ([]BookableType, error) {
	types, err := q.SchedEventTypes(ctx, ws.ID, false)
	if err != nil {
		return nil, err
	}
	members, err := q.SchedMembers(ctx, ws.ID)
	if err != nil {
		return nil, err
	}
	out := []BookableType{}
	for _, t := range types {
		if !t.Bookable || t.ArchivedAt != nil || onlyType != "" && t.ID != onlyType {
			continue
		}
		hosts, err := bookableHosts(ctx, q, ws.ID, t, onlyHost)
		if err != nil {
			return nil, err
		}
		if len(hosts) == 0 {
			continue
		}
		b := BookableType{ID: t.ID, Name: t.Name, Description: t.Description, DurationMinutes: t.DurationMinutes, Mode: t.Mode,
			Price: t.UnitPrice, Currency: t.Currency, Engagements: []Ref{}}
		for _, h := range hosts {
			b.Hosts = append(b.Hosts, Ref{ID: h, Name: members[h].Name})
		}
		slices.SortFunc(b.Hosts, func(a, b Ref) int { return strings.Compare(a.Name, b.Name) })
		if clientID != "" {
			if b.Engagements, err = s.choosableEngagements(ctx, q, ws, clientID, t); err != nil {
				return nil, err
			}
		}
		out = append(out, b)
	}
	return out, nil
}

// choosableEngagements are the client's active packages of the type's product when there is more than one (with
// one, the booking takes it without asking).
func (s *Service) choosableEngagements(ctx context.Context, q store.Q, ws store.Workspace, clientID string, t store.SchedEventType) ([]Ref, error) {
	out := []Ref{}
	if t.ProductID == nil {
		return out, nil
	}
	ids, err := q.SchedClientEngagementIDs(ctx, ws.ID, clientID, *t.ProductID)
	if err != nil {
		return nil, err
	}
	refs, err := q.SchedEngagements(ctx, ws.ID, ids)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		en, err := q.Engagement(ctx, ws.ID, id, false)
		if err != nil {
			return nil, err
		}
		if engagements.Status(en, ws.Today(s.now())) == "active" {
			out = append(out, Ref{ID: id, Name: refs[id].Name})
		}
	}
	if len(out) < 2 {
		return []Ref{}, nil
	}
	return out, nil
}

// LinkInfo is what a booking link's page shows: whose it is, the policy in words and what it books.
type LinkInfo struct {
	Workspace    string         `json:"workspace"`
	Confirmation string         `json:"confirmation"`
	PolicyText   string         `json:"policy_text"`
	EventTypes   []BookableType `json:"event_types"`
}

// Link is a live booking link's page; ErrNotFound for any link that is not live. A link books whatever the
// booking mode: the member made it on purpose.
func (s *Service) Link(ctx context.Context, token, lang string) (LinkInfo, error) {
	var out LinkInfo
	err := s.db.Tx(ctx, func(q store.Q) error {
		target, err := s.resolveLink(ctx, q, token)
		if err != nil {
			return err
		}
		set, err := q.SchedulingSettings(ctx, target.Workspace.ID)
		if err != nil {
			return err
		}
		types, err := s.bookableTypes(ctx, q, target.Workspace, "", deref(target.EventTypeID), deref(target.HostID))
		out = LinkInfo{Workspace: target.Workspace.Name, Confirmation: set.Confirmation,
			PolicyText: schedpolicy.PolicyText(policyOf(set), lang), EventTypes: types}
		return err
	})
	return out, err
}

// LinkSlots are the free starts a live link offers for one of its event types, as Slots, at most 31 days.
func (s *Service) LinkSlots(ctx context.Context, token, eventTypeID, hostID string, from, to time.Time) ([]Slot, error) {
	if !from.Before(to) || to.Sub(from) > maxSlotDays*24*time.Hour {
		return nil, validationFailed(map[string]string{"to": "Ask for at most 31 days at once."})
	}
	out := []Slot{}
	err := s.db.Tx(ctx, func(q store.Q) error {
		target, err := s.resolveLink(ctx, q, token)
		if err != nil {
			return err
		}
		if target.EventTypeID != nil && *target.EventTypeID != eventTypeID || target.HostID != nil && hostID != "" && *target.HostID != hostID {
			return store.ErrNotFound
		}
		hostID = cmp.Or(deref(target.HostID), hostID)
		t, err := bookableEventType(ctx, q, target.Workspace.ID, eventTypeID)
		if err != nil {
			return err
		}
		hosts, err := bookableHosts(ctx, q, target.Workspace.ID, t, hostID)
		if err != nil {
			return err
		}
		for _, h := range hosts {
			starts, err := s.freeStarts(ctx, q, target.Workspace, t, h, from, to)
			if err != nil {
				return err
			}
			for _, st := range starts {
				out = append(out, Slot{StartsAt: st, HostID: h})
			}
		}
		return nil
	})
	slices.SortStableFunc(out, func(a, b Slot) int {
		return cmp.Or(a.StartsAt.Compare(b.StartsAt), strings.Compare(a.HostID, b.HostID))
	})
	return out, err
}

// ClientError is err as the portal answers it, with the store's refusals named as the staff API names them.
func ClientError(err error) error {
	if errors.Is(err, store.ErrSchedRequestOpen) {
		return errRequestOpen
	}
	return err
}
