package store

import (
	"context"
	"strings"
	"time"
)

// EnableAdminAlerts must be called at startup before running queries.
func (s *Store) EnableAdminAlerts() { s.adminAlerts = true }

func (q Q) QueueAdminAlert(ctx context.Context, message string) error {
	if !q.adminAlerts {
		return nil
	}
	_, err := q.db.Exec(ctx, `INSERT INTO admin_alerts (message) VALUES ($1)`, message)
	return err
}

// AlertWorkspace names a workspace for the operator's alerts: its name, the business on its invoices and its first
// owner, one line each and only those known.
func (q Q) AlertWorkspace(ctx context.Context, workspaceID string) (string, error) {
	var name, company, owner, email string
	err := q.db.QueryRow(ctx, `SELECT w.name,
		COALESCE((SELECT settings->'seller'->>'name' FROM invoice_settings WHERE workspace_id = w.id), ''),
		COALESCE(o.name, ''), COALESCE(o.email, '')
		FROM workspaces w
		LEFT JOIN LATERAL (SELECT u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = w.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) o ON true
		WHERE w.id = $1`, workspaceID).Scan(&name, &company, &owner, &email)
	if err != nil {
		return "", err
	}
	var lines []string
	add := func(label, value string) {
		if value = strings.TrimSpace(value); value != "" {
			lines = append(lines, label+": "+value)
		}
	}
	add("Workspace", name)
	if company != name {
		add("Company", company)
	}
	add("Owner", NameAndEmail(owner, email))
	return strings.Join(lines, "\n"), nil
}

// NameAndEmail is a name with its address, "Ann Muster <ann@example.com>", or whichever of them is known.
func NameAndEmail(name, email string) string {
	switch name, email = strings.TrimSpace(name), strings.TrimSpace(email); {
	case name == "":
		return email
	case email == "":
		return name
	}
	return name + " <" + email + ">"
}

// ClaimAdminAlert leases a due message without holding a transaction open during delivery.
func (q Q) ClaimAdminAlert(ctx context.Context) (id int64, message string, err error) {
	err = q.db.QueryRow(ctx, `WITH expired AS (
		DELETE FROM admin_alerts WHERE created_at <= now() - interval '7 days'
	)
	UPDATE admin_alerts SET ready_at = now() + interval '1 minute' WHERE id = (
		SELECT id FROM admin_alerts WHERE ready_at <= now() AND created_at > now() - interval '7 days'
		ORDER BY ready_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
	) RETURNING id, message`).Scan(&id, &message)
	return
}

func (q Q) RetryAdminAlert(ctx context.Context, id int64, delay time.Duration) error {
	_, err := q.db.Exec(ctx, `UPDATE admin_alerts SET ready_at = now() + $2 * interval '1 second' WHERE id = $1`, id, delay.Seconds())
	return err
}

func (q Q) CompleteAdminAlert(ctx context.Context, id int64) error {
	_, err := q.db.Exec(ctx, `DELETE FROM admin_alerts WHERE id = $1`, id)
	return err
}
