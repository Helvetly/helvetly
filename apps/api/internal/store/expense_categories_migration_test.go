package store

import (
	"context"
	"testing"
	"time"
)

// TestExpenseCategoryCatalogueMigration: 00043 gives the categories an older workspace had their catalogue key when name
// and account match, adds the entries it lacks (active, never a second category of a name it has) and leaves a
// workspace without categories to SeedExpenseCategories. Its entries are store.CategoryPresets.
func TestExpenseCategoryCatalogueMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 42); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, created_at) VALUES
		('ws_old', 'Old AG', now()), ('ws_custom', 'Custom AG', now()), ('ws_empty', 'Empty AG', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO expense_categories (id, workspace_id, name, account_code, archived_at, created_at, updated_at) VALUES
		('c1', 'ws_old', 'Travel', '6640', NULL, now(), now()),
		('c2', 'ws_old', 'phone & internet', '6510', now(), now(), now()),
		('c3', 'ws_custom', 'Travel', '6600', NULL, now(), now()),
		('c4', 'ws_custom', 'Coworking', '6000', NULL, now(), now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 43); err != nil {
		t.Fatal(err)
	}
	q := Q{db: pool}

	old, err := q.ExpenseCategories(ctx, "ws_old", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(old) != len(CategoryPresets) {
		t.Fatalf("ws_old has %d categories, want the %d presets", len(old), len(CategoryPresets))
	}
	byPreset := map[string]ExpenseCategory{}
	for _, c := range old {
		if c.Preset == nil {
			t.Fatalf("ws_old %q has no preset", c.Name)
		}
		byPreset[*c.Preset] = c
	}
	for _, want := range CategoryPresets {
		got, ok := byPreset[want.Key]
		if !ok || got.AccountCode != want.Account || got.VATTreatment == nil || *got.VATTreatment != want.VAT {
			t.Errorf("preset %s: %+v", want.Key, got)
		}
		if ok && got.ID != "c1" && got.ID != "c2" && got.Name != want.Name {
			t.Errorf("preset %s added as %q, want %q", want.Key, got.Name, want.Name)
		}
	}
	if byPreset["travel"].ID != "c1" || byPreset["telecom"].ID != "c2" || !byPreset["telecom"].IsArchived {
		t.Errorf("matched categories keep their row and archive: %+v %+v", byPreset["travel"], byPreset["telecom"])
	}
	if byPreset["lodging"].IsArchived {
		t.Error("an added preset is archived")
	}

	custom, err := q.ExpenseCategories(ctx, "ws_custom", true)
	if err != nil {
		t.Fatal(err)
	}
	travels := 0
	for _, c := range custom {
		if c.Name == "Travel" {
			travels++
			if c.Preset != nil || c.AccountCode != "6600" {
				t.Errorf("a category on another account took the preset: %+v", c)
			}
		}
	}
	if travels != 1 || len(custom) != len(CategoryPresets)+1 {
		t.Errorf("ws_custom: %d categories, %d named Travel", len(custom), travels)
	}

	if empty, err := q.ExpenseCategories(ctx, "ws_empty", true); err != nil || len(empty) != 0 {
		t.Errorf("ws_empty got categories from the migration: %d %v", len(empty), err)
	}
	n := 0
	if err := q.SeedExpenseCategories(ctx, "ws_empty", func() string { n++; return "seed_" + string(rune('a'+n/26)) + string(rune('a'+n%26)) }, time.Now()); err != nil {
		t.Fatal(err)
	}
	if empty, err := q.ExpenseCategories(ctx, "ws_empty", true); err != nil || len(empty) != len(CategoryPresets) {
		t.Errorf("seeded ws_empty: %d %v", len(empty), err)
	}

	if _, err := p.DownTo(ctx, 42); err != nil {
		t.Fatal(err)
	}
}
