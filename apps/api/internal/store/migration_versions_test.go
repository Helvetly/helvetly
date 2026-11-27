package store

import (
	"io/fs"
	"testing"

	"github.com/pressly/goose/v3"
)

// Two pull requests can pick the same next number; goose then refuses to start, so CI must catch it before main does.
func TestMigrationVersionsAreUnique(t *testing.T) {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int64]string{}
	for _, e := range entries {
		version, err := goose.NumericComponent(e.Name())
		if err != nil {
			t.Errorf("%s: %v", e.Name(), err)
			continue
		}
		if other, dup := seen[version]; dup {
			t.Errorf("migration version %05d used by %s and %s", version, other, e.Name())
		}
		seen[version] = e.Name()
	}
}
