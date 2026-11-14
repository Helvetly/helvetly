package engagements

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

type jobMailer struct {
	mu    sync.Mutex
	msgs  []mail.Message
	delay time.Duration // set before the job runs
}

func (f *jobMailer) Send(_ context.Context, m mail.Message) error {
	time.Sleep(f.delay)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.msgs = append(f.msgs, m)
	return nil
}

func (f *jobMailer) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.msgs)
}

// failingDrafts refuses one client, like a client deleted meanwhile.
type failingDrafts struct {
	Invoices
	bad string
}

func (f failingDrafts) CreateDraft(ctx context.Context, q store.Q, sess store.Session, clientID string, fill func(*store.Invoice)) (string, error) {
	if clientID == f.bad {
		return "", errors.New("client gone")
	}
	return f.Invoices.CreateDraft(ctx, q, sess, clientID, fill)
}

// zurich is a local Europe/Zurich wall time on 2026-11-16 (CET, UTC+1).
func zurich(hhmm string) time.Time { return wallTime("Europe/Zurich", hhmm) }

func wallTime(zone, hhmm string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", "2026-11-16 "+hhmm, store.Workspace{Timezone: zone}.Location())
	if err != nil {
		panic(err)
	}
	return t
}

func (e *env) tick(at time.Time) {
	e.t.Helper()
	if err := e.svc.Tick(context.Background(), at); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) count(query string, args ...any) (n int) {
	e.t.Helper()
	if err := e.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func (e *env) invoicesOf(engagementID, kind string) int {
	return e.count(`SELECT count(*) FROM engagement_invoices ei JOIN engagement_periods p ON p.id = ei.period_id
		WHERE p.engagement_id = $1 AND ei.kind = $2`, engagementID, kind)
}

func (e *env) noticeKinds(engagementID string) string {
	e.t.Helper()
	var kinds string
	if err := e.pool.QueryRow(context.Background(), `SELECT coalesce(string_agg(kind, ',' ORDER BY kind), '') FROM engagement_notices
		WHERE engagement_id = $1`, engagementID).Scan(&kinds); err != nil {
		e.t.Fatal(err)
	}
	return kinds
}

func TestTickAutoAdvanceOnce(t *testing.T) {
	e := newEnv(t)
	e.svc.inv = &fakeDrafts{e: e}
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"auto_invoice": true}))
	e.tick(fixedNow)
	e.tick(fixedNow)
	if n := e.invoicesOf(v.ID, "advance"); n != 1 {
		t.Fatalf("%d advance drafts", n)
	}
	if got := e.noticeKinds(v.ID); !strings.Contains(got, "draft_created") {
		t.Fatal(got)
	}
}

func TestTickUsageAfterClose(t *testing.T) {
	e := newEnv(t)
	e.svc.inv = &fakeDrafts{e: e}
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"billing": "arrears", "start_date": "2026-10-01", "auto_invoice": true}))
	e.entry(v.ID, "2026-10-05", 2000)
	e.tick(fixedNow)
	e.tick(fixedNow)
	if n := e.invoicesOf(v.ID, "usage"); n != 1 {
		t.Fatalf("%d usage drafts", n)
	}
	if n := e.invoicesOf(v.ID, "advance"); n != 0 {
		t.Fatalf("%d advance drafts for arrears", n)
	}
}

func TestTickClientDeletedLogsAndContinues(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	bad, good := e.client(b), e.client(b)
	e.svc.inv = failingDrafts{Invoices: &fakeDrafts{e: e}, bad: bad}
	broken := e.create(b, input(bad, map[string]any{"auto_invoice": true}))
	fine := e.create(b, input(good, map[string]any{"auto_invoice": true}))
	e.tick(fixedNow)
	if e.invoicesOf(broken.ID, "advance") != 0 || e.invoicesOf(fine.ID, "advance") != 1 {
		t.Fatal("the failure must not stop the next engagement")
	}
}

// endingSoon: a one-off ending in 9 days, nothing logged: ending_soon and under_pace.
func (e *env) endingSoon(b *browser) view {
	return e.create(b, input(e.client(b), map[string]any{"recurrence": "none", "start_date": "2026-11-01", "end_date": "2026-11-25"}))
}

func TestDigestOncePerDayAfter7(t *testing.T) {
	e := newEnv(t)
	m := &jobMailer{}
	e.svc.SetMailer(m, "https://app.example.com")
	b := e.workspace()
	v := e.endingSoon(b)
	e.tick(zurich("06:59"))
	if m.count() != 0 {
		t.Fatal("digest before 07:00")
	}
	e.tick(zurich("07:05"))
	if m.count() != 1 {
		t.Fatalf("%d mails at 07:05", m.count())
	}
	msg := m.msgs[0]
	if !strings.HasPrefix(msg.Subject, "Engagements: 2 updates") || !strings.Contains(msg.Text, "https://app.example.com/engagements?id="+v.ID) ||
		!strings.Contains(msg.HTML, "<a href=") {
		t.Fatalf("%+v", msg)
	}
	e.tick(zurich("08:05"))
	if m.count() != 1 {
		t.Fatalf("%d mails after 08:05", m.count())
	}
}

// Two instances running the job at once send the digest once.
func TestDigestOnceAcrossInstances(t *testing.T) {
	e := newEnv(t)
	m := &jobMailer{delay: 100 * time.Millisecond}
	e.svc.SetMailer(m, "https://app.example.com")
	e.endingSoon(e.workspace())
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			if err := e.svc.Tick(context.Background(), zurich("07:05")); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if m.count() != 1 {
		t.Fatalf("%d digests from two instances", m.count())
	}
}

// Each workspace gets its digest from 07:00 in its own time zone.
func TestDigestAt7LocalPerWorkspace(t *testing.T) {
	e := newEnv(t)
	m := &jobMailer{}
	e.svc.SetMailer(m, "https://app.example.com")
	e.endingSoon(e.workspace())
	e.endingSoon(e.workspaceIn("America/New_York"))
	e.tick(zurich("07:05")) // 01:05 in New York
	if m.count() != 1 {
		t.Fatalf("%d mails at 07:05 Zurich", m.count())
	}
	e.tick(wallTime("America/New_York", "06:59"))
	if m.count() != 1 {
		t.Fatalf("%d mails before 07:00 New York", m.count())
	}
	e.tick(wallTime("America/New_York", "07:05"))
	if m.count() != 2 {
		t.Fatalf("%d mails at 07:05 New York", m.count())
	}
}

func TestDigestOffNoMail(t *testing.T) {
	e := newEnv(t)
	m := &jobMailer{}
	e.svc.SetMailer(m, "https://app.example.com")
	b := e.workspace()
	e.endingSoon(b)
	e.do(b, "PUT", "/api/v1/engagement-settings", map[string]any{"digest": false}, 200, nil)
	e.tick(zurich("07:05"))
	if m.count() != 0 {
		t.Fatal("digest sent although off")
	}
}

func TestNoticesKinds(t *testing.T) {
	e := newEnv(t)
	e.svc.inv = &fakeDrafts{e: e}
	b := e.workspace()
	soon := e.endingSoon(b)
	closed := e.create(b, input(e.client(b), map[string]any{"billing": "arrears", "start_date": "2026-10-01"}))
	e.entry(closed.ID, "2026-10-05", 2000)
	auto := e.create(b, input(e.client(b), map[string]any{"auto_invoice": true}))
	e.tick(fixedNow)
	e.tick(fixedNow)
	for id, want := range map[string]string{soon.ID: "ending_soon,under_pace", closed.ID: "ending_soon,period_closed,under_pace", auto.ID: "draft_created,ending_soon,under_pace"} {
		if got := e.noticeKinds(id); got != want {
			t.Errorf("%s: %q, want %q", id, got, want)
		}
	}
}

func TestDigestMessageEscapes(t *testing.T) {
	m := digestMessage("a@x.ch", []store.EngagementNotice{{Kind: "ending_soon", EngagementID: "eng_1", Number: 3, Title: `<b>"x"</b>`}}, "https://app")
	if strings.Contains(m.HTML, "<b>") || !strings.Contains(m.HTML, "&lt;b&gt;") {
		t.Fatal(m.HTML)
	}
}

func TestSettingsMember403OnPut(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	var got struct{ Data struct{ Digest bool } }
	e.do(member, "GET", "/api/v1/engagement-settings", nil, 200, &got)
	if !got.Data.Digest {
		t.Fatal("digest defaults to on")
	}
	e.fails(member, "PUT", "/api/v1/engagement-settings", map[string]any{"digest": false}, 403, "forbidden")
	e.fails(owner, "PUT", "/api/v1/engagement-settings", map[string]any{}, 422, "validation_failed", "digest")
	e.do(owner, "PUT", "/api/v1/engagement-settings", map[string]any{"digest": false}, 200, nil)
	e.do(member, "GET", "/api/v1/engagement-settings", nil, 200, &got)
	if got.Data.Digest {
		t.Fatal("digest should be off")
	}
}

// The job has no signed-in user: the real invoices service must still make a valid draft for the engagement's client.
func TestTickRealInvoicesDraft(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	cli := e.client(b)
	v := e.create(b, input(cli, map[string]any{"billing": "advance", "auto_invoice": true}))
	e.tick(fixedNow)
	if n := e.invoicesOf(v.ID, "advance"); n != 1 {
		t.Fatalf("%d advance drafts", n)
	}
	var status, client string
	if err := e.pool.QueryRow(context.Background(), `SELECT i.status, i.client_id FROM invoices i JOIN engagement_invoices ei ON ei.invoice_id = i.id
		JOIN engagement_periods p ON p.id = ei.period_id WHERE p.engagement_id = $1`, v.ID).Scan(&status, &client); err != nil {
		t.Fatal(err)
	}
	if status != "draft" || client != cli {
		t.Fatalf("status %q, client %q", status, client)
	}
	if n := e.count(`SELECT count(*) FROM invoice_lines l JOIN engagement_invoices ei ON ei.invoice_id = l.invoice_id
		JOIN engagement_periods p ON p.id = ei.period_id WHERE p.engagement_id = $1`, v.ID); n == 0 {
		t.Fatal("draft has no lines")
	}
}

func TestGuardTurnsPanicIntoError(t *testing.T) {
	err := guard(func() error { panic("boom") })
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v", err)
	}
}

func TestTickAutoOnlyCurrentAndLastClosed(t *testing.T) {
	e := newEnv(t)
	e.svc.inv = &fakeDrafts{e: e}
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-08-01", "auto_invoice": true}))
	for _, d := range []string{"2026-08-05", "2026-09-05", "2026-10-05"} {
		e.entry(v.ID, d, 40000)
	}
	e.tick(fixedNow)
	if n := e.invoicesOf(v.ID, "advance"); n != 1 {
		t.Fatalf("%d advance drafts", n)
	}
	if n := e.invoicesOf(v.ID, "usage"); n != 1 {
		t.Fatalf("%d usage drafts", n)
	}
}

// notified: how many notifications of the event people with the role have in the workspace.
func (e *env) notified(ws, role, event string) int {
	return e.count(`SELECT count(*) FROM notifications n JOIN workspace_members m ON m.user_id = n.user_id AND m.workspace_id = n.workspace_id
		WHERE n.workspace_id = $1 AND m.role = $2 AND n.event = $3`, ws, role, event)
}

func TestTickNotifiesManagersOnce(t *testing.T) {
	e := newEnv(t)
	e.svc.inv = &fakeDrafts{e: e}
	b := e.workspace()
	e.join(b.workspace, "admin")
	e.join(b.workspace, "member")
	other := e.workspace()
	e.create(other, input(e.client(other), nil))
	e.create(b, input(e.client(b), map[string]any{"auto_invoice": true}))
	over := e.create(b, input(e.client(b), nil))
	e.entry(over.ID, "2026-11-05", 31000) // 31 of 30 hours
	e.tick(fixedNow)
	e.tick(fixedNow)
	for _, c := range []struct {
		ws, role, event string
		want            int
	}{
		{b.workspace, "owner", "engagement.draft_created", 1},
		{b.workspace, "admin", "engagement.draft_created", 1},
		{b.workspace, "member", "engagement.draft_created", 0},
		{b.workspace, "owner", "engagement.over_committed", 1},
		{b.workspace, "admin", "engagement.over_committed", 1},
		{b.workspace, "member", "engagement.over_committed", 0},
		{other.workspace, "owner", "engagement.over_committed", 0},
	} {
		if n := e.notified(c.ws, c.role, c.event); n != c.want {
			t.Errorf("%s %s: %d, want %d", c.role, c.event, n, c.want)
		}
	}
}
