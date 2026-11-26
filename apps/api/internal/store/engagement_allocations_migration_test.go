package store

import (
	"context"
	"testing"
	"time"
)

func TestLegacyEntryAllocations(t *testing.T) {
	ctx := context.Background()
	migrations, pool := migrationProvider(t)
	if _, err := migrations.UpTo(ctx, 68); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	q := Q{db: pool}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(q.CreateWorkspace(ctx, Workspace{ID: "ws", Name: "Example", Timezone: "UTC"}, "UTC", now))
	check(q.CreateClient(ctx, "ws", "client", map[string]any{"name": "Example"}, now))
	e := Engagement{ID: "eng", ClientID: "client", Title: "Hours", Quantity: 30000, Billing: "advance", PriceBasis: "net", UnitPrice: 10000, Currency: "CHF", VATCategory: "Z", StartDate: "2026-01-01", Recurrence: "monthly", Interval: 1}
	check(q.CreateEngagement(ctx, "ws", &e, now))
	_, err := q.InsertPeriod(ctx, EngagementPeriod{ID: "period", EngagementID: e.ID, Index: 1, StartsOn: "2026-01-01", EndsOn: "2026-01-31", Quantity: 30000, UnitPrice: 10000, OverageUnitPrice: 10000})
	check(err)
	for _, id := range []string{"original", "issued-summary", "issued-detail", "changed"} {
		inv := Invoice{ID: id, Kind: "invoice", Status: "draft", ClientID: "client", Currency: "CHF", Language: "en", VATMode: "none", IssueDate: "2026-01-01", DueDate: "2026-01-31"}
		description := "Hours"
		start, end := "2026-01-01", "2026-01-31"
		inv.ServiceDate, inv.ServiceDateEnd = &start, &end
		switch id {
		case "issued-summary":
			description = "Hours · 01.01.2026 – 31.01.2026"
		case "issued-detail":
			description = "Hours · 01.01.2026"
		}
		check(q.SaveDraft(ctx, "ws", inv, now))
		// Seed the columns available in the version 68 database.
		_, lineErr := pool.Exec(ctx, `INSERT INTO invoice_lines(id, invoice_id, position, description, quantity, unit_price, vat_category, vat_rate, amount, discount_percent)
            VALUES ('line_' || $1, $1, 1, $2, 5000, 10000, 'Z', 0, 50000, 0)`, id, description)
		check(lineErr)
		if id == "issued-summary" || id == "issued-detail" {
			_, err := pool.Exec(ctx, `UPDATE invoices SET status='open',number=id,issued_at=now() WHERE id=$1`, id)
			check(err)
		}
		check(q.CreateEntry(ctx, e.ID, EngagementEntry{ID: "entry_" + id, PeriodID: "period", Date: "2026-01-01", Quantity: 15000}, now))
		_, err := pool.Exec(ctx, `UPDATE engagement_entries SET invoice_id=$1 WHERE id='entry_' || $1`, id)
		check(err)
	}
	_, err = pool.Exec(ctx, `UPDATE invoices SET updated_at=updated_at + interval '1 second' WHERE id='changed'`)
	check(err)
	_, err = migrations.UpTo(ctx, 69)
	check(err)
	for _, id := range []string{"original", "issued-summary", "issued-detail", "changed"} {
		entry, err := q.Entry(ctx, e.ID, "entry_"+id, false)
		check(err)
		if entry.Invoice == nil || entry.Invoice.ID != id {
			t.Fatal(entry)
		}
		if id != "changed" && (entry.InvoicedQuantity != 5000 || entry.HistoricalEstimate) ||
			id == "changed" && (entry.InvoicedQuantity != 15000 || !entry.HistoricalEstimate) {
			t.Fatal(entry)
		}
	}
}
