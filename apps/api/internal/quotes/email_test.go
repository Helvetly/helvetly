package quotes

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/store"
)

type draftOut struct {
	Data struct {
		To      []string
		Subject string
		Message string
	}
}

func TestQuoteDraftUsesTemplate(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	path := "/api/v1/quotes/" + q.ID + "/email"

	var out draftOut
	e.do(b, "GET", path, nil, http.StatusOK, &out)
	if out.Data.Subject != "Offerte von Muster GmbH" || out.Data.To[0] != "ap@kunde.ch" || // no number yet: {number} is ""
		out.Data.Message != "Guten Tag\n\nIm Anhang finden Sie unsere Offerte  über CHF 216.20, gültig bis 16.12.2026.\n\nFreundliche Grüsse\nMuster GmbH" {
		t.Fatalf("default draft: %+v", out.Data)
	}

	own := store.EmailTemplate{Kind: "quote", Language: "de", Subject: "{number} für {client}", Body: "Hallo {client}: {amount}, {valid_until} <{x}> {company}"}
	if err := e.st.SetEmailTemplate(context.Background(), b.workspace, own, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.do(b, "GET", path, nil, http.StatusOK, &out)
	if out.Data.Subject != "für Kunde AG" || out.Data.Message != "Hallo Kunde AG: CHF 216.20, 16.12.2026 <{x}> Muster GmbH" {
		t.Fatalf("template draft: %+v", out.Data)
	}

	// the send without subject/message uses the template too
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
	if m := e.mail.sent[0]; m.Subject != "Q-2026-001 für Kunde AG" || m.Text != "Hallo Kunde AG: CHF 216.20, 16.12.2026 <{x}> Muster GmbH" {
		t.Fatalf("sent: %q %q", m.Subject, m.Text)
	}
}

func TestQuoteSendDefaultsToDraft(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	for _, tc := range []struct {
		lang string
		want [2]string
	}{
		{"de", [2]string{"Offerte Q-2026-001 von Muster GmbH", "Guten Tag\n\nIm Anhang finden Sie unsere Offerte Q-2026-001 über CHF 216.20, gültig bis 16.12.2026.\n\nFreundliche Grüsse\nMuster GmbH"}},
		{"en", [2]string{"Quote Q-2026-002 from Muster GmbH", "Hello\n\nPlease find attached our quote Q-2026-002 for CHF 216.20, valid until 16.12.2026.\n\nKind regards\nMuster GmbH"}},
	} {
		lang, want := tc.lang, tc.want
		q := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": e.client(b), "language": lang, "lines": []any{line("2", "100.00")}}, http.StatusCreated)
		e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
		m := e.mail.sent[len(e.mail.sent)-1]
		if m.Subject != want[0] || m.Text != want[1] {
			t.Fatalf("%s: %q %q", lang, m.Subject, m.Text)
		}
	}
}

func TestQuoteDraftOtherWorkspace404(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	e.fails(e.workspace(), "GET", "/api/v1/quotes/"+q.ID+"/email", nil, 404, "not_found", "")
}

func TestQuoteSendAcceptsTheRenderedDraftOverTheLimit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	// the template is within the limits, the rendered draft (company name filled in) is not
	own := store.EmailTemplate{Kind: "quote", Language: "de", Subject: "{company}" + strings.Repeat("s", 191), Body: strings.Repeat("{company}", 100) + strings.Repeat("b", emailtemplate.MaxMessage-900)}
	if err := e.st.SetEmailTemplate(context.Background(), b.workspace, own, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	var d draftOut
	path := "/api/v1/quotes/" + q.ID
	e.do(b, "GET", path+"/email", nil, http.StatusOK, &d)
	if utf8.RuneCountInString(d.Data.Subject) <= 200 || utf8.RuneCountInString(d.Data.Message) <= emailtemplate.MaxMessage {
		t.Fatalf("draft is %d / %d runes, want over the limits", utf8.RuneCountInString(d.Data.Subject), utf8.RuneCountInString(d.Data.Message))
	}
	e.fails(b, "POST", path+"/send", map[string]any{"subject": strings.Repeat("s", 201)}, http.StatusUnprocessableEntity, "validation_failed", "subject")
	e.fails(b, "POST", path+"/send", map[string]any{"message": d.Data.Message + "!"}, http.StatusUnprocessableEntity, "validation_failed", "message")
	e.quote(b, "POST", path+"/send", map[string]any{"subject": d.Data.Subject, "message": d.Data.Message}, http.StatusOK)
	if m := e.mail.sent[0]; m.Subject != d.Data.Subject || m.Text != d.Data.Message {
		t.Fatalf("mail %q / %q, want the draft", m.Subject, m.Text)
	}
}

func TestQuoteSendMessageLimit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	for _, tc := range []struct {
		name  string
		runes int
		ok    bool
	}{
		{"one over the limit", emailtemplate.MaxMessage + 1, false},
		{"at the limit, counted in characters not bytes", emailtemplate.MaxMessage, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{"message": strings.Repeat("é", tc.runes)}
			if tc.ok {
				e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", body, http.StatusOK)
			} else {
				e.fails(b, "POST", "/api/v1/quotes/"+q.ID+"/send", body, http.StatusUnprocessableEntity, "validation_failed", "message")
			}
		})
	}
}

// Bcc is validated like Cc and loses the addresses already in To or Cc.
func TestQuoteSendBcc(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	path := "/api/v1/quotes/" + q.ID + "/send"
	for _, tc := range []struct {
		name    string
		body    map[string]any
		wantBcc []string
		field   string
	}{
		{name: "invalid address", body: map[string]any{"bcc": []string{"nope"}}, field: "bcc"},
		{name: "too many", body: map[string]any{"bcc": strings.Split(strings.Repeat("x@y.ch,", 11), ",")[:11]}, field: "bcc"},
		{name: "hidden copies, repeats dropped", body: map[string]any{"cc": []string{"boss@kunde.ch"},
			"bcc": []string{"AP@kunde.ch", "boss@kunde.ch", "audit@muster.ch"}}, wantBcc: []string{"audit@muster.ch"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.field != "" {
				e.fails(b, "POST", path, tc.body, http.StatusUnprocessableEntity, "validation_failed", tc.field)
				return
			}
			e.quote(b, "POST", path, tc.body, http.StatusOK)
			m := e.mail.sent[len(e.mail.sent)-1]
			if fmt.Sprint(m.To, m.Cc) != "[ap@kunde.ch] [boss@kunde.ch]" || !slices.Equal(m.Bcc, tc.wantBcc) {
				t.Fatalf("to %v cc %v bcc %v", m.To, m.Cc, m.Bcc)
			}
		})
	}
}
