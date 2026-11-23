package store_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func ptr[T any](v T) *T { return &v }

// seedScheduling: workspaces wsp_a (members usr_o, usr_h) and wsp_b (member usr_b), clients cli_a and cli_b, every
// write admitted.
func seedScheduling(t *testing.T) *store.Store {
	t.Helper()
	s, _ := seedEngagementWorkspace(t)
	s.SetAdmission(func(context.Context, store.Q, string, string, int64) error { return nil })
	ctx := context.Background()
	for id, ws := range map[string]string{"usr_o": "wsp_a", "usr_h": "wsp_a", "usr_b": "wsp_b"} {
		if err := s.CreateUser(ctx, store.User{ID: id, Email: id + "@x.ch", Name: "N-" + id}, t0); err != nil {
			t.Fatal(err)
		}
		if err := s.AddMember(ctx, ws, id, "member", t0); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestSchedulingSettingsDefaultAndSave(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	got, err := s.SchedulingSettings(ctx, "wsp_a")
	if err != nil || got.BookingMode != "staff" || !slices.Equal(got.ClientReminders, []int{1440, 60}) || len(got.HostReminders) != 0 ||
		!got.LateCancelCounts || !got.NoShowCounts || got.LateRescheduleCounts || got.CutoffTime != nil || got.UpdatedAt != nil {
		t.Fatalf("defaults %+v %v", got, err)
	}
	got.BookingMode, got.CutoffTime, got.ClientReminders, got.AutoAttendedAfterHours = "clients", ptr("14:00"), nil, ptr(12)
	if err := s.SaveSchedulingSettings(ctx, "wsp_a", got, "usr_o", t0); err != nil {
		t.Fatal(err)
	}
	saved, err := s.SchedulingSettings(ctx, "wsp_a")
	if err != nil || saved.BookingMode != "clients" || *saved.CutoffTime != "14:00" || len(saved.ClientReminders) != 0 ||
		*saved.AutoAttendedAfterHours != 12 || *saved.UpdatedBy != "usr_o" {
		t.Fatalf("saved %+v %v", saved, err)
	}
	if other, _ := s.SchedulingSettings(ctx, "wsp_b"); other.BookingMode != "staff" {
		t.Fatalf("another workspace's settings: %+v", other)
	}
	saved.NoticeMinutes = 99999
	if err := s.SaveSchedulingSettings(ctx, "wsp_a", saved, "usr_o", t0); err == nil {
		t.Fatal("notice over two weeks was stored")
	}
}

func TestSchedulingHolidaysReplaceAndRange(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	days := []store.SchedHoliday{{Day: "2026-12-25", Name: "Christmas"}, {Day: "2026-08-01", Name: "National Day"}}
	if err := s.ReplaceSchedulingHolidays(ctx, "wsp_a", days); err != nil {
		t.Fatal(err)
	}
	if got, err := s.SchedulingHolidays(ctx, "wsp_a", "", ""); err != nil || len(got) != 2 || got[0].Day != "2026-08-01" {
		t.Fatalf("%+v %v", got, err)
	}
	if got, _ := s.SchedulingHolidays(ctx, "wsp_a", "2026-09-01", "2026-12-25"); len(got) != 1 || got[0].Name != "Christmas" {
		t.Fatalf("range %+v", got)
	}
	if err := s.ReplaceSchedulingHolidays(ctx, "wsp_a", nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.SchedulingHolidays(ctx, "wsp_a", "", ""); len(got) != 0 {
		t.Fatalf("after clearing %+v", got)
	}
}

func TestSchedulingHostHours(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if _, err := s.SchedulingHost(ctx, "wsp_a", "usr_h"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unsaved host: %v", err)
	}
	h := store.SchedHost{UserID: "usr_h", TimeZone: ptr("Europe/Zurich"), Bookable: true,
		Weekly:    []store.SchedWindow{{Weekday: 2, Start: "13:00", End: "17:00"}, {Weekday: 1, Start: "09:00", End: "12:00"}},
		Overrides: []store.SchedOverride{{Day: "2026-12-24"}, {Day: "2026-12-23", Start: ptr("08:00"), End: ptr("10:00")}}}
	if err := s.SaveSchedulingHost(ctx, "wsp_a", h, t0); err != nil {
		t.Fatal(err)
	}
	got, err := s.SchedulingHost(ctx, "wsp_a", "usr_h")
	if err != nil || *got.TimeZone != "Europe/Zurich" || len(got.Weekly) != 2 || got.Weekly[0] != (store.SchedWindow{Weekday: 1, Start: "09:00", End: "12:00"}) ||
		len(got.Overrides) != 2 || got.Overrides[0].Day != "2026-12-23" || *got.Overrides[0].Start != "08:00" || got.Overrides[1].Start != nil {
		t.Fatalf("%+v %v", got, err)
	}
	h.Weekly, h.Overrides = h.Weekly[:1], nil
	if err := s.SaveSchedulingHost(ctx, "wsp_a", h, t0); err != nil {
		t.Fatal(err)
	}
	if all, _ := s.SchedulingHosts(ctx, "wsp_a"); len(all) != 1 || len(all[0].Weekly) != 1 || len(all[0].Overrides) != 0 {
		t.Fatalf("replaced hours %+v", all)
	}
	if err := s.SaveSchedulingHost(ctx, "wsp_a", store.SchedHost{UserID: "usr_b"}, t0); err == nil {
		t.Fatal("a member of another workspace became a host")
	}
	bad := store.SchedHost{UserID: "usr_o", Weekly: []store.SchedWindow{{Weekday: 1, Start: "12:00", End: "09:00"}}}
	if err := s.SaveSchedulingHost(ctx, "wsp_a", bad, t0); err == nil {
		t.Fatal("a window ending before it starts was stored")
	}
	if _, err := s.SchedulingHost(ctx, "wsp_a", "usr_o"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("a refused save left a host: %v", err)
	}
}

func eventType(id, name string) store.SchedEventType {
	return store.SchedEventType{ID: id, WorkspaceID: "wsp_a", Name: name, DurationMinutes: 60, Mode: "online", BufferBefore: 0,
		MinNoticeMinutes: 720, MaxHorizonDays: 60, Bookable: true, UnitPrice: ptr(store.Money(12000)), Currency: ptr("CHF"), CreatedAt: t0, UpdatedAt: t0}
}

func TestSchedEventTypes(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateSchedEventType(ctx, eventType("set_1", "Lesson")); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSchedEventType(ctx, eventType("set_2", "lesson")); !errors.Is(err, store.ErrSchedNameTaken) {
		t.Fatalf("same name: %v", err)
	}
	got, err := s.SchedEventType(ctx, "wsp_a", "set_1")
	if err != nil || *got.UnitPrice != 12000 || len(got.HostIDs) != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	if _, err := s.SchedEventType(ctx, "wsp_b", "set_1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("another workspace's: %v", err)
	}
	got.Name, got.HostIDs = "Long lesson", []string{"usr_h"}
	if err := s.SaveSchedEventType(ctx, got); err != nil {
		t.Fatal(err)
	}
	got.WorkspaceID = "wsp_b"
	if err := s.SaveSchedEventType(ctx, got); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("saved through another workspace: %v", err)
	}
	if err := s.CreateSchedEventType(ctx, eventType("set_2", "Lesson")); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertSchedEvent(ctx, schedEvent("sev_1", "set_2")); err != nil {
		t.Fatal(err)
	}
	if archived, err := s.DeleteSchedEventType(ctx, "wsp_a", "set_2", t0); err != nil || !archived {
		t.Fatalf("used type: archived %v %v", archived, err)
	}
	if archived, err := s.DeleteSchedEventType(ctx, "wsp_a", "set_1", t0); err != nil || archived {
		t.Fatalf("unused type: archived %v %v", archived, err)
	}
	if live, _ := s.SchedEventTypes(ctx, "wsp_a", false); len(live) != 0 {
		t.Fatalf("live %+v", live)
	}
	if all, _ := s.SchedEventTypes(ctx, "wsp_a", true); len(all) != 1 || all[0].ArchivedAt == nil {
		t.Fatalf("all %+v", all)
	}
	// an archived name is free again
	if err := s.CreateSchedEventType(ctx, eventType("set_3", "Lesson")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteSchedEventType(ctx, "wsp_b", "set_3", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted through another workspace: %v", err)
	}
}

func TestSchedBookingLinks(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	link := func(id string, hash string, expires *time.Time) store.SchedBookingLink {
		return store.SchedBookingLink{ID: id, WorkspaceID: "wsp_a", HostUserID: ptr("usr_h"), TokenHash: []byte(hash),
			TokenSealed: []byte("sealed"), ExpiresAt: expires, CreatedBy: "usr_o", CreatedAt: t0}
	}
	if err := s.CreateSchedBookingLink(ctx, link("sbl_1", "h1", nil)); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSchedBookingLink(ctx, link("sbl_2", "h2", ptr(t0.Add(time.Hour)))); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSchedBookingLink(ctx, store.SchedBookingLink{ID: "sbl_3", WorkspaceID: "wsp_a", TokenHash: []byte("h3"),
		TokenSealed: []byte("x"), CreatedBy: "usr_o", CreatedAt: t0}); err == nil {
		t.Fatal("a link for no host and no event type was stored")
	}
	if l, err := s.LiveSchedBookingLink(ctx, []byte("h1"), t0.AddDate(5, 0, 0)); err != nil || l.ID != "sbl_1" {
		t.Fatalf("a link without an end: %+v %v", l, err)
	}
	if _, err := s.LiveSchedBookingLink(ctx, []byte("h2"), t0.Add(time.Hour)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expired link: %v", err)
	}
	if err := s.RevokeSchedBookingLink(ctx, "wsp_b", "sbl_1", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("revoked through another workspace: %v", err)
	}
	if err := s.RevokeSchedBookingLink(ctx, "wsp_a", "sbl_1", t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LiveSchedBookingLink(ctx, []byte("h1"), t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("revoked link: %v", err)
	}
	if err := s.TouchSchedBookingLink(ctx, "sbl_2", t0); err != nil {
		t.Fatal(err)
	}
	if all, _ := s.SchedBookingLinks(ctx, "wsp_a"); len(all) != 2 || all[0].RevokedAt == nil && all[1].RevokedAt == nil {
		t.Fatalf("%+v", all)
	}
	// the host leaving takes their links with them
	if err := s.RemoveMember(ctx, "wsp_a", "usr_h"); err != nil {
		t.Fatal(err)
	}
	if all, _ := s.SchedBookingLinks(ctx, "wsp_a"); len(all) != 0 {
		t.Fatalf("links of a host who left: %+v", all)
	}
}

func TestClientTimeZone(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if tz, err := s.ClientTimeZone(ctx, "wsp_a", "cli_a"); err != nil || tz != nil {
		t.Fatalf("%v %v", tz, err)
	}
	if err := s.SetClientTimeZone(ctx, "wsp_a", "cli_a", ptr("Europe/Zurich"), true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetClientTimeZone(ctx, "wsp_a", "cli_a", ptr("Asia/Tokyo"), true); err != nil {
		t.Fatal(err)
	}
	if tz, _ := s.ClientTimeZone(ctx, "wsp_a", "cli_a"); *tz != "Europe/Zurich" {
		t.Fatalf("the portal replaced a known zone: %s", *tz)
	}
	if err := s.SetClientTimeZone(ctx, "wsp_a", "cli_a", ptr("Asia/Tokyo"), false); err != nil {
		t.Fatal(err)
	}
	if tz, _ := s.ClientTimeZone(ctx, "wsp_a", "cli_a"); *tz != "Asia/Tokyo" {
		t.Fatalf("staff's zone: %s", *tz)
	}
	if _, err := s.ClientTimeZone(ctx, "wsp_b", "cli_a"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("another workspace's client: %v", err)
	}
}

// TestSchedulingExport: the workspace export reads every scheduling_* table (booking links without their token) and
// no export reads a calendar_* table.
func TestSchedulingExport(t *testing.T) {
	var all strings.Builder
	for _, q := range slices.Concat(store.WorkspaceExportTables, store.UserExportTables, store.HRExportTables) {
		all.WriteString(q.Name + " " + q.Query + "\n")
	}
	if strings.Contains(all.String(), "calendar_") {
		t.Fatal("an export reads a calendar_* table")
	}
	for _, table := range []string{"scheduling_settings", "scheduling_holidays", "scheduling_hosts", "scheduling_availability",
		"scheduling_availability_overrides", "scheduling_event_types", "scheduling_events", "scheduling_occurrences",
		"scheduling_occurrence_entries", "scheduling_requests", "scheduling_reminders", "scheduling_booking_links"} {
		if !slices.ContainsFunc(store.WorkspaceExportTables, func(e store.ExportTable) bool { return e.Name == table }) {
			t.Errorf("%s is not in the workspace export", table)
		}
	}
	for _, e := range store.WorkspaceExportTables {
		if e.Name == "scheduling_booking_links" && !strings.Contains(e.Query, "- 'token_hash' - 'token_sealed'") {
			t.Error("booking links are exported with their token")
		}
	}
	for table := range store.ExportExcluded {
		if strings.HasPrefix(table, "scheduling_") {
			t.Errorf("%s is excluded from the export", table)
		}
	}
}
