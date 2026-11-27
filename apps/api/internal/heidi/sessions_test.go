package heidi

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
)

func TestSessionQuestion(t *testing.T) {
	for _, tc := range []struct{ message, kind, query string }{
		{"What's on my schedule today?", askToday, ""},
		{"Welche Termine habe ich heute?", askToday, ""},
		{"When is the next session with Müller?", askNext, "Müller"},
		{"Wann ist die nächste Sitzung mit Keller AG?", askNext, "Keller AG"},
		{"Who cancelled late this month?", askLate, ""},
		{"Wer hat diesen Monat kurzfristig abgesagt?", askLate, ""},
		{"How many sessions left in Müller's package?", askLeft, "Müller"},
		{"sessions left for Keller AG", askLeft, "Keller AG"},
		{"Show recent invoices", "", ""},
		{"How many hours left for Müller?", "", ""},
	} {
		kind, query, ok := sessionQuestion(tc.message)
		if kind != tc.kind || query != tc.query || ok != (tc.kind != "") {
			t.Errorf("%q: got %q %q %v", tc.message, kind, query, ok)
		}
	}
}

type fakeSessions struct {
	filters []store.SchedOccurrenceFilter
	answer  func(store.SchedOccurrenceFilter) []scheduling.Occurrence
}

func (f *fakeSessions) Sessions(_ context.Context, _ store.Q, _ string, flt store.SchedOccurrenceFilter) ([]scheduling.Occurrence, error) {
	f.filters = append(f.filters, flt)
	return f.answer(flt), nil
}

type fakeEngagements struct{ list []engagements.EngagementView }

func (f fakeEngagements) AssistantList(context.Context, store.Q, store.Session, string, bool) ([]engagements.EngagementView, error) {
	return f.list, nil
}
func (fakeEngagements) AssistantLog(context.Context, store.Q, store.Session, string, string, string, string, *string) (store.EngagementEntry, error) {
	return store.EngagementEntry{}, errors.New("not used")
}

func occ(id, title, client string, start time.Time) scheduling.Occurrence {
	return scheduling.Occurrence{ID: id, Title: title, StartsAt: start, EndsAt: start.Add(time.Hour), Status: "scheduled",
		Client: scheduling.Ref{ID: "cli_" + id, Name: client}, Host: &scheduling.Host{ID: "usr_heidi", Name: "Heidi"}}
}

func TestSessionAnswers(t *testing.T) {
	s, _, sess, _ := fixture(t)
	ctx := context.Background()
	s.now = func() time.Time { return time.Date(2026, 12, 1, 7, 30, 0, 0, time.UTC) } // 08:30 in Zurich
	muller := "cli_mueller"
	if err := s.db.CreateClient(ctx, sess.Workspace.ID, muller, map[string]any{"name": "Müller AG"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	nine := time.Date(2026, 12, 1, 8, 0, 0, 0, time.UTC)
	fake := &fakeSessions{answer: func(f store.SchedOccurrenceFilter) []scheduling.Occurrence {
		switch {
		case slices.Contains(f.Statuses, store.SchedCancelledLate):
			return []scheduling.Occurrence{occ("soc_late", "Coaching", "Keller AG", nine.AddDate(0, 0, -5))}
		case f.ClientID == muller:
			return []scheduling.Occurrence{occ("soc_next", "Coaching", "Müller AG", nine.AddDate(0, 0, 7))}
		case f.ClientID != "":
			return nil
		default:
			return []scheduling.Occurrence{occ("soc_a", "Intro", "Müller AG", nine), occ("soc_b", "Review", "Keller AG", nine.Add(2*time.Hour))}
		}
	}}

	if _, err := s.sessionAnswer(ctx, s.db.Q, *sess, askToday, ""); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("without Scheduling: %v", err)
	}
	s.SetSessions(fake)

	today, err := s.sessionAnswer(ctx, s.db.Q, *sess, askToday, "")
	f := fake.filters[0]
	if err != nil || today.Text != "Today you have 2 sessions." || len(today.Records) != 2 || today.Records[0].Kind != "session" ||
		today.Records[0].ID != "soc_a" || today.Records[0].Detail != "Tue 1 Dec 2026, 09:00 · Müller AG · Heidi" || len(today.Actions) != 0 {
		t.Fatalf("today: %+v %v", today, err)
	}
	if !f.From.Equal(time.Date(2026, 11, 30, 23, 0, 0, 0, time.UTC)) || !f.To.Equal(time.Date(2026, 12, 1, 23, 0, 0, 0, time.UTC)) ||
		!slices.Equal(f.HostIDs, []string{"usr_heidi"}) || !slices.Equal(f.Statuses, openSessions) {
		t.Fatalf("today's filter: %+v", f)
	}

	late, err := s.sessionAnswer(ctx, s.db.Q, *sess, askLate, "")
	f = fake.filters[1]
	if err != nil || late.Text != "1 session was cancelled late this month." || late.Records[0].ID != "soc_late" ||
		late.Actions[0] != (Action{ID: "open_session", OccurrenceID: "soc_late", Label: "Open session"}) || len(f.HostIDs) != 0 ||
		!f.From.Equal(time.Date(2026, 11, 30, 23, 0, 0, 0, time.UTC)) || !f.To.Equal(time.Date(2026, 12, 31, 23, 0, 0, 0, time.UTC)) {
		t.Fatalf("late: %+v %+v %v", late, f, err)
	}

	next, err := s.sessionAnswer(ctx, s.db.Q, *sess, askNext, "müller")
	if err != nil || next.Text != "The next session with Müller AG is on Tue 8 Dec 2026, 09:00." || next.Records[0].ID != "soc_next" ||
		next.Actions[0].OccurrenceID != "soc_next" {
		t.Fatalf("next: %+v %v", next, err)
	}
	if none, err := s.sessionAnswer(ctx, s.db.Q, *sess, askNext, "Nobody GmbH"); err != nil || none.Text != "No client matches Nobody GmbH." {
		t.Fatalf("unknown client: %+v %v", none, err)
	}

	period := &engagements.PeriodSummary{Available: invoicecalc.Quantity(10000), Remaining: invoicecalc.Quantity(3000)}
	period.Used = invoicecalc.Quantity(7000)
	view := engagements.EngagementView{Title: "Coaching package", CurrentPeriod: period}
	view.ID, view.Client.Name = "eng_1", "Müller AG"
	s.engagements = fakeEngagements{list: []engagements.EngagementView{view}}
	left, err := s.sessionAnswer(ctx, s.db.Q, *sess, askLeft, "Müller")
	if err != nil || left.Text != "Müller AG · Coaching package: 3 of 10 left this period." || left.Records[0].Kind != "engagement" {
		t.Fatalf("left: %+v %v", left, err)
	}

	reader := *sess
	reader.Role, reader.Scopes = "member", []string{"read:clients"}
	if _, err := s.sessionAnswer(ctx, s.db.Q, reader, askToday, ""); err == nil {
		t.Fatal("answered without read:scheduling")
	} else if status, _, _, ok := auth.Describe(err); !ok || status != 403 {
		t.Fatalf("refusal: %v", err)
	}
}
