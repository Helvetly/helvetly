package store

import "context"

// ClientEmails is a workspace's own part of its client email: the footer under every branded one and the switches of
// the automatic emails kept on the workspace (the invoice ones live in the invoice settings).
type ClientEmails struct {
	Footer            string `json:"email_footer"`
	PortalInvitations bool   `json:"portal_invitations"`
	SessionReminders  bool   `json:"session_reminders"`
}

const clientEmailsColumns = `email_footer, portal_invitations, session_reminders FROM workspaces WHERE id = $1`

func (q Q) WorkspaceClientEmails(ctx context.Context, workspaceID string) (ClientEmails, error) {
	var c ClientEmails
	err := q.db.QueryRow(ctx, `SELECT `+clientEmailsColumns, workspaceID).Scan(&c.Footer, &c.PortalInvitations, &c.SessionReminders)
	return c, err
}

// LockWorkspaceClientEmails reads WorkspaceClientEmails and locks the workspace's row until the transaction ends, so
// two changes at once are applied and audited one after the other.
func (q Q) LockWorkspaceClientEmails(ctx context.Context, workspaceID string) (ClientEmails, error) {
	var c ClientEmails
	err := q.db.QueryRow(ctx, `SELECT `+clientEmailsColumns+` FOR UPDATE`, workspaceID).Scan(&c.Footer, &c.PortalInvitations, &c.SessionReminders)
	return c, err
}

func (q Q) SetWorkspaceClientEmails(ctx context.Context, workspaceID string, c ClientEmails) error {
	_, err := q.db.Exec(ctx, `UPDATE workspaces SET email_footer = $2, portal_invitations = $3, session_reminders = $4 WHERE id = $1`,
		workspaceID, c.Footer, c.PortalInvitations, c.SessionReminders)
	return err
}
