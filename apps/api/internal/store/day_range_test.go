package store_test

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// A day the person picks begins at midnight in their zone: the filter compares the UTC instant of that midnight,
// across the changes to and from summer time and in zones far from UTC.
func TestDayRangeInZone(t *testing.T) {
	st, _ := storetest.New(t)
	ctx := context.Background()
	utc := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	tests := []struct {
		name, zone, day, start string // start: the instant the day begins in the zone
	}{
		{"Zurich, the day summer time starts (+01:00 at midnight)", "Europe/Zurich", "2026-03-29", "2026-03-28T23:00:00Z"},
		{"Zurich, the day after it starts (+02:00)", "Europe/Zurich", "2026-03-30", "2026-03-29T22:00:00Z"},
		{"Zurich, the day summer time ends (+02:00 at midnight)", "Europe/Zurich", "2026-10-25", "2026-10-24T22:00:00Z"},
		{"Zurich, the day after it ends (+01:00)", "Europe/Zurich", "2026-10-26", "2026-10-25T23:00:00Z"},
		{"Kiritimati, +14:00", "Pacific/Kiritimati", "2026-11-16", "2026-11-15T10:00:00Z"},
		{"Pago Pago, -11:00", "Pacific/Pago_Pago", "2026-11-16", "2026-11-16T11:00:00Z"},
		{"no zone is UTC", "", "2026-11-16", "2026-11-16T00:00:00Z"},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ws := "wsp_day" + string(rune('a'+i))
			if err := st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
				t.Fatal(err)
			}
			start := utc(tt.start)
			for id, at := range map[string]time.Time{ws + "_before": start.Add(-time.Second), ws + "_on": start} {
				if err := st.CreateClient(ctx, ws, id, map[string]any{"name": id, "country": "CH"}, at); err != nil {
					t.Fatal(err)
				}
			}
			list, total, err := st.ListClients(ctx, ws, store.ClientFilter{CreatedFrom: tt.day, Zone: tt.zone, Sort: "name"}, 10, 0)
			if err != nil {
				t.Fatal(err)
			}
			if total != 1 || len(list) != 1 || list[0].ID != ws+"_on" {
				t.Fatalf("created_from %s in %q: %d matches %+v, want only %s_on", tt.day, tt.zone, total, list, ws)
			}
		})
	}
}
