package mail

import (
	"bytes"
	"encoding/base64"
	"fmt"
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
			`<img src="https://app.example.com/email-logo.png"`, ">Helvetly</strong></a>", ">Hi &lt;you&gt;</h1>", "<p>Hi</p>", "linear-gradient(",
			`bgcolor="#ffffff" style="width:100%;background-color:#ffffff">`, ">Helvetly</strong> &middot; The online back office",
			`<a href="https://www.helvetly.com/privacy" style="color:#71717a">Privacy</a>`, `>Terms</a></td>`}},
		{"footer, and links and buttons in Helvetly's colours", Message{HTML: `<p><a href="y">Go</a></p>` + Button("Open", "z"), Footer: "Why <a href=\"x\">you</a>"},
			[]string{`<a style="color:#0f766e" href="y">Go</a>`, `bgcolor="#0f766e" style="background-color:#0f766e;border-radius`, "Why <a href=\"x\">you</a><br><a href=\"https://www.helvetly.com/help\""}},
		{"an eyebrow above the title, the same word dropped from it", Message{Subject: "Invitation: Coaching", Eyebrow: "Invitation", HTML: "<p>x</p>"},
			[]string{">Invitation</td></tr></table>\n<h1", ">Coaching</h1>"}},
		{"a fragment with its own title keeps it", Message{Subject: "Subject", HTML: "<h1>Own</h1>"}, []string{"<h1>Own</h1>"}},
		{"a business: neutral, its logo", Message{Subject: "S", HTML: `<p><a href="y">Go</a></p>` + Button("Open", "z"), Brand: &Brand{Name: "Muster", LogoPath: "/l"}},
			[]string{`<a style="color:#18181b" href="y">Go</a>`, buttonFill, `<img src="https://app.example.com/l" alt="" style="vertical-align:middle;border:0">&nbsp;&nbsp;<strong`,
				">Muster</strong></td>", `bgcolor="#52525b" style="height:3px`}},
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

func TestBuildCalendar(t *testing.T) {
	from := &mail.Address{Name: "Helvetly", Address: "no-reply@helvetly.local"}
	ics := "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n"
	raw := build(from, Message{To: []string{"a@example.com"}, Subject: "Invitation", Text: "Hi", HTML: "<p>Hi</p>",
		Calendar: []byte(ics), CalendarMethod: "REQUEST",
		Attachments: []Attachment{{Name: "invite.ics", ContentType: "application/ics", Data: []byte(ics)}}}, "https://app.example.com", time.Now())
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	alt, err := multipart.NewReader(msg.Body, params["boundary"]).NextPart()
	if err != nil {
		t.Fatal(err)
	}
	_, altParams, _ := mime.ParseMediaType(alt.Header.Get("Content-Type"))
	r := multipart.NewReader(alt, altParams["boundary"])
	var types []string
	var calendar string
	for {
		p, err := r.NextPart()
		if err != nil {
			break
		}
		types = append(types, p.Header.Get("Content-Type"))
		body, _ := io.ReadAll(p)
		calendar = string(body)
	}
	if strings.Join(types, " | ") != "text/plain; charset=utf-8 | text/html; charset=utf-8 | text/calendar; method=REQUEST; charset=utf-8" {
		t.Fatalf("alternative parts %q", types)
	}
	if calendar != ics {
		t.Fatalf("calendar part %q, want %q (CRLF kept, not doubled)", calendar, ics)
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

// TestBuildHidesBcc: a hidden copy is never in the message the recipients get, To and Cc are.
func TestBuildHidesBcc(t *testing.T) {
	from := &mail.Address{Name: "Helvetly", Address: "no-reply@helvetly.local"}
	for _, tc := range []struct {
		name   string
		msg    Message
		wantCc string
	}{
		{"bcc only", Message{To: []string{"a@x.ch"}, Bcc: []string{"secret@x.ch"}}, ""},
		{"cc and bcc", Message{To: []string{"a@x.ch"}, Cc: []string{"b@x.ch"}, Bcc: []string{"secret@x.ch", "hidden@x.ch"}}, "b@x.ch"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := build(from, tc.msg, "https://app.example.com", time.Now())
			msg, err := mail.ReadMessage(bytes.NewReader(raw))
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := msg.Header["Bcc"]; ok {
				t.Fatal("the message has a Bcc header")
			}
			if msg.Header.Get("To") != "a@x.ch" || msg.Header.Get("Cc") != tc.wantCc {
				t.Fatalf("To %q Cc %q", msg.Header.Get("To"), msg.Header.Get("Cc"))
			}
			for _, a := range tc.msg.Bcc {
				if bytes.Contains(raw, []byte(a)) {
					t.Fatalf("%s is in the message", a)
				}
			}
		})
	}
}

func TestCopies(t *testing.T) {
	for _, tc := range []struct {
		name            string
		to, cc, bcc     []string
		wantCc, wantBcc string
	}{
		{"distinct", []string{"a@x.ch"}, []string{"b@x.ch"}, []string{"c@x.ch"}, "[b@x.ch]", "[c@x.ch]"},
		{"cc repeats to", []string{"a@x.ch"}, []string{"a@x.ch", "b@x.ch"}, nil, "[b@x.ch]", "[]"},
		{"bcc repeats to and cc", []string{"a@x.ch"}, []string{"b@x.ch"}, []string{"a@x.ch", "b@x.ch", "c@x.ch"}, "[b@x.ch]", "[c@x.ch]"},
		{"bcc repeats a cc that repeats to", []string{"a@x.ch"}, []string{"a@x.ch"}, []string{"a@x.ch"}, "[]", "[]"},
		{"none", []string{"a@x.ch"}, nil, nil, "[]", "[]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cc, bcc := Copies(tc.to, tc.cc, tc.bcc)
			if fmt.Sprint(cc) != tc.wantCc || fmt.Sprint(bcc) != tc.wantBcc {
				t.Fatalf("cc %v bcc %v, want %s %s", cc, bcc, tc.wantCc, tc.wantBcc)
			}
		})
	}
}
