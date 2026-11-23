package dataexport

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// The owner's export carries the workspace's sessions and the clients' zones, never a calendar token, feed secret or
// imported busy time.
func TestWorkspaceExportCarriesSchedulingWithoutCalendarSecrets(t *testing.T) {
	e := newEnv(t, fakeFiles{"k/doc_a": "%PDF", "k/quo_a": "%PDF quote", "k/quo_a_r1": "%PDF revision 1"})
	ctx, now := context.Background(), time.Now().UTC().Truncate(time.Second)
	zone := "America/New_York"
	refresh, access, feed := []byte("sealed-refresh-secret"), []byte("sealed-access-secret"), []byte("feed-token-sealed")
	for _, err := range []error{
		e.st.SetClientTimeZone(ctx, "ws_a", "cli_a", &zone, false),
		e.st.InsertSchedEvent(ctx, store.SchedEvent{ID: "sev_a", WorkspaceID: "ws_a", ClientID: "cli_a", HostUserID: &e.sess.User.ID,
			Title: "Weekly coaching", Mode: "live", TimeZone: "Europe/Zurich", StartsLocal: now, DurationMinutes: 60, CreatedAt: now, UpdatedAt: now}),
		e.st.CreateCalendarConnection(ctx, store.CalendarConnection{ID: "cal_a", WorkspaceID: "ws_a", UserID: e.sess.User.ID, Provider: "google",
			AccountEmail: "anna@gmail.test", ExternalAccountID: "g-1", RefreshToken: refresh, AccessToken: access, CreatedAt: now}),
		e.st.SaveCalendarBusy(ctx, "cal_a", []store.BusyBlock{{ExternalID: "primary|busy-dentist", UserID: e.sess.User.ID, StartsAt: now,
			EndsAt: now.Add(time.Hour)}}, nil),
		e.st.SaveCalendarFeed(ctx, store.CalendarFeed{WorkspaceID: "ws_a", UserID: e.sess.User.ID, TokenHash: []byte("feed-token-hash"),
			TokenSealed: feed, CreatedAt: now}),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.st.MaterialiseOccurrences(ctx, "ws_a", "sev_a", []store.SchedSlot{{ID: "soc_a", OriginalStart: now, StartsAt: now,
		EndsAt: now.Add(time.Hour)}}, store.SchedScheduled, nil, now); err != nil {
		t.Fatal(err)
	}
	w := e.get("/api/v1/workspace/export")
	if w.Code != http.StatusOK {
		t.Fatalf("export: %d", w.Code)
	}
	z, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]string{}
	var all strings.Builder
	for _, f := range z.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(r)
		_ = r.Close()
		entries[f.Name] = string(b)
		all.Write(b)
	}
	if !strings.Contains(entries["data/scheduling_events.json"], "Weekly coaching") || !strings.Contains(entries["data/scheduling_occurrences.json"], `"soc_a"`) {
		t.Fatalf("sessions missing: %v", keys(entries))
	}
	if !strings.Contains(entries["data/clients.json"], zone) {
		t.Fatalf("the client's zone is missing: %s", entries["data/clients.json"])
	}
	for name := range entries {
		if strings.HasPrefix(name, "data/calendar_") {
			t.Errorf("%s exported", name)
		}
	}
	for _, secret := range [][]byte{refresh, access, feed, []byte("feed-token-hash"), []byte("busy-dentist"), []byte("anna@gmail.test")} {
		for _, form := range []string{string(secret), hex.EncodeToString(secret), base64.StdEncoding.EncodeToString(secret)} {
			if strings.Contains(all.String(), form) {
				t.Errorf("export leaks %q", form)
			}
		}
	}
}
