package signatures

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

const sesNote = "This is a simple electronic signature (SES) under the Swiss ZertES and the EU eIDAS Regulation."

// signWords are the fixed parts of a signing email in its language: the button, the summary's labels, the personal
// link and the SES note.
var signWords = map[string]struct{ button, document, sentBy, signBy, personal, ses, date string }{
	"de": {"Prüfen und unterschreiben →", "Dokument", "Gesendet von", "Unterschreiben bis",
		"Der Link ist persönlich, bitte leiten Sie ihn nicht weiter.",
		"Dies ist eine einfache elektronische Signatur (EES) nach dem Schweizer ZertES und der EU-Verordnung eIDAS.", "02.01.2006"},
	"fr": {"Vérifier et signer →", "Document", "Envoyé par", "À signer avant le",
		"Ce lien est personnel, merci de ne pas le transférer.",
		"Il s’agit d’une signature électronique simple (SES) au sens de la SCSE suisse et du règlement européen eIDAS.", "02.01.2006"},
	"it": {"Verifica e firma →", "Documento", "Inviato da", "Da firmare entro il",
		"Il link è personale, la preghiamo di non inoltrarlo.",
		"Si tratta di una firma elettronica semplice (FES) ai sensi della FiEle svizzera e del regolamento UE eIDAS.", "02.01.2006"},
	"en": {"Review and sign →", "Document", "Sent by", "Sign by", "The link is personal, so please don't forward it.", sesNote,
		"2 January 2006"},
}

// short keeps a name to one line: a long company name never fills a subject or a sentence.
func short(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > 60 {
		return strings.TrimSpace(string(r[:59])) + "…"
	}
	return name
}

// sentBy is the member who sent the request; empty when they are gone (the business itself is named already).
func sentBy(req store.SignatureRequest) string {
	if req.CreatedBy == nil {
		return ""
	}
	return short(req.CreatedBy.Name)
}

// emailText is the template of a request's invitation or reminder in its language (the workspace's own, else the
// built-in one); empty for a request without a language, whose email stays the English one of before templates.
func (s *Service) emailText(ctx context.Context, req store.SignatureRequest, reminder bool) (emailtemplate.Template, error) {
	if req.Language == nil {
		return emailtemplate.Template{}, nil
	}
	kind := "signature_request"
	if reminder {
		kind = "signature_reminder"
	}
	return emailtemplate.Lookup(ctx, s.db.Q, req.WorkspaceID, kind, *req.Language)
}

// inviteMessage is a signer's email with their personal link: a lead, the document's summary, the button and the small
// print. With a language, its subject and lead (and a reminder's message) come from text and the invitation's lead is
// the message the sender wrote; without, it is the English email.
func inviteMessage(req store.SignatureRequest, to store.Signer, link string, reminder bool, text emailtemplate.Template) mail.Message {
	language, company := "en", short(req.WorkspaceName)
	if req.Language != nil {
		language = *req.Language
	}
	w, ok := signWords[language]
	if !ok {
		w = signWords["en"]
	}
	l := mail.NewLetter(language)
	var subject string
	if req.Language != nil {
		r := emailtemplate.Render(text, map[string]string{"document": req.Title, "sender": short(senderOf(req).Name), "company": company})
		subject = r.Subject
		if !reminder && req.Message != nil {
			l.Message(*req.Message)
		} else {
			l.Message(r.Body)
		}
	} else {
		subject = fmt.Sprintf("%s asks you to sign “%s”", company, req.Title)
		lead := "Open the document to review the details before you sign. If you have questions, you can reply to this email."
		if reminder {
			subject = "Reminder: " + subject
			lead = "The document is still waiting for your signature. Open it to review the details before the deadline below."
		}
		l.Greeting(short(to.Name)).Lead(lead).Note(deref(req.Message))
	}
	l.Summary(mail.Row{Label: w.document, Value: req.Title}, mail.Row{Label: w.sentBy, Value: sentBy(req)},
		mail.Row{Label: w.signBy, Value: req.ExpiresAt.In(zone(req)).Format(w.date)}).
		Action(w.button, link).FinePrint(w.personal, w.ses)
	return mail.Message{Workspace: req.WorkspaceID, Language: language, To: []string{to.Email}, Subject: subject, ReplyTo: req.SenderEmail,
		Text: l.Text(), HTML: l.HTML()}
}

// previewBody is POST /signatures/email-preview: the request as the send drawer has it so far.
type previewBody struct {
	Title         string  `json:"title"`
	Message       *string `json:"message"`
	Language      string  `json:"language"`
	ExpiresInDays *int    `json:"expires_in_days"`
}

// preview answers the subject and the HTML a signer would get for the request being written, without sending it.
func (s *Service) preview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body previewBody
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	lang := body.Language
	if _, ok := signWords[lang]; !ok {
		return validationFailed(map[string]string{"language": "Use de, fr, it or en."})
	}
	days := defaultExpiry
	if body.ExpiresInDays != nil && *body.ExpiresInDays >= 1 && *body.ExpiresInDays <= 365 {
		days = *body.ExpiresInDays
	}
	title := strings.TrimSpace(body.Title)
	req := store.SignatureRequest{WorkspaceID: sess.Workspace.ID, WorkspaceName: sess.Workspace.Name, Timezone: sess.Workspace.Timezone,
		Title: title, Message: body.Message, Language: &lang, ExpiresAt: s.now().AddDate(0, 0, days),
		CreatedBy: &store.Uploader{Name: sess.User.Name}, SenderEmail: sess.User.Email}
	text, err := s.emailText(r.Context(), req, false)
	if err != nil {
		return err
	}
	m := inviteMessage(req, store.Signer{}, s.publicURL+"/sign", false, text)
	var brand mail.Brand
	if s.brands != nil {
		if brand, err = s.brands(r.Context(), sess.Workspace.ID); err != nil {
			return err
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]string{"subject": m.Subject, "html": mail.Preview(m, brand, s.publicURL)}))
	return nil
}
func declinedMessage(req store.SignatureRequest, who store.Signer) mail.Message {
	l := mail.NewLetter("en").Lead("This request is closed. If you still need the signature, review the response before starting a new request.").
		Summary(mail.Row{Label: "Document", Value: req.Title}, mail.Row{Label: "Declined by", Value: short(who.Name) + " (" + who.Email + ")"},
			mail.Row{Label: "Reason", Value: deref(who.DeclineReason)})
	return mail.Message{Workspace: req.WorkspaceID, Members: true, To: []string{req.SenderEmail}, ReplyTo: who.Email,
		Subject: fmt.Sprintf("%s declined to sign “%s”", short(who.Name), req.Title), Eyebrow: "Declined", Tone: mail.Negative, Text: l.Text(), HTML: l.HTML()}
}

// completedMessage: the signed PDF for one recipient. The member who sent it gets the Helvetly copy (Members), with
// the hashes shortened in its details and the full values in a fine line; signers get them in full.
func completedMessage(done completed, to string, member bool) mail.Message {
	req := done.req
	rows := []mail.Row{{Label: "Document", Value: req.Title}, {Label: "Sent by", Value: sentBy(req)},
		{Label: "Signed copy", Value: done.name, Hint: "attached"}}
	if member {
		rows = append(rows, mail.Row{Label: "Signed SHA-256", Value: shortHash(done.sum)},
			mail.Row{Label: "Original SHA-256", Value: shortHash(req.OriginalSHA256)})
	}
	l := mail.NewLetter("en").Lead("Keep the attached signed PDF for your records. Its last page contains the certificate of completion.").
		Summary(rows...).
		Details(mail.Row{Label: "SHA-256 of the signed PDF", Value: groups(done.sum)}, mail.Row{Label: "SHA-256 of the original", Value: groups(req.OriginalSHA256)}).
		FinePrint(sesNote)
	return mail.Message{Workspace: req.WorkspaceID, Members: member, Language: "en", To: []string{to}, ReplyTo: req.SenderEmail,
		Subject: fmt.Sprintf("Signed: “%s”", req.Title), Eyebrow: "Completed", Tone: mail.Positive, Text: l.Text(), HTML: l.HTML(),
		Attachments: []mail.Attachment{{Name: done.name, ContentType: "application/pdf", Data: done.pdf}}}
}

// shortHash: the first and last 8 characters of a hash, enough to recognise it.
func shortHash(sum string) string {
	if len(sum) <= 20 {
		return sum
	}
	return sum[:8] + "…" + sum[len(sum)-8:]
}

// groups splits a hash into blocks of 16 so it wraps on a phone; the certificate in the PDF has it whole.
func groups(hash string) string {
	var parts []string
	for len(hash) > 16 {
		parts, hash = append(parts, hash[:16]), hash[16:]
	}
	return strings.Join(append(parts, hash), " ")
}
