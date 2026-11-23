package scheduling

import (
	"context"
	"errors"
	"fmt"
	"time"

	"helvetly.com/api/internal/store"
)

// Background jobs (supervised in cmd/helvetly): reminders, the daily extension of series, auto-attendance and the
// expiry of requests. Each is idempotent across instances: claims and unique keys decide who does a row.

const (
	jobBatch       = 200
	historyKept    = 2 * 365 * 24 * time.Hour // requests and reminders are deleted after two years
	reminderBatch  = 100
	reminderTick   = time.Minute
	materialiseRun = time.Hour // each series is claimed at most daily: when it is a day short of the horizon
	autoAttendTick = 15 * time.Minute
	expireTick     = 5 * time.Minute
)

// every runs tick at once and then every d until ctx ends.
func every(ctx context.Context, d time.Duration, tick func(context.Context)) {
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// RunReminders sends the due reminders every minute; without a mailer it does nothing (and claims nothing).
func (e *Emails) RunReminders(ctx context.Context) {
	if e.mail == nil {
		return
	}
	every(ctx, reminderTick, e.RemindersTick)
}

// RemindersTick claims the due reminders (each once across instances) and sends them.
func (e *Emails) RemindersTick(ctx context.Context) {
	for ctx.Err() == nil {
		due, err := e.s.db.ClaimDueReminders(ctx, e.s.now(), reminderBatch)
		if err != nil {
			e.s.log.ErrorContext(ctx, "claim scheduling reminders", "error", err)
			return
		}
		for _, d := range due {
			if err := e.remind(ctx, d); err != nil {
				// at most once: the reminder is claimed, so a failed send is not tried again
				e.s.log.ErrorContext(ctx, "send scheduling reminder", "occurrence", d.OccurrenceID, "audience", d.Audience, "error", err)
			}
		}
		if len(due) < reminderBatch {
			return
		}
	}
}

// remind sends one claimed reminder: to the client's addresses, or to the host as a member email. A workspace
// whose plan lost the feature, a closed session, a client without an address or a host who left get none.
func (e *Emails) remind(ctx context.Context, d store.DueReminder) error {
	q := e.s.db.Q
	if ok, err := q.FeatureAllowed(ctx, d.WorkspaceID, store.FeatureScheduling); err != nil || !ok {
		return err
	}
	o, err := q.SchedOccurrence(ctx, d.WorkspaceID, d.OccurrenceID, false)
	if err != nil || !isOpen(o.Status) {
		return err
	}
	m, err := e.load(ctx, q, d.WorkspaceID, o.EventID)
	if err != nil {
		return err
	}
	title := sessionTitle(m.event, o)
	l := letter{title: title, sessions: []store.SchedOccurrence{o}, note: deref(m.event.ClientNote)}
	l.where, l.join = place(m.event, o)
	if d.Audience == "host" {
		members, err := q.SchedMembers(ctx, d.WorkspaceID)
		if err != nil || o.HostUserID == nil {
			return err
		}
		clients, err := q.SchedClients(ctx, d.WorkspaceID, []string{o.ClientID})
		if err != nil {
			return err
		}
		// the host's own email, in the business's language and zone, unbranded, without the client's portal link
		m.to, m.portal, m.zone, m.lang, m.members, m.greet = nil, "", m.ws.Location(), language(m.brand.Language), true, ""
		if a := deref(members[*o.HostUserID].Email); a != "" {
			m.to = []string{a}
		}
		l.lead = fmt.Sprintf(wordsOf(m.lang).hostReminded, title, clients[o.ClientID].Name)
		l.note = deref(m.event.Description)
	} else {
		l.lead = fmt.Sprintf(wordsOf(m.lang).reminded, title, m.brand.Name)
	}
	if len(m.to) == 0 {
		return nil
	}
	return e.send(ctx, m, wordsOf(m.lang).reminder+": "+title, l, nil)
}

// RunMaterialise extends open series up to the horizon and deletes old history, hourly.
func (s *Service) RunMaterialise(ctx context.Context) { every(ctx, materialiseRun, s.MaterialiseTick) }

// MaterialiseTick extends every series that is a day short of the horizon (claimed with SKIP LOCKED, so instances
// share the work), queues the new sessions for the hosts' calendars, then purges requests and reminders older than
// two years. The rows are made whatever the plan: they are the business's sessions; reminders and sync wait for it.
func (s *Service) MaterialiseTick(ctx context.Context) {
	for ctx.Err() == nil {
		n, err := s.materialiseBatch(ctx)
		if err != nil {
			s.log.ErrorContext(ctx, "materialise scheduling series", "error", err)
			return
		}
		if n < jobBatch {
			break
		}
	}
	if err := s.db.PurgeSchedHistory(ctx, s.now().Add(-historyKept)); err != nil {
		s.log.ErrorContext(ctx, "purge scheduling history", "error", err)
	}
}

func (s *Service) materialiseBatch(ctx context.Context) (int, error) {
	var claimed int
	err := s.db.Tx(ctx, func(q store.Q) error {
		series, err := q.ClaimSeriesToMaterialise(ctx, s.now().AddDate(0, 0, horizonDays-1), jobBatch)
		if err != nil {
			return err
		}
		claimed = len(series)
		for _, e := range series {
			from := s.now()
			if e.MaterialisedUntil != nil && e.MaterialisedUntil.After(from) {
				from = *e.MaterialisedUntil
			}
			added, err := s.materialise(ctx, q, e, from, nil, store.SchedScheduled)
			if err != nil {
				return fmt.Errorf("series %s: %w", e.ID, err)
			}
			if added == 0 {
				continue
			}
			rows, err := q.SchedOccurrences(ctx, e.WorkspaceID, store.SchedOccurrenceFilter{EventID: e.ID, From: &from})
			if err != nil {
				return err
			}
			ids := make([]string, len(rows))
			for i, o := range rows {
				ids[i] = o.ID
			}
			if err := s.cal.Enqueue(ctx, q, e.WorkspaceID, ids); err != nil {
				return err
			}
		}
		return nil
	})
	return claimed, err
}

// RunAutoAttend marks ended sessions attended where the workspace asked for it, every 15 minutes.
func (s *Service) RunAutoAttend(ctx context.Context) { every(ctx, autoAttendTick, s.AutoAttendTick) }

// AutoAttendTick marks attended the open sessions that ended auto_attended_after_hours ago, each in its own
// transaction; one that fails (its engagement period ended, say) is logged and tried again on the next tick.
func (s *Service) AutoAttendTick(ctx context.Context) {
	due, err := s.db.SchedAutoAttendDue(ctx, s.now(), jobBatch)
	if err != nil {
		s.log.ErrorContext(ctx, "list sessions to mark attended", "error", err)
		return
	}
	allowed := map[string]bool{}
	for _, o := range due {
		ok, seen := allowed[o.WorkspaceID]
		if !seen {
			if ok, err = s.db.FeatureAllowed(ctx, o.WorkspaceID, store.FeatureScheduling); err != nil {
				s.log.ErrorContext(ctx, "scheduling feature", "workspace", o.WorkspaceID, "error", err)
				continue
			}
			allowed[o.WorkspaceID] = ok
		}
		if !ok {
			continue
		}
		if err := s.autoAttend(ctx, o.WorkspaceID, o.ID); err != nil {
			s.log.ErrorContext(ctx, "mark session attended", "occurrence", o.ID, "error", err)
		}
	}
}

func (s *Service) autoAttend(ctx context.Context, workspaceID, id string) error {
	return s.db.Tx(ctx, func(q store.Q) error {
		ws, err := q.AdmissionWorkspace(ctx, workspaceID)
		if err != nil {
			return err
		}
		_, o, err := lockOccurrence(ctx, q, workspaceID, id)
		if err != nil {
			return err
		}
		now := s.now()
		if o.Status != store.SchedScheduled && o.Status != store.SchedRescheduled || o.EndsAt.After(now) {
			return nil // marked or moved since it was listed
		}
		from := o.Status
		o.Status, o.StatusChangedBy, o.StatusChangedAt, o.Late, o.UpdatedAt = store.SchedAttended, nil, &now, false, now
		if err := q.SaveSchedOccurrence(ctx, o); err != nil {
			return err
		}
		if err := s.syncEntries(ctx, q, actor{ws: ws, mayEngagements: true}, o); err != nil {
			return err
		}
		if err := s.audit(ctx, q, workspaceID, nil, "scheduling.attendance_changed", o.ID,
			map[string]any{"occurrence_id": o.ID, "from": from, "to": o.Status, "counts": true}); err != nil {
			return err
		}
		return s.cal.Enqueue(ctx, q, workspaceID, []string{o.ID})
	})
}

// RunExpireRequests ends the open requests of sessions that started, every 5 minutes.
func (s *Service) RunExpireRequests(ctx context.Context) {
	every(ctx, expireTick, s.ExpireRequestsTick)
}

func (s *Service) ExpireRequestsTick(ctx context.Context) {
	if _, err := s.db.ExpireSchedRequests(ctx, s.now()); err != nil && !errors.Is(err, context.Canceled) {
		s.log.ErrorContext(ctx, "expire scheduling requests", "error", err)
	}
}
