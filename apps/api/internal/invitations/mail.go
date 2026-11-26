// Package invitations invites people to a workspace by email and lets them accept (docs/members-contract.md).
package invitations

import (
	"fmt"
	"time"

	"helvetly.com/api/internal/mail"
)

var roleArticle = map[string]string{"owner": "an owner", "admin": "an admin", "member": "a member"}

// inviteMessage: expires is shown on its date in its own location (the workspace's time zone).
func inviteMessage(to, inviter, workspace, role, url string, expires time.Time) mail.Message {
	date := expires.Format("2 January 2006")
	lead := fmt.Sprintf("%s invited you to join as %s. Use the email address that received this invitation to sign in.", inviter, roleArticle[role])
	expiry := fmt.Sprintf("This invitation expires on %s.", date)
	l := mail.NewLetter("en").Lead(lead).Action("Accept invitation", url).FinePrint(expiry)
	title := "Join " + workspace + " on Helvetly"
	return mail.Message{
		To:      []string{to},
		Subject: fmt.Sprintf("%s invited you to %s on Helvetly", inviter, workspace),
		Text:    title + "\n\n" + l.Text(),
		HTML:    mail.Title(title) + l.HTML(),
	}
}
