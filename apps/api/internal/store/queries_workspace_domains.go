package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Workspace domain statuses (00031_workspace_domains.sql).
const (
	DomainPending = "pending"
	DomainActive  = "active"
	DomainFailed  = "failed"
	DomainRemoved = "removed"
)

// DomainRecord is one DNS record the workspace adds at its DNS provider.
type DomainRecord struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// WorkspaceDomain is a workspace's own portal host and what Cloudflare last said of it.
type WorkspaceDomain struct {
	ID, WorkspaceID, Hostname string
	CloudflareID              *string
	Status                    string
	CloudflareStatus          string
	SSLStatus                 string
	Problem                   string
	Detail                    string
	Records                   []DomainRecord
	Checks                    int
	NextCheckAt               time.Time
	LastCheckedAt             *time.Time
	CreatedBy                 string
	CreatedAt, UpdatedAt      time.Time
	// WorkspaceDeleted is set by DueWorkspaceDomains: the workspace is gone, so the domain goes too.
	WorkspaceDeleted bool
}

// ErrDomainTaken: another workspace has the hostname. ErrDomainExists: the workspace already has a domain.
var (
	ErrDomainTaken  = errors.New("domain taken")
	ErrDomainExists = errors.New("workspace has a domain")
)

const domainColumns = `d.id, d.workspace_id, d.hostname, d.cf_hostname_id, d.status, d.cf_status, d.ssl_status, d.problem, d.detail, d.records,
	d.checks, d.next_check_at, d.last_checked_at, d.created_by, d.created_at, d.updated_at`

func scanDomain(row interface{ Scan(...any) error }, extra ...any) (WorkspaceDomain, error) {
	var d WorkspaceDomain
	var records []byte
	err := row.Scan(append([]any{&d.ID, &d.WorkspaceID, &d.Hostname, &d.CloudflareID, &d.Status, &d.CloudflareStatus, &d.SSLStatus,
		&d.Problem, &d.Detail, &records, &d.Checks, &d.NextCheckAt, &d.LastCheckedAt, &d.CreatedBy, &d.CreatedAt, &d.UpdatedAt}, extra...)...)
	if err == nil {
		err = json.Unmarshal(records, &d.Records)
	}
	return d, err
}

// CreateWorkspaceDomain adds a pending domain; ErrDomainTaken or ErrDomainExists when the unique indexes refuse it.
func (q Q) CreateWorkspaceDomain(ctx context.Context, d WorkspaceDomain) error {
	records, _ := json.Marshal(d.Records) // a slice of strings: cannot fail
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_domains (id, workspace_id, hostname, status, records, next_check_at, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, d.ID, d.WorkspaceID, d.Hostname, DomainPending, records, d.NextCheckAt, d.CreatedBy, d.CreatedAt)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		if pg.ConstraintName == "workspace_domains_workspace" {
			return ErrDomainExists
		}
		return ErrDomainTaken
	}
	return err
}

// DeleteWorkspaceDomain forgets a domain Cloudflare never accepted.
func (q Q) DeleteWorkspaceDomain(ctx context.Context, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM workspace_domains WHERE id = $1`, id)
	return err
}

// WorkspaceDomainOf is the workspace's domain that is not removed; ErrNotFound for none.
func (q Q) WorkspaceDomainOf(ctx context.Context, workspaceID string) (WorkspaceDomain, error) {
	return scanDomain(q.db.QueryRow(ctx, `SELECT `+domainColumns+` FROM workspace_domains d WHERE d.workspace_id = $1 AND d.status <> 'removed'`, workspaceID))
}

// SaveWorkspaceDomainCheck stores what a check found: Cloudflare's id and words, the status, the problem, the records
// and when to look again.
func (q Q) SaveWorkspaceDomainCheck(ctx context.Context, d WorkspaceDomain, now time.Time) error {
	records, _ := json.Marshal(d.Records)
	_, err := q.db.Exec(ctx, `UPDATE workspace_domains SET cf_hostname_id = $2, status = $3, cf_status = $4, ssl_status = $5, problem = $6,
		detail = $7, records = $8, checks = $9, next_check_at = $10, last_checked_at = $11, updated_at = $11 WHERE id = $1 AND status <> 'removed'`,
		d.ID, d.CloudflareID, d.Status, d.CloudflareStatus, d.SSLStatus, d.Problem, d.Detail, records, d.Checks, d.NextCheckAt, now)
	return err
}

// RemoveWorkspaceDomain marks the domain removed (its hostname is free again).
func (q Q) RemoveWorkspaceDomain(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_domains SET status = 'removed', removed_at = $2, updated_at = $2 WHERE id = $1`, id, now)
	return err
}

// DueWorkspaceDomains are the domains whose next check is due, oldest first.
func (q Q) DueWorkspaceDomains(ctx context.Context, now time.Time, limit int) ([]WorkspaceDomain, error) {
	return q.workspaceDomains(ctx, `d.status <> 'removed' AND d.next_check_at <= $1 ORDER BY d.next_check_at LIMIT $2`, now, limit)
}

// ActiveWorkspaceDomains are all active domains, for the daily sweep.
func (q Q) ActiveWorkspaceDomains(ctx context.Context) ([]WorkspaceDomain, error) {
	return q.workspaceDomains(ctx, `d.status = 'active' ORDER BY d.id`)
}

func (q Q) workspaceDomains(ctx context.Context, where string, args ...any) ([]WorkspaceDomain, error) {
	rows, err := q.db.Query(ctx, `SELECT `+domainColumns+`, w.deleted_at IS NOT NULL FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id
		WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkspaceDomain
	for rows.Next() {
		var deleted bool
		d, err := scanDomain(rows, &deleted)
		if err != nil {
			return nil, err
		}
		d.WorkspaceDeleted = deleted
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

// PortalDomainKnown: host is a pending or active domain of a live workspace (the origin's certificate question).
func (q Q) PortalDomainKnown(ctx context.Context, host string) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_domains d JOIN workspaces w ON w.id = d.workspace_id
		WHERE d.hostname = $1 AND d.status IN ('pending', 'active') AND w.deleted_at IS NULL)`, host).Scan(&ok)
	return ok, err
}
