package einvoice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type archiveMemory struct {
	mu                     sync.Mutex
	objects                map[string][]byte
	puts, deletes, retains int
	putErr, retainErr      error
	retentionOff           bool
	onPut                  func()
	cleanedCanceled        bool
}

func (f *archiveMemory) Put(_ context.Context, key string, body io.Reader, _ int64, _ string, _ string) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	f.mu.Lock()
	f.puts++
	if f.putErr != nil {
		err = f.putErr
	} else {
		f.objects[key] = data
	}
	hook := f.onPut
	f.mu.Unlock()
	if hook != nil {
		hook()
	}
	return err
}

type archiveReadCloser struct{ *bytes.Reader }

func (archiveReadCloser) Close() error { return nil }
func (f *archiveMemory) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	data, ok := f.objects[key]
	if !ok {
		return nil, errors.New("object missing")
	}
	return archiveReadCloser{bytes.NewReader(bytes.Clone(data))}, nil
}
func (f *archiveMemory) Delete(ctx context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deletes++
	f.cleanedCanceled = ctx.Err() != nil
	delete(f.objects, key)
	return nil
}
func (f *archiveMemory) RetentionMode() string {
	if f.retentionOff {
		return ""
	}
	return "COMPLIANCE"
}
func (f *archiveMemory) RetainUntil(requested time.Time, deadline *time.Time) time.Time {
	if deadline != nil {
		return *deadline
	}
	return requested.AddDate(0, 0, 1)
}
func (f *archiveMemory) Retain(_ context.Context, key string, until time.Time) (storage.Lock, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.retains++
	if f.retainErr != nil {
		return storage.Lock{}, f.retainErr
	}
	return storage.Lock{VersionID: "v1", Mode: "COMPLIANCE", Until: until}, nil
}

type archiveAuth struct {
	*auth.Service
	sess store.Session
}

func (a archiveAuth) SignedIn(h func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { h(w, r, a.sess) }
}

type archiveEnv struct {
	db    *store.Store
	raw   *pgxpool.Pool
	files *archiveMemory
	svc   *Service
	sess  store.Session
	mux   *http.ServeMux
}

func newArchiveEnv(t *testing.T) *archiveEnv { return newArchiveEnvWith(t, simple()) }

func newArchiveEnvWith(t *testing.T, inv store.Invoice) *archiveEnv {
	t.Helper()
	t.Parallel()
	db, raw := storetest.New(t)
	now := time.Now().UTC()
	ctx := context.Background()
	u := store.User{ID: "usr_archive", Email: "archive@example.com", Name: "Archive user"}
	w := store.Workspace{ID: "wsp_archive", Name: "Archive company", Timezone: "UTC"}
	if err := db.CreateUser(ctx, u, now); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateWorkspace(ctx, w, "UTC", now); err != nil {
		t.Fatal(err)
	}
	if err := db.AddMember(ctx, w.ID, u.ID, "owner", now); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(ctx, `INSERT INTO clients(id,workspace_id,number,name,created_at,updated_at)VALUES('cli_archive',$1,1,'XML buyer',now(),now())`, w.ID); err != nil {
		t.Fatal(err)
	}
	inv.Language = "en"
	inv.ClientID = "cli_archive"
	for i := range inv.Lines {
		inv.Lines[i].ID = auth.NewID("lin")
		inv.Lines[i].Unit = nil
	}
	if err := db.SaveDraft(ctx, w.ID, inv, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Issue(ctx, w.ID, inv, 42, now); err != nil {
		t.Fatal(err)
	}
	real, err := auth.New(config.Config{PublicURL: "http://localhost", SecretKey: bytes.Repeat([]byte{4}, 32), SessionTTL: time.Hour}, db, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	sess := store.Session{ID: "ses_archive", User: u, Workspace: w, Role: "owner"}
	files := &archiveMemory{objects: map[string][]byte{}}
	svc := New(db, archiveAuth{real, sess}, files)
	mux := http.NewServeMux()
	svc.Register(mux)
	return &archiveEnv{db, raw, files, svc, sess, mux}
}
func (e *archiveEnv) get(ctx context.Context, format string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/invoices/inv-1/einvoice?format="+format, nil).WithContext(ctx)
	e.mux.ServeHTTP(w, r)
	return w
}

func TestXMLFirstExportIsArchivedAndReused(t *testing.T) {
	e := newArchiveEnv(t)
	first := e.get(context.Background(), "xrechnung-ubl")
	if first.Code != 200 {
		t.Fatalf("first: %d %s", first.Code, first.Body.String())
	}
	second := e.get(context.Background(), "xrechnung-ubl")
	if second.Code != 200 || !bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) {
		t.Fatal("archive was not reused")
	}
	if e.files.puts != 1 {
		t.Fatalf("stored objects %d, expected one immutable XML", e.files.puts)
	}
	digest := sha256.Sum256(first.Body.Bytes())
	if first.Header().Get("X-Helvetly-XML-SHA256") != hex.EncodeToString(digest[:]) {
		t.Fatal("missing or incorrect archive digest")
	}
	if first.Header().Get("X-Helvetly-XML-Archived-At") != second.Header().Get("X-Helvetly-XML-Archived-At") {
		t.Fatal("archive timestamp changed on repeat download")
	}
}

func TestXMLArchiveDoesNotUseAnUpgradedSerializer(t *testing.T) {
	e := newArchiveEnv(t)
	first := e.get(context.Background(), "xrechnung-ubl")
	if first.Code != 200 {
		t.Fatal(first.Body.String())
	}
	called := false
	got, err := e.svc.archive(context.Background(), e.sess, simple(), "xrechnung-ubl", func(store.Invoice) ([]byte, error) { called = true; return []byte("changed serializer output"), nil })
	if err != nil || called || !bytes.Equal(got.bytes, first.Body.Bytes()) {
		t.Fatalf("historical XML regenerated: called=%v err=%v", called, err)
	}
}

func TestXMLArchiveCorruptionNeverRegenerates(t *testing.T) {
	for _, kind := range []string{"same-size", "extra-bytes", "missing"} {
		t.Run(kind, func(t *testing.T) {
			e := newArchiveEnv(t)
			first := e.get(context.Background(), "xrechnung-cii")
			if first.Code != 200 {
				t.Fatal(first.Body.String())
			}
			record, err := e.db.InvoiceXML(context.Background(), e.sess.Workspace.ID, "inv-1", "xrechnung-cii")
			if err != nil {
				t.Fatal(err)
			}
			e.files.mu.Lock()
			data := e.files.objects[record.ObjectKey]
			switch kind {
			case "same-size":
				data[0] ^= 1
			case "extra-bytes":
				e.files.objects[record.ObjectKey] = append(data, 0)
			case "missing":
				delete(e.files.objects, record.ObjectKey)
			}
			e.files.mu.Unlock()
			got := e.get(context.Background(), "xrechnung-cii")
			expected := 500
			if kind == "missing" {
				expected = 503
			}
			if got.Code != expected || e.files.puts != 1 {
				t.Fatalf("corrupt archive: status=%d puts=%d", got.Code, e.files.puts)
			}
		})
	}
}

func TestXMLArchiveConcurrentExportsHaveOneArtifact(t *testing.T) {
	e := newArchiveEnv(t)
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 8)
	for range 8 {
		wg.Go(func() { results <- e.get(context.Background(), "peppol") })
	}
	wg.Wait()
	close(results)
	var first []byte
	for result := range results {
		if result.Code != 200 {
			t.Fatalf("export: %d %s", result.Code, result.Body.String())
		}
		if first == nil {
			first = bytes.Clone(result.Body.Bytes())
		} else if !bytes.Equal(first, result.Body.Bytes()) {
			t.Fatal("concurrent exports differ")
		}
	}
	if e.files.puts != 1 {
		t.Fatalf("PUTs %d", e.files.puts)
	}
	var count int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE kind='invoice.xml_archived'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("archive events %d: %v", count, err)
	}
}

func TestXMLArchiveFailedWritesAndCancellationCleanup(t *testing.T) {
	for _, kind := range []string{"put", "database", "canceled"} {
		t.Run(kind, func(t *testing.T) {
			e := newArchiveEnv(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch kind {
			case "put":
				e.files.putErr = errors.New("failed PUT")
			case "database":
				if _, err := e.raw.Exec(context.Background(), `CREATE FUNCTION reject_xml_archive() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture failure'; END;$$; CREATE TRIGGER reject_xml_archive BEFORE INSERT ON invoice_xml_exports FOR EACH ROW EXECUTE FUNCTION reject_xml_archive()`); err != nil {
					t.Fatal(err)
				}
			case "canceled":
				e.files.onPut = cancel
			}
			got := e.get(ctx, "xrechnung-ubl")
			if got.Code == 200 {
				t.Fatal("failed export returned XML")
			}
			if len(e.files.objects) != 0 || e.files.deletes != 1 || e.files.cleanedCanceled {
				t.Fatalf("cleanup: objects=%d deletes=%d canceled=%v", len(e.files.objects), e.files.deletes, e.files.cleanedCanceled)
			}
			var count int
			if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM invoice_xml_exports`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("uncommitted archives %d: %v", count, err)
			}
			if e.files.retains != 0 {
				t.Fatal("uncommitted object retained")
			}
		})
	}
}

// A failed lock leaves the archived XML served and verified but unprotected and pending; the job's retry confirms it.
func TestXMLArchiveRetentionRetriesWithoutChangingBytes(t *testing.T) {
	e := newArchiveEnv(t)
	ctx := context.Background()
	e.files.retainErr = errors.New("retention temporarily unavailable")
	first := e.get(ctx, "xrechnung-ubl")
	if first.Code != 200 {
		t.Fatalf("export with a failed lock: %d %s", first.Code, first.Body.String())
	}
	record, err := e.db.InvoiceXML(ctx, e.sess.Workspace.ID, "inv-1", "xrechnung-ubl")
	if err != nil || record.Retained {
		t.Fatalf("unprotected XML shown as retained: %+v %v", record, err)
	}
	if r, err := e.db.Retention(ctx, record.ObjectKey); err != nil || r.Status != store.RetentionFailed {
		t.Fatalf("failed lock: %+v %v", r, err)
	}
	e.files.retainErr = nil
	second := e.get(ctx, "xrechnung-ubl")
	if second.Code != 200 || second.Body.String() != first.Body.String() || e.files.puts != 1 || e.files.deletes != 0 {
		t.Fatalf("second export: %d, puts=%d, deletes=%d", second.Code, e.files.puts, e.files.deletes)
	}
	if err := retention.NewJob(e.db, e.files, slog.New(slog.NewTextHandler(io.Discard, nil))).Tick(ctx, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if record, err = e.db.InvoiceXML(ctx, e.sess.Workspace.ID, "inv-1", "xrechnung-ubl"); err != nil || !record.Retained {
		t.Fatalf("after the retry: %+v %v", record, err)
	}
}

// With protection off the XML is archived and verified as before, and never marked retained.
func TestXMLArchiveWithProtectionOffIsNeverRetained(t *testing.T) {
	e := newArchiveEnv(t)
	ctx := context.Background()
	e.files.retentionOff = true
	if w := e.get(ctx, "xrechnung-ubl"); w.Code != 200 {
		t.Fatalf("export: %d %s", w.Code, w.Body.String())
	}
	record, err := e.db.InvoiceXML(ctx, e.sess.Workspace.ID, "inv-1", "xrechnung-ubl")
	if err != nil || record.Retained || e.files.retains != 0 {
		t.Fatalf("protection off: %+v, locks %d, %v", record, e.files.retains, err)
	}
	if r, _ := e.db.Retention(ctx, record.ObjectKey); r.Status != store.RetentionNotRequested {
		t.Fatalf("protection off: %+v", r)
	}
}

func TestXMLArchiveIsAppendOnlyAndTenantIsolated(t *testing.T) {
	e := newArchiveEnv(t)
	first := e.get(context.Background(), "xrechnung-ubl")
	if first.Code != 200 {
		t.Fatal(first.Body.String())
	}
	for _, sql := range []string{`UPDATE invoice_xml_exports SET serializer_version='modified'`, `DELETE FROM invoice_xml_exports`, `TRUNCATE invoice_xml_exports CASCADE`} {
		if _, err := e.raw.Exec(context.Background(), sql); err == nil {
			t.Fatalf("archive mutation allowed: %s", sql)
		}
	}
	a := e.svc.auth.(archiveAuth)
	a.sess.Workspace.ID = "wsp_foreign"
	foreign := New(e.db, a, e.files)
	mux := http.NewServeMux()
	foreign.Register(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/invoices/inv-1/einvoice?format=xrechnung-ubl", nil))
	if w.Code != 404 {
		t.Fatalf("foreign archive leaked: %d %s", w.Code, w.Body.String())
	}
	if _, err := e.db.InvoiceXML(context.Background(), "wsp_foreign", "inv-1", "xrechnung-ubl"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("foreign metadata leaked: %v", err)
	}
	record, err := e.db.InvoiceXML(context.Background(), e.sess.Workspace.ID, "inv-1", "xrechnung-ubl")
	if err != nil {
		t.Fatal(err)
	}
	backend := xmlArchive{db: e.db, files: e.files, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	backend.cleanup(context.Background(), e.sess.Workspace.ID, "inv-1", "xrechnung-ubl", record.ObjectKey)
	if e.files.deletes != 0 || len(e.files.objects) != 1 {
		t.Fatal("uncertain-commit cleanup deleted a referenced object")
	}
}
