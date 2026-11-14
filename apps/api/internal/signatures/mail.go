package signatures

import (
	"fmt"
	"html"
	"strings"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

const sesNote = "This is a simple electronic signature (SES) under the Swiss ZertES and the EU eIDAS Regulation."

func paragraphs(lines ...string) string {
	var b strings.Builder
	for _, l := range lines {
		if l != "" {
			fmt.Fprintf(&b, "<p>%s</p>\n", strings.ReplaceAll(html.EscapeString(l), "\n", "<br>"))
		}
	}
	return b.String()
}

// fine is the small print: hashes and the legal note, muted so the message itself leads.
func fine(lines ...string) string {
	return strings.ReplaceAll(paragraphs(lines...), "<p>", `<p style="font-size:13px;color:#78716c">`)
}

func quoted(message *string) string {
	if message == nil {
		return ""
	}
	return "“" + *message + "”"
}

func inviteMessage(req store.SignatureRequest, to store.Signer, link string, reminder bool) mail.Message {
	from := senderOf(req).Name
	lead := fmt.Sprintf("%s (%s) asks you to review and sign “%s”.", from, req.WorkspaceName, req.Title)
	subject := fmt.Sprintf("%s sent you “%s” to sign", from, req.Title)
	if reminder {
		subject = "Reminder: " + subject
	}
	expiry := fmt.Sprintf("The link is personal, so please don't forward it. It works until %s.",
		req.ExpiresAt.In(zone(req)).Format("2 January 2006"))
	m := mail.Message{To: []string{to.Email}, Subject: subject, ReplyTo: req.SenderEmail,
		Text: fmt.Sprintf("Hello %s,\n\n%s\n\n%s\n\nReview and sign:\n%s\n\n%s\n%s\n", to.Name, lead, quoted(req.Message), link,
			expiry, sesNote),
		HTML: paragraphs("Hello "+to.Name+",", lead, quoted(req.Message)) + mail.Button("Review and sign", link) + fine(expiry, sesNote)}
	return m
}

func declinedMessage(req store.SignatureRequest, who store.Signer) mail.Message {
	lead := fmt.Sprintf("%s (%s) declined to sign “%s”, so the request has stopped.", who.Name, who.Email, req.Title)
	reason := "Reason: " + deref(who.DeclineReason)
	return mail.Message{To: []string{req.SenderEmail}, ReplyTo: who.Email, Subject: fmt.Sprintf("%s declined to sign “%s”", who.Name, req.Title),
		Text: fmt.Sprintf("Hello,\n\n%s\n\n%s\n", lead, reason), HTML: paragraphs("Hello,", lead, reason)}
}

func completedMessage(done completed, to string) mail.Message {
	req := done.req
	lead := fmt.Sprintf("Everyone has signed “%s”. The signed PDF is attached, with a certificate of completion on its last page.", req.Title)
	hashes := fmt.Sprintf("SHA-256 of the signed PDF: %s\nSHA-256 of the original: %s", done.sum, req.OriginalSHA256)
	return mail.Message{To: []string{to}, ReplyTo: req.SenderEmail, Subject: fmt.Sprintf("Signed: “%s”", req.Title),
		Text: fmt.Sprintf("Hello,\n\n%s\n\n%s\n\n%s\n", lead, hashes, sesNote),
		HTML: paragraphs("Hello,", lead) +
			`<p style="font-size:12px;color:#78716c;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all">` +
			strings.ReplaceAll(html.EscapeString(hashes), "\n", "<br>") + "</p>" + fine(sesNote),
		Attachments: []mail.Attachment{{Name: done.name, ContentType: "application/pdf", Data: done.pdf}}}
}
