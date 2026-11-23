package templates

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/store"
)

type generateBody struct {
	ClientID string            `json:"client_id"`
	QuoteID  string            `json:"quote_id"` // optional: the quote the document is the contract of
	Title    string            `json:"title"`
	Values   map[string]string `json:"values"`
	Delivery struct {
		Type          string                   `json:"type"`
		To            string                   `json:"to"` // one address, or several separated by commas
		Cc            []string                 `json:"cc"`
		Bcc           []string                 `json:"bcc"`
		Subject       *string                  `json:"subject"`
		Message       *string                  `json:"message"`
		Language      *string                  `json:"language"` // of the email; none: the English email of before templates
		Signers       []signatures.SignerInput `json:"signers"`
		SigningOrder  string                   `json:"signing_order"`
		ExpiresInDays *int                     `json:"expires_in_days"`
	} `json:"delivery"`
}

type generated struct {
	Document           store.FolderRef `json:"document"`
	SignatureRequestID *string         `json:"signature_request_id"`
	EmailedTo          *string         `json:"emailed_to"`
	ContractNumber     *string         `json:"contract_number"` // a quote's contract: its number, also its file name
}

// value: a stamped value (empty allowed), or why it can't be used.
func value(v string) (string, string) {
	v = strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n"))
	switch {
	case utf8.RuneCountInString(v) > maxValueLen:
		return "", fmt.Sprintf("Use at most %d characters.", maxValueLen)
	case strings.ContainsFunc(v, func(r rune) bool { return unicode.IsControl(r) && r != '\n' }):
		return "", "Remove the control characters."
	}
	return v, ""
}

// signing: the signature request a template's signing fields make for the given signers.
func signing(t store.Template, b generateBody, title, documentID string) signatures.CreateBody {
	body := signatures.CreateBody{DocumentID: documentID, Title: title, Message: b.Delivery.Message,
		SigningOrder: b.Delivery.SigningOrder, ExpiresInDays: b.Delivery.ExpiresInDays, Signers: b.Delivery.Signers}
	for _, f := range t.Fields {
		if f.Signer != nil {
			body.Fields = append(body.Fields, signatures.FieldInput{Signer: *f.Signer, Page: f.Page, Kind: f.Kind, X: f.X, Y: f.Y,
				W: f.W, H: f.H, Label: f.Label})
		}
	}
	return body
}

// generate fills the template for a client and files it in Documents in one transaction, then delivers it.
func (s *Service) generate(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, ws := r.Context(), sess.Workspace.ID
	t, err := s.db.Template(ctx, ws, r.PathValue("id"))
	if err != nil {
		return err
	}
	var b generateBody
	if !s.auth.Decode(w, r, &b) {
		return nil
	}
	bad := map[string]string{}
	title, msg := signatures.PlainText(b.Title, maxNameLen)
	if msg != "" {
		bad["title"] = msg
	}
	if ok, err := s.db.LinkTargetExists(ctx, ws, "client", b.ClientID); err != nil {
		return err
	} else if !ok {
		bad["client_id"] = "Choose a client."
	}
	if b.QuoteID != "" {
		quote, err := s.db.Quote(ctx, ws, b.QuoteID, s.now().Format(time.DateOnly), false)
		switch {
		case errors.Is(err, store.ErrNotFound):
			bad["quote_id"] = "Choose a quote of this workspace."
		case err != nil:
			return err
		case quote.ClientID != b.ClientID:
			bad["quote_id"] = "The quote is for another client."
		}
	}

	var texts []signpdf.Text
	known := map[string]bool{}
	for _, f := range t.Fields {
		if !isData(f.Kind) {
			continue
		}
		known[f.ID] = true
		key := "values." + f.ID
		raw, sent := b.Values[f.ID]
		v, msg := value(raw)
		switch {
		case !sent:
			bad[key] = "Send a value for this field, empty to leave it blank."
		case msg != "":
			bad[key] = msg
		case v == "" && f.Kind == "custom":
			bad[key] = "Fill in " + deref(f.Label) + "."
		}
		text := signpdf.Text{Page: f.Page, X: f.X, Y: f.Y, W: f.W, H: f.H, Value: v, AutoFit: f.AutoFit, Align: f.Align}
		if f.FontSize != nil {
			text.Size = *f.FontSize
		}
		texts = append(texts, text)
	}
	for id := range b.Values {
		if !known[id] {
			bad["values"] = "Send values only for the template's client data fields."
		}
	}

	d := b.Delivery
	var to, cc, bcc []string
	switch d.Type {
	case "save":
	case "email":
		for _, list := range []struct {
			key  string
			in   []string
			into *[]string
		}{{"delivery.to", strings.FieldsFunc(d.To, func(r rune) bool { return r == ',' || r == ';' }), &to},
			{"delivery.cc", d.Cc, &cc}, {"delivery.bcc", d.Bcc, &bcc}} {
			if msg := addresses(list.in, list.into); msg != "" {
				bad[list.key] = msg
			}
		}
		if len(to) == 0 && bad["delivery.to"] == "" {
			bad["delivery.to"] = "Enter an email address such as ana@example.com."
		}
		if d.Language != nil && !slices.Contains(emailtemplate.Languages, *d.Language) {
			bad["delivery.language"] = "Use de, fr, it or en."
		}
		if d.Subject != nil && strings.TrimSpace(*d.Subject) != "" {
			v, msg := signatures.PlainText(*d.Subject, maxNameLen)
			if msg == "" && strings.Contains(v, "\n") {
				msg = "Keep the subject on one line."
			}
			if msg != "" {
				bad["delivery.subject"] = msg
			}
			d.Subject = &v
		} else {
			d.Subject = nil
		}
		if d.Message != nil && strings.TrimSpace(*d.Message) != "" {
			v, msg := signatures.PlainText(*d.Message, maxMessageLen)
			if msg != "" {
				bad["delivery.message"] = msg
			}
			d.Message = &v
		} else {
			d.Message = nil
		}
	case "signature":
		if err := s.db.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureSimpleSignatures); err != nil {
			return err // before the document is stored
		}
		switch {
		case len(t.Signers) == 0:
			bad["delivery.type"] = "This template has no signers: save or email the document."
		case len(d.Signers) != len(t.Signers):
			bad["delivery.signers"] = fmt.Sprintf("Add one signer per role: %d.", len(t.Signers))
		default:
			for k, v := range signatures.CheckSending(signing(t, b, title, "")) {
				if k != "title" {
					bad["delivery."+k] = v
				}
			}
		}
	default:
		bad["delivery.type"] = "Use save, email or signature."
	}

	// The PDF as it is now: changing the file in Documents changes the template.
	var original []byte
	pages := 0
	if t.Document == nil {
		bad["document_id"] = "The template's PDF was deleted: choose another one in the template."
	} else if original, pages, msg, err = s.pdf(ctx, ws, t.Document.ID); err != nil {
		return err
	} else if msg != "" {
		bad["document_id"] = msg
	}
	for _, f := range t.Fields {
		if pages > 0 && f.Page > pages {
			bad["document_id"] = fmt.Sprintf("The PDF now has %d pages: place the template's fields again.", pages)
		}
	}
	if len(bad) > 0 {
		return validationFailed(bad)
	}
	if d.Type == "signature" && s.mail == nil {
		return errMailUnavailable // before filing: nothing could be sent
	}

	filled, err := signpdf.Fill(original, texts, title)
	if err != nil {
		return fmt.Errorf("fill %s: %w", t.ID, err)
	}
	sum := sha256.Sum256(filled)
	now := s.now()
	file := store.ClientFile{ID: auth.NewID("doc"), Name: fileName(title) + ".pdf", Size: int64(len(filled)),
		ContentType: "application/pdf", SHA256: hex.EncodeToString(sum[:]), CreatedAt: now}
	file.ObjectKey = "workspaces/" + ws + "/documents/" + file.ID + "/filled.pdf"
	contractNumber := ""
	// stored before the transaction, so no row lock waits on the upload; no row points at it until the commit
	if err := s.db.ReserveObject(ctx, ws, file.ObjectKey, file.Size, true, now); err != nil {
		return err
	}
	if err := s.files.Put(ctx, file.ObjectKey, bytes.NewReader(filled), file.Size, file.ContentType, file.Name); err != nil {
		return err
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		found, err := q.LockClient(ctx, ws, b.ClientID)
		if err != nil {
			return err
		}
		if !found {
			return validationFailed(map[string]string{"client_id": "Choose a client."})
		}
		if b.QuoteID != "" {
			// numbered in the transaction that files it, so a failed contract leaves no gap
			seq, err := q.NextContractNumber(ctx, ws, now.Year())
			if err != nil {
				return err
			}
			if contractNumber, err = s.contractNumber(ctx, q, ws, now.Format(time.DateOnly), seq); err != nil {
				return err
			}
			file.Name, file.Contract = fileName(contractNumber)+".pdf", true
		}
		if err := q.CreateClientFile(ctx, ws, b.ClientID, sess.User.ID, &file); err != nil {
			return err
		}
		if b.QuoteID != "" {
			if err := q.AddQuoteContract(ctx, ws, b.QuoteID, file.ID, contractNumber, t.ID, sess.User.ID, now); err != nil {
				return err
			}
		}
		return q.UseTemplate(ctx, ws, t.ID, now)
	})
	if err != nil {
		if err := s.files.Delete(context.WithoutCancel(ctx), file.ObjectKey); err != nil {
			s.log.ErrorContext(ctx, "remove filled template", "key", file.ObjectKey, "error", err)
		}
		return err
	}

	out := generated{Document: store.FolderRef{ID: file.ID, Name: file.Name}}
	if contractNumber != "" {
		out.ContractNumber = &contractNumber
	}
	switch d.Type {
	case "email":
		if s.mail == nil {
			return errMailUnavailable // the document stays in Documents
		}
		m, err := s.emailMessage(ctx, sess, d.Language, d.Subject, d.Message, title, file.Name, filled)
		if err != nil {
			return err
		}
		m.To = to
		m.Cc, m.Bcc = mail.Copies(to, cc, bcc)
		if err := s.mail.Send(ctx, m); err != nil {
			s.log.ErrorContext(ctx, "email filled template", "template", t.ID, "document", file.ID, "error", err)
			return auth.Error(http.StatusServiceUnavailable, "mail_failed",
				"The document is in Documents, but the email could not be sent. Try again in a minute.", map[string]any{"document_id": file.ID})
		}
		list := strings.Join(to, ", ")
		out.EmailedTo = &list
	case "signature":
		id, err := s.sign.Create(r, sess, signing(t, b, title, file.ID))
		if err != nil {
			return err // the document stays in Documents
		}
		out.SignatureRequestID = &id
	}
	auth.WriteJSON(w, http.StatusCreated, data(out))
	return nil
}

// fileName: a title as a file name ("/" and "\" are not allowed there).
func fileName(title string) string {
	return strings.NewReplacer("/", "-", `\`, "-").Replace(title)
}

// addresses normalises a list of email addresses into into (at most 10); the message says what is wrong.
func addresses(in []string, into *[]string) string {
	for _, a := range in {
		if strings.TrimSpace(a) == "" {
			continue
		}
		v, msg := clients.NormaliseEmail(strings.TrimSpace(a))
		if msg != "" {
			return "Enter email addresses such as ana@example.com."
		}
		if !slices.Contains(*into, v) {
			*into = append(*into, v)
		}
	}
	if len(*into) > 10 {
		return "Use at most 10 addresses."
	}
	return ""
}

// emailMessage is the email that sends a filled template. With a language, the subject and message the sender wrote
// (else the workspace's "document" template) go out as they are; without, the English email of before templates.
func (s *Service) emailMessage(ctx context.Context, sess store.Session, language, subject, message *string, title, name string, pdf []byte) (mail.Message, error) {
	from := strings.TrimSpace(sess.User.Name)
	if from == "" {
		from = sess.User.Email
	}
	attachments := []mail.Attachment{{Name: name, ContentType: "application/pdf", Data: pdf}}
	if language != nil {
		t, err := emailtemplate.Lookup(ctx, s.db.Q, sess.Workspace.ID, "document", *language)
		if err != nil {
			return mail.Message{}, err
		}
		r := emailtemplate.Render(t, map[string]string{"document": title, "sender": from, "company": sess.Workspace.Name})
		if subject != nil {
			r.Subject = *subject
		}
		if message != nil {
			r.Body = *message
		}
		m := documentEmail(sess.Workspace.ID, *language, r)
		m.ReplyTo, m.Attachments = sess.User.Email, attachments
		return m, nil
	}
	lead := fmt.Sprintf("%s (%s) sent you “%s”. The PDF is attached.", from, sess.Workspace.Name, title)
	text := "Hello,\n\n" + lead + "\n"
	body := "<p>Hello,</p>\n<p>" + html.EscapeString(lead) + "</p>\n"
	if message != nil {
		text += "\n" + *message + "\n"
		body += "<p>" + strings.ReplaceAll(html.EscapeString(*message), "\n", "<br>") + "</p>\n"
	}
	return mail.Message{Workspace: sess.Workspace.ID, Language: "en", ReplyTo: sess.User.Email, Subject: fmt.Sprintf("%s sent you “%s”", from, title),
		Text: text, HTML: body, Attachments: attachments}, nil
}

// documentEmail is a document email's subject and message as a message: one paragraph per blank-line block.
func documentEmail(workspaceID, language string, t emailtemplate.Template) mail.Message {
	var body strings.Builder
	for _, p := range strings.Split(strings.TrimSpace(t.Body), "\n\n") {
		if p = strings.TrimSpace(p); p != "" {
			body.WriteString("<p>" + strings.ReplaceAll(html.EscapeString(p), "\n", "<br>") + "</p>\n")
		}
	}
	return mail.Message{Workspace: workspaceID, Language: language, Subject: t.Subject, Text: t.Body + "\n", HTML: body.String()}
}

// previewBody is POST /templates/email-preview: the email as the send step has it so far.
type previewBody struct {
	Title    string `json:"title"`
	Subject  string `json:"subject"`
	Message  string `json:"message"`
	Language string `json:"language"`
}

// preview answers the HTML a client would get for the email being written, without sending it.
func (s *Service) preview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var b previewBody
	if !s.auth.Decode(w, r, &b) {
		return nil
	}
	if !slices.Contains(emailtemplate.Languages, b.Language) {
		return validationFailed(map[string]string{"language": "Use de, fr, it or en."})
	}
	given := func(v string) *string {
		if strings.TrimSpace(v) == "" {
			return nil
		}
		return &v
	}
	m, err := s.emailMessage(r.Context(), sess, &b.Language, given(b.Subject), given(b.Message), strings.TrimSpace(b.Title), "", nil)
	if err != nil {
		return err
	}
	var brand mail.Brand
	if s.brands != nil {
		if brand, err = s.brands(r.Context(), sess.Workspace.ID); err != nil {
			return err
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]string{"subject": m.Subject, "html": mail.Preview(m, brand, s.publicURL)}))
	return nil
}
