package vatreturn

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestJustEnded(t *testing.T) {
	for _, c := range []struct {
		today, period, want string
		ok                  bool
	}{
		{"2026-10-01", "quarterly", "2026-Q3", true},
		{"2026-10-07", "quarterly", "2026-Q3", true},
		{"2026-10-08", "quarterly", "", false},
		{"2026-11-03", "monthly", "2026-10", true},
		{"2026-07-02", "half_yearly", "2026-H1", true},
		{"2027-01-05", "yearly", "2026", true},
		{"2026-10-02", "weekly", "", false},
	} {
		p, ok := justEnded(c.today, c.period)
		if ok != c.ok || ok && p.Name != c.want {
			t.Errorf("justEnded(%s, %s) = %s %v, want %s %v", c.today, c.period, p.Name, ok, c.want, c.ok)
		}
	}
}

func TestTickRemindsManagersOncePerPeriod(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	owner := e.workspace()
	admin, member := e.join(owner.workspace, "admin"), e.join(owner.workspace, "member")
	unset := e.workspace() // never saved its settings: nothing to remind of
	if err := e.st.SaveVATReturnSettings(ctx, owner.workspace, e.userOf(owner), store.DefaultVATReturnSettings, time.Now()); err != nil {
		t.Fatal(err)
	}
	svc := New(e.st, nil)
	day := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	for _, at := range []time.Time{day, day.Add(time.Hour), day.AddDate(0, 0, 20)} {
		if err := svc.Tick(ctx, at); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []struct {
		who  *browser
		want int
	}{{owner, 1}, {admin, 1}, {member, 0}, {unset, 0}} {
		got, err := e.st.Notifications(ctx, c.who.workspace, e.userOf(c.who), store.NotificationFilter{Limit: 10})
		if err != nil || len(got) != c.want || c.want == 1 && got[0].Event != "vat.return_due" {
			t.Fatalf("%+v: %+v %v", c.who, got, err)
		}
	}
}

// userOf: the user behind a browser's session.
func (e *env) userOf(b *browser) string {
	e.t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), `SELECT s.user_id FROM sessions s WHERE s.token_hash = encode(sha256($1::bytea), 'hex')`,
		b.token).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}
