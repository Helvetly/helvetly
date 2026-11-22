package mail

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestBuildFromDisplayName(t *testing.T) {
	from := &mail.Address{Name: "Helvetly", Address: "no-reply@helvetly.local"}
	for _, c := range []struct{ name, want string }{
		{"Muster GmbH", "Muster GmbH"},
		{`Müller & "Söhne" AG`, `Müller & "Söhne" AG`},
		{"Evil AG\r\nBcc: victim@example.com", "Evil AG Bcc: victim@example.com"},
		{"  Spaced \t  Name  ", "Spaced Name"},
		{strings.Repeat("Ä", 80), strings.Repeat("Ä", 70)},
		{"\r\n", "Helvetly"}, // nothing left: MAIL_FROM's own name
	} {
		raw := build(from, Message{To: []string{"a@example.com"}, Text: "x", Brand: &Brand{Name: c.name}}, "https://app.example.com", time.Now())
		msg, err := mail.ReadMessage(bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		if msg.Header.Get("Bcc") != "" {
			t.Fatalf("%q: a header was injected through the name", c.name)
		}
		got, err := msg.Header.AddressList("From")
		if err != nil || len(got) != 1 || got[0].Name != c.want || got[0].Address != "no-reply@helvetly.local" {
			t.Fatalf("%q: From = %v (%q), %v", c.name, got, msg.Header.Get("From"), err)
		}
		if strings.ContainsFunc(msg.Header.Get("From"), func(r rune) bool { return r > 127 }) {
			t.Fatalf("%q: From not RFC 2047-encoded: %q", c.name, msg.Header.Get("From"))
		}
	}
}

func TestBrandedReplyTo(t *testing.T) {
	brand := Brand{Name: "Muster GmbH", ReplyTo: "office@muster.ch", Owner: "owner@muster.ch", Language: "de"}
	for _, c := range []struct {
		name      string
		brand     Brand
		msg       Message
		want      string
		branded   bool
		wantLang  string
		brandsNil bool
	}{
		{"the workspace's address first", brand, Message{Workspace: "w", ReplyTo: "ana@muster.ch"}, "office@muster.ch", true, "de", false},
		{"else the sender's", Brand{Owner: "owner@muster.ch"}, Message{Workspace: "w", ReplyTo: "ana@muster.ch"}, "ana@muster.ch", true, "", false},
		{"else the owner's", Brand{Owner: "owner@muster.ch"}, Message{Workspace: "w"}, "owner@muster.ch", true, "", false},
		{"never no-reply", Brand{ReplyTo: "No-Reply@helvetly.local", Owner: "owner@muster.ch"}, Message{Workspace: "w", ReplyTo: "no-reply@helvetly.local"},
			"owner@muster.ch", true, "", false},
		{"the message's language wins", brand, Message{Workspace: "w", Language: "fr"}, "office@muster.ch", true, "fr", false},
		{"members: as Helvetly", brand, Message{Workspace: "w", Members: true, ReplyTo: "signer@x.ch"}, "signer@x.ch", false, "", false},
		{"no workspace: as Helvetly", brand, Message{ReplyTo: "ana@x.ch"}, "ana@x.ch", false, "", false},
		{"not wired: as Helvetly", brand, Message{Workspace: "w"}, "", false, "", true},
	} {
		sent := &fakeSending{}
		b := &Branded{Sender: sent, NoReply: "no-reply@helvetly.local",
			Brands: func(context.Context, string) (Brand, error) { return c.brand, nil }}
		if c.brandsNil {
			b.Brands = nil
		}
		if err := b.Send(context.Background(), c.msg); err != nil {
			t.Fatal(err)
		}
		got := sent.sent[0]
		if got.ReplyTo != c.want || (got.Brand != nil) != c.branded || got.Language != c.wantLang && c.branded {
			t.Errorf("%s: reply-to %q brand %v language %q", c.name, got.ReplyTo, got.Brand, got.Language)
		}
	}
	failed := errors.New("db down")
	sent := &fakeSending{}
	b := &Branded{Sender: sent, Brands: func(context.Context, string) (Brand, error) { return Brand{}, failed }}
	if err := b.Send(context.Background(), Message{Workspace: "w"}); !errors.Is(err, failed) || len(sent.sent) != 0 {
		t.Fatalf("a brand that cannot load: %v, %d sent", err, len(sent.sent))
	}
}

func TestBrandedLayout(t *testing.T) {
	const site = "https://app.example.com"
	full := Brand{Name: "Müller & Co AG", LogoPath: "/api/v1/public/email-logo/w/lgo_1", Address: []string{"Bahnhofstrasse 1", "8001 Zürich"},
		Phone: "+41 44 123 45 67", Email: "info@mueller.ch", VAT: "CHE-123.456.789"}
	for _, c := range []struct {
		name      string
		m         Message
		want, not []string
	}{
		{"every detail, in German", Message{HTML: "<p>Hallo</p>", Language: "de", Brand: &full}, []string{
			`<html lang="de">`, `src="https://app.example.com/api/v1/public/email-logo/w/lgo_1"`, ">Müller &amp; Co AG</strong>",
			">Müller &amp; Co AG</strong>", "<br>Bahnhofstrasse 1, 8001 Zürich", "<br>+41 44 123 45 67 · info@mueller.ch",
			"<br>CHE-123.456.789 MWST", `Gesendet mit <a href="https://app.example.com"`}, []string{"Sent by"}},
		{"name only, in French", Message{HTML: "<p>Bonjour</p>", Language: "fr", Brand: &Brand{Name: "Dupont SA", VAT: "FR12345678901"}}, []string{
			">Dupont SA</strong><br>FR12345678901<br><br>", "Envoyé avec"}, []string{"<img", " · ", " TVA"}},
		{"an unknown language: English", Message{HTML: "<p>Hi</p>", Language: "pl", Brand: &Brand{Name: "X", VAT: "CHE-111.222.333"}},
			[]string{"CHE-111.222.333 VAT", "Sent with"}, nil},
		{"a footer of its own stays", Message{HTML: "<p>Hi</p>", Footer: "Why you got this", Brand: &Brand{Name: "X"}},
			[]string{">X</strong>", "Why you got this</td>"}, []string{"Sent with"}},
	} {
		got := layout(c.m, site)
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("%s: no %q in %s", c.name, w, got)
			}
		}
		for _, w := range c.not {
			if strings.Contains(got, w) {
				t.Errorf("%s: %q in %s", c.name, w, got)
			}
		}
	}
}

func TestBrandedPlainText(t *testing.T) {
	from := &mail.Address{Address: "no-reply@helvetly.local"}
	brand := &Brand{Name: "Muster GmbH", Address: []string{"Weg 1", "3000 Bern"}, Email: "info@muster.ch", VAT: "CHE-123.456.789"}
	for _, c := range []struct {
		name string
		m    Message
		want string
	}{
		{"branded", Message{Text: "Guten Tag\n", HTML: "<p>x</p>", Language: "de", Brand: brand},
			"Guten Tag\r\n\r\n-- \r\nMuster GmbH\r\nWeg 1, 3000 Bern\r\ninfo@muster.ch\r\nCHE-123.456.789 MWST\r\n\r\nGesendet mit Helvetly: https://app.example.com\r\n"},
		{"Helvetly's own", Message{Text: "Code: 1\n", HTML: "<p>x</p>"}, "Code: 1\r\n"},
	} {
		msg, err := mail.ReadMessage(bytes.NewReader(build(from, c.m, "https://app.example.com", time.Now())))
		if err != nil {
			t.Fatal(err)
		}
		_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
		p, err := multipart.NewReader(msg.Body, params["boundary"]).NextPart()
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(p)
		if string(body) != c.want {
			t.Errorf("%s: text = %q, want %q", c.name, body, c.want)
		}
	}
}
