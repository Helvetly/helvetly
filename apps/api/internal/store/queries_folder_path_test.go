package store_test

import (
	"context"
	"slices"
	"testing"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func TestExpenseFolder(t *testing.T) {
	d := "2025-03-04"
	for _, c := range []struct {
		date     *string
		category string
		want     []string
	}{
		{&d, "Travel", []string{"Expenses", "2025", "Travel"}},
		{&d, "", []string{"Expenses", "2025"}},
		{nil, "Rent", []string{"Expenses", "2026", "Rent"}},
	} {
		if got := store.ExpenseFolder(c.date, "2026-11-18", c.category); !slices.Equal(got, c.want) {
			t.Errorf("got %v, want %v", got, c.want)
		}
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
	path := []string{"Expenses", "2025", "Travel"}
	var first, again, other, partial string
	err := s.Tx(ctx, func(q store.Q) (err error) {
		if missing, err := q.ExistingFolderPath(ctx, "wsp_a", path); err != nil || missing != "" {
			t.Fatalf("existing before: %q %v", missing, err)
		}
		if first, err = q.FolderPath(ctx, "wsp_a", "usr_1", path, t0); err != nil {
			return err
		}
		if again, err = q.FolderPath(ctx, "wsp_a", "usr_1", []string{"expenses", "2025", "TRAVEL"}, t0); err != nil {
			return err
		}
		if other, err = q.FolderPath(ctx, "wsp_b", "usr_1", path, t0); err != nil {
			return err
		}
		partial, err = q.ExistingFolderPath(ctx, "wsp_a", []string{"Expenses", "2024"})
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
