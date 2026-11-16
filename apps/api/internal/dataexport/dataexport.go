// Package dataexport serves the data exports nDSG and GDPR give people: a workspace owner downloads everything the
// workspace holds (records and stored files, as a ZIP), and anyone downloads their own account data (JSON).
package dataexport

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

type Storage interface {
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
}

type Service struct {
	db    *store.Store
	auth  Auth
	files Storage
	log   *slog.Logger
	limit *auth.RateLimiter
	now   func() time.Time
	// snapshots admits one whole-workspace export (billing's own_data_export allowance) and records what it sent
	snapshots func(ctx context.Context, workspaceID string) (settle func(sent int64), err error)
}

// SetSnapshots is startup wiring: the allowance whole-workspace exports count against (billing.ReserveSnapshot).
func (s *Service) SetSnapshots(reserve func(ctx context.Context, workspaceID string) (func(sent int64), error)) {
	s.snapshots = reserve
}

func New(db *store.Store, a Auth, files Storage, log *slog.Logger) *Service {
	// an export reads every record and file: a few an hour is plenty for a person and keeps the database free
	return &Service{db: db, auth: a, files: files, log: log, limit: auth.NewRateLimiter(10, time.Hour), now: time.Now}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/workspace/export", s.auth.SignedIn(s.workspace))
	mux.HandleFunc("GET /api/v1/account/export", s.auth.SignedIn(s.account))
}

var errRate = auth.Error(http.StatusTooManyRequests, "rate_limited", "Wait before starting another export.", nil)

func (s *Service) workspace(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" {
		s.auth.WriteError(w, r, auth.Error(http.StatusForbidden, "forbidden", "Only an owner can export the whole workspace.", nil))
		return
	}
	if !s.limit.Allow(r) {
		s.auth.WriteError(w, r, errRate)
		return
	}
	settle := func(int64) {}
	if s.snapshots != nil {
		var err error
		if settle, err = s.snapshots(r.Context(), sess.Workspace.ID); err != nil {
			s.auth.WriteError(w, r, err)
			return
		}
	}
	out := &sent{ResponseWriter: w, header: func(h http.Header) {
		h.Set("Content-Type", "application/zip")
		h.Set("Content-Disposition", `attachment; filename="helvetly-workspace-`+s.now().Format(time.DateOnly)+`.zip"`)
		h.Set("Cache-Control", "private, no-store")
	}}
	defer func() { settle(out.n) }()
	z := zip.NewWriter(out)
	tables := &zipTables{z: z}
	files, err := s.db.Export(r.Context(), sess.Workspace.ID, store.WorkspaceExportTables, tables, true)
	if err == nil {
		err = tables.close()
	}
	var missing []string
	if err == nil {
		missing, err = s.addFiles(r.Context(), z, files)
	}
	if err == nil {
		err = readme(z, sess.Workspace, s.now(), len(files), missing)
	}
	if err == nil {
		err = z.Close()
	}
	s.finish(w, r, out, err)
}

// addFiles copies each stored object into the ZIP; an object that is gone is listed instead of failing the export.
func (s *Service) addFiles(ctx context.Context, z *zip.Writer, files []store.ExportFile) (missing []string, err error) {
	for _, f := range files {
		body, err := s.files.Open(ctx, f.Key)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			s.log.WarnContext(ctx, "export: stored file not readable", "path", f.Path, "error", err)
			missing = append(missing, f.Path)
			continue
		}
		entry, err := z.Create("files/" + safePath(f.Path))
		if err == nil {
			_, err = io.Copy(entry, body)
		}
		if cerr := body.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return nil, fmt.Errorf("export file %s: %w", f.Path, err)
		}
	}
	return missing, nil
}

// safePath keeps the folder the query chose and makes the rest one file name: a stored name cannot leave its folder.
func safePath(p string) string {
	folder, name, _ := strings.Cut(p, "/")
	name = strings.NewReplacer("/", "_", "\\", "_").Replace(name)
	name = strings.TrimLeft(name, ".")
	if name == "" {
		name = "file"
	}
	return folder + "/" + name
}

func readme(z *zip.Writer, ws store.Workspace, now time.Time, files int, missing []string) error {
	w, err := z.Create("README.txt")
	if err != nil {
		return err
	}
	text := fmt.Sprintf("Helvetly export of the workspace %q (%s), made %s UTC.\n\n"+
		"data/  one JSON file per kind of record, every row including deleted and voided ones; amounts are in minor units.\n"+
		"files/ the stored files: documents, receipts, issued invoice and sent quote PDFs, e-invoice XML, originals sent for signature, the logo.\n\n"+
		"Not included: sign-in secrets, session tokens and each person's Heidi conversations (in their account export).\n"+
		"%d stored files listed.\n", ws.Name, ws.ID, now.UTC().Format(time.DateTime), files)
	if len(missing) > 0 {
		text += "\nThese files could not be read from storage and are missing from this export:\n" + strings.Join(missing, "\n") + "\n"
	}
	_, err = io.WriteString(w, text)
	return err
}

func (s *Service) account(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if !s.limit.Allow(r) {
		s.auth.WriteError(w, r, errRate)
		return
	}
	out := &sent{ResponseWriter: w, header: func(h http.Header) {
		h.Set("Content-Type", "application/json")
		h.Set("Content-Disposition", `attachment; filename="helvetly-account-`+s.now().Format(time.DateOnly)+`.json"`)
		h.Set("Cache-Control", "private, no-store")
	}}
	doc := &jsonTables{w: out}
	_, err := s.db.Export(r.Context(), sess.User.ID, store.UserExportTables, doc, false)
	if err == nil {
		err = doc.close(s.now())
	}
	s.finish(w, r, out, err)
}

// finish reports an error as JSON while nothing was sent; afterwards it cuts the connection, so a partial file
// never looks complete.
func (s *Service) finish(w http.ResponseWriter, r *http.Request, out *sent, err error) {
	if err == nil {
		return
	}
	if !out.started {
		s.auth.WriteError(w, r, err)
		return
	}
	if !errors.Is(err, context.Canceled) {
		s.log.ErrorContext(r.Context(), "export failed while streaming", "route", r.Pattern, "error", err)
	}
	panic(http.ErrAbortHandler)
}

// sent sets the download's headers on the first byte, so an error before it can still be a JSON error.
type sent struct {
	http.ResponseWriter
	header  func(http.Header)
	started bool
	n       int64 // body bytes written
}

func (s *sent) Write(p []byte) (int, error) {
	if !s.started {
		s.started = true
		s.header(s.Header())
	}
	n, err := s.ResponseWriter.Write(p)
	s.n += int64(n)
	return n, err
}

// zipTables writes each table as data/<name>.json, a JSON array.
type zipTables struct {
	z     *zip.Writer
	cur   io.Writer
	first bool
}

func (t *zipTables) Table(name string) error {
	if err := t.close(); err != nil {
		return err
	}
	w, err := t.z.Create("data/" + name + ".json")
	if err != nil {
		return err
	}
	t.cur, t.first = w, true
	_, err = io.WriteString(w, "[")
	return err
}

func (t *zipTables) Row(v json.RawMessage) error {
	sep := ",\n"
	if t.first {
		sep, t.first = "\n", false
	}
	_, err := io.WriteString(t.cur, sep+string(v))
	return err
}

func (t *zipTables) close() error {
	if t.cur == nil {
		return nil
	}
	_, err := io.WriteString(t.cur, "\n]\n")
	t.cur = nil
	return err
}

// jsonTables writes one JSON object: {"<table>": [rows…], …, "exported_at": "…"}.
type jsonTables struct {
	w      io.Writer
	tables int
	first  bool
}

func (t *jsonTables) Table(name string) error {
	open := "{"
	if t.tables > 0 {
		open = "],"
	}
	t.tables++
	t.first = true
	key, _ := json.Marshal(name)
	_, err := io.WriteString(t.w, open+"\n"+string(key)+": [")
	return err
}

func (t *jsonTables) Row(v json.RawMessage) error {
	sep := ","
	if t.first {
		sep, t.first = "", false
	}
	_, err := io.WriteString(t.w, sep+"\n  "+string(v))
	return err
}

func (t *jsonTables) close(now time.Time) error {
	at, _ := json.Marshal(now.UTC())
	_, err := io.WriteString(t.w, "],\n\"exported_at\": "+string(at)+"\n}\n")
	return err
}
