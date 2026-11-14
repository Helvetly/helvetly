package auth

import (
	"context"
	"slices"
	"testing"
)

// TestAccountDeletePurgesPersonalData: closing an account removes the person's tokens, own Heidi chats, inbox,
// folder stars, notification settings and feedback text, and hands every object of theirs (feedback screenshots)
// to storage removal; a colleague's data and the feedback row itself (a business record) stay.
func TestAccountDeletePurgesPersonalData(t *testing.T) {
	e := newEnv(t)
	gone := e.emailSignIn("leaver@example.com")
	stays := e.emailSignIn("stays@example.com")
	g, s := e.session(gone), e.session(stays)
	ws := s.Workspace.ID
	if err := e.svc.db.AddMember(context.Background(), ws, g.User.ID, "member", e.clock.now()); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.db.AddMember(context.Background(), g.Workspace.ID, s.User.ID, "owner", e.clock.now()); err != nil {
		t.Fatal(err) // a co-owner, so the leaver may go
	}
	var removed []string
	e.svc.OnPhotoRemoved = func(_ context.Context, key string) { removed = append(removed, key) }
	for _, sql := range []string{
		`INSERT INTO api_tokens (id, user_id, workspace_id, name, scopes, token_hash, prefix, created_at)
			SELECT 'tok_' || u, u, $2, 'ci', '{read:*}', md5(u) || md5(u || 'x'), 'hvt_abcd', now() FROM unnest(ARRAY[$1, $3]) u`,
		`INSERT INTO heidi_conversations (workspace_id, user_id, id, created_at, updated_at)
			SELECT $2, u, 'c1', now(), now() FROM unnest(ARRAY[$1, $3]) u`,
		`INSERT INTO heidi_messages (id, workspace_id, user_id, conversation_id, payload, created_at)
			SELECT 'msg_' || u, $2, u, 'c1', '{}', now() FROM unnest(ARRAY[$1, $3]) u`,
		`INSERT INTO notifications (workspace_id, user_id, event, in_app, created_at)
			SELECT $2, u, 'member.joined', true, now() FROM unnest(ARRAY[$1, $3]) u`,
		`INSERT INTO document_folders (id, workspace_id, name, created_at, updated_at) SELECT 'fol_1', $2, 'Shared', now(), now() WHERE $1::text <> $3::text`,
		`INSERT INTO document_folder_stars (user_id, folder_id, workspace_id, created_at)
			SELECT u, 'fol_1', $2, now() FROM unnest(ARRAY[$1, $3]) u`,
		`UPDATE users SET notification_prefs = '{"member.joined": {"email": false}}' WHERE id IN ($1, $3) AND $2::text <> ''`,
		`INSERT INTO product_feedback (id, workspace_id, user_id, kind, description, page_path, created_at)
			SELECT 'fb_' || u, $2, u, 'problem', 'My private note', '/clients/secret', now() FROM unnest(ARRAY[$1, $3]) u`,
		`INSERT INTO product_feedback_files (feedback_id, position, object_key, content_type, size, sha256)
			SELECT 'fb_' || u, 0, 'feedback/' || u || '.png', 'image/png', 1, md5(u) FROM unnest(ARRAY[$1, $3]) u WHERE $2::text <> ''`,
	} {
		if _, err := e.db.Exec(context.Background(), sql, g.User.ID, ws, s.User.ID); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	e.do(gone, "DELETE", "/api/v1/account", map[string]string{"email": "leaver@example.com"}, 204, nil)

	for _, c := range []struct{ what, sql string }{
		{"api tokens", `SELECT count(*) FROM api_tokens WHERE user_id = $1`},
		{"heidi chats", `SELECT count(*) FROM heidi_conversations WHERE user_id = $1`},
		{"heidi messages", `SELECT count(*) FROM heidi_messages WHERE user_id = $1`},
		{"notifications", `SELECT count(*) FROM notifications WHERE user_id = $1`},
		{"folder stars", `SELECT count(*) FROM document_folder_stars WHERE user_id = $1`},
		{"notification settings", `SELECT count(*) FROM users WHERE id = $1 AND notification_prefs <> '{}'`},
		{"feedback text", `SELECT count(*) FROM product_feedback WHERE user_id = $1 AND (description LIKE '%private%' OR page_path <> '')`},
		{"feedback screenshots", `SELECT count(*) FROM product_feedback_files f JOIN product_feedback p ON p.id = f.feedback_id WHERE p.user_id = $1`},
	} {
		if n := e.count(c.sql, g.User.ID); n != 0 {
			t.Errorf("closed account kept its %s: %d", c.what, n)
		}
		if c.what != "notification settings" && c.what != "feedback text" && e.count(c.sql, s.User.ID) == 0 {
			t.Errorf("a colleague lost their %s", c.what)
		}
	}
	if e.count(`SELECT count(*) FROM product_feedback WHERE user_id = $1`, g.User.ID) != 1 {
		t.Error("the feedback record itself was deleted")
	}
	if !slices.Contains(removed, "feedback/"+g.User.ID+".png") || slices.Contains(removed, "feedback/"+s.User.ID+".png") {
		t.Errorf("objects handed to removal: %v", removed)
	}
}
