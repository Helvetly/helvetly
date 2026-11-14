package invoices

import (
	"context"
	"net/http"
	"sync"
	"testing"
)

// A double-click on Send: while the first mail is still going out, a second send of the same document is refused
// instead of emailing the client twice. Once the first is done, sending again is allowed.
func TestOverlappingSendIsRefused(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.issued(b, clientID, nil)
	inFlight, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	e.mail.onSend = func(context.Context) {
		first := false
		once.Do(func() { first = true })
		if first {
			close(inFlight)
			<-release
		}
	}
	done := make(chan int)
	go func() {
		resp, _ := e.send(b, "POST", path(inv.ID, "send"), map[string]any{})
		done <- resp.StatusCode
	}()
	<-inFlight
	second, body := e.send(b, "POST", path(inv.ID, "send"), map[string]any{})
	close(release)
	if first := <-done; first != http.StatusOK || second.StatusCode != http.StatusConflict {
		t.Fatalf("first %d, second %d %s", first, second.StatusCode, body)
	}
	if n := len(e.mail.sent); n != 1 {
		t.Fatalf("%d mails sent for one document", n)
	}
	e.do(b, "POST", path(inv.ID, "send"), map[string]any{}, http.StatusOK, nil)
}
