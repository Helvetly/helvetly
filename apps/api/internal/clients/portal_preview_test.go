package clients

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestPortalPreviewLink(t *testing.T) {
	e, _ := newPortalEnv(t)
	b := e.workspace()
	clientID, _ := e.portalClient(b)
	var out struct {
		Data struct {
			URL       string    `json:"url"`
			ExpiresAt time.Time `json:"expires_at"`
		}
	}
	e.do(b, "POST", "/api/v1/clients/"+clientID+"/portal-preview", nil, 201, &out)
	base, token, ok := strings.Cut(out.Data.URL, "api/v1/public/portal/auth/preview?token=")
	if !ok || !strings.HasPrefix(base, "https://portal.example.com/w/") || len(token) != 43 {
		t.Fatalf("url %q", out.Data.URL)
	}
	if left := time.Until(out.Data.ExpiresAt); left > 5*time.Minute || left < 4*time.Minute {
		t.Fatalf("expires in %v", left)
	}
	ctx := context.Background()
	// Only the token's hash is kept, bound to the workspace and client.
	if _, err := e.st.TakePortalPreviewLink(ctx, token, b.workspace, time.Now()); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("plain token found: %v", err)
	}
	sum := sha256.Sum256([]byte(token))
	if p, err := e.st.TakePortalPreviewLink(ctx, hex.EncodeToString(sum[:]), b.workspace, time.Now()); err != nil || p.ClientID != clientID || p.Email != "ana@acme.ch" {
		t.Fatalf("taken: %+v %v", p, err)
	}

	other := e.workspace()
	for _, tc := range []struct {
		name    string
		who     *browser
		setup   func()
		status  int
		problem string
	}{
		{"another workspace's client", other, nil, 404, ""},
		{"client's portal off", b, func() {
			e.do(b, "PATCH", "/api/v1/clients/"+clientID, map[string]any{"portal_enabled": false}, 200, nil)
		}, 409, "portal_off"},
		{"workspace's portal off", b, func() {
			e.portalBackOn(b, clientID)
			if err := e.st.SetPortalOff(ctx, b.workspace, true); err != nil {
				t.Fatal(err)
			}
		}, 409, "portal_closed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.setup != nil {
				tc.setup()
			}
			resp, raw := e.send(tc.who, "POST", "/api/v1/clients/"+clientID+"/portal-preview", nil, "")
			if resp.StatusCode != tc.status || !strings.Contains(string(raw), tc.problem) {
				t.Fatalf("%d %s", resp.StatusCode, raw)
			}
		})
	}
	// Without the CSRF token a signed-in session is refused.
	b.csrf = "wrong"
	if resp, raw := e.send(b, "POST", "/api/v1/clients/"+clientID+"/portal-preview", nil, ""); resp.StatusCode != 403 {
		t.Fatalf("csrf: %d %s", resp.StatusCode, raw)
	}
}
