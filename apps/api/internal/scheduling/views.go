package scheduling

import (
	"cmp"
	"context"
	"strconv"
	"time"

	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// The answers' shapes (scheduling-contract.md, "Model"); openapi.json documents them and its drift test compares.

type Ref struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type EngagementRef struct {
	ID     string  `json:"id"`
	Number int64   `json:"number"`
	Title  string  `json:"title"`
	Unit   *string `json:"unit"`
}

type Meeting struct {
	Provider string  `json:"provider"`
	URL      *string `json:"url"`
}

// Event is a one-off session or a series.
type Event struct {
	ID              string          `json:"id"`
	Client          Ref             `json:"client"`
	Engagement      *EngagementRef  `json:"engagement"`
	EventTypeID     *string         `json:"event_type_id"`
	Host            *Ref            `json:"host"`
	Title           string          `json:"title"`
	Description     *string         `json:"description"`
	ClientNote      *string         `json:"client_note"`
	Mode            string          `json:"mode"`
	Meeting         *Meeting        `json:"meeting"`
	Location        *string         `json:"location"`
	TimeZone        string          `json:"time_zone"`
	StartsLocal     string          `json:"starts_local"`
	DurationMinutes int             `json:"duration_minutes"`
	Recurrence      *RecurrenceJSON `json:"recurrence"`
	SkipHolidays    bool            `json:"skip_holidays"`
	Attendees       []string        `json:"attendees"`
	UnitsPerSession *store.Quantity `json:"units_per_session"`
	UnitPrice       *store.Money    `json:"unit_price"`
	Currency        *string         `json:"currency"`
	Sequence        int             `json:"sequence"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type Waived struct {
	By     Ref       `json:"by"`
	At     time.Time `json:"at"`
	Reason *string   `json:"reason"`
}

type InvoiceRef struct {
	ID     string  `json:"id"`
	Number *string `json:"number"`
	Status string  `json:"status"`
}

// Occurrence is one session, with the event's values where it has none of its own.
type Occurrence struct {
	ID            string         `json:"id"`
	EventID       string         `json:"event_id"`
	OriginalStart time.Time      `json:"original_start"`
	StartsAt      time.Time      `json:"starts_at"`
	EndsAt        time.Time      `json:"ends_at"`
	Status        string         `json:"status"`
	Late          bool           `json:"late"`
	Counts        bool           `json:"counts"`
	Waived        *Waived        `json:"waived"`
	Title         string         `json:"title"`
	Location      *string        `json:"location"`
	Meeting       *Meeting       `json:"meeting"`
	Host          *Ref           `json:"host"`
	Client        Ref            `json:"client"`
	Engagement    *EngagementRef `json:"engagement"`
	IsException   bool           `json:"is_exception"`
	Sequence      int            `json:"sequence"`
	Request       *Request       `json:"request"`
	EntryIDs      []string       `json:"entry_ids"`
	Invoice       *InvoiceRef    `json:"invoice"`
	Conflicts     []Conflict     `json:"conflicts,omitempty"` // only on the single read and on writes
	UpdatedAt     time.Time      `json:"updated_at"`
}

// Conflict is a warning about a session's time; a busy time has no title (none is stored).
type Conflict struct {
	Kind         string    `json:"kind"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
	OccurrenceID string    `json:"occurrence_id,omitempty"`
	Title        string    `json:"title,omitempty"`
}

// Request is a client's cancel, reschedule or booking request.
type Request struct {
	ID            string      `json:"id"`
	OccurrenceID  string      `json:"occurrence_id"`
	Kind          string      `json:"kind"`
	Status        string      `json:"status"`
	Late          bool        `json:"late"`
	ProposedTimes []time.Time `json:"proposed_times"`
	StaffProposal *time.Time  `json:"staff_proposal"`
	Note          *string     `json:"note"`
	Reason        *string     `json:"reason"`
	CreatedAt     time.Time   `json:"created_at"`
	DecidedAt     *time.Time  `json:"decided_at"`
}

// OccurrenceSummary is what a request list says about its session.
type OccurrenceSummary struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Status   string    `json:"status"`
	Client   Ref       `json:"client"`
	Host     *Ref      `json:"host"`
}

// RequestItem is a request in the staff's list.
type RequestItem struct {
	Request
	Occurrence OccurrenceSummary `json:"occurrence"`
}

// BusyBlock is a host's imported busy time, without a title.
type BusyBlock struct {
	HostID   string    `json:"host_id"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
}

func requestView(r store.SchedRequest) Request {
	times := r.ProposedTimes
	if times == nil {
		times = []time.Time{}
	}
	return Request{ID: r.ID, OccurrenceID: r.OccurrenceID, Kind: r.Kind, Status: r.Status, Late: r.Late, ProposedTimes: times,
		StaffProposal: r.StaffProposal, Note: r.Note, Reason: r.Reason, CreatedAt: r.CreatedAt, DecidedAt: r.DecidedAt}
}

func conflictViews(cs []schedpolicy.Conflict) []Conflict {
	out := make([]Conflict, len(cs))
	for i, c := range cs {
		out[i] = Conflict{Kind: string(c.Kind), StartsAt: c.Start, EndsAt: c.End, OccurrenceID: c.OccurrenceID, Title: c.Title}
	}
	return out
}

// counts: the session uses a session of its package (or is billable): attended, or a no-show or late cancellation
// the settings count and nobody waived.
func counts(o store.SchedOccurrence, set store.SchedSettings) bool {
	switch o.Status {
	case store.SchedAttended:
		return true
	case store.SchedNoShow:
		return set.NoShowCounts && o.WaivedAt == nil
	case store.SchedCancelledLate:
		return set.LateCancelCounts && o.WaivedAt == nil
	}
	return false
}

func isOpen(status string) bool {
	return status == store.SchedRequested || status == store.SchedScheduled || status == store.SchedRescheduled
}

// resolver names what occurrences point at, with one query per kind of record.
type resolver struct {
	events      map[string]store.SchedEvent
	clients     map[string]store.SchedRef
	engagements map[string]store.SchedRef
	members     map[string]store.SchedRef
	invoices    map[string]store.SchedRef
	requests    map[string]store.SchedRequest
	entries     map[string][]store.SchedEntryLink
	settings    store.SchedSettings
}

func (s *Service) resolve(ctx context.Context, q store.Q, workspaceID string, events []store.SchedEvent, occs []store.SchedOccurrence) (*resolver, error) {
	r := &resolver{events: map[string]store.SchedEvent{}, requests: map[string]store.SchedRequest{}}
	var eventIDs, clientIDs, engIDs, invIDs, occIDs []string
	for _, e := range events {
		r.events[e.ID] = e
		clientIDs = append(clientIDs, e.ClientID)
		if e.EngagementID != nil {
			engIDs = append(engIDs, *e.EngagementID)
		}
	}
	for _, o := range occs {
		if _, ok := r.events[o.EventID]; !ok {
			eventIDs = append(eventIDs, o.EventID)
		}
		clientIDs, occIDs = append(clientIDs, o.ClientID), append(occIDs, o.ID)
		if o.EngagementID != nil {
			engIDs = append(engIDs, *o.EngagementID)
		}
		if o.InvoiceID != nil {
			invIDs = append(invIDs, *o.InvoiceID)
		}
	}
	var err error
	if len(eventIDs) > 0 {
		more, err := q.SchedEventsByID(ctx, workspaceID, eventIDs)
		if err != nil {
			return nil, err
		}
		for id, e := range more {
			r.events[id] = e
		}
	}
	if r.clients, err = q.SchedClients(ctx, workspaceID, clientIDs); err != nil {
		return nil, err
	}
	if r.engagements, err = q.SchedEngagements(ctx, workspaceID, engIDs); err != nil {
		return nil, err
	}
	if r.members, err = q.SchedMembers(ctx, workspaceID); err != nil {
		return nil, err
	}
	if r.invoices, err = q.SchedInvoices(ctx, workspaceID, invIDs); err != nil {
		return nil, err
	}
	if r.entries, err = q.SchedEntryLinksOf(ctx, occIDs); err != nil {
		return nil, err
	}
	if len(occs) > 0 {
		open, err := q.SchedRequests(ctx, workspaceID, []string{"pending", "proposed"}, nil)
		if err != nil {
			return nil, err
		}
		for _, x := range open {
			r.requests[x.OccurrenceID] = x
		}
	}
	r.settings, err = q.SchedulingSettings(ctx, workspaceID)
	return r, err
}

func (r *resolver) host(id *string) *Ref {
	if id == nil {
		return nil
	}
	m, ok := r.members[*id]
	if !ok {
		return nil // left the workspace
	}
	return &Ref{ID: m.ID, Name: m.Name}
}

func (r *resolver) client(id string) Ref { return Ref{ID: id, Name: r.clients[id].Name} }

func (r *resolver) engagement(id *string) *EngagementRef {
	if id == nil {
		return nil
	}
	m := r.engagements[*id]
	n := int64(0)
	if m.Number != nil {
		n, _ = strconv.ParseInt(*m.Number, 10, 64)
	}
	return &EngagementRef{ID: *id, Number: n, Title: m.Name, Unit: m.Unit}
}

func meeting(provider, url *string) *Meeting {
	if provider == nil {
		return nil
	}
	return &Meeting{Provider: *provider, URL: url}
}

func (r *resolver) event(e store.SchedEvent) Event {
	attendees := e.Attendees
	if attendees == nil {
		attendees = []string{}
	}
	return Event{ID: e.ID, Client: r.client(e.ClientID), Engagement: r.engagement(e.EngagementID), EventTypeID: e.EventTypeID,
		Host: r.host(e.HostUserID), Title: e.Title, Description: e.Description, ClientNote: e.ClientNote, Mode: e.Mode,
		Meeting: meeting(e.MeetingProvider, e.MeetingURL), Location: e.Location, TimeZone: e.TimeZone,
		StartsLocal: e.StartsLocal.Format("2006-01-02T15:04"), DurationMinutes: e.DurationMinutes, Recurrence: recurrenceOut(e),
		SkipHolidays: e.SkipHolidays, Attendees: attendees, UnitsPerSession: e.UnitsPerSession, UnitPrice: e.UnitPrice,
		Currency: e.Currency, Sequence: e.Sequence, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt}
}

func (r *resolver) occurrence(o store.SchedOccurrence) Occurrence {
	e := r.events[o.EventID]
	v := Occurrence{ID: o.ID, EventID: o.EventID, OriginalStart: o.OriginalStart, StartsAt: o.StartsAt, EndsAt: o.EndsAt,
		Status: o.Status, Late: o.Late, Counts: counts(o, r.settings), Title: cmp.Or(deref(o.Title), e.Title),
		Location: cmp.Or(o.Location, e.Location), Host: r.host(o.HostUserID), Client: r.client(o.ClientID),
		Engagement: r.engagement(o.EngagementID), IsException: o.IsException, Sequence: o.Sequence, EntryIDs: []string{},
		UpdatedAt: o.UpdatedAt}
	if e.Mode == "online" {
		v.Meeting = meeting(e.MeetingProvider, cmp.Or(o.MeetingURL, e.MeetingURL))
	}
	if o.WaivedAt != nil {
		by := Ref{}
		if o.WaivedBy != nil {
			by = Ref{ID: *o.WaivedBy, Name: r.members[*o.WaivedBy].Name}
		}
		v.Waived = &Waived{By: by, At: *o.WaivedAt, Reason: o.WaiveReason}
	}
	if x, ok := r.requests[o.ID]; ok {
		rv := requestView(x)
		v.Request = &rv
	}
	for _, l := range r.entries[o.ID] {
		v.EntryIDs = append(v.EntryIDs, l.EntryID)
	}
	if o.InvoiceID != nil {
		inv := r.invoices[*o.InvoiceID]
		v.Invoice = &InvoiceRef{ID: *o.InvoiceID, Number: inv.Number, Status: inv.Status}
	}
	return v
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// occurrenceViews answers occurrences as the API shows them.
func (s *Service) occurrenceViews(ctx context.Context, q store.Q, workspaceID string, occs []store.SchedOccurrence) ([]Occurrence, error) {
	r, err := s.resolve(ctx, q, workspaceID, nil, occs)
	if err != nil {
		return nil, err
	}
	out := make([]Occurrence, len(occs))
	for i, o := range occs {
		out[i] = r.occurrence(o)
	}
	return out, nil
}

func (s *Service) occurrenceView(ctx context.Context, q store.Q, workspaceID, id string) (Occurrence, error) {
	o, err := q.SchedOccurrence(ctx, workspaceID, id, false)
	if err != nil {
		return Occurrence{}, err
	}
	list, err := s.occurrenceViews(ctx, q, workspaceID, []store.SchedOccurrence{o})
	if err != nil {
		return Occurrence{}, err
	}
	return list[0], nil
}
