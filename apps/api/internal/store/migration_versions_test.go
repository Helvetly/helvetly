package store

import (
	"io/fs"
	"strings"
	"testing"
)

// Two pull requests can pick the same next number; goose then refuses to start, so CI must catch it before main does.
func TestMigrationVersionsAreUnique(t *testing.T) {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, e := range entries {
		version, _, ok := strings.Cut(e.Name(), "_")
		if !ok {
			t.Errorf("%s: no version prefix", e.Name())
			continue
		}
		if other, dup := seen[version]; dup {
			t.Errorf("migration version %s used by %s and %s", version, other, e.Name())
		}
		seen[version] = e.Name()
	}
}
