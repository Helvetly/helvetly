package scheduling

import (
	"cmp"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// BookInput is a client's booking: an event type, a host (empty: any), a free start, and the engagement when
// several of the client's fit.
type BookInput struct {
	EventTypeID  string
	HostID       string
	StartsAt     time.Time
	EngagementID string
	Note         *string
}

// Slot is a free start of a host.
type Slot struct {
	StartsAt time.Time `json:"starts_at"`
	HostID   string    `json:"host_id"`
}

// maxSlotDays bounds one slots call.
const maxSlotDays = 31

// bookableEventType is a live, bookable event type of the workspace; ErrNotFound otherwise.
func bookableEventType(ctx context.Context, q store.Q, workspaceID, id string) (store.SchedEventType, error) {
	t, err := q.SchedEventType(ctx, workspaceID, id)
	if err == nil && (t.ArchivedAt != nil || !t.Bookable) {
		err = store.ErrNotFound
	}
	return t, err
}

// bookableHosts are the members who can be booked for the event type: its hosts (none listed: every member with
// saved hours who is bookable), narrowed to hostID when given.
func bookableHosts(ctx context.Context, q store.Q, workspaceID string, t store.SchedEventType, hostID string) ([]string, error) {
	profiles, err := q.SchedulingHosts(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	members, err := q.SchedMembers(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, h := range profiles {
		if _, member := members[h.UserID]; !member || !h.Bookable || len(h.Weekly) == 0 && len(h.Overrides) == 0 {
			continue
		}
		if len(t.HostIDs) > 0 && !slices.Contains(t.HostIDs, h.UserID) || hostID != "" && h.UserID != hostID {
			continue
		}
		out = append(out, h.UserID)
	}
	return out, nil
}

// freeStarts are the host's free starts for the event type in [from, to).
func (s *Service) freeStarts(ctx context.Context, q store.Q, ws store.Workspace, t store.SchedEventType, hostID string, from, to time.Time) ([]time.Time, error) {
	hours, _, err := hostHours(ctx, q, ws, hostID)
	if err != nil {
		return nil, err
	}
	holidays, err := holidaySet(ctx, q, ws.ID)
	if err != nil {
		return nil, err
	}
	before, after := time.Duration(t.BufferBefore)*time.Minute, time.Duration(t.BufferAfter)*time.Minute
	lo, hi := schedpolicy.QueryRange(from, to, max(before, after))
	sessions, busy, err := s.taken(ctx, q, ws.ID, hostID, lo, hi)
	if err != nil {
		return nil, err
	}
	taken := busy
	for _, x := range sessions {
		taken = append(taken, schedpolicy.Block{Start: x.Start, End: x.End})
	}
	var step time.Duration
	if t.SlotStepMinutes != nil {
		step = time.Duration(*t.SlotStepMinutes) * time.Minute
	}
	return schedpolicy.Slots(schedpolicy.SlotQuery{Hours: hours, Holidays: holidays, Duration: time.Duration(t.DurationMinutes) * time.Minute,
		Step: step, BufferBefore: before, BufferAfter: after, Now: s.now(), MinNotice: time.Duration(t.MinNoticeMinutes) * time.Minute,
		Horizon: time.Duration(t.MaxHorizonDays) * 24 * time.Hour, From: from, To: to, Taken: taken}), nil
}

// Slots are the free starts of the event type's hosts (or of hostID) in [from, to), at most 31 days, by time; only
// free times, never why a time is taken. 409 booking_off unless clients may book.
func (s *Service) Slots(ctx context.Context, ws store.Workspace, eventTypeID, hostID string, from, to time.Time) ([]Slot, error) {
	if !from.Before(to) || to.Sub(from) > maxSlotDays*24*time.Hour {
		return nil, validationFailed(map[string]string{"to": "Ask for at most 31 days at once."})
	}
	out := []Slot{}
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := s.bookingOpen(ctx, q, ws.ID); err != nil {
			return err
		}
		t, err := bookableEventType(ctx, q, ws.ID, eventTypeID)
		if err != nil {
			return err
		}
		hosts, err := bookableHosts(ctx, q, ws.ID, t, hostID)
		if err != nil {
			return err
		}
		for _, h := range hosts {
			starts, err := s.freeStarts(ctx, q, ws, t, h, from, to)
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

// bookingOpen refuses booking unless the plan has Scheduling and the settings let clients book.
func (s *Service) bookingOpen(ctx context.Context, q store.Q, workspaceID string) error {
	if err := q.RequireFeature(ctx, workspaceID, store.FeatureScheduling); err != nil {
		if errors.Is(err, store.ErrFeatureDenied) {
			return errBookingOff
		}
		return err
	}
	set, err := q.SchedulingSettings(ctx, workspaceID)
	if err == nil && set.BookingMode != "clients" {
		err = errBookingOff
	}
	return err
}

// Book is a signed-in client's booking from the portal: the slot is checked again under the host's lock, the
// session is scheduled (or requested, waiting for the business, with manual confirmation) and counts in the month's
// limit. 409 slot_taken, booking_off, booking_unavailable (over the limit, without plan details).
func (s *Service) Book(ctx context.Context, ws store.Workspace, clientID, email string, in BookInput) (Occurrence, error) {
	var out Occurrence
	var cs changes
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := s.bookingOpen(ctx, q, ws.ID); err != nil {
			return err
		}
		if _, err := q.Client(ctx, ws.ID, clientID); err != nil {
			return err
		}
		o, change, err := s.book(ctx, q, ws, clientID, email, in)
		if err != nil {
			return err
		}
		cs = changes{change}
		out, err = s.occurrenceView(ctx, q, ws.ID, o.ID)
		return err
	})
	if err != nil {
		return Occurrence{}, err
	}
	s.tell(ctx, cs)
	return out, nil
}

func (s *Service) book(ctx context.Context, q store.Q, ws store.Workspace, clientID, email string, in BookInput) (store.SchedOccurrence, Change, error) {
	var none store.SchedOccurrence
	t, err := bookableEventType(ctx, q, ws.ID, in.EventTypeID)
	if err != nil {
		return none, Change{}, err
	}
	hosts, err := bookableHosts(ctx, q, ws.ID, t, in.HostID)
	if err != nil {
		return none, Change{}, err
	}
	end := in.StartsAt.Add(time.Duration(t.DurationMinutes) * time.Minute)
	free := func(host string) (bool, error) {
		starts, err := s.freeStarts(ctx, q, ws, t, host, in.StartsAt, end)
		return slices.ContainsFunc(starts, in.StartsAt.Equal), err
	}
	// "Any host": the free one with the fewest open sessions that day, then by name.
	members, err := q.SchedMembers(ctx, ws.ID)
	if err != nil {
		return none, Change{}, err
	}
	type candidate struct {
		id, name string
		load     int
	}
	var candidates []candidate
	day := recur.DateOf(in.StartsAt.In(ws.Location()))
	dayStart, dayEnd := day.At(0, 0).In(ws.Location()), day.AddDays(1).At(0, 0).In(ws.Location())
	for _, h := range hosts {
		ok, err := free(h)
		if err != nil {
			return none, Change{}, err
		}
		if !ok {
			continue
		}
		n, err := q.SchedOpenCount(ctx, ws.ID, h, dayStart, dayEnd)
		if err != nil {
			return none, Change{}, err
		}
		candidates = append(candidates, candidate{h, members[h].Name, n})
	}
	if len(candidates) == 0 {
		return none, Change{}, errSlotTaken
	}
	slices.SortFunc(candidates, func(a, b candidate) int { return cmp.Or(a.load-b.load, strings.Compare(a.name, b.name)) })
	host := candidates[0].id
	if err := q.LockSchedHost(ctx, ws.ID, host); err != nil {
		return none, Change{}, err
	}
	if ok, err := free(host); err != nil {
		return none, Change{}, err
	} else if !ok { // another booking took it between the check and the lock
		return none, Change{}, errSlotTaken
	}
	set, err := q.SchedulingSettings(ctx, ws.ID)
	if err != nil {
		return none, Change{}, err
	}
	engagementID, err := s.bookingEngagement(ctx, q, ws, clientID, t, in.EngagementID)
	if err != nil {
		return none, Change{}, err
	}
	now := s.now()
	zone := ws.Location()
	local := in.StartsAt.In(zone)
	e := store.SchedEvent{ID: auth.NewID("sev"), WorkspaceID: ws.ID, ClientID: clientID, EngagementID: engagementID, EventTypeID: &t.ID,
		HostUserID: &host, Title: t.Name, ClientNote: in.Note, Mode: t.Mode, MeetingProvider: t.MeetingProvider, Location: t.Location,
		TimeZone: ws.Timezone, StartsLocal: wall(recur.DateOf(local).At(local.Hour(), local.Minute())), DurationMinutes: t.DurationMinutes,
		CreatedAt: now, UpdatedAt: now}
	if e.Mode == "live" && e.Location == nil {
		e.Location = set.DefaultLocation
	}
	if engagementID == nil {
		e.UnitPrice, e.Currency = t.UnitPrice, t.Currency
	}
	if email != "" {
		e.Attendees = []string{strings.ToLower(email)}
	} else if c, err := q.Client(ctx, ws.ID, clientID); err == nil && c.Email != nil {
		e.Attendees = []string{*c.Email}
	}
	if err := q.CreateSchedEvent(ctx, e); err != nil {
		if errors.Is(err, store.ErrAdmissionDenied) {
			return none, Change{}, errBookingLimit
		}
		return none, Change{}, err
	}
	status := store.SchedScheduled
	if set.Confirmation == "manual" {
		status = store.SchedRequested
	}
	if _, err := s.materialise(ctx, q, e, time.Time{}, nil, status); err != nil {
		return none, Change{}, err
	}
	occs, err := q.SchedOccurrences(ctx, ws.ID, store.SchedOccurrenceFilter{EventID: e.ID})
	if err != nil || len(occs) != 1 {
		return none, Change{}, cmp.Or(err, errSlotTaken)
	}
	o := occs[0]
	if err := s.makeMeeting(ctx, q, &e, o); err != nil && !errors.Is(err, ErrNoConnection) {
		return none, Change{}, err // without the host's connection the session goes ahead and staff add a link
	}
	change := Change{Kind: ChangeInvited, WorkspaceID: ws.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, Notify: true}
	if status == store.SchedRequested {
		req := store.SchedRequest{ID: auth.NewID("srq"), WorkspaceID: ws.ID, OccurrenceID: o.ID, ClientID: clientID, Kind: "booking",
			Status: "pending", Note: in.Note, RequestedByEmail: nonEmpty(email), CreatedAt: now}
		if err := q.CreateSchedRequest(ctx, req); err != nil {
			return none, Change{}, err
		}
		change = Change{Kind: ChangeRequested, WorkspaceID: ws.ID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, RequestID: req.ID, Notify: true}
	}
	return o, change, s.cal.Enqueue(ctx, q, ws.ID, []string{o.ID})
}

// bookingEngagement is the client's active engagement started from the event type's product: the one there is, or
// the one the client picked when several fit.
func (s *Service) bookingEngagement(ctx context.Context, q store.Q, ws store.Workspace, clientID string, t store.SchedEventType, picked string) (*string, error) {
	if t.ProductID == nil {
		return nil, nil
	}
	ids, err := q.SchedClientEngagementIDs(ctx, ws.ID, clientID, *t.ProductID)
	if err != nil {
		return nil, err
	}
	var active []string
	for _, id := range ids {
		en, err := q.Engagement(ctx, ws.ID, id, false)
		if err != nil {
			return nil, err
		}
		if engagements.Status(en, ws.Today(s.now())) == "active" {
			active = append(active, id)
		}
	}
	switch {
	case picked != "" && slices.Contains(active, picked):
		return &picked, nil
	case picked != "":
		return nil, validationFailed(map[string]string{"engagement_id": "Choose one of your active packages."})
	case len(active) == 1:
		return &active[0], nil
	case len(active) > 1:
		return nil, validationFailed(map[string]string{"engagement_id": "Choose which package this session is for."})
	}
	return nil, nil
}

// Booking links (owner's answer 2026-11-23): made on demand for a host or an event type, until a date or with no
// end, revocable; the only way someone who is not a client yet books.

// sealer encrypts booking links' tokens (AES-256-GCM, a key derived from SECRET_KEY for this purpose only, the
// workspace and link as authenticated data), so a member can copy a link again; lookups go by SHA-256.
type sealer struct{ aead cipher.AEAD }

func newSealer(secret []byte) sealer {
	if len(secret) < 32 {
		return sealer{}
	}
	key, err := hkdf.Key(sha256.New, secret, nil, "helvetly scheduling booking links", 32)
	if err != nil {
		return sealer{}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return sealer{}
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return sealer{}
	}
	return sealer{aead}
}

var errNoKey = errors.New("scheduling: SECRET_KEY is not set, so booking links cannot be made")

func (s sealer) seal(workspaceID, linkID, plain string) ([]byte, error) {
	if s.aead == nil {
		return nil, errNoKey
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, []byte(plain), []byte(workspaceID+"\x00"+linkID)), nil
}

func (s sealer) open(workspaceID, linkID string, sealed []byte) (string, error) {
	if s.aead == nil {
		return "", errNoKey
	}
	n := s.aead.NonceSize()
	if len(sealed) < n {
		return "", errors.New("scheduling: sealed token too short")
	}
	plain, err := s.aead.Open(nil, sealed[:n], sealed[n:], []byte(workspaceID+"\x00"+linkID))
	return string(plain), err
}

func tokenHash(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// BookingLink is a link as members see it; URL only while it is live.
type BookingLink struct {
	store.SchedBookingLink
	URL    *string `json:"url"`
	Active bool    `json:"active"`
}

func (s *Service) linkView(l store.SchedBookingLink) BookingLink {
	v := BookingLink{SchedBookingLink: l, Active: l.RevokedAt == nil && (l.ExpiresAt == nil || l.ExpiresAt.After(s.now()))}
	if v.Active {
		if token, err := s.seal.open(l.WorkspaceID, l.ID, l.TokenSealed); err == nil {
			u := s.portalURL + "/book?link=" + url.QueryEscape(token)
			v.URL = &u
		}
	}
	return v
}

func (s *Service) listBookingLinks(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	links, err := s.db.SchedBookingLinks(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	out := make([]BookingLink, len(links))
	for i, l := range links {
		out[i] = s.linkView(l)
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) createBookingLink(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, "host_id", "event_type_id", "expires_at"); err != nil {
		return err
	}
	ctx, now := r.Context(), s.now()
	l := store.SchedBookingLink{ID: auth.NewID("sbl"), WorkspaceID: sess.Workspace.ID, CreatedBy: sess.User.ID, CreatedAt: now}
	f := form{}
	if raw, ok := body["expires_at"]; ok && !isNull(raw) {
		if t, ok := f.instant("expires_at", raw); ok {
			if !t.After(now) {
				f.fail("expires_at", "Choose a time in the future.")
			}
			l.ExpiresAt = &t
		}
	}
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		if raw, ok := body["host_id"]; ok && !isNull(raw) {
			var id string
			if json.Unmarshal(raw, &id) != nil {
				f.fail("host_id", "Choose a member.")
			} else if _, err := q.MemberRole(ctx, sess.Workspace.ID, id); err != nil {
				if !isNotFound(err) {
					return err
				}
				f.fail("host_id", "Choose a member of this workspace.")
			} else {
				l.HostUserID = &id
			}
		}
		if raw, ok := body["event_type_id"]; ok && !isNull(raw) {
			var id string
			_ = json.Unmarshal(raw, &id)
			if _, err := bookableEventType(ctx, q, sess.Workspace.ID, id); err != nil {
				if !isNotFound(err) {
					return err
				}
				f.fail("event_type_id", "Choose a bookable event type.")
			} else {
				l.EventTypeID = &id
			}
		}
		if len(f) == 0 && l.HostUserID == nil && l.EventTypeID == nil {
			f.fail("event_type_id", "Choose an event type or a host.")
		}
		if err := f.err(); err != nil {
			return err
		}
		token := rand.Text() + rand.Text() // 260 random bits
		sealed, err := s.seal.seal(l.WorkspaceID, l.ID, token)
		if err != nil {
			return err
		}
		l.TokenHash, l.TokenSealed = tokenHash(token), sealed
		if err := q.CreateSchedBookingLink(ctx, l); err != nil {
			return err
		}
		return s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.booking_link_created", l.ID,
			map[string]any{"link_id": l.ID, "host_id": l.HostUserID, "event_type_id": l.EventTypeID, "expires_at": l.ExpiresAt})
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(s.linkView(l)))
	return nil
}

func (s *Service) revokeBookingLink(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RevokeSchedBookingLink(ctx, sess.Workspace.ID, r.PathValue("id"), s.now()); err != nil {
			return err
		}
		return s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.booking_link_revoked", r.PathValue("id"),
			map[string]any{"link_id": r.PathValue("id")})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// LinkTarget is what a live booking link books: its workspace and the event type or host it is limited to.
type LinkTarget struct {
	Workspace   store.Workspace
	LinkID      string
	EventTypeID *string
	HostID      *string
}

// ResolveLink finds the live link of a token; ErrNotFound for an unknown, revoked or expired one, a deleted
// workspace or a plan without Scheduling.
func (s *Service) ResolveLink(ctx context.Context, token string) (LinkTarget, error) {
	var t LinkTarget
	err := s.db.Tx(ctx, func(q store.Q) (err error) {
		t, err = s.resolveLink(ctx, q, token)
		return err
	})
	return t, err
}

func (s *Service) resolveLink(ctx context.Context, q store.Q, token string) (LinkTarget, error) {
	l, err := q.LiveSchedBookingLink(ctx, tokenHash(token), s.now())
	if err != nil {
		return LinkTarget{}, err
	}
	ws, err := q.AdmissionWorkspace(ctx, l.WorkspaceID)
	if err != nil {
		return LinkTarget{}, err
	}
	if ok, err := q.FeatureAllowed(ctx, ws.ID, store.FeatureScheduling); err != nil || !ok {
		return LinkTarget{}, cmp.Or(err, store.ErrNotFound)
	}
	return LinkTarget{Workspace: ws, LinkID: l.ID, EventTypeID: l.EventTypeID, HostID: l.HostUserID}, nil
}

// PublicBooking is a booking through a link by someone who may not be a client yet.
type PublicBooking struct {
	BookInput
	Name, Email string
}

// BookWithLink books through a live link: the link's event type and host apply, the client is found by email (a
// live client of the workspace) or made in the same transaction, and the booking follows the settings' confirmation.
func (s *Service) BookWithLink(ctx context.Context, token string, in PublicBooking) (Occurrence, error) {
	addr := strings.ToLower(strings.TrimSpace(in.Email))
	name := strings.TrimSpace(in.Name)
	f := form{}
	if name == "" || len([]rune(name)) > 200 {
		f.fail("name", "Enter your name.")
	}
	if !strings.Contains(addr, "@") || len(addr) > 254 {
		f.fail("email", "Enter your email address.")
	}
	if err := f.err(); err != nil {
		return Occurrence{}, err
	}
	var out Occurrence
	var cs changes
	err := s.db.Tx(ctx, func(q store.Q) error {
		target, err := s.resolveLink(ctx, q, token)
		if err != nil {
			return err
		}
		ws := target.Workspace
		if target.EventTypeID != nil {
			in.EventTypeID = *target.EventTypeID
		}
		if target.HostID != nil {
			in.HostID = *target.HostID
		}
		clientID, err := q.LiveClientByEmail(ctx, ws.ID, addr)
		if isNotFound(err) {
			// shortcut: clients have no "pending" state yet; the new client is an ordinary one, named by the booker.
			clientID = auth.NewID("cli")
			err = q.CreateClient(ctx, ws.ID, clientID, map[string]any{"name": name, "email": addr}, s.now())
			if errors.Is(err, store.ErrAdmissionDenied) {
				return errBookingLimit
			}
		}
		if err != nil {
			return err
		}
		o, change, err := s.book(ctx, q, ws, clientID, addr, in.BookInput)
		if err != nil {
			return err
		}
		cs = changes{change}
		if err := q.TouchSchedBookingLink(ctx, target.LinkID, s.now()); err != nil {
			return err
		}
		if err := s.audit(ctx, q, ws.ID, nil, "scheduling.booking_link_used", target.LinkID,
			map[string]any{"link_id": target.LinkID, "occurrence_id": o.ID, "client_id": clientID}); err != nil {
			return err
		}
		out, err = s.occurrenceView(ctx, q, ws.ID, o.ID)
		return err
	})
	if err != nil {
		return Occurrence{}, err
	}
	s.tell(ctx, cs)
	return out, nil
}
