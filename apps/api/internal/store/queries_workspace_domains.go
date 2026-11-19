package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Workspace domain statuses (00032_workspace_domains.sql).
const (
	DomainPending = "pending"
	DomainActive  = "active"
	DomainFailed  = "failed"
	DomainRemoved = "removed"
)

// WorkspaceDomain is a workspace's own portal host and what its last check found.
type WorkspaceDomain struct {
	ID, WorkspaceID, Hostname string
	Status                    string
	// Problem is why it is not active (a code), Detail what the check saw.
	Problem, Detail string
	// VerifiedAt: the TXT record proved the workspace owns the domain; nil until then.
	VerifiedAt    *time.Time
	Checks        int
	NextCheckAt   time.Time
	LastCheckedAt *time.Time
	// StatusSince dates the current status.
	StatusSince          time.Time
	CreatedBy            string
	CreatedAt, UpdatedAt time.Time
	// WorkspaceDeletedAt is set when the workspace is deleted (it may be restored for 30 days).
	WorkspaceDeletedAt *time.Time
}

// ErrDomainTaken: another workspace has the hostname. ErrDomainExists: the workspace already has a domain.
var (
	ErrDomainTaken  = errors.New("domain taken")
	ErrDomainExists = errors.New("workspace has a domain")
)

const domainColumns = `d.id, d.workspace_id, d.hostname, d.status, d.problem, d.detail, d.verified_at, d.checks, d.next_check_at,
	d.last_checked_at, d.status_since, d.created_by, d.created_at, d.updated_at, w.deleted_at`

const domainFrom = ` FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id `

func scanDomain(row interface{ Scan(...any) error }) (WorkspaceDomain, error) {
	var d WorkspaceDomain
	err := row.Scan(&d.ID, &d.WorkspaceID, &d.Hostname, &d.Status, &d.Problem, &d.Detail, &d.VerifiedAt, &d.Checks, &d.NextCheckAt,
		&d.LastCheckedAt, &d.StatusSince, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt, &d.WorkspaceDeletedAt)
	return d, err
}

// CreateWorkspaceDomain adds a pending domain; ErrDomainTaken or ErrDomainExists when the unique indexes refuse it.
func (q Q) CreateWorkspaceDomain(ctx context.Context, d WorkspaceDomain) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, status_since, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)`, d.ID, d.WorkspaceID, d.Hostname, DomainPending, d.NextCheckAt, d.CreatedAt, d.CreatedBy)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		if pg.ConstraintName == "workspace_domains_workspace" {
			return ErrDomainExists
		}
		return ErrDomainTaken
	}
	return err
}

// WorkspaceDomainOf is the workspace's domain that is not removed; ErrNotFound for none.
func (q Q) WorkspaceDomainOf(ctx context.Context, workspaceID string) (WorkspaceDomain, error) {
	return scanDomain(q.db.QueryRow(ctx, `SELECT `+domainColumns+domainFrom+`WHERE d.workspace_id = $1 AND d.status <> 'removed'`, workspaceID))
}

// WorkspaceDomainByHostname is the domain, not removed, of whichever workspace has host; ErrNotFound for none.
func (q Q) WorkspaceDomainByHostname(ctx context.Context, host string) (WorkspaceDomain, error) {
	return scanDomain(q.db.QueryRow(ctx, `SELECT `+domainColumns+domainFrom+`WHERE d.hostname = $1 AND d.status <> 'removed'`, host))
}

// SaveWorkspaceDomainCheck stores what a check found and when to look again.
func (q Q) SaveWorkspaceDomainCheck(ctx context.Context, d WorkspaceDomain, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_domains SET status = $2, problem = $3, detail = $4, verified_at = $5, checks = $6,
		next_check_at = $7, status_since = $8, last_checked_at = $9, updated_at = $9 WHERE id = $1 AND status <> 'removed'`,
		d.ID, d.Status, d.Problem, d.Detail, d.VerifiedAt, d.Checks, d.NextCheckAt, d.StatusSince, now)
	return err
}

// RemoveWorkspaceDomain marks the domain removed (its hostname is free again).
func (q Q) RemoveWorkspaceDomain(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_domains SET status = 'removed', removed_at = $2, status_since = $2, updated_at = $2 WHERE id = $1`, id, now)
	return err
}

// DueWorkspaceDomains are the domains whose next check is due, oldest first.
func (q Q) DueWorkspaceDomains(ctx context.Context, now time.Time, limit int) ([]WorkspaceDomain, error) {
	rows, err := q.db.Query(ctx, `SELECT `+domainColumns+domainFrom+`WHERE d.status <> 'removed' AND d.next_check_at <= $1
		ORDER BY d.next_check_at LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkspaceDomain
	for rows.Next() {
		d, err := scanDomain(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// PortalScopeByDomain is the live workspace whose active domain host is; ErrNotFound for any other host.
func (q Q) PortalScopeByDomain(ctx context.Context, host string) (PortalScope, error) {
	var s PortalScope
	err := q.db.QueryRow(ctx, `SELECT w.id, w.name, coalesce(p.slug, ''), w.logo_file_id FROM workspace_domains d
		JOIN workspaces w ON w.id = d.workspace_id
		LEFT JOIN portal_slugs p ON p.workspace_id = w.id AND p.retired_at IS NULL
		WHERE d.hostname = $1 AND d.status = 'active' AND w.deleted_at IS NULL`, host).Scan(&s.WorkspaceID, &s.Name, &s.Slug, &s.LogoFileID)
	s.Domain = host
	return s, err
}

// ActivePortalDomain is the workspace's active domain; ErrNotFound when it has none.
func (q Q) ActivePortalDomain(ctx context.Context, workspaceID string) (string, error) {
	var host string
	err := q.db.QueryRow(ctx, `SELECT hostname FROM workspace_domains WHERE workspace_id = $1 AND status = 'active'`, workspaceID).Scan(&host)
	return host, err
}

// PortalDomainCertifiable: host is a live workspace's domain whose ownership is proven and whose plan has not lost
// it, so the origin may get it a certificate.
func (q Q) PortalDomainCertifiable(ctx context.Context, host string) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id
		WHERE d.hostname = $1 AND d.status <> 'removed' AND d.verified_at IS NOT NULL AND d.problem <> 'plan' AND w.deleted_at IS NULL)`, host).Scan(&ok)
	return ok, err
}
