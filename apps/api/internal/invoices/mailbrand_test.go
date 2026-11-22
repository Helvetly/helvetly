package invoices

import (
	"context"
	"image/png"
	"net/http"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestReplyAddress(t *testing.T) {
	office, billing := "office@muster.ch", "billing@muster.ch"
	for _, c := range []struct {
		name string
		own  *string
		set  Settings
		want string
	}{
		{"the workspace's reply address", &office, Settings{Seller: Seller{Party: store.Party{Email: &billing}}}, office},
		{"else the company email", nil, Settings{Seller: Seller{Party: store.Party{Email: &billing}}}, billing},
		{"else the member", nil, Settings{}, "ana@muster.ch"},
	} {
		if got := replyAddress(c.own, c.set, "ana@muster.ch"); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestMailBrandAndReplyTo(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	blank := e.workspace()
	got, err := e.svc.MailBrand(ctx, blank.workspace)
	if err != nil || got.Name != "Acme" || got.ReplyTo != "" || got.LogoPath != "" || !strings.HasSuffix(got.Owner, "@example.com") ||
		got.Language != "de" || len(got.Address) != 0 {
		t.Fatalf("no seller details: %+v, %v", got, err)
	}

	b, client := e.ready()
	got, err = e.svc.MailBrand(ctx, b.workspace)
	if err != nil || got.Name != "Muster GmbH" || got.ReplyTo != "billing@muster.ch" || got.Email != "billing@muster.ch" ||
		got.VAT != "CHE-109.322.551 MWST" || strings.Join(got.Address, "|") != "Bahnhofstrasse 1|8001 Zürich" {
		t.Fatalf("seller details: %+v, %v", got, err)
	}
	inv := e.issued(b, client, nil)
	draft := func() string {
		var out struct {
			Data struct {
				ReplyTo string `json:"reply_to"`
			}
		}
		e.do(b, "GET", "/api/v1/invoices/"+inv.ID+"/email", nil, http.StatusOK, &out)
		return out.Data.ReplyTo
	}
	if r := draft(); r != "billing@muster.ch" {
		t.Fatalf("draft reply-to %q", r)
	}

	office := "office@muster.ch" // the workspace's reply address (Settings → Workspace, tested in internal/workspaces)
	if err := e.st.SetWorkspaceReplyTo(ctx, b.workspace, &office); err != nil {
		t.Fatal(err)
	}
	if got, _ = e.svc.MailBrand(ctx, b.workspace); got.ReplyTo != "office@muster.ch" || draft() != "office@muster.ch" {
		t.Fatalf("reply address: brand %q, draft %q", got.ReplyTo, draft())
	}
	// cleared, and no company email: the member who sends
	if err := e.st.SetWorkspaceReplyTo(ctx, b.workspace, nil); err != nil {
		t.Fatal(err)
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"email": nil}}, http.StatusOK, nil)
	if got, _ = e.svc.MailBrand(ctx, b.workspace); got.ReplyTo != "" || !strings.HasSuffix(draft(), "@example.com") {
		t.Fatalf("fallback: brand %q, draft %q", got.ReplyTo, draft())
	}
}

func TestEmailLogo(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	if resp, body := e.upload(b, "logo.png", pngOf(200, 100)); resp.StatusCode != http.StatusOK {
		t.Fatalf("upload: %d %s", resp.StatusCode, body)
	}
	brand, err := e.svc.MailBrand(context.Background(), b.workspace)
	if err != nil || !strings.HasPrefix(brand.LogoPath, emailLogoPath+b.workspace+"/lgo_") {
		t.Fatalf("logo path %q, %v", brand.LogoPath, err)
	}
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, c := range []struct {
		path string
		want int
	}{
		{brand.LogoPath, http.StatusOK}, // no session: mail clients carry none
		{emailLogoPath + b.workspace + "/lgo_other", http.StatusNotFound},
		{emailLogoPath + "wsp_nope/" + strings.TrimPrefix(brand.LogoPath, emailLogoPath+b.workspace+"/"), http.StatusNotFound},
	} {
		resp, err := noRedirect.Get(e.srv.URL + c.path)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != c.want {
			t.Errorf("%s: %d, want %d", c.path, resp.StatusCode, c.want)
		}
		if c.want == http.StatusOK {
			cfg, err := png.DecodeConfig(resp.Body)
			if err != nil || cfg.Width != 72 || cfg.Height != 36 {
				t.Errorf("email logo %dx%d, %v; want 72x36", cfg.Width, cfg.Height, err)
			}
		}
		resp.Body.Close()
	}
}
