package billing

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestSubscriptionNews(t *testing.T) {
	end := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)
	was := store.Billing{SubscriptionID: "sub_1", Status: "active", Plan: Basic}
	for _, c := range []struct {
		name   string
		typ    string
		before store.Billing
		after  store.Subscription
		want   string
	}{
		{"first checkout", "checkout.session.completed", store.Billing{}, store.Subscription{Status: "trialing", Plan: Basic}, ""},
		{"trial ends soon", "customer.subscription.trial_will_end", was, store.Subscription{Status: "trialing", Plan: Basic, TrialEnd: &end}, "billing.trial_ending"},
		{"redelivered", "customer.subscription.updated", was, store.Subscription{Status: "active", Plan: Basic}, ""},
		{"upgrade", "customer.subscription.updated", was, store.Subscription{Status: "active", Plan: Pro}, "billing.subscription_changed"},
		{"card fails", "customer.subscription.updated", was, store.Subscription{Status: "past_due", Plan: Basic}, "billing.payment_failed"},
		{"still failing", "customer.subscription.updated", store.Billing{SubscriptionID: "sub_1", Status: "past_due", Plan: Basic},
			store.Subscription{Status: "unpaid", Plan: Basic}, "billing.subscription_changed"},
		{"cancelled", "customer.subscription.deleted", was, store.Subscription{Status: "canceled"}, "billing.subscription_changed"},
	} {
		if got, _ := subscriptionNews(c.typ, c.before, c.after); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func (e *env) events(ws string, role string) []string {
	e.t.Helper()
	var out []string
	rows, err := e.raw.Query(context.Background(), `SELECT n.event FROM notifications n JOIN workspace_members m
		ON m.user_id = n.user_id AND m.workspace_id = n.workspace_id WHERE n.workspace_id = $1 AND m.role = $2 ORDER BY n.id`, ws, role)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var ev string
		if err := rows.Scan(&ev); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, ev)
	}
	return out
}

func TestWebhookNotifiesOwnersOnce(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.join(ws, "admin")
	other := e.workspace().workspace
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	for i, s := range []struct{ status, price string }{{"active", "price_bm"}, {"active", "price_pm"}, {"past_due", "price_pm"}} {
		e.stripe.put("sub_1", ws, "cus_1", s.status, s.price)
		id := "evt_" + string(rune('a'+i))
		for range 2 { // a redelivered event is applied once
			if code := e.event(id, "customer.subscription.updated", map[string]any{"id": "sub_1"}); code != http.StatusOK {
				t.Fatalf("status %d", code)
			}
		}
	}
	got := e.events(ws, "owner")
	if len(got) != 2 || got[0] != "billing.subscription_changed" || got[1] != "billing.payment_failed" {
		t.Fatalf("owner: %v", got)
	}
	if got := e.events(ws, "admin"); len(got) != 0 {
		t.Fatalf("admin: %v", got)
	}
	if got := e.events(other, "owner"); len(got) != 0 {
		t.Fatalf("other workspace: %v", got)
	}
}

func TestLimitNearNotifiesManagersOnce(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.join(b.workspace, "admin")
	e.join(b.workspace, "member")
	e.subscribe(b.workspace, "price_bm")
	setAdmissionLimit(t, e, Clients, 10)
	ctx := context.Background()
	add := func(n int) {
		for range n {
			if err := e.st.Tx(ctx, func(q store.Q) error {
				return q.CreateClient(ctx, b.workspace, "cli_"+time.Now().Format("150405.000000000"), map[string]any{"name": "Client"}, time.Now())
			}); err != nil {
				t.Fatal(err)
			}
		}
	}
	add(8) // 80 %
	if got := e.events(b.workspace, "owner"); len(got) != 0 {
		t.Fatalf("below 90 %%: %v", got)
	}
	add(2) // 90 % and 100 %: one notification
	for role, want := range map[string]int{"owner": 1, "admin": 1, "member": 0} {
		if got := e.events(b.workspace, role); len(got) != want || want == 1 && got[0] != "billing.limit_near" {
			t.Fatalf("%s: %v", role, got)
		}
	}
}

func TestAdminSubscriptionAlerts(t *testing.T) {
	e := newEnv(t, true)
	e.st.EnableAdminAlerts()
	ws := e.workspace().workspace
	ctx := context.Background()

	for i, step := range []struct {
		status, want string
		cancel       bool
	}{
		{"incomplete", "", false},
		{"trialing", "Nowa subskrypcja (okres próbny)", false},
		{"active", "Nowa aktywna subskrypcja", false},
		{"active", "Zaplanowano anulowanie subskrypcji", true},
		{"active", "", true},
		{"canceled", "Subskrypcja zakończona", false},
		{"canceled", "", false},
	} {
		e.stripe.put("sub_admin", ws, "cus_admin", step.status, "price_bm")
		e.stripe.mu.Lock()
		e.stripe.subs["sub_admin"]["cancel_at_period_end"] = step.cancel
		e.stripe.mu.Unlock()

		id := fmt.Sprintf("evt_%d", i)
		for range 2 {
			if code := e.event(id, "customer.subscription.updated", map[string]any{"id": "sub_admin"}); code != http.StatusOK {
				t.Fatalf("event %s: HTTP %d", id, code)
			}
		}

		var count int
		var message string
		if err := e.raw.QueryRow(ctx, `SELECT count(*), coalesce(max(message), '') FROM admin_alerts`).Scan(&count, &message); err != nil {
			t.Fatal(err)
		}
		if step.want == "" {
			if count != 0 {
				t.Fatalf("unexpected alert for %s: %q", step.status, message)
			}
			continue
		}
		if count != 1 || !strings.HasPrefix(message, step.want+"\n") || !strings.Contains(message, "sub_admin") {
			t.Fatalf("unexpected alerts for %s: %d, %q, want %q", step.status, count, message, step.want)
		}
		e.exec(`DELETE FROM admin_alerts`)
	}
}
