package scheduling

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestDayOffNeedsASpecialRequest(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{{"date": "2026-12-25", "name": "Christmas Day"}}}, 200, nil)
	oneOff := func(start string) map[string]any {
		return map[string]any{"client_id": c, "title": "Lesson", "starts_local": start, "duration_minutes": 60}
	}

	cases := []struct {
		name   string
		body   map[string]any
		status int
	}{
		{"a one-off on a day off is refused", oneOff("2026-12-25T09:00"), http.StatusConflict},
		{"allow_day_off false is still refused", with(oneOff("2026-12-25T10:00"), "allow_day_off", false), http.StatusConflict},
		{"allow_day_off true schedules it", with(oneOff("2026-12-25T11:00"), "allow_day_off", true), http.StatusCreated},
		{"another day needs no flag", oneOff("2026-12-24T09:00"), http.StatusCreated},
		{"a series skips the day off without a flag", with(with(oneOff("2026-12-18T09:00"), "skip_holidays", true),
			"recurrence", map[string]any{"freq": "weekly", "count": 3}), http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, raw := e.send(b, "POST", "/api/v1/scheduling/events", tc.body)
			if resp.StatusCode != tc.status {
				t.Fatalf("status %d, want %d: %s", resp.StatusCode, tc.status, raw)
			}
			if tc.status != http.StatusConflict {
				return
			}
			var out struct {
				Error struct {
					Code    string            `json:"code"`
					Details map[string]string `json:"details"`
				} `json:"error"`
			}
			if err := json.Unmarshal(raw, &out); err != nil || out.Error.Code != "day_off" ||
				out.Error.Details["name"] != "Christmas Day" || out.Error.Details["date"] != "2026-12-25" {
				t.Fatalf("day_off naming the holiday: %s", raw)
			}
		})
	}
	if open := e.list(b, "from=2026-12-18T00:00:00Z&to=2027-01-09T00:00:00Z&status=scheduled"); len(open) != 5 {
		t.Fatalf("the series skips 25 Dec (3 + 24 Dec + the special request): %d", len(open))
	}

	moved := e.create(b, oneOff("2026-12-23T09:00")).Data.Occurrences[0].ID
	path := "/api/v1/scheduling/occurrences/" + moved
	e.fails(b, "PATCH", path, map[string]any{"starts_local": "2026-12-25T09:00"}, http.StatusConflict, "day_off")
	if got := e.occurrence(b, moved); !got.StartsAt.Equal(mustTime("2026-12-23T08:00:00Z")) {
		t.Fatalf("a refused move changes nothing: %v", got.StartsAt)
	}
	e.do(b, "PATCH", path, map[string]any{"starts_local": "2026-12-25T09:00", "allow_day_off": true}, 200, nil)
	e.do(b, "PATCH", path, map[string]any{"starts_local": "2026-12-25T14:00"}, 200, nil)
}

func TestClientsCannotBookADayOff(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	typeID := e.bookable(b, "auto")
	e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{{"date": "2026-11-17", "name": "Closed"}}}, 200, nil)
	ws, ctx := e.ws(b), context.Background()
	slots, err := e.svc.Slots(ctx, ws, typeID, "", mustTime("2026-11-17T00:00:00Z"), mustTime("2026-11-19T00:00:00Z"))
	if err != nil || len(slots) != 10 || !slots[0].StartsAt.Equal(mustTime("2026-11-18T07:00:00Z")) {
		t.Fatalf("only Wednesday's slots: %d %+v %v", len(slots), slots, err)
	}
	c := e.client(b, "a@example.com")
	if _, err := e.svc.Book(ctx, ws, c, "", BookInput{EventTypeID: typeID, StartsAt: mustTime("2026-11-17T07:00:00Z")}); !errors.Is(err, errSlotTaken) {
		t.Fatalf("booking a day off: %v", err)
	}
}

func with(m map[string]any, k string, v any) map[string]any {
	m[k] = v
	return m
}
