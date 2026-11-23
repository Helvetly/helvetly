package portal

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// host makes usr_owner a bookable host of wsp_a, working every day 00:00–23:59 UTC.
func (e *env) host() {
	e.staff()
	e.exec(`INSERT INTO scheduling_hosts (workspace_id, user_id, time_zone, bookable, updated_at) VALUES ('wsp_a','usr_owner','UTC',true,now())`)
	for d := 1; d <= 7; d++ {
		e.exec(`INSERT INTO scheduling_availability (workspace_id, user_id, weekday, starts, ends) VALUES ('wsp_a','usr_owner',$1,'00:00','23:59')`, d)
	}
}

// session adds a one-off session of client starting at start; meeting "" makes it live.
func (e *env) session(id, client, status string, start time.Time, meeting string) {
	mode, url := "live", any(nil)
	if meeting != "" {
		mode, url = "online", meeting
	}
	e.exec(`INSERT INTO scheduling_events (id, workspace_id, client_id, host_user_id, title, description, client_note, mode, meeting_provider,
		meeting_url, location, time_zone, starts_local, duration_minutes, created_at, updated_at)
		VALUES ($1,'wsp_a',$2,'usr_owner','Coaching','internal only','Bring notes',$3,CASE WHEN $3 = 'online' THEN 'manual' END,$4,
		CASE WHEN $3 = 'live' THEN 'Bahnhofstrasse 1' END,'UTC',$5,60,now(),now())`, "sev_"+id, client, mode, url, start.Format("2006-01-02T15:04"))
	e.exec(`INSERT INTO scheduling_occurrences (id, workspace_id, event_id, host_user_id, client_id, original_start, starts_at, ends_at, status,
		timed_at, created_at, updated_at) VALUES ($1,'wsp_a',$2,'usr_owner',$3,$4,$4,$5,$6,now(),now(),now())`,
		"soc_"+id, "sev_"+id, client, start, start.Add(time.Hour), status)
}

func errCode(out map[string]any) string {
	if e, ok := out["error"].(map[string]any); ok {
		code, _ := e["code"].(string)
		return code
	}
	return ""
}

func TestPortalSessionsOwnClientOnly(t *testing.T) {
	e := newEnv(t)
	e.host()
	now := time.Now().UTC().Truncate(time.Minute)
	e.session("soon", "cli_1", "scheduled", now.Add(2*time.Hour), "https://meet.example.com/soon")
	e.session("later", "cli_1", "scheduled", now.Add(72*time.Hour), "https://meet.example.com/later")
	e.session("done", "cli_1", "attended", now.Add(-72*time.Hour), "")
	e.session("other", "cli_3", "scheduled", now.Add(72*time.Hour), "")
	e.exec(`UPDATE clients SET time_zone = 'Europe/Zurich' WHERE id = 'cli_1'`)
	c, _ := e.signIn("ana@acme.ch")

	res, body := e.get(c, "/scheduling/occurrences?when=upcoming")
	if res.StatusCode != 200 || !strings.Contains(body, "soc_soon") || !strings.Contains(body, "soc_later") ||
		strings.Contains(body, "soc_other") || strings.Contains(body, "soc_done") || strings.Contains(body, "internal only") ||
		!strings.Contains(body, `"time_zone":"Europe/Zurich"`) || !strings.Contains(body, `"meeting_url":"https://meet.example.com/soon"`) ||
		strings.Contains(body, "meet.example.com/later") || !strings.Contains(body, `"can_cancel":true`) ||
		!strings.Contains(body, `"client_note":"Bring notes"`) || !strings.Contains(body, `"host_name"`) {
		t.Fatalf("upcoming: %d %s", res.StatusCode, body)
	}
	if strings.Index(body, "soc_soon") > strings.Index(body, "soc_later") {
		t.Fatalf("upcoming by start: %s", body)
	}
	if res, body := e.get(c, "/scheduling/occurrences?when=past"); res.StatusCode != 200 || !strings.Contains(body, "soc_done") ||
		strings.Contains(body, "soc_soon") || !strings.Contains(body, `"status":"attended"`) {
		t.Fatalf("past: %d %s", res.StatusCode, body)
	}
	if res, _ := e.get(c, "/scheduling/occurrences?when=soon"); res.StatusCode != 400 {
		t.Fatalf("bad when: %d", res.StatusCode)
	}
	res, body = e.get(c, "/scheduling/occurrences/soc_later/ics")
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/calendar") ||
		!strings.Contains(body, "METHOD:PUBLISH") || strings.Contains(body, "internal only") {
		t.Fatalf("ics: %d %s", res.StatusCode, body)
	}
	if res, _ := e.get(c, "/scheduling/occurrences/soc_other/ics"); res.StatusCode != 404 {
		t.Fatalf("another client's ics: %d", res.StatusCode)
	}
}

func TestPortalRequests(t *testing.T) {
	e := newEnv(t)
	e.host()
	now := time.Now().UTC().Truncate(time.Minute)
	e.session("soon", "cli_1", "scheduled", now.Add(2*time.Hour), "")   // inside the 24 h notice: late
	e.session("later", "cli_1", "scheduled", now.Add(96*time.Hour), "") // on time
	e.session("move", "cli_1", "scheduled", now.Add(120*time.Hour), "")
	e.session("other", "cli_3", "scheduled", now.Add(96*time.Hour), "")
	c, csrf := e.signIn("ana@acme.ch")
	base := "/scheduling/occurrences/"
	proposed := []string{now.Add(144 * time.Hour).Format(time.RFC3339)}

	for _, tc := range []struct {
		name, path string
		body       map[string]any
		csrf       string
		status     int
		code       string
	}{
		{"no csrf", base + "soc_later/cancel-request", map[string]any{}, "", 403, "csrf_failed"},
		{"another client's", base + "soc_other/cancel-request", map[string]any{}, csrf, 404, "not_found"},
		{"note too long", base + "soc_later/cancel-request", map[string]any{"note": strings.Repeat("x", 501)}, csrf, 422, "validation_failed"},
		{"on time cancels at once", base + "soc_later/cancel-request", map[string]any{"note": "Sick"}, csrf, 200, ""},
		{"closed", base + "soc_later/cancel-request", map[string]any{}, csrf, 409, "not_open"},
		{"late waits", base + "soc_soon/cancel-request", map[string]any{}, csrf, 201, ""},
		{"one open request", base + "soc_soon/reschedule-request", map[string]any{"proposed_times": proposed}, csrf, 409, "request_open"},
		{"no times", base + "soc_move/reschedule-request", map[string]any{"proposed_times": []string{}}, csrf, 422, "validation_failed"},
		{"reschedule", base + "soc_move/reschedule-request", map[string]any{"proposed_times": proposed, "note": "Next week?"}, csrf, 201, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res, out := e.do("POST", tc.path, tc.body, c, tc.csrf)
			if res.StatusCode != tc.status || errCode(out) != tc.code {
				t.Fatalf("%d %s, want %d %s: %v", res.StatusCode, errCode(out), tc.status, tc.code, out)
			}
		})
	}
	var status string
	var late bool
	if err := e.raw.QueryRow(t.Context(), `SELECT status FROM scheduling_occurrences WHERE id = 'soc_later'`).Scan(&status); err != nil || status != "cancelled_on_time" {
		t.Fatalf("on time: %s %v", status, err)
	}
	var lateID string
	if err := e.raw.QueryRow(t.Context(), `SELECT id, late FROM scheduling_requests WHERE occurrence_id = 'soc_soon'`).Scan(&lateID, &late); err != nil || !late {
		t.Fatalf("late request: %v %v", late, err)
	}

	// Withdraw the late cancel; the business proposes another time for the reschedule and the client accepts it.
	if res, out := e.do("DELETE", "/scheduling/requests/"+lateID, nil, c, csrf); res.StatusCode != 204 {
		t.Fatalf("withdraw: %d %v", res.StatusCode, out)
	}
	if res, out := e.do("DELETE", "/scheduling/requests/"+lateID, nil, c, csrf); res.StatusCode != 409 {
		t.Fatalf("withdraw again: %d %v", res.StatusCode, out)
	}
	moved := now.Add(150 * time.Hour)
	e.exec(`UPDATE scheduling_requests SET status = 'proposed', staff_proposal = $1 WHERE occurrence_id = 'soc_move'`, moved)
	var moveID string
	if err := e.raw.QueryRow(t.Context(), `SELECT id FROM scheduling_requests WHERE occurrence_id = 'soc_move'`).Scan(&moveID); err != nil {
		t.Fatal(err)
	}
	bob, bobCSRF := e.signIn("bob@beta.ch")
	if res, _ := e.do("POST", "/scheduling/requests/"+moveID+"/accept", map[string]any{}, bob, bobCSRF); res.StatusCode != 404 {
		t.Fatalf("another client accepts: %d", res.StatusCode)
	}
	if res, out := e.do("POST", "/scheduling/requests/"+moveID+"/accept", map[string]any{}, c, csrf); res.StatusCode != 200 ||
		out["data"].(map[string]any)["status"] != "accepted" {
		t.Fatalf("accept: %d %v", res.StatusCode, out)
	}
	var starts time.Time
	if err := e.raw.QueryRow(t.Context(), `SELECT starts_at, status FROM scheduling_occurrences WHERE id = 'soc_move'`).Scan(&starts, &status); err != nil ||
		!starts.Equal(moved) || status != "rescheduled" {
		t.Fatalf("moved: %s %s %v", starts, status, err)
	}
}

// bookable turns client booking on with one 60-minute live event type (no notice) and answers its id.
func (e *env) bookable(confirmation string) string {
	e.host()
	e.exec(`INSERT INTO scheduling_settings (workspace_id, booking_mode, confirmation, updated_at) VALUES ('wsp_a','clients',$1,now())`, confirmation)
	e.exec(`INSERT INTO scheduling_event_types (id, workspace_id, name, duration_minutes, mode, min_notice_minutes, unit_price, currency,
		created_at, updated_at) VALUES ('set_trial','wsp_a','Trial lesson',60,'live',0,9000,'CHF',now(),now())`)
	return "set_trial"
}

// nextSlot is a free start tomorrow, as the slots answer has it.
func (e *env) nextSlot(c *http.Cookie, path string) string {
	e.t.Helper()
	day := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	res, out := e.do("GET", fmt.Sprintf("%sfrom=%s&to=%s", path, day.Format(time.RFC3339), day.Add(24*time.Hour).Format(time.RFC3339)), nil, c, "")
	slots, _ := out["data"].([]any)
	if res.StatusCode != 200 || len(slots) == 0 {
		e.t.Fatalf("slots: %d %v", res.StatusCode, out)
	}
	return slots[3].(map[string]any)["starts_at"].(string)
}

func TestPortalBookingRaceOneWins(t *testing.T) {
	e := newEnv(t)
	typeID := e.bookable("auto")
	ana, anaCSRF := e.signIn("ana@acme.ch")
	bob, bobCSRF := e.signIn("bob@beta.ch")

	res, out := e.do("GET", "/scheduling/booking", nil, ana, "")
	types, _ := out["event_types"].([]any)
	if res.StatusCode != 200 || out["mode"] != "clients" || len(types) != 1 || out["policy_text"] == "" {
		t.Fatalf("booking: %d %v", res.StatusCode, out)
	}
	if hosts := types[0].(map[string]any)["hosts"].([]any); len(hosts) != 1 || types[0].(map[string]any)["price"] != "90.00" {
		t.Fatalf("type: %v", types[0])
	}
	start := e.nextSlot(ana, "/scheduling/booking/slots?event_type_id="+typeID+"&")

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	codes := make([]string, 2)
	for i, who := range []struct {
		c    *http.Cookie
		csrf string
	}{{ana, anaCSRF}, {bob, bobCSRF}} {
		wg.Go(func() {
			res, out := e.do("POST", "/scheduling/booking", map[string]any{"event_type_id": typeID, "starts_at": start}, who.c, who.csrf)
			statuses[i], codes[i] = res.StatusCode, errCode(out)
		})
	}
	wg.Wait()
	won := map[int]int{}
	for i, s := range statuses {
		won[s]++
		if s == 409 && codes[i] != "slot_taken" {
			t.Fatalf("loser's code: %s", codes[i])
		}
	}
	if won[201] != 1 || won[409] != 1 {
		t.Fatalf("one booking wins, one is told the slot is taken: %v %v", statuses, codes)
	}
	var n int
	if err := e.raw.QueryRow(t.Context(), `SELECT count(*) FROM scheduling_occurrences WHERE status = 'scheduled'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("sessions: %d %v", n, err)
	}

	// Booking off: the page lists nothing and a booking is refused.
	e.exec(`UPDATE scheduling_settings SET booking_mode = 'staff'`)
	if res, out := e.do("GET", "/scheduling/booking", nil, ana, ""); res.StatusCode != 200 || len(out["event_types"].([]any)) != 0 {
		t.Fatalf("staff only: %d %v", res.StatusCode, out)
	}
	if res, out := e.do("POST", "/scheduling/booking", map[string]any{"event_type_id": typeID, "starts_at": start}, ana, anaCSRF); res.StatusCode != 409 ||
		errCode(out) != "booking_off" {
		t.Fatalf("booking off: %d %v", res.StatusCode, out)
	}
}

func TestPortalBookingManualConfirmation(t *testing.T) {
	e := newEnv(t)
	typeID := e.bookable("manual")
	c, csrf := e.signIn("ana@acme.ch")
	start := e.nextSlot(c, "/scheduling/booking/slots?event_type_id="+typeID+"&")
	res, out := e.do("POST", "/scheduling/booking", map[string]any{"event_type_id": typeID, "starts_at": start, "note": "First time"}, c, csrf)
	if res.StatusCode != 201 || out["data"].(map[string]any)["status"] != "requested" {
		t.Fatalf("book: %d %v", res.StatusCode, out)
	}
	_, body := e.get(c, "/scheduling/occurrences")
	if !strings.Contains(body, `"kind":"booking"`) || !strings.Contains(body, `"can_cancel":false`) {
		t.Fatalf("pending booking: %s", body)
	}
}

func TestPortalBookingLink(t *testing.T) {
	e := newEnv(t)
	typeID := e.bookable("auto")
	e.exec(`UPDATE scheduling_settings SET booking_mode = 'staff'`) // a link books whatever the mode
	e.exec(`UPDATE clients SET number = number + 100`)              // the fixtures' numbers bypass the client counter
	token := "link-token-for-tests"
	sum := sha256.Sum256([]byte(token))
	e.exec(`INSERT INTO scheduling_booking_links (id, workspace_id, event_type_id, token_hash, token_sealed, created_by, created_at)
		VALUES ('sbl_1','wsp_a',$1,$2,'\x00','usr_owner',now())`, typeID, sum[:])

	res, out := e.doAt("", "GET", "/scheduling/link?link="+token, nil, nil, "")
	if res.StatusCode != 200 || out["workspace"] != "Studio" || len(out["event_types"].([]any)) != 1 {
		t.Fatalf("link: %d %v", res.StatusCode, out)
	}
	if res, _ := e.doAt("", "GET", "/scheduling/link?link=nope", nil, nil, ""); res.StatusCode != 404 {
		t.Fatalf("unknown link: %d", res.StatusCode)
	}
	day := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	res, out = e.doAt("", "GET", fmt.Sprintf("/scheduling/link/slots?link=%s&event_type_id=%s&from=%s&to=%s", token, typeID,
		day.Format(time.RFC3339), day.Add(24*time.Hour).Format(time.RFC3339)), nil, nil, "")
	slots, _ := out["data"].([]any)
	if res.StatusCode != 200 || len(slots) == 0 {
		t.Fatalf("link slots: %d %v", res.StatusCode, out)
	}
	start := slots[0].(map[string]any)["starts_at"]
	book := map[string]any{"event_type_id": typeID, "starts_at": start, "name": "Nora New", "email": "Nora@New.ch"}
	if res, out := e.doAt("", "POST", "/scheduling/link/book?link="+token, map[string]any{"event_type_id": typeID, "starts_at": start}, nil, ""); res.StatusCode != 422 {
		t.Fatalf("no name: %d %v", res.StatusCode, out)
	}
	if res, out := e.doAt("", "POST", "/scheduling/link/book?link="+token, book, nil, ""); res.StatusCode != 201 ||
		out["data"].(map[string]any)["status"] != "scheduled" {
		t.Fatalf("book: %d %v", res.StatusCode, out)
	}
	var name string
	if err := e.raw.QueryRow(t.Context(), `SELECT name FROM clients WHERE email = 'nora@new.ch'`).Scan(&name); err != nil || name != "Nora New" {
		t.Fatalf("client made: %s %v", name, err)
	}
	e.exec(`UPDATE scheduling_booking_links SET revoked_at = now()`)
	if res, _ := e.doAt("", "GET", "/scheduling/link?link="+token, nil, nil, ""); res.StatusCode != 404 {
		t.Fatalf("revoked: %d", res.StatusCode)
	}
}

func TestVerifyKeepsFirstTimeZone(t *testing.T) {
	e := newEnv(t)
	sign := func(zone string) {
		res, out := e.do("POST", "/auth/verify", map[string]string{"email": "bob@beta.ch", "code": "123456", "time_zone": zone}, nil, "")
		if res.StatusCode != 201 {
			t.Fatalf("verify: %d %v", res.StatusCode, out)
		}
	}
	zone := func() (z *string) {
		if err := e.raw.QueryRow(t.Context(), `SELECT time_zone FROM clients WHERE id = 'cli_3'`).Scan(&z); err != nil {
			t.Fatal(err)
		}
		return z
	}
	for _, bad := range []string{"Local", "../etc/passwd", "Mars/Olympus"} {
		if sign(bad); zone() != nil {
			t.Fatalf("%q kept", bad)
		}
	}
	sign("Europe/Zurich")
	sign("America/New_York")
	if z := zone(); z == nil || *z != "Europe/Zurich" {
		t.Fatalf("first zone stays: %v", z)
	}
}
