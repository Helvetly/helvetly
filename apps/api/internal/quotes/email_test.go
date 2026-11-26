package quotes

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/emailtemplate"
)

type draftOut struct {
	Data struct {
		To      []string
		Subject string
		Message string
	}
}

func TestQuoteDraftUsesBuiltInText(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	path := "/api/v1/quotes/" + q.ID + "/email"

	var out draftOut
	e.do(b, "GET", path, nil, http.StatusOK, &out)
	if out.Data.Subject != "Offerte von Muster GmbH" || out.Data.To[0] != "ap@kunde.ch" || // no number yet: {number} is ""
		out.Data.Message != "Guten Tag\n\nIm Anhang finden Sie unsere Offerte  über CHF 216.20, gültig bis 16.12.2026.\n\nIm PDF sehen Sie, welche Leistungen enthalten sind. Antworten Sie bei Fragen, Änderungswünschen oder wenn Sie das Angebot annehmen möchten.\n\nFreundliche Grüsse\nMuster GmbH" {
		t.Fatalf("default draft: %+v", out.Data)
	}

	// a text the workspace wrote when that was possible is no longer read
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO email_templates (workspace_id, kind, language, subject, body, updated_at)
		VALUES ($1, 'quote', 'de', '{number} für {client}', 'Hallo {client}', now())`, b.workspace); err != nil {
		t.Fatal(err)
	}
	e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
	if m := e.mail.sent[0]; m.Subject != "Offerte Q-2026-001 von Muster GmbH" || !strings.HasPrefix(m.Text, "Guten Tag\n") {
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
		{"de", [2]string{"Offerte Q-2026-001 von Muster GmbH", "Guten Tag\n\nIm Anhang finden Sie unsere Offerte Q-2026-001 über CHF 216.20, gültig bis 16.12.2026.\n\nIm PDF sehen Sie, welche Leistungen enthalten sind. Antworten Sie bei Fragen, Änderungswünschen oder wenn Sie das Angebot annehmen möchten.\n\nFreundliche Grüsse\nMuster GmbH"}},
		{"en", [2]string{"Quote Q-2026-002 from Muster GmbH", "Hello\n\nPlease find attached our quote Q-2026-002 for CHF 216.20, valid until 16.12.2026.\n\nThe PDF sets out what’s included. Reply if you have questions, want to make a change or are ready to go ahead.\n\nKind regards\nMuster GmbH"}},
	} {
		lang, want := tc.lang, tc.want
		q := e.quote(b, "POST", "/api/v1/quotes", map[string]any{"client_id": e.client(b), "language": lang, "lines": []any{line("2", "100.00")}}, http.StatusCreated)
		e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{}, http.StatusOK)
		m := e.mail.sent[len(e.mail.sent)-1]
		closingAt := strings.LastIndex(want[1], "\n\n")
		if m.Subject != want[0] || !strings.HasPrefix(m.Text, want[1][:closingAt]+"\n\n") ||
			!strings.HasSuffix(m.Text, want[1][closingAt:]+"\n") {
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
