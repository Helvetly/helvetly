package store_test

import (
	"context"
	"testing"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func TestExpenseYear(t *testing.T) {
	d, short := "2025-03-04", "20"
	for _, c := range []struct {
		date *string
		want int
	}{{&d, 2025}, {nil, 2026}, {&short, 2026}} {
		if got := store.ExpenseYear(c.date, "2026-11-18"); got != c.want {
			t.Errorf("%v: got %d, want %d", c.date, got, c.want)
		}
	}
}

func TestExpenseYearFolder(t *testing.T) {
	s, _ := storetest.New(t)
	ctx := context.Background()
	for _, id := range []string{"wsp_a", "wsp_b"} {
		if err := s.CreateWorkspace(ctx, store.Workspace{ID: id, Name: id}, "UTC", t0); err != nil {
			t.Fatal(err)
		}
		if err := s.CreateExpenseCategory(ctx, id, "exc_"+id, "Travel / Trips", "6640", t0); err != nil {
			t.Fatal(err)
		}
	}
	travel := "exc_wsp_a"
	var cat, again, uncategorised, other, before, after string
	err := s.Tx(ctx, func(q store.Q) (err error) {
		if before, err = q.ExistingExpenseYearFolder(ctx, "wsp_a", &travel, 2025); err != nil {
			return err
		}
		if cat, err = q.ExpenseYearFolder(ctx, "wsp_a", &travel, 2025, "", t0); err != nil {
			return err
		}
		if again, err = q.ExpenseYearFolder(ctx, "wsp_a", &travel, 2025, "", t0); err != nil {
			return err
		}
		if uncategorised, err = q.ExpenseYearFolder(ctx, "wsp_a", nil, 2025, "", t0); err != nil {
			return err
		}
		theirs := "exc_wsp_b"
		if other, err = q.ExpenseYearFolder(ctx, "wsp_b", &theirs, 2025, "", t0); err != nil {
			return err
		}
		if _, err = q.ExpenseYearFolder(ctx, "wsp_b", &travel, 2025, "", t0); err == nil { // another workspace's category
			t.Error("filed under another workspace's category")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Tx(ctx, func(q store.Q) (err error) {
		after, err = q.ExistingExpenseYearFolder(ctx, "wsp_a", &travel, 2025)
		return err
	})
	if before != "" || cat == "" || cat != again || cat == uncategorised || other == cat || after != cat {
		t.Fatalf("before %q cat %q again %q uncategorised %q other %q after %q", before, cat, again, uncategorised, other, after)
	}
	path := func(ws string, names ...string) string {
		var id string
		_ = s.Tx(ctx, func(q store.Q) (err error) {
			id, err = q.ExistingFolderPath(ctx, ws, names)
			return err
		})
		return id
	}
	if got := path("wsp_a", "Expenses", "Travel - Trips", "2025"); got != cat {
		t.Fatalf("Expenses/Travel - Trips/2025 = %q, want %q", got, cat)
	}
	if got := path("wsp_a", "Expenses", store.UncategorisedFolder, "2025"); got != uncategorised {
		t.Fatalf("Expenses/Uncategorised/2025 = %q, want %q", got, uncategorised)
	}
	// renaming the category renames its folder; the year folder stays where it is
	if err := s.Tx(ctx, func(q store.Q) error { return q.RenameCategoryFolder(ctx, "wsp_a", travel, "Reisen", t0) }); err != nil {
		t.Fatal(err)
	}
	if got := path("wsp_a", "Expenses", "Reisen", "2025"); got != cat {
		t.Fatalf("after rename: %q, want %q", got, cat)
	}
	if got := path("wsp_b", "Expenses", "Travel - Trips", "2025"); got != other {
		t.Fatalf("other workspace renamed too: %q", got)
	}
}

func TestFolderPath(t *testing.T) {
	s, _ := storetest.New(t)
	ctx := context.Background()
	for _, id := range []string{"wsp_a", "wsp_b"} {
		if err := s.CreateWorkspace(ctx, store.Workspace{ID: id, Name: id}, "UTC", t0); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.CreateUser(ctx, store.User{ID: "usr_1", Email: "a@x.ch", Name: "Ann"}, t0); err != nil {
		t.Fatal(err)
	}
	path := []string{"Archive", "2025", "Travel"}
	var first, again, other, partial string
	err := s.Tx(ctx, func(q store.Q) (err error) {
		if missing, err := q.ExistingFolderPath(ctx, "wsp_a", path); err != nil || missing != "" {
			t.Fatalf("existing before: %q %v", missing, err)
		}
		if first, err = q.FolderPath(ctx, "wsp_a", "usr_1", path, t0); err != nil {
			return err
		}
		if again, err = q.FolderPath(ctx, "wsp_a", "usr_1", []string{"archive", "2025", "TRAVEL"}, t0); err != nil {
			return err
		}
		if other, err = q.FolderPath(ctx, "wsp_b", "usr_1", path, t0); err != nil {
			return err
		}
		partial, err = q.ExistingFolderPath(ctx, "wsp_a", []string{"Archive", "2024"})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if first == "" || first != again || other == first || partial != "" {
		t.Fatalf("first %q again %q other %q partial %q", first, again, other, partial)
	}
	_ = s.Tx(ctx, func(q store.Q) error {
		if got, _ := q.ExistingFolderPath(ctx, "wsp_a", path); got != first {
			t.Errorf("existing %q, want %q", got, first)
		}
		return nil
	})
}
