package dunning

import (
	"context"
	"strings"
	"testing"
)

func TestDigestUnconfirmed(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	e.mail.uncertain = true
	e.tickAt(10)
	st := e.status(b, id)
	work, err := e.svc.DigestWorkspaces(context.Background(), e.svc.now())
	if err != nil || len(work) != 1 {
		t.Fatalf("work %v %v", work, err)
	}
	_, lines, err := e.svc.DigestSection(context.Background(), work[0], e.svc.now())
	if err != nil || len(lines) != 1 || st.Notices[0].Confirmed || !strings.Contains(lines[0].Text, "delivery unconfirmed") {
		t.Fatalf("lines=%v %v", lines, err)
	}
}
