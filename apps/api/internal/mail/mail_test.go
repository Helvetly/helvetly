package mail

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestBuild(t *testing.T) {
	from := &mail.Address{Name: "Helvetly", Address: "no-reply@helvetly.local"}
	raw := build(from, Message{To: []string{"ana@example.com\r\nBcc: evil@example.com"}, Subject: "123456 is your code – ok",
		Text: "Code: 123456\n", HTML: "<p>123456</p>"}, "https://app.example.com", time.Now())

	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Header.Get("Bcc") != "" {
		t.Fatal("a header was injected through To")
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || subject != "123456 is your code – ok" {
		t.Fatalf("subject = %q, %v", subject, err)
	}
	_, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	r := multipart.NewReader(msg.Body, params["boundary"])
	for _, want := range []struct{ ct, body string }{{"text/plain; charset=utf-8", "Code: 123456\r\n"}, {"text/html; charset=utf-8", "<p>123456</p>"}} {
		p, err := r.NextPart() // decodes quoted-printable
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(p)
		if p.Header.Get("Content-Type") != want.ct || !strings.Contains(string(body), want.body) {
			t.Fatalf("part %q = %q, want %q %q", p.Header.Get("Content-Type"), body, want.ct, want.body)
		}
	}
}

func TestLayout(t *testing.T) {
	const site = "https://app.example.com"
	for _, c := range []struct {
		name string
		m    Message
		want []string
	}{
		{"fragment", Message{Subject: "Hi <you>", HTML: "<p>Hi</p>"}, []string{"<!doctype html>", "<title>Hi &lt;you&gt;</title>",
			`<a href="https://app.example.com" style="color:#18181b;font-size:20px"><strong>Helvetly</strong></a>`, "<p>Hi</p>",
			`Sent by <a href="https://app.example.com"`}},
		{"footer, and links in the brand colour", Message{HTML: `<p><a href="y">Go</a></p>`, Footer: "Why <a href=\"x\">you</a>"},
			[]string{`<a style="color:#0b7268" href="y">Go</a>`, "Why <a href=\"x\">you</a></td>"}},
	} {
		got := layout(c.m, site)
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("%s: no %q in %s", c.name, w, got)
			}
		}
	}
	for _, own := range []string{"", "<!DOCTYPE html><p>Own</p>"} {
		if got := layout(Message{HTML: own}, site); got != own {
			t.Fatalf("layout(%q) = %q", own, got)
		}
	}
}

func TestButton(t *testing.T) {
	got := Button("Review <now>", "https://x.example/a?b=1&c=2")
	for _, w := range []string{`href="https://x.example/a?b=1&amp;c=2"`, ">Review &lt;now&gt;</a></strong>", `<a style="color:#0b7268" href=`} {
		if !strings.Contains(got, w) {
			t.Errorf("no %q in %s", w, got)
		}
	}
}

func TestBuildAttachment(t *testing.T) {
	from := &mail.Address{Name: "Helvetly", Address: "no-reply@helvetly.local"}
	pdf := bytes.Repeat([]byte("%PDF-1.4 "), 20)
	raw := build(from, Message{To: []string{"a@example.com", "b@example.com"}, Cc: []string{"c@example.com"}, ReplyTo: "seller@example.com",
		Subject: "Rechnung 2026-001", Text: "Hallo", HTML: "<p>Hallo</p>",
		Attachments: []Attachment{{Name: "Rechnung 2026-001.pdf", ContentType: "application/pdf", Data: pdf}}}, "https://app.example.com", time.Now())
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Header.Get("To") != "a@example.com, b@example.com" || msg.Header.Get("Cc") != "c@example.com" ||
		msg.Header.Get("Reply-To") != "seller@example.com" {
		t.Fatalf("headers %v", msg.Header)
	}
	_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	r := multipart.NewReader(msg.Body, params["boundary"])
	alt, err := r.NextPart()
	if err != nil || !strings.HasPrefix(alt.Header.Get("Content-Type"), "multipart/alternative") {
		t.Fatalf("first part %v %v", alt, err)
	}
	att, err := r.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(base64.NewDecoder(base64.StdEncoding, att))
	if att.FileName() != "Rechnung 2026-001.pdf" || !bytes.Equal(body, pdf) {
		t.Fatalf("attachment %q: %d bytes", att.FileName(), len(body))
	}
}

func TestBuildListUnsubscribe(t *testing.T) {
	from := &mail.Address{Address: "no-reply@helvetly.local"}
	for _, c := range []struct{ url, want, post string }{
		{"", "", ""},
		{"https://x.example/u?token=a\r\nBcc: evil@example.com", "<https://x.example/u?token=a  Bcc: evil@example.com>", "List-Unsubscribe=One-Click"},
	} {
		msg, err := mail.ReadMessage(bytes.NewReader(build(from, Message{To: []string{"a@example.com"}, ListUnsubscribe: c.url}, "https://app.example.com", time.Now())))
		if err != nil {
			t.Fatal(err)
		}
		if msg.Header.Get("List-Unsubscribe") != c.want || msg.Header.Get("List-Unsubscribe-Post") != c.post || msg.Header.Get("Bcc") != "" {
			t.Fatalf("%q: headers %v", c.url, msg.Header)
		}
	}
}

// A user-typed document title becomes the attachment name: its quotes and backslashes stay inside the parameter.
func TestBuildAttachmentNameQuoted(t *testing.T) {
	from := &mail.Address{Address: "no-reply@helvetly.local"}
	const name = `Offer "A" \ final – signed.pdf`
	raw := build(from, Message{To: []string{"a@example.com"}, Text: "x",
		Attachments: []Attachment{{Name: name, ContentType: "application/pdf", Data: []byte("%PDF")}}}, "https://app.example.com", time.Now())
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	r := multipart.NewReader(msg.Body, params["boundary"])
	if _, err := r.NextPart(); err != nil {
		t.Fatal(err)
	}
	att, err := r.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	_, disp, err := mime.ParseMediaType(att.Header.Get("Content-Disposition"))
	if err != nil {
		t.Fatalf("Content-Disposition %q: %v", att.Header.Get("Content-Disposition"), err)
	}
	got, err := new(mime.WordDecoder).DecodeHeader(disp["filename"])
	if err != nil || got != name {
		t.Fatalf("filename = %q (%v), want %q", got, err, name)
	}
}

// Subject, Reply-To and Cc carry user-typed text (report summaries, seller addresses): no CR or LF starts a header.
func TestBuildNoHeaderInjection(t *testing.T) {
	from := &mail.Address{Address: "no-reply@helvetly.local"}
	evil := "x\r\nBcc: evil@example.com\nX-Evil: 1"
	raw := build(from, Message{To: []string{"a@example.com"}, Cc: []string{evil}, ReplyTo: evil, Subject: evil, Text: "x",
		Attachments: []Attachment{{Name: evil, ContentType: "application/pdf", Data: []byte("%PDF")}}}, "https://app.example.com", time.Now())
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Header.Get("Bcc") != "" || msg.Header.Get("X-Evil") != "" || bytes.Contains(raw, []byte("\r\nX-Evil")) || bytes.Contains(raw, []byte("\nBcc")) {
		t.Fatalf("a header was injected: %v", msg.Header)
	}
}
