package admintelegram

import (
	"context"
	"errors"
	"fmt"
	"html"
	"sort"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/store"
)

type command struct{ name, arg string }

var commands = []struct{ name, args, description string }{
	{"stats", "", "Overview of everything below"},
	{"users", "", "Users, sign-ups and active people"},
	{"workspaces", "", "Workspaces created and deleted"},
	{"paid", "", "Paying workspaces, trials, MRR and ARR"},
	{"signups", "[n]", "The latest n sign-ups (10, at most 25)"},
	{"workspace", "<id|slug|email>", "One workspace's summary"},
	{"usage", "", "Storage, AI and email use this month"},
	{"health", "", "Version, database and queues"},
	{"help", "", "What the bot answers"},
}

var helpText = func() string {
	lines := []string{"<b>Helvetly operator bot</b> (read-only)"}
	for _, c := range commands {
		lines = append(lines, strings.TrimSpace("/"+c.name+" "+esc(c.args))+": "+c.description)
	}
	return strings.Join(lines, "\n")
}()

// parse reads a command line: "/signups 5", "/signups@SomeBot 5", "/workspace ann@example.com".
func parse(line string) (command, error) {
	name, arg, _ := strings.Cut(strings.TrimSpace(line), " ")
	name, _, _ = strings.Cut(strings.TrimPrefix(name, "/"), "@")
	cmd := command{name: strings.ToLower(name), arg: strings.TrimSpace(arg)}
	switch cmd.name {
	case "stats", "users", "workspaces", "paid", "usage", "health", "help", "start":
		return cmd, nil
	case "signups":
		if _, err := signupCount(cmd.arg); err != nil {
			return cmd, err
		}
		return cmd, nil
	case "workspace":
		if cmd.arg == "" || len(cmd.arg) > 254 || strings.ContainsAny(cmd.arg, " \t\n") {
			return cmd, errors.New("Usage: /workspace <id|slug|email>")
		}
		return cmd, nil
	}
	return cmd, errors.New("Unknown command.")
}

func signupCount(arg string) (int, error) {
	if arg == "" {
		return 10, nil
	}
	n, err := strconv.Atoi(arg)
	if err != nil || n < 1 {
		return 0, errors.New("Usage: /signups [n], n from 1 to 25")
	}
	return min(n, 25), nil
}

func (b *Bot) run(ctx context.Context, cmd command) (string, error) {
	now := b.now()
	switch cmd.name {
	case "users":
		return b.users(ctx, now)
	case "workspaces":
		return b.workspaces(ctx, now)
	case "paid":
		return b.paid(ctx, now)
	case "signups":
		n, _ := signupCount(cmd.arg)
		return b.signups(ctx, n, now)
	case "workspace":
		return b.workspace(ctx, cmd.arg, now)
	case "usage":
		return b.usage(ctx, now)
	case "health":
		return b.health(ctx, now)
	case "stats":
		var parts []string
		for _, f := range []func(context.Context, time.Time) (string, error){b.users, b.workspaces, b.paid, b.usage, b.health} {
			s, err := f(ctx, now)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return strings.Join(parts, "\n\n"), nil
	}
	return helpText, nil
}

func (b *Bot) users(ctx context.Context, now time.Time) (string, error) {
	u, err := b.db.OperatorUsers(ctx, now)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("<b>Users</b>\nTotal: %s\nSign-ups: %s today · %s in 7 days · %s in 30 days\nActive: %s in 7 days · %s in 30 days",
		num(u.Total), num(u.Today), num(u.Week), num(u.Month), num(u.Active7), num(u.Active30)), nil
}

func (b *Bot) workspaces(ctx context.Context, now time.Time) (string, error) {
	w, err := b.db.OperatorWorkspaces(ctx, now)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("<b>Workspaces</b>\nTotal: %s\nNew: %s in 7 days · %s in 30 days\nDeleted (restorable): %s",
		num(w.Total), num(w.Week), num(w.Month), num(w.Deleted)), nil
}

// paidSummary is what /paid shows, computed from the stored subscriptions with billing's plan and price rules.
type paidSummary struct {
	byPlan                      map[string]map[string]int64 // plan → interval → workspaces
	paying, seats               int64
	trials, trialsEnding        int64
	pastDue, lapsed, cancelling int64
	mrr                         map[string]int64 // currency → minor units a month
}

func summarisePaid(subs []store.OperatorSubscription, now time.Time) paidSummary {
	s := paidSummary{byPlan: map[string]map[string]int64{}, mrr: map[string]int64{}}
	for _, sub := range subs {
		plan := billing.PlanOf(sub.Billing, now)
		switch {
		case plan == "":
			if sub.Status == "active" || sub.Status == "trialing" || sub.Status == "past_due" {
				s.lapsed++ // live at Stripe, unpaid past the grace
			}
			continue
		case sub.Status == "trialing":
			s.trials++
			if sub.TrialEnd != nil && sub.TrialEnd.Before(now.Add(7*24*time.Hour)) {
				s.trialsEnding++
			}
			continue
		}
		if sub.Status == "past_due" {
			s.pastDue++
		}
		if sub.CancelAtPeriodEnd {
			s.cancelling++
		}
		if s.byPlan[plan] == nil {
			s.byPlan[plan] = map[string]int64{}
		}
		s.byPlan[plan][sub.Interval]++
		s.paying++
		seats := billing.IncludedSeats(plan)
		if sub.PaidSeats != nil {
			seats = *sub.PaidSeats
		} else if sub.Seats != nil {
			seats = *sub.Seats
		}
		amount := billing.PlanAmount(plan, sub.Interval) // an earlier flat price per workspace
		if sub.PerSeat {
			s.seats += seats
			amount = billing.PlanTotal(plan, sub.Interval, seats)
		}
		if sub.Interval == "year" {
			amount /= 12
		}
		s.mrr[strings.ToLower(sub.Currency)] += amount
	}
	return s
}

func (b *Bot) paid(ctx context.Context, now time.Time) (string, error) {
	subs, cancelled, err := b.db.OperatorSubscriptions(ctx, now.Add(-30*24*time.Hour))
	if err != nil {
		return "", err
	}
	s := summarisePaid(subs, now)
	lines := []string{"<b>Paid</b>", "Paying workspaces: " + num(s.paying)}
	for _, plan := range billing.Plans() {
		if n := s.byPlan[plan]; len(n) > 0 {
			lines = append(lines, fmt.Sprintf("  %s: %s monthly · %s yearly", billing.PlanName(plan), num(n["month"]), num(n["year"])))
		}
	}
	lines = append(lines,
		"Paid seats (per-seat prices): "+num(s.seats),
		fmt.Sprintf("Trials: %s running · %s ending in 7 days", num(s.trials), num(s.trialsEnding)),
		fmt.Sprintf("Past due, in grace: %s · lapsed past grace: %s", num(s.pastDue), num(s.lapsed)),
		fmt.Sprintf("Cancelling at period end: %s · cancelled in 30 days: %s", num(s.cancelling), num(cancelled)))
	if len(s.mrr) == 0 {
		lines = append(lines, "MRR: none")
	}
	currencies := make([]string, 0, len(s.mrr))
	for c := range s.mrr {
		currencies = append(currencies, c)
	}
	sort.Strings(currencies)
	for _, c := range currencies {
		lines = append(lines, fmt.Sprintf("MRR ≈ %s · ARR ≈ %s", money(s.mrr[c], c), money(s.mrr[c]*12, c)))
	}
	lines = append(lines, "<i>Estimate: list prices with VAT, discounts ignored.</i>")
	return strings.Join(lines, "\n"), nil
}

// planLabel names the plan a billing record gives now: "Free", "Pro", "Pro trial", "Basic, past due".
func planLabel(b store.Billing, now time.Time) string {
	plan := billing.PlanOf(b, now)
	if plan == "" {
		return "Free"
	}
	switch b.Status {
	case "trialing":
		return billing.PlanName(plan) + " trial"
	case "past_due":
		return billing.PlanName(plan) + ", past due"
	}
	return billing.PlanName(plan)
}

func (b *Bot) signups(ctx context.Context, n int, now time.Time) (string, error) {
	list, err := b.db.OperatorSignups(ctx, n)
	if err != nil {
		return "", err
	}
	lines := []string{fmt.Sprintf("<b>Latest %d sign-ups</b>", len(list))}
	for _, s := range list {
		ws := s.Workspace
		if ws == "" {
			ws = "no workspace"
		}
		lines = append(lines, fmt.Sprintf("%s · %s · %s · %s", s.At.UTC().Format("2006-01-02 15:04"), esc(s.Email), esc(ws),
			planLabel(s.Billing, now)))
	}
	return strings.Join(lines, "\n"), nil
}

func (b *Bot) workspace(ctx context.Context, key string, now time.Time) (string, error) {
	w, err := b.db.OperatorFindWorkspace(ctx, key, now)
	if err != nil {
		return "", err
	}
	title := "<b>" + esc(w.Name) + "</b> (" + esc(w.ID)
	if w.Slug != "" {
		title += ", portal " + esc(w.Slug)
	}
	lines := []string{title + ")"}
	if w.OtherWorkspacesOfEmail > 0 {
		lines = append(lines, fmt.Sprintf("<i>That email has %d more workspace(s); search by id for those.</i>", w.OtherWorkspacesOfEmail))
	}
	if w.DeletedAt != nil {
		lines = append(lines, "Deleted "+w.DeletedAt.UTC().Format(time.DateOnly))
	}
	if w.OwnerEmail != "" {
		lines = append(lines, "Owner: "+esc(w.OwnerEmail))
	}
	active := "never"
	if w.LastActive != nil {
		active = w.LastActive.UTC().Format("2006-01-02 15:04")
	}
	lines = append(lines, "Created "+w.CreatedAt.UTC().Format(time.DateOnly)+" · last active "+active)
	plan := planLabel(w.Billing, now)
	if w.Billing.Interval != "" && plan != "Free" {
		plan += " (" + w.Billing.Interval + "ly)"
	}
	if w.Billing.CancelAtPeriodEnd {
		plan += ", cancelling"
	}
	lines = append(lines, "Plan: "+plan,
		fmt.Sprintf("Members %s · clients %s · invoices issued %s · documents %s", num(w.Members), num(w.Clients), num(w.Invoices), num(w.Documents)))
	storage, heidi, automation := int64(-2), int64(-2), int64(-2) // -2: unknown
	if b.Limits != nil {
		if s, h, a, err := b.Limits(ctx, w.ID); err == nil {
			storage, heidi, automation = s, h, a
		}
	}
	lines = append(lines, "Storage: "+bytesText(w.StorageBytes)+of(storage, bytesText),
		"AI this month: Heidi "+num(w.HeidiTokens)+of(heidi, num)+" · automation "+num(w.AutomationTokens)+of(automation, num)+" tokens")
	return strings.Join(lines, "\n"), nil
}

func of(limit int64, format func(int64) string) string {
	switch {
	case limit == -1:
		return " of unlimited"
	case limit < 0:
		return ""
	}
	return " of " + format(limit)
}

func (b *Bot) usage(ctx context.Context, now time.Time) (string, error) {
	u, err := b.db.OperatorUsage(ctx, now)
	if err != nil {
		return "", err
	}
	lines := []string{"<b>Usage</b>", "Storage: " + bytesText(u.StorageBytes)}
	pools := []string{}
	for _, p := range u.Pools {
		pools = append(pools, fmt.Sprintf("%s %s tokens (%s)", p.Pool, num(p.Tokens), money(p.CostMicros/10_000, "usd")))
	}
	if len(pools) == 0 {
		pools = append(pools, "none")
	}
	lines = append(lines, "AI this month: "+strings.Join(pools, " · "),
		"Operator bot today: "+num(u.OperatorTokens)+" tokens",
		"Emails this month: "+num(u.Emails)+" recipients")
	lines = append(lines, ranking("Top storage", u.TopStorage, bytesText)...)
	lines = append(lines, ranking("Top AI (tokens)", u.TopAI, num)...)
	return strings.Join(lines, "\n"), nil
}

func ranking(title string, list []store.OperatorRank, format func(int64) string) []string {
	if len(list) == 0 {
		return nil
	}
	out := []string{title + ":"}
	for i, r := range list {
		out = append(out, fmt.Sprintf("  %d. %s %s", i+1, esc(r.Workspace), format(r.Amount)))
	}
	return out
}

func (b *Bot) health(ctx context.Context, now time.Time) (string, error) {
	h, err := b.db.OperatorHealth(ctx, now)
	if err != nil {
		return "", err
	}
	version := b.Version
	if version == "" {
		version = "dev"
	}
	return strings.Join([]string{"<b>Health</b>",
		"Version " + esc(version) + " · up " + now.Sub(b.started).Round(time.Minute).String(),
		fmt.Sprintf("DB connections: %d of %d (this instance's pool: %d of %d)", h.Connections, h.MaxConnections, h.PoolInUse, h.PoolMax),
		fmt.Sprintf("Waiting: ZIP exports %s · calendar pushes %s · staged uploads %s · import files %s · alerts %s",
			num(h.ZipExports), num(h.CalendarPushes), num(h.StagedUploads), num(h.ImportFiles), num(h.AdminAlerts)),
		fmt.Sprintf("Failed in 24h: e-invoices %s · ZIP exports %s · import files %s · calendar pushes retrying %s",
			num(h.FailedEInvoices), num(h.FailedZips), num(h.FailedImports), num(h.FailingPushes)),
	}, "\n"), nil
}

func esc(s string) string { return html.EscapeString(s) }

// num writes n with thousands separators: 12,345.
func num(n int64) string {
	s := strconv.FormatInt(max(n, -n), 10)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	if n < 0 {
		return "-" + s
	}
	return s
}

// money writes minor units in a currency: "CHF 1,234.50".
func money(minor int64, currency string) string {
	return fmt.Sprintf("%s %s.%02d", strings.ToUpper(currency), num(minor/100), max(minor%100, -minor%100))
}

// bytesText writes decimal units, as storage is sold: "1.2 GB".
func bytesText(n int64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	v, i := float64(n), 0
	for v >= 1000 && i < len(units)-1 {
		v /= 1000
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%d B", n)
	}
	return fmt.Sprintf("%.1f %s", v, units[i])
}
