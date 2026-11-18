package invoices

import (
	"context"
	"net/http"
	"testing"
	"time"
)

var noEmail = map[string]any{"email": false}

// sentAt is the invoice's sent_at as the API answers it.
func (e *env) sentAt(b *browser, id string) *time.Time {
	e.t.Helper()
	var out struct {
		Data struct {
			SentAt *time.Time `json:"sent_at"`
		}
	}
	e.do(b, "GET", path(id), nil, http.StatusOK, &out)
	return out.Data.SentAt
}

// The owner sends the PDF themselves: email false marks the invoice sent, no email goes out and no delivery is
// recorded, even on a server without email. A repeat keeps the first date.
func TestMarkSentWithoutEmail(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mailOn bool
	}{{"mail set up", true}, {"mail not set up", false}} {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t)
			if !tt.mailOn {
				e.svc.mail = nil
			}
			b, clientID := e.ready()
			inv := e.issued(b, clientID, nil)
			e.do(b, "POST", path(inv.ID, "send"), noEmail, http.StatusOK, nil)
			first := e.sentAt(b, inv.ID)
			if first == nil {
				t.Fatal("sent_at not set")
			}
			e.do(b, "POST", path(inv.ID, "send"), noEmail, http.StatusOK, nil)
			if again := e.sentAt(b, inv.ID); again == nil || !again.Equal(*first) {
				t.Fatalf("a repeat moved sent_at from %v to %v", first, again)
			}
			if d, err := e.st.Deliveries(context.Background(), inv.ID); err != nil || len(d) != 0 {
				t.Fatalf("deliveries %v, %v", d, err)
			}
			if len(e.mail.sent) != 0 {
				t.Fatalf("%d mails sent", len(e.mail.sent))
			}
		})
	}
}

func TestMarkSentRefused(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	draft := e.draft(b, clientID, nil)
	voided := e.issued(b, clientID, nil)
	e.invoice(b, "POST", path(voided.ID, "void"), map[string]any{"reason": "Falscher Kunde"}, http.StatusOK)
	other, otherClient := e.ready()
	foreign := e.issued(other, otherClient, nil)
	for _, tt := range []struct {
		name, id, code string
		status         int
	}{
		{"draft", draft.ID, "invalid_state", http.StatusConflict},
		{"void", voided.ID, "invalid_state", http.StatusConflict},
		{"another workspace", foreign.ID, "not_found", http.StatusNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e.fails(b, "POST", path(tt.id, "send"), noEmail, tt.status, tt.code)
		})
	}
	if at := e.sentAt(other, foreign.ID); at != nil {
		t.Fatalf("another workspace marked its invoice sent: %v", at)
	}
}
