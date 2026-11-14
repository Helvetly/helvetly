// Package mail sends the server's own email over SMTP: STARTTLS, implicit TLS or (for a local relay such as
// Mailpit) plaintext, as multipart text + HTML.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/config"
)

type Message struct {
	To, Cc              []string
	ReplyTo             string // optional
	Subject, Text, HTML string
	Attachments         []Attachment
	ListUnsubscribe     string // optional: the one-click unsubscribe URL (RFC 8058)
	Preview             string // optional: the inbox preview line, hidden in the HTML
	Footer              string // optional HTML under the card, such as why the email came; else "Sent by Helvetly"
}

type Attachment struct {
	Name, ContentType string
	Data              []byte
}

type Sender struct {
	cfg       config.SMTP
	publicURL string // hosts the logo, and the footer links to it
}

func NewSender(cfg config.SMTP, publicURL string) *Sender {
	return &Sender{cfg: cfg, publicURL: publicURL}
}

func (s *Sender) Send(ctx context.Context, m Message) error {
	c := s.cfg
	from, err := mail.ParseAddress(c.From)
	if err != nil {
		return fmt.Errorf("MAIL_FROM: %w", err)
	}
	raw := build(from, m, s.publicURL, time.Now())

	dialer := &net.Dialer{Timeout: 15 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(c.Host, strconv.Itoa(c.Port)))
	if err != nil {
		return fmt.Errorf("smtp connect: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(45 * time.Second))
	tlsCfg := &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12}
	if c.TLS == "tls" {
		tc := tls.Client(conn, tlsCfg)
		if err := tc.HandshakeContext(ctx); err != nil {
			return fmt.Errorf("smtp tls: %w", err)
		}
		conn = tc
	}
	cl, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		return fmt.Errorf("smtp: %w", err)
	}
	defer cl.Close()
	if err := cl.Hello("helvetly"); err != nil {
		return fmt.Errorf("smtp hello: %w", err)
	}
	if c.TLS == "starttls" {
		if ok, _ := cl.Extension("STARTTLS"); !ok {
			return errors.New("smtp server does not offer STARTTLS (SMTP_TLS=none only for a trusted local relay)")
		}
		if err := cl.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if c.Username != "" {
		// PlainAuth refuses to send credentials over an unencrypted connection (except to localhost).
		if err := cl.Auth(smtp.PlainAuth("", c.Username, c.Password, c.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := cl.Mail(from.Address); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	for _, rcpt := range append(slices.Clone(m.To), m.Cc...) {
		if err := cl.Rcpt(rcpt); err != nil {
			return fmt.Errorf("smtp RCPT TO: %w", err)
		}
	}
	w, err := cl.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: %w", err)
	}
	_ = cl.Quit()
	return nil
}

// headerSafe: no CR or LF from a value can start a header of its own.
func headerSafe(v string) string { return strings.NewReplacer("\r", " ", "\n", " ").Replace(v) }

func build(from *mail.Address, m Message, publicURL string, now time.Time) []byte {
	var b bytes.Buffer
	boundary := "helvetly-" + rand.Text()
	hdr := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	hdr("From", from.String())
	hdr("To", headerSafe(strings.Join(m.To, ", ")))
	if len(m.Cc) > 0 {
		hdr("Cc", headerSafe(strings.Join(m.Cc, ", ")))
	}
	if m.ReplyTo != "" {
		hdr("Reply-To", headerSafe(m.ReplyTo))
	}
	hdr("Subject", mime.QEncoding.Encode("utf-8", headerSafe(m.Subject)))
	hdr("Date", now.UTC().Format(time.RFC1123Z))
	domain := "helvetly.local"
	if _, d, ok := strings.Cut(from.Address, "@"); ok {
		domain = d
	}
	hdr("Message-ID", "<"+rand.Text()+"@"+domain+">")
	hdr("Auto-Submitted", "auto-generated")
	if m.ListUnsubscribe != "" {
		hdr("List-Unsubscribe", "<"+headerSafe(m.ListUnsubscribe)+">")
		hdr("List-Unsubscribe-Post", "List-Unsubscribe=One-Click")
	}
	hdr("MIME-Version", "1.0")
	mixed := "helvetly-mixed-" + rand.Text()
	if len(m.Attachments) > 0 {
		hdr("Content-Type", `multipart/mixed; boundary="`+mixed+`"`)
		fmt.Fprintf(&b, "\r\n--%s\r\nContent-Type: multipart/alternative; boundary=\"%s\"\r\n", mixed, boundary)
	} else {
		hdr("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	}
	b.WriteString("\r\n")
	for _, part := range []struct{ ct, body string }{{"text/plain", m.Text}, {"text/html", layout(m, publicURL)}} {
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", boundary, part.ct)
		qp := quotedprintable.NewWriter(&b)
		_, _ = qp.Write([]byte(strings.ReplaceAll(part.body, "\n", "\r\n")))
		_ = qp.Close()
		b.WriteString("\r\n")
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	if len(m.Attachments) == 0 {
		return b.Bytes()
	}
	for _, a := range m.Attachments {
		// a quoted-string parameter: a quote or backslash from a typed title must not end it
		name := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(mime.QEncoding.Encode("utf-8", headerSafe(a.Name)))
		fmt.Fprintf(&b, "\r\n--%s\r\nContent-Type: %s; name=\"%s\"\r\nContent-Disposition: attachment; filename=\"%s\"\r\n"+
			"Content-Transfer-Encoding: base64\r\n\r\n", mixed, a.ContentType, name, name)
		enc := base64.StdEncoding.EncodeToString(a.Data)
		for len(enc) > 76 {
			b.WriteString(enc[:76] + "\r\n")
			enc = enc[76:]
		}
		b.WriteString(enc + "\r\n")
	}
	fmt.Fprintf(&b, "--%s--\r\n", mixed)
	return b.Bytes()
}
