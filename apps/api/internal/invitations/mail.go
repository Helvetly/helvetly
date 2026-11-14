// Package invitations invites people to a workspace by email and lets them accept (docs/members-contract.md).
package invitations

import (
	"fmt"
	"html"
	"time"

	"helvetly.com/api/internal/mail"
)

var roleArticle = map[string]string{"owner": "an owner", "admin": "an admin", "member": "a member"}

// inviteMessage: expires is shown on its date in its own location (the workspace's time zone).
func inviteMessage(to, inviter, workspace, role, url string, expires time.Time) mail.Message {
	date := expires.Format("2 January 2006")
	lead := fmt.Sprintf("%s invited you to join %s on Helvetly as %s.", inviter, workspace, roleArticle[role])
	expiry := fmt.Sprintf("This invitation expires on %s.", date)
	text := fmt.Sprintf("Hello,\n\n%s\n\nAccept the invitation here:\n%s\n\n%s\n", lead, url, expiry)
	htmlBody := fmt.Sprintf(`<p>Hello,</p>
<p>%s</p>
%s<p>%s</p>`, html.EscapeString(lead), mail.Button("Accept invitation", url), html.EscapeString(expiry))
	return mail.Message{
		To:      []string{to},
		Subject: fmt.Sprintf("%s invited you to %s on Helvetly", inviter, workspace),
		Text:    text,
		HTML:    htmlBody,
	}
}
