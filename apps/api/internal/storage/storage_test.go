package storage

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// The tests below run against the S3 in compose (`pnpm infra:up`) only with HELVETLY_TEST_S3=1. They prove what that
// S3 does, not what a given provider does: run them against a provider's test bucket before relying on it.
func testConfig(t *testing.T) config.S3 {
	t.Helper()
	if os.Getenv("HELVETLY_TEST_S3") != "1" {
		t.Skip("set HELVETLY_TEST_S3=1 to test against the S3 in compose")
	}
	env := func(k, fallback string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return fallback
	}
	return config.S3{Endpoint: env("S3_ENDPOINT", "http://localhost:9300"), Region: env("S3_REGION", "us-east-1"),
		Bucket: env("S3_BUCKET", "helvetly"), AccessKey: env("S3_ACCESS_KEY", "helvetly"), SecretKey: env("S3_SECRET_KEY", "helvetly-secret"),
		ObjectLockMode: "GOVERNANCE"}
}

func randomKey(name string) string { return "test/" + strings.ToLower(rand.Text()) + "/" + name }

// newBucket makes a throwaway bucket (versioned, or with Object Lock) and removes it, bypassing GOVERNANCE locks.
func newBucket(t *testing.T, cfg config.S3, objectLock bool) string {
	t.Helper()
	cfg.ObjectLockDays = 0
	s, err := New(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	name := "helvetly-test-" + strings.ToLower(rand.Text()[:10])
	if err := s.client.MakeBucket(ctx, name, minio.MakeBucketOptions{Region: cfg.Region, ObjectLocking: objectLock}); err != nil {
		t.Skipf("this S3 cannot make a test bucket (object lock %v): %v", objectLock, err)
	}
	if !objectLock {
		if err := s.client.EnableVersioning(ctx, name); err != nil {
			t.Skipf("this S3 cannot version a bucket: %v", err)
		}
	}
	t.Cleanup(func() {
		for o := range s.client.ListObjects(ctx, name, minio.ListObjectsOptions{Recursive: true, WithVersions: true}) {
			_ = s.client.RemoveObject(ctx, name, o.Key, minio.RemoveObjectOptions{VersionID: o.VersionID, GovernanceBypass: true})
		}
		_ = s.client.RemoveBucket(ctx, name)
	})
	return name
}

func read(t *testing.T, s *S3, key string) string {
	t.Helper()
	b, err := s.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func download(t *testing.T, link string) (int, string) {
	t.Helper()
	resp, err := http.Get(link)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// Plain storage: no versioning, protection off. Nothing here needs Object Lock, and no version is recorded or invented.
func TestS3(t *testing.T) {
	cfg := testConfig(t)
	db, _ := storetest.New(t)
	s, err := New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key, body := randomKey("hello.txt"), "hello, storage"
	if err := s.Put(ctx, key, strings.NewReader(body), int64(len(body)), "text/plain", "Grüezi.txt"); err != nil {
		t.Fatal(err)
	}
	if v, err := db.ObjectVersion(ctx, key); err != nil || v != "" {
		t.Fatalf("an unversioned bucket recorded version %q (%v)", v, err)
	}
	link, err := s.PresignDownload(ctx, key, time.Minute, "Grüezi.txt")
	if err != nil {
		t.Fatal(err)
	}
	if code, got := download(t, link); code != 200 || got != body || strings.Contains(link, "versionId") {
		t.Fatalf("download: %d %q %s", code, got, link)
	}
	if got := read(t, s, key); got != body {
		t.Fatalf("get: %q", got)
	}
	copyKey := key + ".copy"
	if err := s.Copy(ctx, key, copyKey); err != nil {
		t.Fatal(err)
	}
	obj, err := s.Open(ctx, copyKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := obj.Seek(7, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	rest, _ := io.ReadAll(obj)
	obj.Close()
	if string(rest) != body[7:] {
		t.Fatalf("open after seek: %q", rest)
	}
	if _, err := s.Open(ctx, key+".missing"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("open a missing object: %v", err)
	}
	s.proxy = true
	w := httptest.NewRecorder()
	if err := Serve(w, httptest.NewRequest("GET", "/", nil), s, "", key, "Grüezi.txt", ""); err != nil || w.Code != 200 ||
		w.Body.String() != body || w.Header().Get("Content-Type") != "text/plain" || w.Header().Get("ETag") == "" {
		t.Fatalf("proxied download: %v %d %q %v", err, w.Code, w.Body.String(), w.Header())
	}
	if _, err := s.Retain(ctx, key, time.Now().Add(time.Hour)); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("retain with protection off: %v", err)
	}
	for _, k := range []string{key, copyKey} {
		if err := s.Delete(ctx, k); err != nil {
			t.Fatal(err)
		}
	}
	if code, _ := download(t, link); code != 404 {
		t.Fatalf("after delete: %d", code)
	}
}

// Versioned storage: reads, links and copies keep naming the version the API wrote, whatever overwrites the key later.
func TestS3PinsTheWrittenVersion(t *testing.T) {
	cfg := testConfig(t)
	cfg.Bucket = newBucket(t, cfg, false)
	db, _ := storetest.New(t)
	s, err := New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key := randomKey("invoice.pdf")
	if err := s.Put(ctx, key, strings.NewReader("original"), 8, "application/pdf", "invoice.pdf"); err != nil {
		t.Fatal(err)
	}
	v1, err := db.ObjectVersion(ctx, key)
	if err != nil || !pinned(v1) {
		t.Fatalf("version from the upload: %q %v", v1, err)
	}
	// someone else overwrites the key: storage now has a newer version
	if _, err := s.client.PutObject(ctx, cfg.Bucket, key, strings.NewReader("tampered"), 8, minio.PutObjectOptions{}); err != nil {
		t.Fatal(err)
	}
	if got := read(t, s, key); got != "original" {
		t.Fatalf("read after an overwrite: %q", got)
	}
	link, err := s.PresignDownload(ctx, key, time.Minute, "invoice.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if code, got := download(t, link); code != 200 || got != "original" {
		t.Fatalf("presigned after an overwrite: %d %q", code, got)
	}
	copyKey := key + ".copy"
	if err := s.Copy(ctx, key, copyKey); err != nil {
		t.Fatal(err)
	}
	if v, _ := db.ObjectVersion(ctx, copyKey); !pinned(v) || read(t, s, copyKey) != "original" {
		t.Fatalf("copy: version %q, %q", v, read(t, s, copyKey))
	}
	// deleting removes only the API's version: the other one is not the API's to delete
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if v, _ := db.ObjectVersion(ctx, key); v != "" {
		t.Fatalf("version kept after delete: %q", v)
	}
	if _, err := s.client.StatObject(ctx, cfg.Bucket, key, minio.StatObjectOptions{VersionID: v1}); err == nil {
		t.Fatal("the deleted version is still there")
	}
	if got := read(t, s, key); got != "tampered" {
		t.Fatalf("the other version: %q", got)
	}
	// a recorded version storage does not have is an error, never another version's bytes
	if err := db.SetObjectVersion(ctx, copyKey, "00000000-0000-0000-0000-000000000000", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, copyKey); err == nil {
		t.Fatal("opened a version storage does not have")
	}
}

// Required protection: a bucket without Object Lock, or credentials that may not read it, stop the start; nothing
// falls back to unprotected storage.
func TestS3RequiredProtectionRefusesToStart(t *testing.T) {
	cfg := testConfig(t)
	cfg.ObjectLockDays = 1
	cfg.Bucket = newBucket(t, cfg, false) // versioned, but no Object Lock
	if _, err := New(cfg, nil); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("bucket without Object Lock: %v", err)
	}
	bad := cfg
	bad.SecretKey = "wrong-" + cfg.SecretKey
	if _, err := New(bad, nil); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("wrong credentials: %v", err)
	}
}

// Object Lock: the written version is locked, read back, never shortened, and storage refusing a delete is an error.
func TestS3LocksTheWrittenVersion(t *testing.T) {
	cfg := testConfig(t)
	cfg.ObjectLockDays = 1
	cfg.Bucket = newBucket(t, cfg, true)
	db, _ := storetest.New(t)
	s, err := New(cfg, db)
	if err != nil {
		t.Fatalf("bucket with Object Lock: %v", err)
	}
	ctx := context.Background()
	key := randomKey("receipt.pdf")
	if err := s.Put(ctx, key, strings.NewReader("receipt"), 7, "application/pdf", "receipt.pdf"); err != nil {
		t.Fatal(err)
	}
	v1, _ := db.ObjectVersion(ctx, key)
	if _, err := s.client.PutObject(ctx, cfg.Bucket, key, strings.NewReader("newer"), 5, minio.PutObjectOptions{}); err != nil {
		t.Fatal(err)
	}
	until := s.RetainUntil(time.Now(), nil)
	lock, err := s.Retain(ctx, key, until)
	if err != nil {
		t.Fatal(err)
	}
	if lock.VersionID != v1 || lock.Mode != "GOVERNANCE" || lock.Until.Before(until) {
		t.Fatalf("lock %+v, want version %s until %v", lock, v1, until)
	}
	// the newer version is not the one locked
	if mode, _, err := s.client.GetObjectRetention(ctx, cfg.Bucket, key, ""); err == nil && mode != nil {
		t.Fatalf("the newer version got the lock too: %v", *mode)
	}
	again, err := s.Retain(ctx, key, until.Add(-time.Hour))
	if err != nil || !again.Until.Equal(lock.Until) {
		t.Fatalf("a shorter request changed the lock: %+v %v", again, err)
	}
	if err := s.Delete(ctx, key); err == nil {
		t.Fatal("storage refused nothing: a locked version was deleted")
	}
	if got := read(t, s, key); got != "receipt" {
		t.Fatalf("after the refused delete: %q", got)
	}
}

// The registry's guard: an object whose protection was requested is never deleted by the API before its deadline.
func TestS3RefusesDeletingARetainedRecord(t *testing.T) {
	cfg := testConfig(t)
	db, _ := storetest.New(t)
	s, err := New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key := randomKey("invoice.pdf")
	if err := s.Put(ctx, key, strings.NewReader("pdf"), 3, "application/pdf", "invoice.pdf"); err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(24 * time.Hour)
	if err := db.RequestRetention(ctx, store.RetentionRequest{WorkspaceID: "ws_1", Key: key, Until: &until}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, key); !errors.Is(err, ErrRetained) {
		t.Fatalf("delete a retained record: %v", err)
	}
	if got := read(t, s, key); got != "pdf" {
		t.Fatalf("after the refusal: %q", got)
	}
	s.now = func() time.Time { return until.Add(time.Minute) } // past the deadline the record may go
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
}

func TestClassify(t *testing.T) {
	for code, want := range map[string]error{"AccessDenied": ErrAccessDenied, "InvalidAccessKeyId": ErrAccessDenied,
		"ObjectLockConfigurationNotFoundError": ErrUnsupported, "NotImplemented": ErrUnsupported,
		"NoSuchKey": store.ErrNotFound, "NoSuchVersion": store.ErrNotFound} {
		if err := classify(minio.ErrorResponse{Code: code}); !errors.Is(err, want) {
			t.Errorf("%s: %v", code, err)
		}
	}
	if err := classify(minio.ErrorResponse{Code: "InvalidRequest", Message: "Bucket is missing Object Lock Configuration"}); !errors.Is(err, ErrUnsupported) {
		t.Errorf("missing Object Lock configuration: %v", err)
	}
	for _, other := range []minio.ErrorResponse{{Code: "SlowDown", StatusCode: 503}, {Code: "InvalidRequest", Message: "Invalid part number"}} {
		err := classify(other)
		if errors.Is(err, ErrAccessDenied) || errors.Is(err, ErrUnsupported) || errors.Is(err, store.ErrNotFound) {
			t.Errorf("%s %q was classified: %v", other.Code, other.Message, err)
		}
	}
}

func TestPinnedIgnoresNullAndEmptyVersions(t *testing.T) {
	if pinned("") || pinned("null") || !pinned("3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY") {
		t.Fatal("pinned")
	}
}

func TestCoversNeverWeakensALock(t *testing.T) {
	until := time.Date(2037, 1, 1, 14, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		lock Lock
		mode minio.RetentionMode
		want bool
	}{
		{Lock{Mode: "GOVERNANCE", Until: until}, minio.Governance, true},
		{Lock{Mode: "COMPLIANCE", Until: until}, minio.Governance, true}, // stricter than asked
		{Lock{Mode: "GOVERNANCE", Until: until}, minio.Compliance, false},
		{Lock{Mode: "COMPLIANCE", Until: until.Add(-time.Second)}, minio.Compliance, false}, // too short
	} {
		if got := covers(tc.lock, tc.mode, until); got != tc.want {
			t.Errorf("covers(%+v, %s) = %v", tc.lock, tc.mode, got)
		}
	}
}
