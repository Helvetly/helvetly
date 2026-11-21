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
	VerifiedAt *time.Time
	// CloudflareID is the custom hostname on the zone; nil until Cloudflare took it. CloudflareStatus and SSLStatus
	// are Cloudflare's words for the hostname and its certificate at the last check.
	CloudflareID                *string
	CloudflareStatus, SSLStatus string
	// OwnershipName and OwnershipValue are the TXT record Cloudflare names for the hostname; empty until it does.
	OwnershipName, OwnershipValue string
	Checks                        int
	NextCheckAt                   time.Time
	LastCheckedAt                 *time.Time
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

const domainColumns = `d.id, d.workspace_id, d.hostname, d.status, d.problem, d.detail, d.verified_at, d.cf_hostname_id, d.cf_status,
	d.ssl_status, d.ownership_name, d.ownership_value, d.checks, d.next_check_at, d.last_checked_at, d.status_since, d.created_by,
	d.created_at, d.updated_at, w.deleted_at`

const domainFrom = ` FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id `

func scanDomain(row interface{ Scan(...any) error }) (WorkspaceDomain, error) {
	var d WorkspaceDomain
	err := row.Scan(&d.ID, &d.WorkspaceID, &d.Hostname, &d.Status, &d.Problem, &d.Detail, &d.VerifiedAt, &d.CloudflareID, &d.CloudflareStatus,
		&d.SSLStatus, &d.OwnershipName, &d.OwnershipValue, &d.Checks, &d.NextCheckAt, &d.LastCheckedAt, &d.StatusSince, &d.CreatedBy,
		&d.CreatedAt, &d.UpdatedAt, &d.WorkspaceDeletedAt)
	return d, err
}

// CreateWorkspaceDomain adds a pending domain (with the Cloudflare hostname and proof of one it takes over);
// ErrDomainTaken or ErrDomainExists when the unique indexes refuse it.
func (q Q) CreateWorkspaceDomain(ctx context.Context, d WorkspaceDomain) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_domains (id, workspace_id, hostname, status, verified_at, cf_hostname_id, cf_status,
		ssl_status, ownership_name, ownership_value, next_check_at, status_since, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, $12)`, d.ID, d.WorkspaceID, d.Hostname, DomainPending,
		d.VerifiedAt, d.CloudflareID, d.CloudflareStatus, d.SSLStatus, d.OwnershipName, d.OwnershipValue, d.NextCheckAt, d.CreatedAt, d.CreatedBy)
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
func (q Q) WorkspaceDomainByHostname(ctx context.Context, host string, forUpdate bool) (WorkspaceDomain, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF d"
	}
	return scanDomain(q.db.QueryRow(ctx, `SELECT `+domainColumns+domainFrom+`WHERE d.hostname = $1 AND d.status <> 'removed'`+lock, host))
}

// SaveWorkspaceDomainCheck stores what a check found and when to look again, only while the domain's status is still
// was: false when another check (another instance, "Re-check") changed it or it was removed meanwhile.
func (q Q) SaveWorkspaceDomainCheck(ctx context.Context, d WorkspaceDomain, was string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE workspace_domains SET status = $2, problem = $3, detail = $4, verified_at = $5, cf_hostname_id = $6,
		cf_status = $7, ssl_status = $8, ownership_name = $9, ownership_value = $10, checks = $11, next_check_at = $12, status_since = $13,
		last_checked_at = $14, updated_at = $14 WHERE id = $1 AND status = $15 AND status <> 'removed'`,
		d.ID, d.Status, d.Problem, d.Detail, d.VerifiedAt, d.CloudflareID, d.CloudflareStatus, d.SSLStatus, d.OwnershipName, d.OwnershipValue,
		d.Checks, d.NextCheckAt, d.StatusSince, now, was)
	return tag.RowsAffected() == 1, err
}

// RemoveWorkspaceDomain marks the domain removed (its hostname is free again).
func (q Q) RemoveWorkspaceDomain(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_domains SET status = 'removed', removed_at = $2, status_since = $2, updated_at = $2 WHERE id = $1`, id, now)
	return err
}

// ClaimDueWorkspaceDomains takes up to limit domains whose check is due, oldest first, and moves their next check to
// lease, so another instance skips them meanwhile (rows another is claiming are skipped, not waited for).
func (q Q) ClaimDueWorkspaceDomains(ctx context.Context, now, lease time.Time, limit int) ([]WorkspaceDomain, error) {
	rows, err := q.db.Query(ctx, `UPDATE workspace_domains d SET next_check_at = $2 FROM workspaces w
		WHERE w.id = d.workspace_id AND d.id IN (SELECT id FROM workspace_domains WHERE status <> 'removed' AND next_check_at <= $1
			ORDER BY next_check_at LIMIT $3 FOR UPDATE SKIP LOCKED)
		RETURNING `+domainColumns, now, lease, limit)
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

// ActivePortalDomain is the live workspace's active domain; ErrNotFound when it has none.
func (q Q) ActivePortalDomain(ctx context.Context, workspaceID string) (string, error) {
	var host string
	err := q.db.QueryRow(ctx, `SELECT d.hostname FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id
		WHERE d.workspace_id = $1 AND d.status = 'active' AND w.deleted_at IS NULL`, workspaceID).Scan(&host)
	return host, err
}

// DomainHostnamesKnown answers, for the custom hostnames of one page of the zone: which names any of the workspaces'
// domains ever had (removed ones too), and for the names a domain that is not removed has, its Cloudflare id ("" while
// it has none yet).
func (q Q) DomainHostnamesKnown(ctx context.Context, names []string) (known map[string]bool, live map[string]string, err error) {
	rows, err := q.db.Query(ctx, `SELECT hostname, coalesce(cf_hostname_id, ''), status <> 'removed' FROM workspace_domains WHERE hostname = ANY($1)`, names)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	known, live = map[string]bool{}, map[string]string{}
	for rows.Next() {
		var host, id string
		var isLive bool
		if err := rows.Scan(&host, &id, &isLive); err != nil {
			return nil, nil, err
		}
		known[host] = true
		if isLive {
			live[host] = id
		}
	}
	return known, live, rows.Err()
}

// CloudflareHostnameHeldBefore reports whether a domain other than domainID (a removed one: a hostname has one domain
// that is not removed) ever held the Cloudflare custom hostname id.
func (q Q) CloudflareHostnameHeldBefore(ctx context.Context, id, domainID string) (bool, error) {
	var held bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_domains WHERE cf_hostname_id = $1 AND id <> $2)`, id, domainID).Scan(&held)
	return held, err
}
