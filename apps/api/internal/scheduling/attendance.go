package scheduling

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// actor is who changes a session: a member (with their permissions) or the client through the portal.
type actor struct {
	id             string // the member; "" for the client
	ws             store.Workspace
	mayEngagements bool // may add and remove engagement entries
}

func actorOf(sess store.Session) actor {
	return actor{id: sess.User.ID, ws: sess.Workspace, mayEngagements: permissions.Allows(sess.Role, sess.Scopes, "write:engagements")}
}

// clientActor: the client's own requests count their sessions as the policy says, whatever members may do.
func clientActor(ws store.Workspace) actor { return actor{ws: ws, mayEngagements: true} }

func (a actor) ref() *string {
	if a.id == "" {
		return nil
	}
	return &a.id
}

func isNotFound(err error) bool { return errors.Is(err, store.ErrNotFound) }

// audit writes a scheduling step to the workspace's audit log (never a money event).
func (s *Service) audit(ctx context.Context, q store.Q, workspaceID string, actorID *string, kind, subjectID string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if actorID != nil && *actorID == "" {
		actorID = nil
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: workspaceID, Kind: kind, SubjectType: "scheduling", SubjectID: subjectID,
		ActorID: actorID, At: s.now(), Payload: raw})
}

// reasonOf is the engagement entry reason of a counting status.
func reasonOf(status string) string {
	switch status {
	case store.SchedAttended:
		return "attended"
	case store.SchedNoShow:
		return "no_show"
	case store.SchedCancelledLate:
		return "late_cancel"
	}
	return ""
}

var reasonLabels = map[string]string{"attended": "Attended", "no_show": "No-show", "late_cancel": "Cancelled late",
	"late_reschedule": "Rescheduled late"}

// unitsFor is the engagement quantity one session uses: the event's own, else by the unit (hours: the duration;
// days: the duration over 8 hours; anything else: 1).
func unitsFor(e store.SchedEvent, unit *string) invoicecalc.Quantity {
	if e.UnitsPerSession != nil {
		return *e.UnitsPerSession
	}
	switch deref(unit) {
	case "hour":
		return invoicecalc.Quantity(e.DurationMinutes * 1000 / 60)
	case "day":
		return invoicecalc.Quantity(e.DurationMinutes * 1000 / 480)
	}
	return 1000
}

// syncEntries makes the occurrence's engagement entry match whether it counts: one for its status's reason, none for
// another (a late reschedule's entry stays). Removing an invoiced entry is refused (409 entry_invoiced).
func (s *Service) syncEntries(ctx context.Context, q store.Q, a actor, o store.SchedOccurrence) error {
	set, err := q.SchedulingSettings(ctx, a.ws.ID)
	if err != nil {
		return err
	}
	links, err := q.SchedEntryLinks(ctx, o.ID)
	if err != nil {
		return err
	}
	want := ""
	if counts(o, set) {
		want = reasonOf(o.Status)
	}
	have := false
	for _, l := range links {
		if l.Reason == "late_reschedule" {
			continue
		}
		if l.Reason == want {
			have = true
			continue
		}
		if err := s.removeEntry(ctx, q, a, o, l.Reason); err != nil {
			return err
		}
	}
	if want == "" || have || o.EngagementID == nil {
		return nil
	}
	return s.addEntry(ctx, q, a, o, want)
}

func (s *Service) removeEntry(ctx context.Context, q store.Q, a actor, o store.SchedOccurrence, reason string) error {
	if !a.mayEngagements {
		return errNeedEngagements
	}
	entryID, err := q.UnlinkSchedEntry(ctx, o.ID, reason)
	if err != nil || o.EngagementID == nil {
		return err
	}
	return engagements.RemoveEntry(ctx, q, *o.EngagementID, entryID)
}

// addEntry logs the session on its engagement for reason: on the start's date in the workspace zone, the host as
// performer, "<title> · <reason>" as the note.
func (s *Service) addEntry(ctx context.Context, q store.Q, a actor, o store.SchedOccurrence, reason string) error {
	if !a.mayEngagements {
		return errNeedEngagements
	}
	e, err := q.SchedEvent(ctx, a.ws.ID, o.EventID, false)
	if err != nil {
		return err
	}
	en, err := q.Engagement(ctx, a.ws.ID, *o.EngagementID, false)
	if err != nil {
		return err
	}
	title := e.Title
	if o.Title != nil {
		title = *o.Title
	}
	note := fmt.Sprintf("%s · %s", title, reasonLabels[reason])
	entry := store.EngagementEntry{ID: auth.NewID("ent"), Date: o.StartsAt.In(a.ws.Location()).Format(time.DateOnly),
		Quantity: unitsFor(e, en.Unit), Note: &note}
	if o.HostUserID != nil {
		entry.PerformedBy = &store.UserRef{ID: *o.HostUserID}
	}
	if e.ParticipantContactID != nil { // the entry carries the session's participant
		entry.Participant = &store.PersonRef{ID: *e.ParticipantContactID}
	}
	if a.id != "" {
		entry.CreatedBy = &store.UserRef{ID: a.id}
	}
	if err := engagements.AddEntry(ctx, q, a.ws, en.ID, entry, s.now()); err != nil {
		return err
	}
	return q.LinkSchedEntry(ctx, o.ID, entry.ID, reason)
}

func (s *Service) setAttendance(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if err := decode(body, "status", "waive", "reason"); err != nil {
		return err
	}
	f := form{}
	status := ""
	if raw, ok := body["status"]; ok && (json.Unmarshal(raw, &status) != nil ||
		!slices.Contains([]string{store.SchedAttended, store.SchedNoShow, store.SchedScheduled}, status)) {
		f.fail("status", "Choose attended, no_show or scheduled.")
	}
	var waive *bool
	if raw, ok := body["waive"]; ok {
		if b, ok := f.boolean("waive", raw); ok {
			waive = &b
		}
	}
	var reason *string
	if raw, ok := body["reason"]; ok {
		reason = f.text("reason", raw, 0, 500)
	}
	if status == "" && waive == nil {
		f.fail("status", "Choose attended, no_show or scheduled.")
	}
	if err := f.err(); err != nil {
		return err
	}
	if waive != nil && !canManage(sess) {
		return errOwnerAdmin
	}
	ctx, now := r.Context(), s.now()
	var out Occurrence
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		_, o, err := lockOccurrence(ctx, q, sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		from := o.Status
		if status != "" && status != o.Status {
			switch {
			case !isOpen(o.Status) && o.Status != store.SchedAttended && o.Status != store.SchedNoShow:
				return errClosed
			case status != store.SchedScheduled && now.Before(o.StartsAt):
				return errNotStarted
			}
			o.Status, o.StatusChangedBy, o.StatusChangedAt = status, &sess.User.ID, &now
			o.Late = status == store.SchedNoShow
			o.WaivedBy, o.WaivedAt, o.WaiveReason = nil, nil, nil
		}
		if waive != nil {
			if o.Status != store.SchedNoShow && o.Status != store.SchedCancelledLate {
				return validationFailed(map[string]string{"waive": "Only a no-show or a late cancellation can be waived."})
			}
			o.WaivedBy, o.WaivedAt, o.WaiveReason = nil, nil, nil
			if *waive {
				o.WaivedBy, o.WaivedAt, o.WaiveReason = &sess.User.ID, &now, reason
			}
		}
		o.UpdatedAt = now
		if err := q.SaveSchedOccurrence(ctx, o); err != nil {
			return err
		}
		if err := s.syncEntries(ctx, q, actorOf(sess), o); err != nil {
			return err
		}
		set, err := q.SchedulingSettings(ctx, sess.Workspace.ID)
		if err != nil {
			return err
		}
		if from != o.Status {
			if err := s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.attendance_changed", o.ID,
				map[string]any{"occurrence_id": o.ID, "from": from, "to": o.Status, "counts": counts(o, set)}); err != nil {
				return err
			}
		}
		if waive != nil && *waive {
			if err := s.audit(ctx, q, sess.Workspace.ID, &sess.User.ID, "scheduling.waived", o.ID,
				map[string]any{"occurrence_id": o.ID, "reason": reason}); err != nil {
				return err
			}
		}
		if err := s.cal.Enqueue(ctx, q, sess.Workspace.ID, []string{o.ID}); err != nil {
			return err
		}
		out, err = s.occurrenceView(ctx, q, sess.Workspace.ID, o.ID)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// invoiceOccurrences makes one draft per client from counting sessions without an engagement, one line each.
func (s *Service) invoiceOccurrences(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		OccurrenceIDs []string `json:"occurrence_ids"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if len(in.OccurrenceIDs) == 0 || len(in.OccurrenceIDs) > 200 {
		return validationFailed(map[string]string{"occurrence_ids": "Choose 1 to 200 sessions."})
	}
	slices.Sort(in.OccurrenceIDs)
	in.OccurrenceIDs = slices.Compact(in.OccurrenceIDs)
	ctx := r.Context()
	var ids []string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureScheduling); err != nil {
			return err
		}
		set, err := q.SchedulingSettings(ctx, sess.Workspace.ID)
		if err != nil {
			return err
		}
		var occs []store.SchedOccurrence
		var invIDs []string
		for _, id := range in.OccurrenceIDs {
			o, err := q.SchedOccurrence(ctx, sess.Workspace.ID, id, true)
			if err != nil {
				return err
			}
			if o.InvoiceID != nil {
				invIDs = append(invIDs, *o.InvoiceID)
			}
			occs = append(occs, o)
		}
		invoices, err := q.SchedInvoices(ctx, sess.Workspace.ID, invIDs)
		if err != nil {
			return err
		}
		var eventIDs []string
		for _, o := range occs {
			eventIDs = append(eventIDs, o.EventID)
		}
		events, err := q.SchedEventsByID(ctx, sess.Workspace.ID, eventIDs)
		if err != nil {
			return err
		}
		// One draft per client or, for a company sending to its participants, per participant: never two on one.
		type addressee struct{ client, participant string }
		byClient := map[addressee][]store.SchedOccurrence{}
		var clients []addressee
		records := map[string]store.Client{}
		for _, o := range occs {
			if o.InvoiceID != nil && invoices[*o.InvoiceID].Status != "void" { // a deleted draft clears it; a voided invoice releases it
				return errAlreadyInvoiced
			}
			if !counts(o, set) || o.EngagementID != nil || events[o.EventID].UnitPrice == nil {
				return errNotBillable
			}
			c, ok := records[o.ClientID]
			if !ok {
				if c, err = q.Client(ctx, sess.Workspace.ID, o.ClientID); err != nil {
					return err
				}
				records[o.ClientID] = c
			}
			key := addressee{client: o.ClientID}
			if p := c.Participant(events[o.EventID].ParticipantContactID); p != nil && c.IsCompany && c.DocumentsTo == "participants" {
				key.participant = p.ID
			}
			if _, ok := byClient[key]; !ok {
				clients = append(clients, key)
			}
			byClient[key] = append(byClient[key], o)
		}
		var vat struct {
			Rate invoicecalc.Percent `json:"default_vat_rate"`
		}
		vat.Rate = 810
		if _, err := q.InvoiceSettings(ctx, sess.Workspace.ID, &vat); err != nil {
			return err
		}
		for _, key := range clients {
			list := byClient[key]
			c := records[key.client]
			id, err := s.inv.CreateDraft(ctx, q, sess, key.client, func(inv *store.Invoice) {
				if key.participant != "" {
					inv.ParticipantContactID = &key.participant
				}
				for _, o := range list {
					e := events[o.EventID]
					title := e.Title
					if o.Title != nil {
						title = *o.Title
					}
					description := title + " · " + o.StartsAt.In(loadZone(e.TimeZone)).Format("2 Jan 2006")
					// The company's invoice names who took each session; a participant's own invoice names them already.
					if p := c.Participant(e.ParticipantContactID); p != nil && key.participant == "" {
						description += " · " + p.Name
					}
					inv.Lines = append(inv.Lines, store.InvoiceLine{Description: description,
						Quantity: 1000, UnitPrice: *e.UnitPrice, VATCategory: "S", VATRate: vat.Rate})
				}
			})
			if err != nil {
				return err
			}
			for _, o := range list {
				o.InvoiceID = &id
				o.UpdatedAt = s.now()
				if err := q.SaveSchedOccurrence(ctx, o); err != nil {
					return err
				}
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(map[string]any{"invoice_ids": ids}))
	return nil
}
