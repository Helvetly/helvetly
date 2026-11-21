package store

import (
	"context"
	"testing"
	"time"
)

// TestExpenseCategoryCatalogueMigration: 00046 gives the categories an older workspace had their catalogue key when name
// and account match, adds the entries it lacks (active, never a second category of a name it has) and leaves a
// workspace without categories to SeedExpenseCategories. Its entries are the first presetsOf46 of store.CategoryPresets.
func TestExpenseCategoryCatalogueMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 45); err != nil {
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
	if _, err := p.UpTo(ctx, 46); err != nil {
		t.Fatal(err)
	}
	q := Q{db: pool}
	catalogue := CategoryPresets[:presetsOf46]

	old, err := q.ExpenseCategories(ctx, "ws_old", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(old) != len(catalogue) {
		t.Fatalf("ws_old has %d categories, want the %d presets", len(old), len(catalogue))
	}
	byPreset := map[string]ExpenseCategory{}
	for _, c := range old {
		if c.Preset == nil {
			t.Fatalf("ws_old %q has no preset", c.Name)
		}
		byPreset[*c.Preset] = c
	}
	for _, want := range catalogue {
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
	if travels != 1 || len(custom) != len(catalogue)+1 {
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

// presetsOf46: how many entries of CategoryPresets migration 00046 added; 00047 adds the rest.
const presetsOf46 = 40

// TestExpenseCategoryCatalogueMoreMigration: 00047 adds the entries after the first presetsOf46 to every workspace
// that has categories, active and as in store.CategoryPresets, skips one whose name the workspace already uses (its
// own category keeps its name, account and lack of a key), leaves empty workspaces to SeedExpenseCategories, and
// running it again adds nothing.
func TestExpenseCategoryCatalogueMoreMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 46); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, created_at) VALUES
		('ws_a', 'A AG', now()), ('ws_b', 'B AG', now()), ('ws_empty', 'Empty AG', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO expense_categories (id, workspace_id, name, account_code, preset, vat_treatment, archived_at, created_at, updated_at) VALUES
		('a1', 'ws_a', 'Travel', '6640', 'travel', 'standard', NULL, now(), now()),
		('a2', 'ws_a', 'depreciation', '6820', NULL, NULL, NULL, now(), now()),
		('a3', 'ws_a', 'Office supplies', '6500', NULL, NULL, now(), now(), now()),
		('b1', 'ws_b', 'Coworking', '6000', NULL, NULL, NULL, now(), now())`); err != nil {
		t.Fatal(err)
	}
	added := CategoryPresets[presetsOf46:]
	q := Q{db: pool}
	for round := range 2 { // the second round runs 00047 again: nothing more is added
		if _, err := p.UpTo(ctx, 47); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			workspace string
			want      int
			own       map[string]string // a category of the workspace's own: id → the name it keeps
		}{
			{"ws_a", 3 + len(added) - 2, map[string]string{"a2": "depreciation", "a3": "Office supplies"}},
			{"ws_b", 1 + len(added), map[string]string{"b1": "Coworking"}},
			{"ws_empty", 0, nil},
		} {
			list, err := q.ExpenseCategories(ctx, tc.workspace, true)
			if err != nil {
				t.Fatal(err)
			}
			if len(list) != tc.want {
				t.Errorf("round %d %s: %d categories, want %d", round, tc.workspace, len(list), tc.want)
			}
			byPreset := map[string]ExpenseCategory{}
			for _, c := range list {
				if name, ok := tc.own[c.ID]; ok {
					if c.Name != name || c.Preset != nil {
						t.Errorf("%s: own category %s became %+v", tc.workspace, c.ID, c)
					}
					continue
				}
				if c.Preset != nil {
					byPreset[*c.Preset] = c
				}
			}
			if tc.want == 0 {
				continue
			}
			for _, want := range added {
				got, ok := byPreset[want.Key]
				if tc.workspace == "ws_a" && (want.Key == "depreciation" || want.Key == "office_supplies") {
					if ok {
						t.Errorf("ws_a got %s beside its own category of that name", want.Key)
					}
					continue
				}
				if !ok || got.Name != want.Name || got.AccountCode != want.Account || got.IsArchived ||
					got.VATTreatment == nil || *got.VATTreatment != want.VAT {
					t.Errorf("%s preset %s: %+v", tc.workspace, want.Key, got)
				}
			}
		}
		if _, err := p.DownTo(ctx, 46); err != nil {
			t.Fatal(err)
		}
	}
}
