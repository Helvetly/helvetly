// Package storage keeps files in an S3-compatible bucket (MaxIOFS locally, any S3 in production).
//
// Required of the storage: PUT, GET (with Range), HEAD, DELETE, server-side COPY and presigned GET, on one bucket.
// Optional, used when present: object versioning (each write's VersionID is recorded and every later read names it)
// and, only with S3_OBJECT_LOCK_DAYS > 0, standard S3 Object Lock on the bucket.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/url"
	"strings"
	"time"

	// minio-go over aws-sdk-go-v2: one module with path-style addressing and presigning built in, and none of the
	// AWS SDK's default request checksums that S3-compatible servers often reject.
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
)

// Registry is where the API keeps what storage answered about its objects (*store.Store): the version each write made,
// and whether an object belongs to a business record that must not be deleted.
type Registry interface {
	ObjectVersion(ctx context.Context, key string) (string, error)
	SetObjectVersion(ctx context.Context, key, version string, at time.Time) error
	ForgetObjectVersion(ctx context.Context, key, version string) error
	DeleteBlocked(ctx context.Context, key string, now time.Time) (bool, error)
}

// Kinds of storage failure, so "the bucket cannot do this" is never confused with "these keys may not" or "try again".
var (
	ErrUnsupported  = errors.New("storage does not support the operation or the bucket lacks the configuration")
	ErrAccessDenied = errors.New("storage credentials are not allowed the operation")
	ErrRetained     = errors.New("object belongs to a business record under retention")
)

type S3 struct {
	client   *minio.Client
	reg      Registry
	bucket   string
	lockDays int
	lockMode minio.RetentionMode
	proxy    bool
	media    *Media
	now      func() time.Time
}

func New(cfg config.S3, reg Registry) (*S3, error) {
	u, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	lookup := minio.BucketLookupPath
	if cfg.VirtualHosted {
		lookup = minio.BucketLookupDNS
	}
	c, err := minio.New(u.Host, &minio.Options{Creds: credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: u.Scheme == "https", Region: cfg.Region, BucketLookup: lookup})
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	s := &S3{client: c, reg: reg, bucket: cfg.Bucket, lockDays: cfg.ObjectLockDays,
		lockMode: minio.RetentionMode(cfg.ObjectLockMode), proxy: cfg.ProxyDownloads, now: time.Now}
	if s.lockDays > 0 { // required protection never falls back to none: refuse to start instead
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := s.checkObjectLock(ctx); err != nil {
			return nil, fmt.Errorf("storage: S3_OBJECT_LOCK_DAYS is set: %w", err)
		}
	}
	return s, nil
}

// checkObjectLock reads only the bucket's Object Lock configuration (s3:GetBucketObjectLockConfiguration): Object Lock
// implies versioning, which the per-version locks need.
func (s *S3) checkObjectLock(ctx context.Context) error {
	enabled, _, _, _, err := s.client.GetObjectLockConfig(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("bucket %q Object Lock configuration: %w", s.bucket, classify(err))
	}
	if enabled != "Enabled" {
		return fmt.Errorf("bucket %q: %w: Object Lock is not enabled (create the bucket with Object Lock and versioning)",
			s.bucket, ErrUnsupported)
	}
	return nil
}

// classify wraps a storage error with the kind it is; anything else (network, 5xx, throttling, other invalid requests)
// is returned as it is.
func classify(err error) error {
	resp := minio.ToErrorResponse(err)
	switch resp.Code {
	case "AccessDenied", "AllAccessDisabled", "InvalidAccessKeyId", "SignatureDoesNotMatch":
		return fmt.Errorf("%w: %w", ErrAccessDenied, err)
	case "NotImplemented", "MethodNotAllowed", "ObjectLockConfigurationNotFoundError", "NoSuchObjectLockConfiguration":
		return fmt.Errorf("%w: %w", ErrUnsupported, err)
	case "InvalidRequest": // S3's catch-all; only its "Bucket is missing Object Lock Configuration" means unsupported
		if strings.Contains(strings.ToLower(resp.Message), "object lock") {
			return fmt.Errorf("%w: %w", ErrUnsupported, err)
		}
	case minio.NoSuchKey, minio.NoSuchVersion:
		return fmt.Errorf("%w: %w", store.ErrNotFound, err)
	}
	return err
}

// pinned: a version a later request can name. "null" is what a suspended (or never versioned) bucket calls its single
// overwritable version, so it pins nothing.
func pinned(version string) bool { return version != "" && version != "null" }

func (s *S3) version(ctx context.Context, key string) (string, error) {
	v, err := s.reg.ObjectVersion(ctx, key)
	if err != nil {
		return "", fmt.Errorf("storage version of %s: %w", key, err)
	}
	return v, nil
}

// record keeps the version a write answered; without it the write cannot be served by version, so it is undone.
func (s *S3) record(ctx context.Context, key, version string) error {
	if !pinned(version) {
		return nil
	}
	if err := s.reg.SetObjectVersion(ctx, key, version, s.now()); err != nil {
		_ = s.client.RemoveObject(context.WithoutCancel(ctx), s.bucket, key, minio.RemoveObjectOptions{VersionID: version})
		return fmt.Errorf("storage record version of %s: %w", key, err)
	}
	return nil
}

// RetentionMode: the configured Object Lock mode, "" when protection is off (S3_OBJECT_LOCK_DAYS=0).
func (s *S3) RetentionMode() string {
	if s.lockDays == 0 {
		return ""
	}
	return string(s.lockMode)
}

// Lock is an Object Lock as storage reported it back.
type Lock struct {
	VersionID string
	Mode      string
	Until     time.Time
}

// RetainUntil: the business deadline, but never less than S3_OBJECT_LOCK_DAYS from when the record asked for it (not
// from a retry). A nil deadline (unknown) leaves the days alone.
func (s *S3) RetainUntil(requested time.Time, deadline *time.Time) time.Time {
	until := requested.UTC().AddDate(0, 0, s.lockDays)
	if deadline != nil && deadline.After(until) {
		until = deadline.UTC()
	}
	return until.Truncate(time.Second)
}

// Retain locks the recorded version of key until at least until and returns the lock read back from storage: success
// means that version is protected, not just that the call returned. A lock already in place that covers it is left
// alone, never shortened.
func (s *S3) Retain(ctx context.Context, key string, until time.Time) (Lock, error) {
	if s.lockDays == 0 {
		return Lock{}, fmt.Errorf("storage retain %s: %w: retention is off", key, ErrUnsupported)
	}
	v, err := s.version(ctx, key)
	if err != nil {
		return Lock{}, err
	}
	if v == "" { // written before versions were recorded: take the object's current version, the one the API wrote
		info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
		if err != nil {
			return Lock{}, fmt.Errorf("storage retain %s: %w", key, classify(err))
		}
		if v = info.VersionID; !pinned(v) {
			return Lock{}, fmt.Errorf("storage retain %s: %w: the object has no version to lock", key, ErrUnsupported)
		}
	}
	until = until.UTC().Truncate(time.Second)
	mode := s.lockMode
	if lock, err := s.lockOf(ctx, key, v); err == nil {
		if covers(lock, mode, until) {
			return lock, nil
		}
		if lock.Mode == string(minio.Compliance) { // a COMPLIANCE lock is only ever extended as COMPLIANCE
			mode = minio.Compliance
		}
	}
	if err := s.client.PutObjectRetention(ctx, s.bucket, key, minio.PutObjectRetentionOptions{Mode: &mode,
		RetainUntilDate: &until, VersionID: v}); err != nil {
		return Lock{}, fmt.Errorf("storage retain %s: %w", key, classify(err))
	}
	lock, err := s.lockOf(ctx, key, v)
	if err != nil {
		return Lock{}, fmt.Errorf("storage retain %s: read back: %w", key, err)
	}
	if !covers(lock, mode, until) {
		return Lock{}, fmt.Errorf("storage retain %s: storage reports %s until %s, wanted %s until %s", key, lock.Mode,
			lock.Until.Format(time.RFC3339), s.lockMode, until.Format(time.RFC3339))
	}
	return lock, nil
}

// covers: lock protects at least as long as until in mode, or more strictly (COMPLIANCE satisfies GOVERNANCE).
func covers(lock Lock, mode minio.RetentionMode, until time.Time) bool {
	return (lock.Mode == string(mode) || lock.Mode == string(minio.Compliance)) && !lock.Until.Before(until)
}

func (s *S3) lockOf(ctx context.Context, key, version string) (Lock, error) {
	mode, until, err := s.client.GetObjectRetention(ctx, s.bucket, key, version)
	if err != nil {
		return Lock{}, classify(err)
	}
	if mode == nil || until == nil {
		return Lock{}, fmt.Errorf("%w: no retention on the version", ErrUnsupported)
	}
	return Lock{VersionID: version, Mode: string(*mode), Until: until.UTC()}, nil
}

// Put stores the object; downloads save it as filename (set on the object: not every S3 honours a presigned override).
func (s *S3) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error {
	info, err := s.client.PutObject(ctx, s.bucket, key, body, size, minio.PutObjectOptions{ContentType: contentType,
		ContentDisposition: mime.FormatMediaType("attachment", map[string]string{"filename": filename})})
	if err != nil {
		return fmt.Errorf("storage put %s: %w", key, classify(err))
	}
	return s.record(ctx, key, info.VersionID)
}

// Get reads a whole object (small ones, such as an invoice PDF).
func (s *S3) Get(ctx context.Context, key string) ([]byte, error) {
	obj, err := s.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	b, err := io.ReadAll(obj)
	if err != nil {
		return nil, fmt.Errorf("storage get %s: %w", key, err)
	}
	return b, nil
}

// PresignDownload: a URL that downloads the recorded version of the object until ttl passes, saving it as filename
// (the name may have changed since the upload). Storage serves the bytes; nothing checks them against a digest.
func (s *S3) PresignDownload(ctx context.Context, key string, ttl time.Duration, filename string) (string, error) {
	v, err := s.version(ctx, key)
	if err != nil {
		return "", err
	}
	params := url.Values{"response-content-disposition": {mime.FormatMediaType("attachment", map[string]string{"filename": filename})}}
	if v != "" {
		params.Set("versionId", v)
	}
	u, err := s.client.PresignedGetObject(ctx, s.bucket, key, ttl, params)
	if err != nil {
		return "", fmt.Errorf("storage presign %s: %w", key, err)
	}
	return u.String(), nil
}

// Open streams the recorded version of an object; it can seek, so it serves HTTP range requests.
func (s *S3) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	v, err := s.version(ctx, key)
	if err != nil {
		return nil, err
	}
	return s.OpenVersion(ctx, key, v)
}

// OpenVersion streams one version of an object ("" = the current one), as recorded when a media link was signed.
func (s *S3) OpenVersion(ctx context.Context, key, v string) (io.ReadSeekCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{VersionID: v})
	if err != nil {
		return nil, fmt.Errorf("storage open %s: %w", key, classify(err))
	}
	if _, err := obj.Stat(); err != nil { // GetObject is lazy: a missing object or version only shows here
		_ = obj.Close()
		return nil, fmt.Errorf("storage open %s: %w", key, classify(err))
	}
	return obj, nil
}

// ProxyDownloads: S3_PROXY_DOWNLOADS, see Serve.
func (s *S3) ProxyDownloads() bool { return s.proxy }

// UseMedia makes Serve redirect downloads to m's signed links (MEDIA_URL), ahead of presigning or proxying.
func (s *S3) UseMedia(m *Media) { s.media = m }

// MediaLink: a signed MEDIA_URL link to the recorded version of the object, or "" without UseMedia.
func (s *S3) MediaLink(ctx context.Context, key, filename, contentType string) (string, error) {
	if s.media == nil {
		return "", nil
	}
	v, err := s.version(ctx, key)
	if err != nil {
		return "", err
	}
	return s.media.link(key, v, filename, contentType), nil
}

// Copy duplicates the recorded version of src inside the bucket, without the bytes passing through the API, and
// records the version the copy made.
func (s *S3) Copy(ctx context.Context, src, dst string) error {
	v, err := s.version(ctx, src)
	if err != nil {
		return err
	}
	info, err := s.client.CopyObject(ctx, minio.CopyDestOptions{Bucket: s.bucket, Object: dst},
		minio.CopySrcOptions{Bucket: s.bucket, Object: src, VersionID: v})
	if err != nil {
		return fmt.Errorf("storage copy %s: %w", src, classify(err))
	}
	return s.record(ctx, dst, info.VersionID)
}

// Delete removes the recorded version of key (permanently, on a versioned bucket), or the key itself when no version
// was recorded. A business record's object under retention is refused here, before storage is asked; storage's own
// refusal (Object Lock) is an error too, never a success.
func (s *S3) Delete(ctx context.Context, key string) error {
	blocked, err := s.reg.DeleteBlocked(ctx, key, s.now())
	if err != nil {
		return fmt.Errorf("storage delete %s: %w", key, err)
	}
	if blocked {
		return fmt.Errorf("storage delete %s: %w", key, ErrRetained)
	}
	v, err := s.version(ctx, key)
	if err != nil {
		return err
	}
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{VersionID: v}); err != nil {
		return fmt.Errorf("storage delete %s: %w", key, classify(err))
	}
	if v != "" {
		if err := s.reg.ForgetObjectVersion(ctx, key, v); err != nil {
			return fmt.Errorf("storage delete %s: forget version: %w", key, err)
		}
	}
	return nil
}
