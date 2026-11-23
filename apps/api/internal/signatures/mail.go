package signatures

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/emailtemplate"
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
	var subject string
	var lead []string
	if req.Language != nil {
		r := emailtemplate.Render(text, map[string]string{"document": req.Title, "sender": short(senderOf(req).Name), "company": company})
		subject, lead = r.Subject, strings.Split(r.Body, "\n\n")
		if !reminder && req.Message != nil {
			lead = strings.Split(*req.Message, "\n\n")
		}
	} else {
		subject = fmt.Sprintf("%s asks you to sign “%s”", company, req.Title)
		if reminder {
			subject = "Reminder: " + subject
		}
		lead = []string{"Hello " + short(to.Name) + ",", fmt.Sprintf("%s asks you to review and sign “%s”.", company, req.Title), quoted(req.Message)}
	}
	rows := [][2]string{{w.document, req.Title}, {w.sentBy, sentBy(req)}, {w.signBy, req.ExpiresAt.In(zone(req)).Format(w.date)}}
	return mail.Message{Workspace: req.WorkspaceID, Language: language, To: []string{to.Email}, Subject: subject, ReplyTo: req.SenderEmail,
		Text: strings.Join(slices.DeleteFunc(lead, func(l string) bool { return l == "" }), "\n\n") + "\n\n" + mail.DetailsText(rows...) +
			fmt.Sprintf("\n%s\n%s\n\n%s\n%s\n", w.button, link, w.personal, w.ses),
		HTML: paragraphs(lead...) + mail.Details(rows...) + mail.Button(w.button, link) + fine(w.personal, w.ses)}
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
	lead := fmt.Sprintf("%s declined to sign “%s”, so the request has stopped.", short(who.Name), req.Title)
	rows := [][2]string{{"Document", req.Title}, {"Declined by", short(who.Name) + " (" + who.Email + ")"}, {"Reason", deref(who.DeclineReason)}}
	return mail.Message{Workspace: req.WorkspaceID, Members: true, To: []string{req.SenderEmail}, ReplyTo: who.Email,
		Subject: fmt.Sprintf("%s declined to sign “%s”", short(who.Name), req.Title),
		Text:    fmt.Sprintf("Hello,\n\n%s\n\n%s", lead, mail.DetailsText(rows...)), HTML: paragraphs("Hello,", lead) + mail.Details(rows...)}
}

func completedMessage(done completed, to string) mail.Message {
	req := done.req
	lead := fmt.Sprintf("Everyone has signed “%s”. The signed PDF is attached, with a certificate of completion on its last page.", req.Title)
	rows := [][2]string{{"Document", req.Title}, {"Sent by", sentBy(req)}, {"Signed copy", done.name + " (attached)"}}
	hashes := fmt.Sprintf("SHA-256 of the signed PDF: %s\nSHA-256 of the original: %s", done.sum, req.OriginalSHA256)
	return mail.Message{Workspace: req.WorkspaceID, Language: "en", To: []string{to}, ReplyTo: req.SenderEmail,
		Subject: fmt.Sprintf("Signed: “%s”", req.Title),
		Text:    fmt.Sprintf("Hello,\n\n%s\n\n%s\n%s\n\n%s\n", lead, mail.DetailsText(rows...), hashes, sesNote),
		HTML: paragraphs("Hello,", lead) + mail.Details(rows...) +
			`<p style="font-size:12px;color:#78716c;font-family:ui-monospace,Menlo,Consolas,monospace">` +
			strings.ReplaceAll(html.EscapeString(hashes), "\n", "<br>") + "</p>" + fine(sesNote),
		Attachments: []mail.Attachment{{Name: done.name, ContentType: "application/pdf", Data: done.pdf}}}
}
