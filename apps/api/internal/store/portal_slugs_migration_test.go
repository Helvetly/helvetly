package store

import (
	"context"
	"testing"
)

// TestPortalSlugsMigration: 00027 gives every workspace a slug from its name, oldest first; repeats, reserved words
// and names too short get a suffix or prefix, and a deleted workspace keeps its own.
func TestPortalSlugsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 26); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, created_at, deleted_at) VALUES
		('ws_1', 'Müller & Söhne AG', now() - interval '5 days', NULL),
		('ws_2', 'Müller  Söhne AG', now() - interval '4 days', NULL),
		('ws_3', 'API', now() - interval '3 days', NULL),
		('ws_4', 'Ö', now() - interval '2 days', NULL),
		('ws_5', 'Gone GmbH', now() - interval '1 day', now()),
		('ws_6', 'ÄPFEL Über ÉCOLE', now() - interval '12 hours', NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 27); err != nil {
		t.Fatal(err)
	}
	q := Q{db: pool}
	for ws, want := range map[string]string{"ws_1": "mueller-soehne-ag", "ws_2": "mueller-soehne-ag-2", "ws_3": "api-2",
		"ws_4": "portal-oe", "ws_5": "gone-gmbh", "ws_6": "aepfel-ueber-ecole"} {
		if got, err := q.CurrentPortalSlug(ctx, ws); err != nil || got != want {
			t.Errorf("%s: %q %v, want %q", ws, got, err, want)
		}
	}
	if _, err := q.PortalScopeBySlug(ctx, "gone-gmbh"); err != ErrNotFound {
		t.Errorf("a deleted workspace's slug resolves: %v", err)
	}
	if _, err := p.DownTo(ctx, 26); err != nil {
		t.Fatal(err)
	}
}
