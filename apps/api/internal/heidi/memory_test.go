package heidi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestMemoryFollowsMemberAndWorkspaceAcrossConversations(t *testing.T) {
	s, mux, sess, _, raw := fixtureRaw(t)
	ctx := t.Context()
	const endpoint = "/api/v1/heidi/memory"
	change := func(method, body string) *httptest.ResponseRecorder {
		t.Helper()
		return call(mux, method, endpoint, body, "application/json")
	}
	first := func() string {
		t.Helper()
		w := call(mux, "GET", "/api/v1/heidi/suggestions?page=dashboard", "", "")
		var res struct{ Data []suggestion }
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &res) != nil || len(res.Data) == 0 {
			t.Fatalf("suggestions %d %s", w.Code, w.Body)
		}
		return res.Data[0].Title
	}
	mustChat := func(id, msg string) {
		t.Helper()
		w := chat(t, mux, id, msg)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"done"`) {
			t.Fatalf("chat %d %s", w.Code, w.Body)
		}
	}
	assertMemory := func(want string) {
		t.Helper()
		w := change("GET", "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), want) {
			t.Fatalf("memory %d %s, want %s", w.Code, w.Body, want)
		}
	}
	mustChat("first", "jaka ostatnio byla wystawiona faktura")
	mustChat("second", "What was the latest issued invoice?")
	assertMemory(`"count":2`)
	if got := first(); got != "Latest issued invoice" {
		t.Fatal(got)
	}
	orig := *sess
	sess.Role, sess.Scopes = "member", []string{"read:clients"}
	assertMemory(`"topics":[]`)
	if got := first(); got == "Latest issued invoice" {
		t.Fatal("lost permission still suggests invoice")
	}
	*sess = orig
	other := store.User{ID: "usr_other", Email: "other@example.test"}
	ws := store.Workspace{ID: "ws_other", Name: "Other", Timezone: "UTC"}
	now := time.Now()
	for _, err := range []error{s.db.CreateUser(ctx, other, now), s.db.CreateWorkspace(ctx, ws, ws.Timezone, now), s.db.AddMember(ctx, ws.ID, sess.User.ID, "owner", now), s.db.AddMember(ctx, sess.Workspace.ID, other.ID, "member", now)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	sess.User = other
	assertMemory(`"topics":[]`)
	sess.User, sess.Workspace = orig.User, ws
	assertMemory(`"topics":[]`)
	*sess = orig
	if w := change("DELETE", ""); w.Code != 200 {
		t.Fatal(w.Body)
	}
	assertMemory(`"has_memory":false`)
	if got := first(); got == "Latest issued invoice" {
		t.Fatal("cleared topic still suggested")
	}
	mustChat("third", "Show recent clients")
	if w := change("PATCH", `{"enabled":false}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	mustChat("fourth", "Show recent invoices")
	assertMemory(`"topics":[]`)
	if w := change("PATCH", `{"enabled":true}`); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if err := s.learn(ctx, s.db.Q, *sess, "file-name-or-personal-text"); err != nil {
		t.Fatal(err)
	}
	assertMemory(`"topics":[]`)
	if err := s.learn(ctx, s.db.Q, *sess, "create_client"); err != nil {
		t.Fatal(err)
	}
	assertMemory(`"count":1`)
	if _, err := raw.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, sess.Workspace.ID, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	assertMemory(`"topics":[]`)
}

func TestMemoryIsLocalWithoutProviderConsent(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	ctx := context.Background()
	c, err := s.db.AIConsent(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil || c.Granted {
		t.Fatalf("consent %+v %v", c, err)
	}
	if w := chat(t, mux, "local", "Show recent clients"); w.Code != 200 {
		t.Fatal(w.Body)
	}
	m, err := s.db.HeidiMemory(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil || m.Topics["list_clients"] != 1 {
		t.Fatalf("memory %+v %v", m, err)
	}
	c, err = s.db.AIConsent(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil || c.Granted {
		t.Fatalf("learning changed provider consent %+v %v", c, err)
	}
}

func TestLegacyReplyStylesAreIgnored(t *testing.T) {
	s, mux, sess, _, raw := fixtureRaw(t)
	if _, ok := workspaceOps["set_heidi_reply_style"]; ok {
		t.Error("Heidi still offers to set a reply style")
	}
	grant(t, mux)
	calls := 0
	s.provider = &testProvider{input: 5, answer: func(_ context.Context, req ProviderRequest) (ProviderReply, error) {
		calls++
		if strings.Contains(req.Instructions, "The user prefers") || !strings.Contains(req.Instructions, formatting) {
			t.Error("expected default formatting without a stored preference")
		}
		return ProviderReply{Text: "Here is how Swiss VAT works.", Tokens: new(int64(1))}, nil
	}}
	for _, style := range []string{"brief", "detailed"} {
		t.Run(style, func(t *testing.T) {
			if _, err := raw.Exec(t.Context(), `INSERT INTO heidi_memory(workspace_id,user_id,reply_style)
				VALUES ($1,$2,$3) ON CONFLICT (workspace_id,user_id) DO UPDATE SET reply_style=excluded.reply_style`,
				sess.Workspace.ID, sess.User.ID, style); err != nil {
				t.Fatal(err)
			}
			const endpoint = "/api/v1/heidi/memory"
			if w := call(mux, "GET", endpoint, "", ""); w.Code != 200 ||
				strings.Contains(w.Body.String(), "reply_style") || !strings.Contains(w.Body.String(), `"has_memory":false`) {
				t.Errorf("memory %d %s", w.Code, w.Body)
			}
			if w := call(mux, "PATCH", endpoint, `{"reply_style":"`+style+`"}`, "application/json"); w.Code != 400 {
				t.Errorf("retired setting %d %s", w.Code, w.Body)
			}
			if w := chat(t, mux, style, "Explain how Swiss VAT works"); w.Code != 200 ||
				!strings.Contains(w.Body.String(), "Here is how Swiss VAT works.") {
				t.Fatalf("chat %d %s", w.Code, w.Body)
			}
		})
	}
	if calls != 2 {
		t.Fatalf("expected two model answers, got %d", calls)
	}
}
