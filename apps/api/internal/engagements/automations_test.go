package engagements

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Billing admits against the real clock's month, so these tests run on today's UTC date, not fixedNow.
func automationClock(e *env, hourUTC int) time.Time {
	y, m, d := time.Now().UTC().Date()
	at := time.Date(y, m, d, hourUTC, 0, 0, 0, time.UTC)
	e.svc.now = func() time.Time { return at }
	return at
}

// failingMailer refuses the addresses in fail and records the rest.
type failingMailer struct {
	uncertain         string
	uncertainAttempts int
	mu                sync.Mutex
	fail              []string
	sent              []string
}

func (f *failingMailer) Send(_ context.Context, m mail.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.uncertain == m.To[0] {
		f.uncertainAttempts++
		return mail.ErrUncertain
	}
	if slices.Contains(f.fail, m.To[0]) {
		return errors.New("smtp refused")
	}
	f.sent = append(f.sent, m.To[0])
	return nil
}

func (f *failingMailer) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

// automationEnv: a Pro workspace with three managers and an engagement ending soon (ending_soon and under_pace
// notices), the notices raised before 07:00 Zurich so that no digest goes yet.
func automationEnv(t *testing.T) (*env, *browser, *failingMailer, []string) {
	e := newEnv(t)
	m := &failingMailer{}
	e.svc.SetMailer(m, "https://app.example.com")
	b := e.workspace()
	e.join(b.workspace, "admin")
	e.join(b.workspace, "admin")
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	at := automationClock(e, 5) // 06:00 in Zurich
	e.create(b, input(e.client(b), map[string]any{"recurrence": "none",
		"start_date": at.AddDate(0, 0, -15).Format(time.DateOnly), "end_date": at.AddDate(0, 0, 9).Format(time.DateOnly)}))
	e.tick(at)
	_, emails, err := e.st.DigestRecipients(context.Background(), b.workspace)
	if err != nil || len(emails) != 3 {
		t.Fatalf("recipients %v %v", emails, err)
	}
	return e, b, m, emails
}

func (e *env) automationUsage(ws string, at time.Time) store.PeriodUsage {
	e.t.Helper()
	u, err := e.st.UsageInPeriods(context.Background(), ws, store.AutomationActions, store.UsagePeriod(at), store.UsagePeriod(at))
	if err != nil {
		e.t.Fatal(err)
	}
	return u
}

func (e *env) pendingNotices(ws string) int {
	return e.count(`SELECT count(*) FROM engagement_notices n JOIN engagements g ON g.id = n.engagement_id
		WHERE g.workspace_id = $1 AND n.notified_at IS NULL`, ws)
}

// seedAutomations records n used automatic actions this month.
func (e *env) seedAutomations(ws string, n int, at time.Time) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period,
			reserved, consumed, created_at, settled_at)
		SELECT $1, $2, 'seed:' || i, '', $3, 0, 1, now(), now() FROM generate_series(1, $4::int) AS i`,
		ws, store.AutomationActions, store.UsagePeriod(at), n); err != nil {
		e.t.Fatal(err)
	}
}

// TestAutomationNoticesAndDigestCountOncePerTargetAndRecipient: each notice is one action once per period and kind;
// the digest to three managers is three; a run with nothing new counts nothing.
func TestAutomationNoticesAndDigestCountOncePerTargetAndRecipient(t *testing.T) {
	e, b, m, _ := automationEnv(t)
	at := automationClock(e, 5)
	e.tick(at)
	if u := e.automationUsage(b.workspace, at); u.Consumed != 2 || u.Reserved != 0 {
		t.Fatalf("two notices, ticked twice: %+v", u)
	}
	at = automationClock(e, 9) // 10:00 in Zurich
	e.tick(at)
	if u := e.automationUsage(b.workspace, at); m.count() != 3 || u.Consumed != 5 || u.Reserved != 0 {
		t.Fatalf("digest to three: %d sent, %+v", m.count(), u)
	}
	e.tick(automationClock(e, 10))
	if u := e.automationUsage(b.workspace, at); m.count() != 3 || u.Total() != 5 {
		t.Fatalf("empty tick: %d sent, %+v", m.count(), u)
	}
}

// TestAutomationDigestPartialSend: a recipient whose send fails is given back; when every send fails nothing counts
// and the notices wait for the next run.
func TestAutomationDigestPartialSend(t *testing.T) {
	t.Run("one of three fails", func(t *testing.T) {
		e, b, m, emails := automationEnv(t)
		m.fail = emails[1:2]
		at := automationClock(e, 9)
		e.tick(at)
		if u := e.automationUsage(b.workspace, at); m.count() != 2 || u.Consumed != 4 || u.Reserved != 0 {
			t.Fatalf("%d sent, %+v", m.count(), u)
		}
		m.fail = nil
		// A new worker reads the original batch from Postgres.
		worker := New(e.st, e.svc.auth, e.svc.inv, e.svc.log)
		worker.SetMailer(m, "https://app.example.test")
		worker.sendDigests(context.Background(), at.Add(time.Hour))
		if len(m.sent) != 3 || m.sent[2] != emails[1] || m.sent[0] == m.sent[1] || slices.Contains(m.sent[:2], emails[1]) {
			t.Fatal(m.sent)
		}
		if u := e.automationUsage(b.workspace, at); u.Consumed != 5 || u.Reserved != 0 {
			t.Fatal(u)
		}

	})
	t.Run("uncertain and revoked recipients", func(t *testing.T) {
		e, b, m, emails := automationEnv(t)
		m.uncertain = emails[0]
		m.fail = emails[1:2]
		at := automationClock(e, 9)
		e.tick(at)
		// Remove the refused manager's access before the next worker runs.
		if _, err := e.pool.Exec(context.Background(), `UPDATE workspace_members SET role='member'
            WHERE workspace_id=$1 AND user_id=(SELECT id FROM users WHERE email=$2)`, b.workspace, emails[1]); err != nil {
			t.Fatal(err)
		}
		m.fail = nil
		e.tick(at.Add(time.Hour))
		if m.uncertainAttempts != 1 || !slices.Equal(m.sent, []string{emails[2]}) {
			t.Fatalf("attempts %d, sent %v", m.uncertainAttempts, m.sent)
		}
		if u := e.automationUsage(b.workspace, at); u.Consumed != 4 || u.Reserved != 0 {
			t.Fatal(u)
		}
	})
	t.Run("all fail", func(t *testing.T) {
		e, b, m, emails := automationEnv(t)
		m.fail = emails
		at := automationClock(e, 9)
		e.tick(at)
		if u := e.automationUsage(b.workspace, at); u.Consumed != 2 || u.Reserved != 0 || e.count("SELECT count(*) FROM digest_deliveries WHERE workspace_id=$1 AND state='pending'", b.workspace) != 3 {
			t.Fatalf("%+v, pending %d", u, e.pendingNotices(b.workspace))
		}
		m.fail = nil
		e.tick(automationClock(e, 10))
		if u := e.automationUsage(b.workspace, at); m.count() != 3 || u.Total() != 5 || e.pendingNotices(b.workspace) != 0 {
			t.Fatalf("next run: %d sent, %+v", m.count(), u)
		}
	})
}

// TestAutomationDigestWaitsForRoomForEveryRecipient: two actions left for three recipients send nothing and count
// nothing; after the upgrade the digest goes to all three.
func TestAutomationDigestWaitsForRoomForEveryRecipient(t *testing.T) {
	e, b, m, _ := automationEnv(t)
	at := automationClock(e, 9)
	e.seedAutomations(b.workspace, 3000-2-2, at)
	e.tick(at)
	if u := e.automationUsage(b.workspace, at); m.count() != 0 || u.Total() != 2998 || e.pendingNotices(b.workspace) != 2 {
		t.Fatalf("at the limit: %d sent, %+v, pending %d", m.count(), u, e.pendingNotices(b.workspace))
	}
	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.tick(automationClock(e, 10))
	if u := e.automationUsage(b.workspace, at); m.count() != 3 || u.Total() != 3001 {
		t.Fatalf("after the upgrade: %d sent, %+v", m.count(), u)
	}
}

// TestAutomationAutoDraftCountsOnceAndWaitsAtTheLimit: an automatic draft is one action however often the job runs;
// with none left it waits without an error and is made after the upgrade.
func TestAutomationAutoDraftCountsOnceAndWaitsAtTheLimit(t *testing.T) {
	drafts := func(e *env, ws string) int {
		return e.count(`SELECT coalesce(sum(consumed + reserved), 0) FROM usage_events WHERE workspace_id = $1 AND resource = $2
			AND operation LIKE 'engagements.draft:%'`, ws, store.AutomationActions)
	}
	for _, full := range []bool{false, true} {
		t.Run(map[bool]string{false: "room", true: "full"}[full], func(t *testing.T) {
			e := newEnv(t)
			e.svc.inv = &fakeDrafts{e: e}
			b := e.workspace()
			billingtest.Wire(t, e.st)
			billingtest.On(t, e.st, b.workspace, billing.Pro)
			at := automationClock(e, 9)
			y, mo, _ := at.Date()
			v := e.create(b, input(e.client(b), map[string]any{"auto_invoice": true,
				"start_date": time.Date(y, mo, 1, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)}))
			if full {
				e.seedAutomations(b.workspace, 3000, at)
			}
			e.tick(at)
			e.tick(at)
			if full {
				if n := e.invoicesOf(v.ID, "advance"); n != 0 || drafts(e, b.workspace) != 0 {
					t.Fatalf("at the limit: %d drafts, %d counted", n, drafts(e, b.workspace))
				}
				billingtest.On(t, e.st, b.workspace, billing.Business)
				e.tick(at)
			}
			if n := e.invoicesOf(v.ID, "advance"); n != 1 || drafts(e, b.workspace) != 1 {
				t.Fatalf("full=%v: %d drafts, %d counted", full, n, drafts(e, b.workspace))
			}
		})
	}
}
