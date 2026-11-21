package notifications

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"helvetly.com/api/internal/store"
)

// message: what the bell and the email say. actor is who did it ("" for Helvetly's own jobs); action labels the
// email's button to href.
type message struct{ title, body, href, actor, action string }

// actions label the email's button per event: what the reader does next on the page it opens.
var actions = map[string]string{
	"invoice.paid": "View invoice", "invoice.partly_paid": "View invoice", "invoice.overdue": "View invoice",
	"dunning.sent": "View invoice", "instalment.issued": "View invoice", "einvoice.delivery_failed": "Check the invoice",
	"einvoice.delivered": "View invoice", "client.change_requested": "Review the request", "portal.first_sign_in": "Open the client",
	"portal.document_viewed": "Open the document", "signature.viewed": "View the request", "signature.signed": "View the request",
	"signature.completed": "View the request", "signature.declined": "View the request", "expense.reimbursed": "View expense",
	"engagement.draft_created": "Review the draft", "engagement.over_committed": "View engagement", "member.invited": "View members",
	"member.joined": "View members", "member.role_changed": "View members", "member.removed": "View members",
	"billing.trial_ending": "Choose a plan", "billing.payment_failed": "Update payment method",
	"billing.payment_disputed":     "View billing",
	"billing.subscription_changed": "View billing", "billing.limit_near": "Compare plans", "period.closed": "View periods",
	"period.reopened": "View periods", "vat.return_due": "Open the VAT return", "import.ready": "Review the import",
	"import.failed": "Open the import", "portal.domain_active": "View the portal settings",
	"portal.domain_failed": "Check the domain", "portal.domain_released": "View the portal settings", "quote.accepted": "Make the invoice", "quote.declined": "View the quote",
	"approval.requested": "Review the draft", "approval.approved": "Issue it", "approval.rejected": "Open the draft",
}

// data is a notification's stored fields; numbers read as their text.
type data map[string]any

func (d data) s(key string) string {
	switch v := d[key].(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		return fmt.Sprint(v)
	}
}

// render words a notification from its stored data, so wording changes reach old notifications too.
func render(n store.Notification) message {
	d := data{}
	_ = json.Unmarshal(n.Data, &d)
	m := words(n.Event, d)
	if m.actor == "" {
		m.actor = d.s("actor")
	}
	if m.href == "" {
		m.href = "/notifications"
	}
	m.action = or(m.action, actions[n.Event], "Open Helvetly")
	return m
}

func words(event string, d data) message {
	number := or(d.s("number"), "without a number")
	invoice := "/invoices?" + url.Values{"id": {d.s("invoice_id")}}.Encode()
	money := strings.TrimSpace(d.s("currency") + " " + d.s("amount"))
	switch event {
	case "invoice.paid":
		m := message{title: "Invoice " + number + " was paid", href: invoice}
		if d.s("amount") != "" {
			m.body = money + " received" + from(d.s("client")) + "."
		}
		return m
	case "invoice.partly_paid":
		body := money + " received" + from(d.s("client"))
		if d.s("open") != "" {
			body += " · " + d.s("currency") + " " + d.s("open") + " still open"
		}
		return message{title: "Invoice " + number + " was partly paid", body: body, href: invoice}
	case "invoice.overdue":
		return message{title: "Invoice " + number + " is overdue", body: strings.TrimSpace(money + " still open" + from(d.s("client")) +
			", due on " + d.s("due_date") + "."), href: invoice}
	case "dunning.sent":
		title := fmt.Sprintf("Payment reminder %s sent for invoice %s", or(d.s("level"), "1"), number)
		if d.s("title") != "" { // the step's name as sent; older events have only the level
			title = d.s("title") + " sent for invoice " + number
		}
		return message{title: title,
			body: "To " + or(d.s("client"), "the client") + amountSuffix(money), href: invoice}
	case "instalment.issued":
		return message{title: fmt.Sprintf("Instalment %s of %s issued as invoice %s", d.s("position"), d.s("count"), number),
			body: strings.TrimSpace(money + " for " + or(d.s("client"), "the client")), href: invoice}
	case "einvoice.delivery_failed":
		return message{title: "E-invoice " + number + " could not be delivered", body: or(d.s("reason"), "The channel refused it."),
			href: invoice}
	case "einvoice.delivered":
		return message{title: "E-invoice " + number + " was delivered", body: "Through " + or(d.s("channel"), "the channel") + ".",
			href: invoice}
	case "client.change_requested":
		return message{title: or(d.s("client_name"), "A client") + " asked to change their billing details",
			body:  or(d.s("contact_name"), "The client") + " sent the change from the client portal. Approve or reject it on the client's page.",
			href:  clientHref(d.s("client_id")),
			actor: d.s("contact_name")}
	case "approval.requested":
		return message{title: or(d.s("actor"), "A team member") + " asks you to approve " + approvalDoc(d),
			body: strings.TrimSpace(money + " · " + approvalStep(d).once), href: approvalHref(d, invoice)}
	case "approval.approved":
		step := approvalStep(d)
		return message{title: "Your " + approvalDoc(d) + " was approved", body: step.now, href: approvalHref(d, invoice),
			action: step.action}
	case "approval.rejected":
		body := "It is a draft again: change it and submit it again."
		if d.s("comment") != "" {
			body = "“" + d.s("comment") + "”"
		}
		return message{title: or(d.s("actor"), "A team member") + " rejected your " + approvalDoc(d), body: body,
			href: approvalHref(d, invoice)}
	case "quote.accepted", "quote.declined":
		verb := map[string]string{"quote.accepted": "accepted", "quote.declined": "declined"}[event]
		body := "In the client portal."
		if d.s("note") != "" {
			body = "“" + d.s("note") + "”"
		}
		return message{title: fmt.Sprintf("%s %s quote %s", or(d.s("client_name"), "The client"), verb, or(d.s("quote_number"), "without a number")),
			body: body, href: "/quotes?" + url.Values{"id": {d.s("quote_id")}}.Encode()}
	case "portal.first_sign_in":
		return message{title: or(d.s("contact_name"), "The client") + " signed in to the client portal for the first time",
			body: or(d.s("client_name"), "The client") + " can now see its invoices and shared documents there.",
			href: clientHref(d.s("client_id")), actor: d.s("contact_name")}
	case "portal.domain_active":
		return message{title: "Your client portal is live at " + d.s("hostname"),
			body: "Invitations and emails to your clients now link to https://" + d.s("hostname") + "/.", href: "/settings/workspace"}
	case "portal.domain_failed":
		return message{title: d.s("hostname") + " stopped working for your client portal",
			body: "Until it works again, your clients sign in at your portal address on Helvetly. Check the DNS record in the settings.",
			href: "/settings/workspace"}
	case "portal.domain_released":
		body := "It was not set up within 14 days, so it is free again. You can add it again at any time."
		if d.s("reason") == "claimed" {
			body = "Another workspace proved it owns the domain with its DNS record. Your clients sign in at your portal address on Helvetly."
		}
		return message{title: d.s("hostname") + " was removed from your client portal", body: body, href: "/settings/workspace"}
	case "portal.document_viewed":
		return message{title: fmt.Sprintf("%s opened “%s”", or(d.s("contact_name"), "The client"), d.s("document_name")),
			body: "Shared with " + or(d.s("client_name"), "the client") + " in the client portal.",
			href: "/documents?" + url.Values{"file": {d.s("document_id")}}.Encode(), actor: d.s("contact_name")}
	case "signature.viewed":
		return message{title: fmt.Sprintf("%s opened “%s”", or(d.s("signer"), "A signer"), d.s("title")),
			body: "Waiting for their signature.", href: signatureHref(d.s("request_id")), actor: d.s("signer")}
	case "signature.signed":
		body := "Waiting for the others to sign."
		if d.s("remaining") == "1" {
			body = "One more signature to go."
		} else if d.s("remaining") != "" {
			body = d.s("remaining") + " more signatures to go."
		}
		return message{title: fmt.Sprintf("%s signed “%s”", or(d.s("signer"), "A signer"), d.s("title")), body: body,
			href: signatureHref(d.s("request_id")), actor: d.s("signer")}
	case "signature.completed":
		return message{title: fmt.Sprintf("“%s” was signed by everyone", d.s("title")), body: "The signed PDF is in Documents.",
			href: signatureHref(d.s("request_id"))}
	case "signature.declined":
		return message{title: fmt.Sprintf("%s declined to sign “%s”", or(d.s("signer"), "A signer"), d.s("title")), body: d.s("reason"),
			href: signatureHref(d.s("request_id")), actor: d.s("signer")}
	case "expense.reimbursed":
		return message{title: "Your expense “" + or(d.s("description"), "without a description") + "” was reimbursed",
			body: strings.TrimSpace(money + " paid back on " + d.s("reimbursed_on") + "."),
			href: "/expenses?" + url.Values{"id": {d.s("expense_id")}}.Encode()}
	case "engagement.draft_created":
		return message{title: "Draft invoice ready for " + or(d.s("engagement"), "an engagement"),
			body: strings.TrimSpace(d.s("client")+" · "+d.s("period")) + ". Check it and issue it.", href: invoice}
	case "engagement.over_committed":
		return message{title: or(d.s("engagement"), "An engagement") + " is over its committed quantity",
			body: strings.TrimSpace(fmt.Sprintf("%s %s over in %s", d.s("overage"), d.s("unit"), d.s("period"))) + from(d.s("client")),
			href: "/engagements?" + url.Values{"id": {d.s("engagement_id")}}.Encode()}
	case "member.invited":
		return message{title: or(d.s("actor"), "Someone") + " invited " + d.s("email"), body: "Role: " + or(d.s("role"), "member") + ".",
			href: "/members"}
	case "member.joined":
		return message{title: or(d.s("name"), d.s("email"), "Someone") + " joined the workspace", body: "Role: " + or(d.s("role"), "member") + ".",
			href: "/members", actor: or(d.s("name"), d.s("email"))}
	case "member.role_changed":
		return message{title: "Your role is now " + or(d.s("role"), "member"), body: "Changed by " + or(d.s("actor"), "an owner") + ".",
			href: "/members"}
	case "member.removed":
		return message{title: or(d.s("name"), d.s("email"), "Someone") + " was removed from the workspace",
			body: "By " + or(d.s("actor"), "an owner") + ".", href: "/members"}
	case "billing.trial_ending":
		return message{title: "Your trial ends on " + or(d.s("trial_end"), "soon"),
			body: "Choose a plan to keep working without interruption.", href: "/settings/billing"}
	case "billing.payment_failed":
		return message{title: "A subscription payment failed", body: "Update the payment method to keep the " +
			or(d.s("plan"), "current") + " plan.", href: "/settings/billing"}
	case "billing.payment_disputed":
		what := "the subscription"
		if d.s("for") == "ai_tokens" {
			what = "AI tokens"
		}
		return message{title: "A payment is disputed", body: "A payment for " + what + " was disputed with the card issuer. " +
			"The plan keeps working while the dispute is open; if it is lost, what the payment bought ends.", href: "/settings/billing"}
	case "billing.subscription_changed":
		return message{title: "The subscription is now " + or(d.s("plan"), "changed"), body: statusWords(d.s("status")),
			href: "/settings/billing"}
	case "billing.limit_near":
		return message{title: fmt.Sprintf("%s of %s %s used this period", d.s("used"), d.s("max"), or(d.s("limit"), "items")),
			body: "The " + or(d.s("plan"), "current") + " plan is almost at its limit. Upgrade before you reach it.",
			href: "/settings/billing"}
	case "period.closed":
		return message{title: d.s("month") + " was closed", body: "Invoices, payments and expenses in it are now locked.",
			href: "/books"}
	case "period.reopened":
		return message{title: d.s("month") + " was reopened", body: "Its invoices, payments and expenses can change again.",
			href: "/books"}
	case "vat.return_due":
		return message{title: "VAT return " + d.s("period") + " is ready to file",
			body: "The period ended on " + d.s("last") + ". Close its months, then export the return.",
			href: "/books/vat-return?" + url.Values{"period": {d.s("period")}}.Encode()}
	case "import.ready":
		return message{title: "Your " + or(d.s("kind"), "file") + " import is ready to review",
			body: fmt.Sprintf("%s records found in %s.", or(d.s("records"), "0"), plural(d.s("files"), "file")),
			href: importHref(d.s("path"))}
	case "import.failed":
		return message{title: "Your " + or(d.s("kind"), "file") + " import could not be read", body: or(d.s("reason"), "Upload the files again."),
			href: importHref(d.s("path"))}
	}
	return message{title: "Something happened in your workspace", href: "/"}
}

// approvalDoc names a draft waiting for approval: "credit note for Acme AG", "quote for Acme AG", "expense from
// Swisscom".
func approvalDoc(d data) string {
	switch d.s("doc_type") {
	case "quote":
		return "quote" + strings.Replace(from(d.s("client")), " from ", " for ", 1)
	case "expense":
		return "expense" + from(d.s("client"))
	}
	kind := map[string]string{"credit_note": "credit note", "debit_note": "debit note", "corrected": "corrected invoice",
		"proforma": "pro-forma invoice"}[d.s("kind")]
	return or(kind, "invoice") + strings.Replace(from(d.s("client")), " from ", " for ", 1)
}

// approvalStep: what an approval lets happen to the document: invoices are issued, quotes sent, expenses booked.
type step struct{ once, now, action string }

func approvalStep(d data) step {
	switch d.s("doc_type") {
	case "quote":
		return step{"it is sent once approved.", "You can send it now.", "Send it"}
	case "expense":
		return step{"it is booked once approved.", "You can book it now.", "Book it"}
	}
	return step{"it is issued once approved.", "You can issue it now.", "Issue it"}
}

// approvalHref opens the document; notifications from before quotes and expenses name only invoice_id.
func approvalHref(d data, invoice string) string {
	switch d.s("doc_type") {
	case "quote":
		return "/quotes?" + url.Values{"id": {d.s("doc_id")}}.Encode()
	case "expense":
		return "/expenses?" + url.Values{"id": {d.s("doc_id")}}.Encode()
	}
	return invoice
}

func from(client string) string {
	if client == "" {
		return ""
	}
	return " from " + client
}

func amountSuffix(money string) string {
	if money == "" {
		return "."
	}
	return " for " + money + "."
}

func plural(n, word string) string {
	if n == "" || n == "1" {
		return "1 " + word
	}
	return n + " " + word + "s"
}

func statusWords(status string) string {
	switch status {
	case "trialing":
		return "In its trial."
	case "active":
		return "Active."
	case "past_due", "unpaid":
		return "A payment is outstanding."
	case "canceled":
		return "Cancelled: the workspace is read-only."
	case "paused":
		return "Paused."
	}
	return ""
}

func clientHref(id string) string { return "/clients?" + url.Values{"id": {id}}.Encode() }

func importHref(path string) string { return or(path, "/") + "?import=1" }

func signatureHref(id string) string {
	return "/documents?" + url.Values{"view": {"signatures"}, "request": {id}}.Encode()
}

func or(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// burstTitle is the subject of one email for several events of a kind.
func burstTitle(event string, n int) string {
	switch event {
	case "invoice.paid":
		return fmt.Sprintf("%d invoices were paid", n)
	case "invoice.partly_paid":
		return fmt.Sprintf("%d invoices were partly paid", n)
	case "invoice.overdue":
		return fmt.Sprintf("%d invoices are overdue", n)
	case "member.joined":
		return fmt.Sprintf("%d people joined the workspace", n)
	case "client.change_requested":
		return fmt.Sprintf("%d clients asked to change their billing details", n)
	case "einvoice.delivery_failed":
		return fmt.Sprintf("%d e-invoices could not be delivered", n)
	}
	return fmt.Sprintf("%d updates in Helvetly", n)
}
