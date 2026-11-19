package store

import (
	"context"
	"errors"
	"time"
)

// PortalScope is the live workspace a portal slug leads to, with its current slug (another one when the slug asked
// for is a retired one).
type PortalScope struct {
	WorkspaceID, Name, Slug string
	LogoFileID              *string
	// Domain is the workspace's own host the request came in on (portal.firma.ch), "" under PORTAL_URL/w/<slug>/.
	Domain string
}

// PortalScopeBySlug resolves any slug the workspace has had; ErrNotFound for an unknown one or a deleted workspace.
func (q Q) PortalScopeBySlug(ctx context.Context, slug string) (PortalScope, error) {
	var s PortalScope
	err := q.db.QueryRow(ctx, `SELECT w.id, w.name, cur.slug, w.logo_file_id FROM portal_slugs p
		JOIN workspaces w ON w.id = p.workspace_id
		JOIN portal_slugs cur ON cur.workspace_id = w.id AND cur.retired_at IS NULL
		WHERE p.slug = $1 AND w.deleted_at IS NULL`, slug).Scan(&s.WorkspaceID, &s.Name, &s.Slug, &s.LogoFileID)
	return s, err
}

// CurrentPortalSlug is the workspace's slug; ErrNotFound when it has none yet.
func (q Q) CurrentPortalSlug(ctx context.Context, workspaceID string) (string, error) {
	var slug string
	err := q.db.QueryRow(ctx, `SELECT slug FROM portal_slugs WHERE workspace_id = $1 AND retired_at IS NULL`, workspaceID).Scan(&slug)
	return slug, err
}

// AddFirstPortalSlug gives a workspace without a slug this one; false when the slug was ever anyone's or the
// workspace got one meanwhile.
func (q Q) AddFirstPortalSlug(ctx context.Context, workspaceID, slug string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO portal_slugs (slug, workspace_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		slug, workspaceID, now)
	return tag.RowsAffected() == 1, err
}

// PortalSlugOwner is the workspace that has or had slug; "" for none.
func (q Q) PortalSlugOwner(ctx context.Context, slug string) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT workspace_id FROM portal_slugs WHERE slug = $1`, slug).Scan(&id)
	if err == ErrNotFound {
		return "", nil
	}
	return id, err
}

// ErrPortalSlugTaken: another workspace has or had the slug.
var ErrPortalSlugTaken = errors.New("portal slug taken")

// SetPortalSlug makes slug the workspace's current one and retires the previous one; a slug the workspace had before
// comes back. Run it in a transaction: ErrPortalSlugTaken leaves the previous one retired.
func (q Q) SetPortalSlug(ctx context.Context, workspaceID, slug string, now time.Time) error {
	if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('portal-slug:' || $1, 0))`, workspaceID); err != nil {
		return err
	}
	if _, err := q.db.Exec(ctx, `UPDATE portal_slugs SET retired_at = $2 WHERE workspace_id = $1 AND retired_at IS NULL AND slug <> $3`,
		workspaceID, now, slug); err != nil {
		return err
	}
	tag, err := q.db.Exec(ctx, `INSERT INTO portal_slugs (slug, workspace_id, created_at) VALUES ($1, $2, $3)
		ON CONFLICT (slug) DO UPDATE SET retired_at = NULL WHERE portal_slugs.workspace_id = excluded.workspace_id`,
		slug, workspaceID, now)
	if err == nil && tag.RowsAffected() != 1 {
		err = ErrPortalSlugTaken
	}
	return err
}

// HasPortalClients: the workspace has a live client with the portal on.
func (q Q) HasPortalClients(ctx context.Context, workspaceID string) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM clients WHERE workspace_id = $1 AND portal_enabled AND deleted_at IS NULL)`,
		workspaceID).Scan(&ok)
	return ok, err
}

// PortalOff: the workspace turned its whole client portal off.
func (q Q) PortalOff(ctx context.Context, workspaceID string) (bool, error) {
	var off bool
	err := q.db.QueryRow(ctx, `SELECT portal_off FROM workspaces WHERE id = $1`, workspaceID).Scan(&off)
	return off, err
}

// SetPortalOff turns the workspace's client portal off or on; turning it off ends every portal session at once.
func (q Q) SetPortalOff(ctx context.Context, workspaceID string, off bool) error {
	if _, err := q.db.Exec(ctx, `UPDATE workspaces SET portal_off = $2 WHERE id = $1`, workspaceID, off); err != nil {
		return err
	}
	if !off {
		return nil
	}
	_, err := q.db.Exec(ctx, `DELETE FROM portal_sessions WHERE workspace_id = $1`, workspaceID)
	return err
}
