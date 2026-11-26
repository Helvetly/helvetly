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
	} else {
		switch first.Event {
		case "approval.approved":
			action = "Open approved draft"
		case "billing.limit_near":
			subject, action = "Check your workspace’s plan usage", "Review plan and usage"
		case "billing.subscription_changed":
			subject, action = "Your workspace subscription has changed", "Review subscription"
		}
	}
	prefs := s.publicURL + "/notifications?prefs=1"
	oneClick := s.publicURL + "/api/v1/public/notifications/unsubscribe?" + url.Values{"token": {s.token(first.UserID, first.Event)}}.Encode()
	because := fmt.Sprintf("You get this email because you are a member of %s on Helvetly.", first.WorkspaceName)
	esc := html.EscapeString

	var text, body strings.Builder
	fmt.Fprintf(&text, "%s\n%s\n\n", first.WorkspaceName, subject)
	fmt.Fprintf(&body, `<p style="margin:0 0 6px;font-size:13px;color:#71717a">%s</p>`+"\n", esc(first.WorkspaceName))
	body.WriteString(mail.Title(subject))
	l := mail.NewLetter("en")
	if len(rows) == 1 {
		writeEmailContent(l, first, summary)
	} else {
		l.Lead("Here are the updates recorded in your workspace. Open an item below for its details or go to Notifications to review them together.")
	}
	text.WriteString(l.Text() + "\n")
	body.WriteString(l.HTML())
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
	fmt.Fprintf(&text, "%s: %s\n\n--\n%s\nNotification settings: %s\n", action, s.publicURL+href, because, prefs)
	body.WriteString(mail.Button(action, s.publicURL+href))
	label, tone := emailOutcome(burst)
	return mail.Message{Workspace: first.WorkspaceID, To: []string{first.Email}, Subject: subject, Text: text.String(), HTML: body.String(),
		ListUnsubscribe: oneClick, NotificationSettings: prefs, Footer: esc(because), Eyebrow: label, Tone: tone, Members: true}
}

// Next steps in notification emails can be more explicit than the short in-app notification.
var emailNextStep = map[string]string{
	"invoice.paid":                     "Open the invoice to review the payment date, amount and payment history.",
	"invoice.partly_paid":              "Open the invoice to see what has been received and check the remaining balance before following up.",
	"invoice.overdue":                  "Check the payment history before following up. You can record a payment or send a reminder from the invoice.",
	"dunning.sent":                     "Open the invoice to see which reminder was sent and review its outstanding balance.",
	"instalment.issued":                "Open the instalment invoice to check its due date and see whether it has been sent to your client.",
	"einvoice.delivery_failed":         "Open the invoice to review the delivery details and check what needs to be corrected before sending it again.",
	"einvoice.delivered":               "Open the invoice to see its delivery history and check which channel was used.",
	"client.change_requested":          "Compare the proposed details with the current client record before deciding whether to apply the change.",
	"portal.first_sign_in":             "Open the client record to review their portal access and the information you’ve shared with them.",
	"portal.document_viewed":           "Open the document to check the file and review who has access.",
	"portal.domain_active":             "Open your portal settings to copy the new address or check how it looks to a client.",
	"portal.domain_failed":             "Open your workspace settings to see the required DNS records and check the domain again after updating them.",
	"portal.domain_released":           "Open your workspace settings to check the portal address your clients can use now.",
	"expense.reimbursed":               "Open the expense to see the reimbursement details and any receipts attached to it.",
	"engagement.draft_created":         "Open the draft to check the billing period, quantities and rates before issuing it.",
	"engagement.over_committed":        "Review the recorded work and the agreed quantity before you decide what to bill.",
	"scheduling.booked":                "Open the session to check the time, location or meeting link, and any details the client shared.",
	"scheduling.booking_requested":     "Review the requested time and your availability before confirming or declining the booking.",
	"scheduling.cancel_requested":      "Open the request to check the cancellation details and how it affects the client’s remaining sessions.",
	"scheduling.reschedule_requested":  "Open the request to compare the current booking with the proposed times before you reply.",
	"scheduling.cancelled_by_client":   "Open the session if you need to check the cancellation details or arrange another time with the client.",
	"scheduling.proposal_answered":     "Open the session to check the client’s response and the time currently on the schedule.",
	"scheduling.calendar_disconnected": "Open the calendar settings to reconnect your account and resume syncing sessions.",
	"scheduling.event_detached":        "Review the session in Helvetly and decide whether to add it back to the calendar or change the booking.",
	"member.invited":                   "Open the member list to check the invitation and the role the recipient will have if they accept.",
	"member.joined":                    "Open the member list to review the new member’s role and access.",
	"member.role_changed":              "Your new role determines which parts of this workspace you can see and what you can manage.",
	"member.removed":                   "Open the member list to review who still has access to this workspace.",
	"billing.trial_ending":             "Open Billing to review your trial and compare the plans available after it ends.",
	"period.closed":                    "Open Books to review the closed period and export its records if you need a copy.",
	"period.reopened":                  "Review the period in Books. When the corrections are complete, you can close it again.",
	"vat.return_due":                   "Open the return to check the figures and prepare the export you’ll use to file.",
	"import.ready":                     "Review the extracted entries and correct anything that needs changing before you finish the import.",
	"import.failed":                    "Check the error and the file you uploaded. After fixing the issue, try importing it again.",
}

func writeEmailContent(l *mail.Letter, n store.Notification, summary string) {
	d := data{}
	_ = json.Unmarshal(n.Data, &d)
	plan := or(d.s("plan"), "current")
	switch n.Event {
	case "approval.requested":
		next := "The invoice stays in draft until it receives the required approvals. The sender can issue it after that."
		switch d.s("doc_type") {
		case "quote":
			next = "Once the quote is approved, the sender can share it with the client."
		case "expense":
			next = "Once the expense is approved, it can be booked in the workspace."
		}
		l.Lead("Review the draft and any supporting details, then approve it or explain what needs to change.").Lead(next)
		if amount := d.s("amount"); amount != "" {
			l.Summary(mail.Row{Label: "Amount", Value: strings.TrimSpace(d.s("currency") + " " + amount)})
		}
	case "approval.approved":
		switch d.s("doc_type") {
		case "quote":
			l.Lead("The draft passed its approval checks. Review the final details before sharing the quote with your client.")
		case "expense":
			l.Lead("The expense passed its approval checks. Review the details and receipts before booking it in your accounts.")
		default:
			l.Lead("The draft passed its approval checks. Open it to review the final details and issue the invoice when you’re ready.")
		}
	case "approval.rejected":
		l.Lead("The document is back in draft. Update it and submit it again when it’s ready for another review.").Note(d.s("comment"))
	case "quote.accepted":
		l.Lead("The client agreed to the current version of the quote.").Lead("Open it to review the agreed details or create an invoice draft from it.").Note(d.s("note"))
	case "quote.declined":
		l.Lead("The client declined this version of the quote.").Lead("Open the quote to review the response. If the client wants a different proposal, you can prepare a new revision.").Note(d.s("note"))
	case "billing.limit_near":
		l.Emphasis("Your workspace is approaching a usage limit on the ", plan+" plan", ".").
			Lead("If you expect to need more capacity, open Billing to see how this limit is counted and compare available plans.").
			Summary(mail.Row{Label: or(d.s("limit"), "Usage"), Value: d.s("used") + " of " + d.s("max")})
	case "billing.payment_failed":
		l.Emphasis("We couldn’t collect a payment for the ", plan+" plan", ".").
			Lead("Open Billing to check the failed payment and update your payment method.")
	case "billing.payment_disputed":
		if d.s("for") == "ai_tokens" {
			l.Lead("The card issuer opened a dispute for a purchase of AI tokens.").
				Lead("If the dispute is lost, the credits from that purchase are reversed. Open Billing to review the payment.")
		} else {
			l.Lead("The card issuer opened a dispute for a subscription payment. Your paid plan stays available while it’s being reviewed.").
				Lead("If the dispute is lost, paid access from that subscription ends. Open Billing to review the payment and your plan.")
		}
	case "billing.subscription_changed":
		if d.s("plan") != "" {
			l.Emphasis("The subscription update is for the ", plan+" plan", ".")
		}
		l.Lead(subscriptionEmailStatus(d.s("status")))
	default:
		l.Lead(summary).Lead(emailNextStep[n.Event])
	}
}

func subscriptionEmailStatus(status string) string {
	switch status {
	case "active":
		return "Your subscription is active and the plan’s features are available to your workspace. Open Billing to review your plan and payment details."
	case "trialing":
		return "Your workspace is on a trial. Open Billing to check when the trial ends and review the plan options."
	case "past_due", "unpaid":
		return "A subscription payment is outstanding. Open Billing to check the payment and update your payment method."
	case "canceled", "paused":
		return "Your paid subscription is no longer active. Your records are still available. Open Billing to check which plan and limits apply and review your options."
	default:
		return "Open Billing to confirm which plan and features are available to your workspace and review your subscription details."
	}
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
