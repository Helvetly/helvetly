package templates

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/store"
)

type generateBody struct {
	ClientID string            `json:"client_id"`
	Title    string            `json:"title"`
	Values   map[string]string `json:"values"`
	Delivery struct {
		Type          string                   `json:"type"`
		To            string                   `json:"to"`
		Message       *string                  `json:"message"`
		Signers       []signatures.SignerInput `json:"signers"`
		SigningOrder  string                   `json:"signing_order"`
		ExpiresInDays *int                     `json:"expires_in_days"`
	} `json:"delivery"`
}

type generated struct {
	Document           store.FolderRef `json:"document"`
	SignatureRequestID *string         `json:"signature_request_id"`
	EmailedTo          *string         `json:"emailed_to"`
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
		texts = append(texts, signpdf.Text{Page: f.Page, X: f.X, Y: f.Y, W: f.W, H: f.H, Value: v})
	}
	for id := range b.Values {
		if !known[id] {
			bad["values"] = "Send values only for the template's client data fields."
		}
	}

	d := b.Delivery
	var to string
	switch d.Type {
	case "save":
	case "email":
		if to, msg = clients.NormaliseEmail(strings.TrimSpace(d.To)); msg != "" {
			bad["delivery.to"] = "Enter an email address such as ana@example.com."
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
	// stored before the transaction, so no row lock waits on the upload; no row points at it until the commit
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
		if err := q.CreateClientFile(ctx, ws, b.ClientID, sess.User.ID, &file); err != nil {
			return err
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
	switch d.Type {
	case "email":
		if s.mail == nil {
			return errMailUnavailable // the document stays in Documents
		}
		if err := s.mail.Send(ctx, emailMessage(sess, to, title, d.Message, file.Name, filled)); err != nil {
			s.log.ErrorContext(ctx, "email filled template", "template", t.ID, "document", file.ID, "error", err)
			return auth.Error(http.StatusServiceUnavailable, "mail_failed",
				"The document is in Documents, but the email could not be sent. Try again in a minute.", map[string]any{"document_id": file.ID})
		}
		out.EmailedTo = &to
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

func emailMessage(sess store.Session, to, title string, message *string, name string, pdf []byte) mail.Message {
	from := strings.TrimSpace(sess.User.Name)
	if from == "" {
		from = sess.User.Email
	}
	lead := fmt.Sprintf("%s (%s) sent you “%s”. The PDF is attached.", from, sess.Workspace.Name, title)
	text := "Hello,\n\n" + lead + "\n"
	body := "<p>Hello,</p>\n<p>" + html.EscapeString(lead) + "</p>\n"
	if message != nil {
		text += "\n" + *message + "\n"
		body += "<p>" + strings.ReplaceAll(html.EscapeString(*message), "\n", "<br>") + "</p>\n"
	}
	return mail.Message{To: []string{to}, ReplyTo: sess.User.Email, Subject: fmt.Sprintf("%s sent you “%s”", from, title),
		Text: text, HTML: body, Attachments: []mail.Attachment{{Name: name, ContentType: "application/pdf", Data: pdf}}}
}
