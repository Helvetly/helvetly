package notifications

import (
	"context"
	"encoding/json"
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
	} else if first.Event == "approval.approved" {
		action = "Open approved draft"
	}
	prefs := s.publicURL + "/notifications?prefs=1"
	unsub := s.publicURL + "/unsubscribe#" + s.token(first.UserID, first.Event)
	oneClick := s.publicURL + "/api/v1/public/notifications/unsubscribe?" + url.Values{"token": {s.token(first.UserID, first.Event)}}.Encode()
	because := fmt.Sprintf("You get this email because you are a member of %s on Helvetly.", first.WorkspaceName)
	esc := html.EscapeString

	var text, body strings.Builder
	fmt.Fprintf(&text, "%s\n%s\n\n", first.WorkspaceName, subject)
	fmt.Fprintf(&body, `<p style="margin:0 0 6px;font-size:13px;color:#71717a">%s</p>`+"\n", esc(first.WorkspaceName))
	body.WriteString(mail.Title(subject))
	if len(rows) == 1 {
		lead, note := emailLead(first, summary)
		l := mail.NewLetter("en").Lead(lead).Note(note)
		text.WriteString(l.Text() + "\n")
		body.WriteString(l.HTML())
	}
	if len(rows) > 1 {
		body.WriteString("<ul>\n")
		for i, m := range rows {
			link, meta := s.publicURL+m.href, burst[i].CreatedAt.In(zone).Format("15:04")
			if m.body != "" {
				meta = strings.TrimSuffix(m.body, ".") + " · " + meta
			}
			fmt.Fprintf(&text, "- %s\n  %s\n  %s\n", m.title, meta, link)
			fmt.Fprintf(&body, `<li><a href="%s"><strong>%s</strong></a><br><span style="font-size:14px;color:#71717a">%s</span></li>`+"\n",
				esc(link), esc(m.title), esc(meta))
		}
		body.WriteString("</ul>\n")
		text.WriteString("\n")
	}
	fmt.Fprintf(&text, "%s: %s\n\n--\n%s\nNotification settings: %s\nUnsubscribe: %s\n", action, s.publicURL+href, because, prefs, unsub)
	body.WriteString(mail.Button(action, s.publicURL+href))
	footer := fmt.Sprintf(`%s<br><a href="%s" style="color:#71717a">Notification settings</a> &nbsp;·&nbsp; `+
		`<a href="%s" style="color:#71717a">Unsubscribe</a>`, esc(because), esc(prefs), esc(unsub))
	label, tone := emailOutcome(burst)
	return mail.Message{Workspace: first.WorkspaceID, To: []string{first.Email}, Subject: subject, Text: text.String(), HTML: body.String(), ListUnsubscribe: oneClick, Eyebrow: label, Tone: tone,
		Footer: footer, Members: true}
}

// emailLead gives the recipient context and a next step beyond the notification title.
func emailLead(n store.Notification, summary string) (lead, note string) {
	switch n.Event {
	case "approval.approved", "approval.rejected", "quote.accepted", "quote.declined":
		d := data{}
		_ = json.Unmarshal(n.Data, &d)
		switch n.Event {
		case "approval.approved":
			switch d.s("doc_type") {
			case "quote":
				return "The quote is ready to send. Open it to review the details before sharing it with your client.", ""
			case "expense":
				return "The expense is ready to book. Review the details and receipts before recording it in your books.", ""
			default:
				return "Open the draft to review the final details and issue the invoice when you’re ready.", ""
			}
		case "approval.rejected":
			return "The document is back in draft. Update it and submit it again when it’s ready for another review.", d.s("comment")
		case "quote.accepted":
			return "Open the accepted quote to review the agreed details or create an invoice draft from it.", d.s("note")
		case "quote.declined":
			return "Open the quote to review the response. If the client wants a different proposal, you can prepare a new revision.", d.s("note")
		}
	case "einvoice.delivered":
		return summary + " Open the invoice to see its delivery history.", ""
	case "member.role_changed":
		return summary + " Your new role determines what you can see and do in this workspace.", ""
	}
	return summary, ""
}

func emailOutcome(burst []store.Notification) (string, mail.Tone) {
	n := burst[0]
	switch n.Event {
	case "approval.approved":
		return "Approved", mail.Positive
	case "approval.rejected":
		return "Rejected", mail.Negative
	case "quote.accepted":
		return "Accepted", mail.Positive
	case "quote.declined":
		return "Declined", mail.Negative
	case "invoice.paid":
		return "Paid", mail.Positive
	case "scheduling.booked":
		return "Booked", mail.Positive
	case "scheduling.proposal_answered":
		if len(burst) == 1 {
			d := data{}
			_ = json.Unmarshal(n.Data, &d)
			switch d.s("answer") {
			case "accepted":
				return "Accepted", mail.Positive
			case "declined":
				return "Declined", mail.Negative
			}
		}
	}
	return "", 0
}
