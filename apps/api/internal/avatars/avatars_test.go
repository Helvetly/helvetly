package avatars

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/members"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
	"helvetly.com/api/internal/uploads"
)

type fakeFiles struct {
	mu      sync.Mutex
	objects map[string][]byte
	fail    bool
}

func (f *fakeFiles) Put(_ context.Context, key string, r io.Reader, _ int64, _, _ string) error {
	if f.fail {
		return errors.New("storage down")
	}
	b, err := io.ReadAll(r)
	f.mu.Lock()
	f.objects[key] = b
	f.mu.Unlock()
	return err
}

func (f *fakeFiles) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	delete(f.objects, key)
	f.mu.Unlock()
	return nil
}

func (f *fakeFiles) Open(context.Context, string) (io.ReadSeekCloser, error) {
	return nil, errors.New("not proxied")
}
func (f *fakeFiles) ProxyDownloads() bool { return false }
func (f *fakeFiles) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.example.com/" + key, nil
}

func (f *fakeFiles) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.objects)
}

type env struct {
	t     *testing.T
	st    *store.Store
	raw   *pgxpool.Pool
	srv   *httptest.Server
	files *fakeFiles
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	files := &fakeFiles{objects: map[string][]byte{}}
	svc := New(st, a, files, discard)
	a.OnPhotoRemoved = svc.RemoveObject
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	members.New(st, a, discard).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv, files: files}
}

type person struct{ id, email, token, csrf string }

func (e *env) workspace() string {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return ws
}

// join adds a new person with Google's picture to the workspace and signs them in there.
func (e *env) join(ws, role string) *person {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	p := &person{id: auth.NewID("usr"), email: strings.ToLower(rand.Text()) + "@example.com", token: rand.Text(), csrf: rand.Text()}
	sum := sha256.Sum256([]byte(p.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, store.User{ID: p.id, Email: p.email, Name: "Anna", AvatarURL: "https://google.example/a.png"}, now),
		e.st.AddMember(ctx, ws, p.id, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), p.csrf, p.id, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return p
}

func encode(t *testing.T, format string, side int, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, side, side))
	for i := range img.Pix {
		img.Pix[i] = shade
	}
	var buf bytes.Buffer
	var err error
	if format == "jpeg" {
		err = jpeg.Encode(&buf, img, nil)
	} else {
		err = png.Encode(&buf, img)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (e *env) do(p *person, method, path string, body io.Reader, contentType string, withCSRF bool) (*http.Response, map[string]any) {
	e.t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, body)
	if err != nil {
		e.t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: p.token})
	if withCSRF {
		req.Header.Set("X-CSRF-Token", p.csrf)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res, out
}

func (e *env) upload(p *person, body []byte, withCSRF bool) (*http.Response, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", "me.webp") // the name is never trusted
	_, _ = part.Write(body)
	_ = mw.Close()
	return e.do(p, "PUT", "/api/v1/account/avatar", &buf, mw.FormDataContentType(), withCSRF)
}

func (e *env) sessionAvatar(p *person) string {
	e.t.Helper()
	_, out := e.do(p, "GET", "/api/v1/session", nil, "", false)
	user, _ := out["user"].(map[string]any)
	url, _ := user["avatar_url"].(string)
	return url
}

func (e *env) memberAvatar(viewer *person, id string) any {
	e.t.Helper()
	res, out := e.do(viewer, "GET", "/api/v1/members", nil, "", false)
	list, _ := out["data"].([]any)
	for _, m := range list {
		if m := m.(map[string]any); m["user_id"] == id {
			return m["avatar_url"]
		}
	}
	e.t.Fatalf("member %s: %d %v", id, res.StatusCode, out)
	return nil
}

func TestAvatarLifecycle(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	ana, ben := e.join(ws, "owner"), e.join(ws, "member")
	google := "https://google.example/a.png"
	if got := e.sessionAvatar(ana); got != google {
		t.Fatalf("before upload: %q", got)
	}
	if res, _ := e.do(ana, "GET", "/api/v1/users/"+ana.id+"/avatar", nil, "", false); res.StatusCode != 404 {
		t.Fatalf("get without photo: %d", res.StatusCode)
	}

	first := encode(t, "png", 64, 10)
	res, out := e.upload(ana, first, true)
	url, _ := out["avatar_url"].(string)
	if res.StatusCode != 200 || !strings.HasPrefix(url, "/api/v1/users/"+ana.id+"/avatar?v=") || e.files.count() != 1 {
		t.Fatalf("upload: %d %v (%d objects)", res.StatusCode, out, e.files.count())
	}
	// Everywhere the person is shown follows: the session, the member list, an edit of the name.
	if got := e.sessionAvatar(ana); got != url {
		t.Fatalf("session avatar %q, want %q", got, url)
	}
	if got := e.memberAvatar(ben, ana.id); got != url {
		t.Fatalf("member avatar %v, want %q", got, url)
	}
	if res, out := e.do(ana, "PATCH", "/api/v1/account", strings.NewReader(`{"name":"Ana B"}`), "application/json", true); res.StatusCode != 200 ||
		out["data"].(map[string]any)["avatar_url"] != url {
		t.Fatalf("rename: %d %v", res.StatusCode, out)
	}
	for _, viewer := range []*person{ana, ben} {
		res, _ := e.do(viewer, "GET", url, nil, "", false)
		if loc := res.Header.Get("Location"); res.StatusCode != 302 || !strings.Contains(loc, "users/"+ana.id+"/avatars/uav_") {
			t.Fatalf("download: %d %s", res.StatusCode, loc)
		}
	}

	// The same bytes again store nothing new; other bytes replace the object.
	if res, again := e.upload(ana, first, true); res.StatusCode != 200 || again["avatar_url"] != url || e.files.count() != 1 {
		t.Fatalf("same bytes: %d %v (%d objects)", res.StatusCode, again, e.files.count())
	}
	if res, next := e.upload(ana, encode(t, "jpeg", 80, 20), true); res.StatusCode != 200 || next["avatar_url"] == url || e.files.count() != 1 {
		t.Fatalf("replace: %d %v (%d objects)", res.StatusCode, next, e.files.count())
	}

	// Removing it falls back to Google's picture.
	if res, out := e.do(ana, "DELETE", "/api/v1/account/avatar", nil, "", true); res.StatusCode != 200 || out["avatar_url"] != google || e.files.count() != 0 {
		t.Fatalf("delete: %d %v (%d objects)", res.StatusCode, out, e.files.count())
	}
	if got := e.sessionAvatar(ana); got != google {
		t.Fatalf("after delete: %q", got)
	}
	if res, _ := e.do(ana, "DELETE", "/api/v1/account/avatar", nil, "", true); res.StatusCode != 404 {
		t.Fatalf("delete again: %d", res.StatusCode)
	}
}

// Only the person and the members of the viewer's current workspace see a photo; another tenant gets 404.
func TestAvatarVisibility(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	ana := e.join(ws, "owner")
	stranger := e.join(e.workspace(), "owner")
	if res, out := e.upload(ana, encode(t, "png", 64, 1), true); res.StatusCode != 200 {
		t.Fatalf("upload: %d %v", res.StatusCode, out)
	}
	if res, _ := e.do(stranger, "GET", "/api/v1/users/"+ana.id+"/avatar", nil, "", false); res.StatusCode != 404 {
		t.Fatalf("other workspace: %d", res.StatusCode)
	}
	if res, _ := e.do(ana, "GET", "/api/v1/users/"+ana.id+"/avatar", nil, "", false); res.StatusCode != 302 {
		t.Fatalf("own photo: %d", res.StatusCode)
	}
}

func TestAvatarRejects(t *testing.T) {
	e := newEnv(t)
	ana := e.join(e.workspace(), "owner")
	for _, tc := range []struct {
		name   string
		csrf   bool
		body   []byte
		status int
	}{
		{"no CSRF token", false, encode(t, "png", 64, 1), 403},
		{"not an image", true, []byte("%PDF-1.7 not a photo"), 422},
		{"too small", true, encode(t, "png", 16, 1), 422},
		{"over 1 MB", true, bytes.Repeat([]byte{0x89}, uploads.MaxPhotoSize+1), 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if res, out := e.upload(ana, tc.body, tc.csrf); res.StatusCode != tc.status {
				t.Fatalf("got %d %v, want %d", res.StatusCode, out, tc.status)
			}
		})
	}
	e.files.fail = true
	if res, _ := e.upload(ana, encode(t, "png", 64, 2), true); res.StatusCode != 500 {
		t.Fatalf("storage down: %d", res.StatusCode)
	}
	if n := e.files.count(); n != 0 || e.sessionAvatar(ana) != "https://google.example/a.png" {
		t.Fatalf("rejected uploads stored %d objects", n)
	}
}

// Simultaneous uploads end with one photo: the stored object is the one the row points at.
func TestAvatarConcurrentUploads(t *testing.T) {
	e := newEnv(t)
	ana := e.join(e.workspace(), "owner")
	var wg sync.WaitGroup
	for i := range 6 {
		body := encode(t, "png", 64, uint8(30+i))
		wg.Go(func() {
			if res, out := e.upload(ana, body, true); res.StatusCode != 200 {
				t.Errorf("upload: %d %v", res.StatusCode, out)
			}
		})
	}
	wg.Wait()
	var key string
	if err := e.raw.QueryRow(t.Context(), `SELECT photo_key FROM users WHERE id = $1`, ana.id).Scan(&key); err != nil {
		t.Fatal(err)
	}
	e.files.mu.Lock()
	_, ok := e.files.objects[key]
	e.files.mu.Unlock()
	if !ok || e.files.count() != 1 {
		t.Fatalf("row points at %s (stored: %v), %d objects", key, ok, e.files.count())
	}
}

// Deleting the account removes the photo from storage with the rest of the profile.
func TestClosedAccountLosesPhoto(t *testing.T) {
	e := newEnv(t)
	ws := e.workspace()
	e.join(ws, "owner")
	ana := e.join(ws, "member")
	if res, out := e.upload(ana, encode(t, "png", 64, 3), true); res.StatusCode != 200 {
		t.Fatalf("upload: %d %v", res.StatusCode, out)
	}
	body := strings.NewReader(`{"email":"` + ana.email + `"}`)
	if res, out := e.do(ana, "DELETE", "/api/v1/account", body, "application/json", true); res.StatusCode != 204 {
		t.Fatalf("close: %d %v", res.StatusCode, out)
	}
	if n := e.files.count(); n != 0 {
		t.Fatalf("%d objects left", n)
	}
}
