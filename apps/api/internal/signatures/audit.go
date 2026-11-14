package signatures

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

// event appends to the request's audit trail; the caller holds the request's lock, so the chain has no forks.
func (s *Service) event(ctx context.Context, q store.Q, requestID, eventType string, signerID *string, r *http.Request,
	details map[string]string) error {
	seq, prev, err := q.LastSignatureEvent(ctx, requestID)
	if err != nil {
		return err
	}
	if details == nil {
		details = map[string]string{}
	}
	raw, err := json.Marshal(details) // map keys sorted: the same bytes when read back and marshalled again
	if err != nil {
		return err
	}
	e := store.SignatureEvent{Seq: seq + 1, Type: eventType, SignerID: signerID, At: s.now(), Data: raw}
	if r != nil {
		ip, ua := client(r)
		e.IP, e.UserAgent = &ip, &ua
	}
	e.Hash = chainHash(prev, requestID, e)
	return q.InsertSignatureEvent(ctx, requestID, e)
}

// client: the address and browser of a request, for the evidence. The address is the peer's, which
// auth.ForwardedFor has already replaced with the client a trusted proxy reports.
func client(r *http.Request) (string, string) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ua := r.UserAgent()
	if len(ua) > 500 {
		ua = ua[:500]
	}
	return host, strings.ToValidUTF8(ua, "") // Postgres text refuses invalid UTF-8, also a character cut at 500 bytes
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// chainHash = SHA-256(previous hash ‖ the event as canonical JSON).
func chainHash(prev, requestID string, e store.SignatureEvent) string {
	var details map[string]string
	_ = json.Unmarshal(e.Data, &details)
	canonical, _ := json.Marshal([]any{requestID, e.Seq, e.Type, deref(e.SignerID), e.At.UTC().Format(time.RFC3339Nano),
		deref(e.IP), deref(e.UserAgent), details})
	sum := sha256.Sum256(append([]byte(prev), canonical...))
	return hex.EncodeToString(sum[:])
}

// verifyChain: every event's hash follows from the one before it.
func verifyChain(requestID string, events []store.SignatureEvent) bool {
	prev := ""
	for i, e := range events {
		if e.Seq != i+1 || chainHash(prev, requestID, e) != e.Hash {
			return false
		}
		prev = e.Hash
	}
	return true
}
