package store_test

import (
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestWorkspaceToday(t *testing.T) {
	for _, tc := range []struct{ zone, now, want string }{
		{"America/New_York", "2026-11-17T04:59:00Z", "2026-11-16"}, // 23:59 EST
		{"America/New_York", "2026-11-17T05:00:00Z", "2026-11-17"}, // midnight EST
		{"Europe/Zurich", "2026-11-16T22:59:00Z", "2026-11-16"},    // 23:59 CET
		{"Europe/Zurich", "2026-11-16T23:00:00Z", "2026-11-17"},    // midnight CET
		{"UTC", "2026-11-16T23:59:00Z", "2026-11-16"},
		{"Mars/Base", "2026-11-16T23:59:00Z", "2026-11-16"}, // an unknown name falls back to UTC
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		if got := (store.Workspace{Timezone: tc.zone}).Today(now); got != tc.want {
			t.Errorf("%s at %s: %s, want %s", tc.zone, tc.now, got, tc.want)
		}
	}
}

func TestValidTimezone(t *testing.T) {
	for name, want := range map[string]bool{"Europe/Zurich": true, "America/New_York": true, "UTC": true,
		"": false, "Local": false, "Mars/Base": false, "../etc/passwd": false} {
		if got := store.ValidTimezone(name); got != want {
			t.Errorf("%q: %v, want %v", name, got, want)
		}
	}
}
