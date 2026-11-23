package scheduling

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// bookable sets up booking: clients may book, the owner works 08:00–18:00 every day, one 60-minute event type.
func (e *env) bookable(b *browser, confirmation string) string {
	e.t.Helper()
	e.do(b, "PUT", "/api/v1/scheduling/settings", map[string]any{"booking_mode": "clients", "confirmation": confirmation}, 200, nil)
	var weekly []map[string]any
	for d := 1; d <= 7; d++ {
		weekly = append(weekly, map[string]any{"day": d, "start": "08:00", "end": "18:00"})
	}
	e.do(b, "PUT", "/api/v1/scheduling/hosts/me", map[string]any{"weekly": weekly}, 200, nil)
	var t struct{ Data store.SchedEventType }
	e.do(b, "POST", "/api/v1/scheduling/event-types", map[string]any{"name": "Trial lesson", "duration_minutes": 60, "mode": "live"}, 201, &t)
	return t.Data.ID
}

func TestBookingRaceOneWins(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	typeID := e.bookable(b, "auto")
	ws := e.ws(b)
	ctx := context.Background()
	slots, err := e.svc.Slots(ctx, ws, typeID, "", mustTime("2026-11-17T00:00:00Z"), mustTime("2026-11-18T00:00:00Z"))
	if err != nil || len(slots) != 10 || !slots[0].StartsAt.Equal(mustTime("2026-11-17T07:00:00Z")) || slots[0].HostID != b.user {
		t.Fatalf("Tuesday 08:00–18:00 in hours: %d %+v %v", len(slots), slots, err)
	}
	if _, err := e.svc.Slots(ctx, ws, typeID, "", fixedNow, fixedNow.AddDate(0, 0, 40)); err == nil {
		t.Fatal("at most 31 days per call")
	}
	clients := []string{e.client(b, "a@example.com"), e.client(b, "b@example.com")}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, c := range clients {
		wg.Go(func() {
			_, errs[i] = e.svc.Book(ctx, ws, c, "", BookInput{EventTypeID: typeID, StartsAt: slots[0].StartsAt})
		})
	}
	wg.Wait()
	won, taken := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			won++
		case errors.Is(err, errSlotTaken):
			taken++
		default:
			t.Fatal(err)
		}
	}
	if won != 1 || taken != 1 {
		t.Fatalf("two clients, one slot: %v", errs)
	}
	after, _ := e.svc.Slots(ctx, ws, typeID, "", mustTime("2026-11-17T00:00:00Z"), mustTime("2026-11-18T00:00:00Z"))
	if len(after) != 9 {
		t.Fatalf("the slot is gone: %d", len(after))
	}
	if _, err := e.svc.Book(ctx, ws, clients[0], "", BookInput{EventTypeID: typeID, StartsAt: mustTime("2026-11-17T07:30:00Z")}); !errors.Is(err, errSlotTaken) {
		t.Fatalf("not a slot: %v", err)
	}
}

func TestBookingManualConfirmation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	typeID := e.bookable(b, "manual")
	c := e.client(b, "a@example.com")
	ws := e.ws(b)
	o, err := e.svc.Book(context.Background(), ws, c, "a@example.com", BookInput{EventTypeID: typeID, StartsAt: mustTime("2026-11-18T09:00:00Z")})
	if err != nil || o.Status != "requested" || o.Request == nil || o.Request.Kind != "booking" {
		t.Fatalf("held, waiting: %+v %v", o, err)
	}
	var got struct{ Data Occurrence }
	e.do(b, "POST", "/api/v1/scheduling/requests/"+o.Request.ID+"/approve", map[string]any{}, 200, &got)
	if got.Data.Status != "scheduled" {
		t.Fatalf("confirmed: %+v", got.Data)
	}
	o2, _ := e.svc.Book(context.Background(), ws, c, "", BookInput{EventTypeID: typeID, StartsAt: mustTime("2026-11-18T10:00:00Z")})
	e.do(b, "POST", "/api/v1/scheduling/requests/"+o2.Request.ID+"/decline", map[string]any{}, 200, nil)
	if st := e.occurrence(b, o2.ID).Status; st != "declined" {
		t.Fatalf("declined booking frees the slot: %s", st)
	}
	e.do(b, "PUT", "/api/v1/scheduling/settings", map[string]any{"booking_mode": "staff"}, 200, nil)
	if _, err := e.svc.Book(context.Background(), ws, c, "", BookInput{EventTypeID: typeID, StartsAt: mustTime("2026-11-18T11:00:00Z")}); !errors.Is(err, errBookingOff) {
		t.Fatalf("booking off: %v", err)
	}
}

func TestBookingLinks(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	typeID := e.bookable(b, "auto")
	var link struct{ Data BookingLink }
	e.do(b, "POST", "/api/v1/scheduling/booking-links", map[string]any{"event_type_id": typeID}, 201, &link)
	if link.Data.URL == nil || !strings.HasPrefix(*link.Data.URL, "https://portal.example.com/book?link=") || !link.Data.Active {
		t.Fatalf("link: %+v", link.Data)
	}
	token := strings.TrimPrefix(*link.Data.URL, "https://portal.example.com/book?link=")
	ctx := context.Background()
	in := PublicBooking{BookInput: BookInput{StartsAt: mustTime("2026-11-18T09:00:00Z")}, Name: "Eva Neu", Email: "Eva@New.example"}
	o, err := e.svc.BookWithLink(ctx, token, in)
	if err != nil || o.Client.Name != "Eva Neu" || o.Status != "scheduled" {
		t.Fatalf("booked through the link: %+v %v", o, err)
	}
	in.StartsAt = mustTime("2026-11-18T10:00:00Z")
	again, err := e.svc.BookWithLink(ctx, token, in)
	if err != nil || again.Client.ID != o.Client.ID {
		t.Fatalf("the client is found again by email: %+v %v", again, err)
	}
	e.do(b, "DELETE", "/api/v1/scheduling/booking-links/"+link.Data.ID, nil, http.StatusNoContent, nil)
	if _, err := e.svc.BookWithLink(ctx, token, in); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("a revoked link is gone: %v", err)
	}
	var list struct{ Data []BookingLink }
	e.do(b, "GET", "/api/v1/scheduling/booking-links", nil, 200, &list)
	if len(list.Data) != 1 || list.Data[0].Active || list.Data[0].URL != nil || list.Data[0].LastUsedAt == nil {
		t.Fatalf("list: %+v", list.Data)
	}
	e.fails(b, "POST", "/api/v1/scheduling/booking-links", map[string]any{"expires_at": "2020-01-01T00:00:00Z", "event_type_id": typeID}, 422, "validation_failed")
}

func TestRolesAndWorkspaces(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	o := e.create(b, map[string]any{"client_id": c, "title": "Intro", "starts_local": "2026-12-01T09:00", "duration_minutes": 60}).Data.Occurrences[0]
	reader := e.join(b.workspace, "member", []string{"read:scheduling"})
	writer := e.join(b.workspace, "member", []string{"read:scheduling", "write:scheduling"})
	none := e.join(b.workspace, "member", []string{"read:clients"})
	admin := e.join(b.workspace, "admin", nil)

	e.occurrence(reader, o.ID)
	e.fails(none, "GET", "/api/v1/scheduling/occurrences/"+o.ID, nil, 403, "forbidden")
	e.fails(reader, "POST", "/api/v1/scheduling/events", map[string]any{"client_id": c}, 403, "forbidden")
	e.do(writer, "PATCH", "/api/v1/scheduling/occurrences/"+o.ID, map[string]any{"title": "Renamed"}, 200, nil)
	e.fails(writer, "PUT", "/api/v1/scheduling/settings", map[string]any{"notice_minutes": 60}, 403, "forbidden")
	e.do(admin, "PUT", "/api/v1/scheduling/settings", map[string]any{"notice_minutes": 60}, 200, nil)
	e.fails(writer, "POST", "/api/v1/scheduling/event-types", map[string]any{"name": "x", "duration_minutes": 30}, 403, "forbidden")
	e.fails(writer, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []any{}}, 403, "forbidden")
	// Own hours for anyone with read:scheduling; someone else's only for owners and admins.
	e.do(reader, "PUT", "/api/v1/scheduling/hosts/"+reader.user, map[string]any{"weekly": []any{}}, 200, nil)
	e.fails(reader, "PUT", "/api/v1/scheduling/hosts/"+writer.user, map[string]any{"weekly": []any{}}, 403, "forbidden")
	e.do(admin, "GET", "/api/v1/scheduling/hosts/"+writer.user, nil, 200, nil)

	other := e.workspace()
	for _, call := range []struct{ method, path string }{
		{"GET", "/api/v1/scheduling/occurrences/" + o.ID},
		{"GET", "/api/v1/scheduling/events/" + o.EventID},
		{"GET", "/api/v1/scheduling/occurrences/" + o.ID + "/ics"},
		{"POST", "/api/v1/scheduling/occurrences/" + o.ID + "/cancel"},
		{"GET", "/api/v1/scheduling/hosts/" + b.user},
	} {
		var body any
		if call.method == "POST" {
			body = map[string]any{}
		}
		e.fails(other, call.method, call.path, body, 404, "not_found")
	}
	if got := e.list(other, ""); len(got) != 0 {
		t.Fatalf("another workspace lists nothing: %+v", got)
	}
}

func TestPlanGateAndMonthlyLimit(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	c := e.client(b, "")
	body := map[string]any{"client_id": c, "title": "Intro", "starts_local": "2026-12-01T09:00", "duration_minutes": 30}
	e.fails(b, "POST", "/api/v1/scheduling/events", body, http.StatusForbidden, "feature_not_in_plan")
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.at(time.Now().UTC()) // the quota month is the real one
	series := map[string]any{"client_id": c, "title": "Weekly", "starts_local": "2027-01-04T09:00", "duration_minutes": 30,
		"recurrence": map[string]any{"freq": "weekly", "count": 30}}
	e.create(b, series) // a series counts once
	for range 99 {
		e.create(b, body)
	}
	e.fails(b, "POST", "/api/v1/scheduling/events", body, http.StatusPaymentRequired, "limit_reached")
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	e.list(b, "") // readable after a downgrade
}

func TestSettingsHolidaysEventTypesAndICS(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var set struct {
		Data struct {
			store.SchedSettings
			PolicyText string `json:"policy_text"`
		}
	}
	e.do(b, "GET", "/api/v1/scheduling/settings?lang=en", nil, 200, &set)
	if set.Data.BookingMode != "staff" || len(set.Data.ClientReminders) != 2 || set.Data.LateRescheduleCounts || set.Data.PolicyText == "" {
		t.Fatalf("defaults: %+v", set.Data)
	}
	e.fails(b, "PUT", "/api/v1/scheduling/settings", map[string]any{"cutoff_time": "25:00"}, 422, "validation_failed")
	e.fails(b, "PUT", "/api/v1/scheduling/settings", map[string]any{"client_reminders": []int{60, 60}}, 422, "validation_failed")
	e.do(b, "PUT", "/api/v1/scheduling/settings", map[string]any{"cutoff_time": "14:00"}, 200, &set)
	if *set.Data.CutoffTime != "14:00" || set.Data.NoticeMinutes != 1440 {
		t.Fatalf("partial update keeps the rest: %+v", set.Data)
	}

	var sug struct {
		Data struct {
			Days []store.SchedHoliday `json:"days"`
		}
	}
	e.do(b, "GET", "/api/v1/scheduling/holidays?suggest=CH&year=2027&canton=ZH", nil, 200, &sug)
	if len(sug.Data.Days) < 8 {
		t.Fatalf("suggestions: %+v", sug.Data.Days)
	}
	c := e.client(b, "")
	occs := e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2026-12-22T09:00", "duration_minutes": 60,
		"skip_holidays": true, "recurrence": map[string]any{"freq": "weekly", "count": 3}}).Data.Occurrences
	e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{{"date": "2026-12-29", "name": "Closed"}}}, 200, nil)
	if st := e.occurrence(b, occs[1].ID).Status; st != "cancelled_on_time" {
		t.Fatalf("a new holiday cancels its session: %s", st)
	}
	open := e.list(b, "from=2026-12-01T00:00:00Z&to=2027-02-01T00:00:00Z&status=scheduled")
	if len(open) != 3 || !open[2].StartsAt.Equal(mustTime("2027-01-12T08:00:00Z")) {
		t.Fatalf("the count skips the holiday: %+v", open)
	}

	var et struct{ Data store.SchedEventType }
	e.do(b, "POST", "/api/v1/scheduling/event-types", map[string]any{"name": "Coaching", "duration_minutes": 45, "unit_price": "90"}, 201, &et)
	e.fails(b, "POST", "/api/v1/scheduling/event-types", map[string]any{"name": "coaching", "duration_minutes": 45}, 422, "validation_failed")
	e.do(b, "PATCH", "/api/v1/scheduling/event-types/"+et.Data.ID, map[string]any{"buffer_after": 15}, 200, &et)
	if et.Data.BufferAfter != 15 || et.Data.UnitPrice == nil {
		t.Fatalf("patched: %+v", et.Data)
	}
	booked := e.create(b, map[string]any{"client_id": c, "event_type_id": et.Data.ID, "starts_local": "2026-12-03T09:00"}).Data
	if booked.Event.Title != "Coaching" || booked.Event.DurationMinutes != 45 {
		t.Fatalf("event type defaults: %+v", booked.Event)
	}
	e.do(b, "DELETE", "/api/v1/scheduling/event-types/"+et.Data.ID, nil, http.StatusNoContent, nil)
	var types struct{ Data []store.SchedEventType }
	e.do(b, "GET", "/api/v1/scheduling/event-types?archived=true", nil, 200, &types)
	if len(types.Data) != 1 || types.Data[0].ArchivedAt == nil {
		t.Fatalf("a used event type is archived: %+v", types.Data)
	}

	resp, raw := e.send(b, "GET", "/api/v1/scheduling/occurrences/"+occs[0].ID+"/ics", nil)
	ics := string(raw)
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "text/calendar") ||
		!strings.Contains(ics, "METHOD:PUBLISH") || !strings.Contains(ics, "UID:"+occs[0].EventID+"@app.example.com") ||
		!strings.Contains(ics, "RECURRENCE-ID;TZID=Europe/Zurich:20261222T090000") {
		t.Fatalf("ics: %d %s", resp.StatusCode, ics)
	}
}
