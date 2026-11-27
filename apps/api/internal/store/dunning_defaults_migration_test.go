package store

import (
	"context"
	"testing"
)

func TestDunningDefaultsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 89); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO workspaces (id, name, created_at) SELECT id, id, now()
		FROM unnest(ARRAY['wsp_a', 'defaults', 'old_text', 'renamed', 'different_days', 'fee', 'no_qr', 'chosen_text', 'levels']) AS id`)
	exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		VALUES ('cli_1', 'wsp_a', 1, 'One', now(), now())`)
	seedInvoice(t, pool, "inv_pending", "invoice", "open", 1000, "2026-10-31", 0)
	exec(`INSERT INTO dunning_notices (workspace_id, invoice_id, level, levels, sent_at, sent_on, open_amount,
		fee, interest, interest_rate, total, email, title)
		VALUES ('wsp_a', 'inv_pending', 1, 3, '2026-11-10T09:00:00Z', '2026-11-10', 1000,
		0, 0, 0, 1000, 'buyer@example.com', 'Payment reminder')`)

	exec(`INSERT INTO invoice_settings (workspace_id, settings, updated_at)
		SELECT id, '{"currency":"EUR","dunning":{"enabled":true,"interest_enabled":true,"steps":[
			{"name":null,"timing":"after_due","days":10,"fee":"0.00","qr_bill":true},
			{"name":null,"timing":"after_previous","days":14,"fee":"0.00","qr_bill":true},
			{"name":null,"timing":"after_previous","days":14,"fee":"0.00","qr_bill":true}
		]}}', now() FROM workspaces`)
	exec(`UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning,steps}', (
		SELECT jsonb_agg(step || '{"text":null}'::jsonb ORDER BY pos)
		FROM jsonb_array_elements(settings #> '{dunning,steps}') WITH ORDINALITY AS steps(step, pos)
	)) WHERE workspace_id = 'old_text'`)
	exec(`UPDATE invoice_settings SET settings = jsonb_set(settings, $2::text[], $3::jsonb) WHERE workspace_id = $1`,
		"renamed", "{dunning,steps,1,name}", `"Reminder 2"`)
	exec(`UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning,steps,1,days}', '15') WHERE workspace_id = 'different_days'`)
	exec(`UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning,steps,1,fee}', '"5.00"') WHERE workspace_id = 'fee'`)
	exec(`UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning,steps,1,qr_bill}', 'false') WHERE workspace_id = 'no_qr'`)
	exec(`UPDATE invoice_settings SET settings = jsonb_set(settings, '{dunning,steps,1,text}', '"Please pay"') WHERE workspace_id = 'chosen_text'`)
	exec(`UPDATE invoice_settings SET settings = '{"dunning":{"levels":[{"days":14,"fee":"0.00"}]}}' WHERE workspace_id = 'levels'`)
	exec(`CREATE TABLE original_settings AS SELECT * FROM invoice_settings`)
	exec(`CREATE TABLE original_notices AS SELECT * FROM dunning_notices`)

	if _, err := p.UpTo(ctx, 90); err != nil {
		t.Fatal(err)
	}
	var changed string
	err := pool.QueryRow(ctx, `SELECT COALESCE(string_agg(s.workspace_id, ',' ORDER BY s.workspace_id), '')
		FROM invoice_settings s JOIN original_settings o USING (workspace_id)
		WHERE s.settings <> CASE WHEN s.workspace_id IN ('defaults', 'old_text')
			THEN jsonb_set(jsonb_set(o.settings, '{dunning,steps,1,days}', '10'), '{dunning,steps,2,days}', '10')
			ELSE o.settings END OR s.updated_at <> o.updated_at`).Scan(&changed)
	if err != nil || changed != "" {
		t.Fatalf("unexpected settings after migration for %q: %v", changed, err)
	}
	var unchanged bool
	err = pool.QueryRow(ctx, `SELECT (SELECT jsonb_agg(to_jsonb(n)) FROM dunning_notices n) =
		(SELECT jsonb_agg(to_jsonb(n)) FROM original_notices n)`).Scan(&unchanged)
	if err != nil || !unchanged {
		t.Fatalf("recorded notice changed: %v", err)
	}
}
