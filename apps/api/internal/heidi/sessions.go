package heidi

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
)

// Sessions is what Heidi reads of internal/scheduling: occurrences resolved as the API answers them.
type Sessions interface {
	Sessions(ctx context.Context, q store.Q, workspaceID string, f store.SchedOccurrenceFilter) ([]scheduling.Occurrence, error)
}

// SetSessions is startup wiring (Scheduling).
func (s *Service) SetSessions(x Sessions) { s.sessions = x }

// The Scheduling questions Heidi answers itself (scheduling-contract.md, "Public API, MCP, Heidi").
const (
	askToday = "today" // what's on my schedule today
	askNext  = "next"  // when is the next session with <client>
	askLate  = "late"  // who cancelled late this month
	askLeft  = "left"  // sessions left in <client>'s package
)

var openSessions = []string{store.SchedRequested, store.SchedScheduled, store.SchedRescheduled}

// sessionQuestion recognises one of the four questions (English and German) and the client it names.
func sessionQuestion(message string) (kind, query string, ok bool) {
	lower := strings.ToLower(message)
	has := func(words ...string) bool {
		return slices.ContainsFunc(words, func(w string) bool { return strings.Contains(lower, w) })
	}
	after := func(seps ...string) string {
		for _, sep := range seps {
			if i := strings.LastIndex(lower, sep); i >= 0 {
				q := strings.Trim(message[i+len(sep):], " ?.!")
				for _, tail := range []string{"'s package", "’s package", "s package", " package", "s paket", " paket"} {
					if len(q) >= len(tail) && strings.EqualFold(q[len(q)-len(tail):], tail) {
						q = strings.TrimSpace(q[:len(q)-len(tail)])
						break
					}
				}
				return q
			}
		}
		return ""
	}
	switch {
	case has("cancelled late", "canceled late", "late cancel", "kurzfristig abgesagt", "spät abgesagt", "zu spät abgesagt"):
		return askLate, "", true
	case has("sessions left", "sessions remaining", "sitzungen übrig", "termine übrig", "lektionen übrig"):
		return askLeft, after(" in ", " for ", " bei ", " von ", " für "), true
	case has("next session", "next appointment", "nächste sitzung", "nächster termin", "nächste termin"):
		return askNext, after(" with ", " mit "), true
	case has("schedule", "session", "appointment", "termin", "sitzung", "kalender") && has("today", "heute"):
		return askToday, "", true
	}
	return "", "", false
}

func (s *Service) sessionAnswer(ctx context.Context, q store.Q, sess store.Session, kind, query string) (turn, error) {
	if err := need(sess, "read:scheduling"); err != nil {
		return turn{}, err
	}
	if s.sessions == nil {
		return turn{}, auth.Error(503, "unavailable", "Scheduling assistance is unavailable.", nil)
	}
	now, zone := s.now(), sess.Workspace.Location()
	switch kind {
	case askToday:
		y, m, d := now.In(zone).Date()
		from := time.Date(y, m, d, 0, 0, 0, 0, zone)
		to := from.AddDate(0, 0, 1)
		list, err := s.sessions.Sessions(ctx, q, sess.Workspace.ID, store.SchedOccurrenceFilter{From: &from, To: &to,
			HostIDs: []string{sess.User.ID}, Statuses: openSessions})
		if err != nil {
			return turn{}, err
		}
		lead := "Nothing is on your schedule today."
		if len(list) > 0 {
			lead = "Today you have " + count(len(list), "session", "sessions") + "."
		}
		return s.sessionTurn(lead, "Looking up today’s sessions", list, zone), nil
	case askLate:
		y, m, _ := now.In(zone).Date()
		from := time.Date(y, m, 1, 0, 0, 0, 0, zone)
		to := from.AddDate(0, 1, 0)
		list, err := s.sessions.Sessions(ctx, q, sess.Workspace.ID, store.SchedOccurrenceFilter{From: &from, To: &to,
			Statuses: []string{store.SchedCancelledLate}})
		if err != nil {
			return turn{}, err
		}
		lead := "Nobody cancelled late this month."
		if len(list) > 0 {
			lead = count(len(list), "session was", "sessions were") + " cancelled late this month."
		}
		return s.sessionTurn(lead, "Looking up late cancellations", list, zone), nil
	case askNext:
		if query == "" {
			return turn{Text: "Name the client, for example: when is the next session with Müller?"}, nil
		}
		clients, err := s.clientsNamed(ctx, q, sess, query)
		if err != nil || len(clients) == 0 {
			return turn{Text: "No client matches " + md(query) + "."}, err
		}
		to := now.AddDate(0, 0, 400)
		var next []scheduling.Occurrence
		for _, c := range clients {
			list, err := s.sessions.Sessions(ctx, q, sess.Workspace.ID, store.SchedOccurrenceFilter{From: &now, To: &to, ClientID: c.ID,
				Statuses: openSessions})
			if err != nil {
				return turn{}, err
			}
			if len(list) > 0 && (len(next) == 0 || list[0].StartsAt.Before(next[0].StartsAt)) {
				next = list[:1]
			}
		}
		if len(next) == 0 {
			return turn{Text: "No session with " + md(query) + " is scheduled."}, nil
		}
		o := next[0]
		return s.sessionTurn(fmt.Sprintf("The next session with %s is on %s.", md(o.Client.Name), when(o.StartsAt, zone)),
			"Looking up the next session", next, zone), nil
	default: // askLeft
		if err := need(sess, "read:engagements"); err != nil {
			return turn{}, err
		}
		if s.engagements == nil {
			return turn{}, auth.Error(503, "unavailable", "Engagement assistance is unavailable.", nil)
		}
		list, err := s.engagements.AssistantList(ctx, q, sess, query, false)
		if err != nil {
			return turn{}, err
		}
		out := turn{Statuses: []string{"Looking up packages"}}
		var lines []string
		for i, e := range list {
			if i == maxRecords {
				break
			}
			out.Records = append(out.Records, engagementRecord(e))
			if p := e.CurrentPeriod; p != nil {
				lines = append(lines, fmt.Sprintf("%s · %s: %s of %s left this period.", md(e.Client.Name), md(e.Title), p.Remaining.String(),
					p.Available.String()))
			}
		}
		switch {
		case len(list) == 0 && query != "":
			out.Text = fmt.Sprintf("No active engagement matches “%s”.", md(query))
		case len(list) == 0:
			out.Text = "You don’t have any active engagements."
		case len(lines) == 0:
			out.Text = "These engagements have no package this period."
		default:
			out.Text = strings.Join(lines, "\n")
		}
		return out, nil
	}
}

// clientsNamed is up to five live clients matching the name.
func (s *Service) clientsNamed(ctx context.Context, q store.Q, sess store.Session, name string) ([]store.Client, error) {
	list, _, err := q.ListClients(ctx, sess.Workspace.ID, store.ClientFilter{Search: name, Sort: "-created_at"}, 5, 0)
	return list, err
}

func (s *Service) sessionTurn(lead, status string, list []scheduling.Occurrence, zone *time.Location) turn {
	out := turn{Text: lead, Statuses: []string{status}}
	for i, o := range list {
		if i == maxRecords {
			out.Text += fmt.Sprintf(" Here are the first %d; open Scheduling for the rest.", maxRecords)
			break
		}
		out.Records = append(out.Records, sessionRecord(o, zone))
	}
	if len(list) == 1 {
		out.Actions = []Action{{ID: "open_session", OccurrenceID: list[0].ID, Label: "Open session"}}
	}
	return out
}

// when is "Tue 1 Dec 2026, 09:00" in the zone.
func when(t time.Time, zone *time.Location) string { return t.In(zone).Format("Mon 2 Jan 2006, 15:04") }

func sessionRecord(o scheduling.Occurrence, zone *time.Location) Record {
	host := ""
	if o.Host != nil {
		host = o.Host.Name
	}
	return Record{Kind: "session", ID: o.ID, Title: o.Title, Status: o.Status,
		Detail: joinDetail(when(o.StartsAt, zone), o.Client.Name, host)}
}
