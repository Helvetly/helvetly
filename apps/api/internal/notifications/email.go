package notifications

import (
	"context"
	"fmt"
	"html"
	"net/url"
	"strings"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// quiet: events of one kind for one person less than this apart make one email, sent once none has come for this
// long, so every email waits about a minute.
const quiet = time.Minute

// Run sends the due emails every 15 seconds until ctx ends. Without a mailer nothing is sent: the bell still works
// and the pending rows wait for a mail server.
func (s *Service) Run(ctx context.Context) {
	if s.mailer == nil {
		return
	}
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Tick(ctx)
		}
	}
}

// Tick claims the settled bursts and sends one email per person, workspace and event.
func (s *Service) Tick(ctx context.Context) {
	due, err := s.db.ClaimNotificationEmails(ctx, quiet, s.now())
	if err != nil {
		s.log.ErrorContext(ctx, "claim notification emails", "error", err)
		return
	}
	for start := 0; start < len(due); {
		end := start + 1
		for end < len(due) && due[end].UserID == due[start].UserID && due[end].WorkspaceID == due[start].WorkspaceID &&
			due[end].Event == due[start].Event {
			end++
		}
		burst := due[start:end]
		if err := s.mailer.Send(ctx, s.message(burst)); err != nil {
			// At most once: the rows are claimed, so a failed send is not retried (the bell still has them).
			s.log.ErrorContext(ctx, "send notification email", "user", burst[0].UserID, "event", burst[0].Event, "error", err)
		}
		start = end
	}
}

// message is one email for a burst (oldest first) of one event for one person in one workspace: one event leads with
// its summary and button, several are rows that each link to their page.
func (s *Service) message(burst []store.Notification) mail.Message {
	first := burst[0]
	zone := store.Workspace{Timezone: first.WorkspaceTimezone}.Location()
	rows := make([]message, 0, len(burst))
	for _, n := range burst {
		rows = append(rows, render(n))
	}
	lead := rows[0]
	subject, summary, action, href := lead.title, lead.body, lead.action, lead.href
	if len(rows) > 1 {
		subject, summary, action, href = burstTitle(first.Event, len(rows)), "", "Open notifications", "/notifications"
	}
	prefs := s.publicURL + "/notifications?prefs=1"
	unsub := s.publicURL + "/unsubscribe#" + s.token(first.UserID, first.Event)
	oneClick := s.publicURL + "/api/v1/public/notifications/unsubscribe?" + url.Values{"token": {s.token(first.UserID, first.Event)}}.Encode()
	because := fmt.Sprintf("You get this email because you are a member of %s on Helvetly.", first.WorkspaceName)
	esc := html.EscapeString

	var text, body strings.Builder
	fmt.Fprintf(&text, "%s\n%s\n\n", first.WorkspaceName, subject)
	fmt.Fprintf(&body, `<p style="margin:0 0 8px;font-size:13px;color:#71717a">%s</p>`+"\n"+
		`<h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600;color:#18181b">%s</h1>`+"\n", esc(first.WorkspaceName), esc(subject))
	if summary != "" {
		fmt.Fprintf(&text, "%s\n\n", summary)
		fmt.Fprintf(&body, "<p>%s</p>\n", esc(summary))
	}
	if len(rows) > 1 {
		body.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0">` + "\n")
		for i, m := range rows {
			link, meta := s.publicURL+m.href, burst[i].CreatedAt.In(zone).Format("15:04")
			if m.body != "" {
				meta = strings.TrimSuffix(m.body, ".") + " · " + meta
			}
			fmt.Fprintf(&text, "- %s\n  %s\n  %s\n", m.title, meta, link)
			fmt.Fprintf(&body, `<tr><td style="padding:14px 0;border-top:1px solid #e4e4e7">`+
				`<div style="font-weight:600;color:#18181b">%s</div><div style="font-size:14px;color:#71717a">%s</div></td>`+
				`<td align="right" valign="top" style="padding:14px 0 14px 16px;border-top:1px solid #e4e4e7;white-space:nowrap">`+
				`<a href="%s" style="font-size:14px;font-weight:600">View</a></td></tr>`+"\n", esc(m.title), esc(meta), esc(link))
		}
		body.WriteString("</table>\n")
		text.WriteString("\n")
	}
	fmt.Fprintf(&text, "%s: %s\n\n--\n%s\nNotification settings: %s\nUnsubscribe: %s\n", action, s.publicURL+href, because, prefs, unsub)
	body.WriteString(mail.Button(action, s.publicURL+href))
	footer := fmt.Sprintf(`%s<br><a href="%s" style="color:#71717a">Notification settings</a> &nbsp;·&nbsp; `+
		`<a href="%s" style="color:#71717a">Unsubscribe</a>`, esc(because), esc(prefs), esc(unsub))
	preview := or(summary, rows[0].title)
	return mail.Message{To: []string{first.Email}, Subject: subject, Text: text.String(), HTML: body.String(), ListUnsubscribe: oneClick,
		Preview: preview, Footer: footer}
}
