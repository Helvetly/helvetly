package documents

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// A ZIP of a Documents view above zipStream bytes is built in the background: queued by the member, built by
// RunZipExports (one at a time per workspace), stored under the workspace's exports prefix outside the documents
// and storage accounting, announced in the member's bell and deleted zipKeep after it is ready.
const (
	zipKeep  = 7 * 24 * time.Hour
	zipLease = 15 * time.Minute // longer than building the biggest ZIP allowed takes; a dead instance's claim lapses
	zipTries = 3
)

func zipExportKey(e store.ZipExport) string {
	return "workspaces/" + e.WorkspaceID + "/exports/documents-" + e.ID + ".zip"
}

// queueZip queues the ZIP of a view (the same query as groupZip) for the member; one pending at a time each.
func (s *Service) queueZip(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	_, f, files, total, err := s.zipSelection(r, sess)
	if err != nil {
		return err
	}
	v := r.URL.Query()
	v.Del("check")
	e := store.ZipExport{ID: auth.NewID("zip"), WorkspaceID: sess.Workspace.ID, UserID: sess.User.ID, Query: v.Encode(),
		Zone: sess.Workspace.Zone(), Name: zipName(f), Status: "pending", Files: len(files), Bytes: total, CreatedAt: s.now()}
	queued, err := s.db.QueueZipExport(r.Context(), e)
	if err != nil {
		return err
	}
	if !queued {
		return refuse(http.StatusConflict, "zip_pending", "A ZIP is already being prepared. We'll notify you when it's ready.", nil)
	}
	auth.WriteJSON(w, http.StatusAccepted, data(e))
	return nil
}

// zipExports lists the member's own exports in the workspace (pending, ready, recently failed).
func (s *Service) zipExports(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.ZipExports(r.Context(), sess.Workspace.ID, sess.User.ID, s.now())
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

// zipExport: one of the member's own exports, by id, while its row lasts (the bell's link outlives the list's ten).
func (s *Service) zipExport(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.db.ZipExport(r.Context(), sess.Workspace.ID, sess.User.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if e.Status == "ready" && (e.ExpiresAt == nil || !s.now().Before(*e.ExpiresAt)) {
		e.Status = "expired" // past its time, before the cleanup deletes it
	}
	auth.WriteJSON(w, http.StatusOK, data(e))
	return nil
}

// downloadZip serves a ready export to the member who asked for it, while it lasts.
func (s *Service) downloadZip(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.db.ZipExport(r.Context(), sess.Workspace.ID, sess.User.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	switch {
	case e.Status == "pending":
		return refuse(http.StatusConflict, "zip_pending", "This ZIP is still being prepared.", nil)
	case e.Status != "ready" || e.ExpiresAt == nil || !s.now().Before(*e.ExpiresAt):
		return refuse(http.StatusGone, "zip_expired", "This ZIP is no longer available. Download it again from Documents.", nil)
	}
	return storage.Serve(w, r, s.files, e.WorkspaceID, e.ObjectKey, e.Name, "application/zip")
}

// RunZipExports builds queued ZIPs and deletes stale ones, every few seconds, until ctx ends.
func (s *Service) RunZipExports(ctx context.Context) {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		s.ZipExportsTick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// ZipExportsTick deletes stale exports, then builds what is due, one after another.
func (s *Service) ZipExportsTick(ctx context.Context) {
	s.deleteStaleZips(ctx)
	for ctx.Err() == nil {
		var e store.ZipExport
		err := s.db.Tx(ctx, func(q store.Q) (err error) {
			e, err = q.ClaimZipExport(ctx, s.now(), zipLease)
			return err
		})
		if errors.Is(err, store.ErrNotFound) {
			return
		}
		if err != nil {
			s.log.ErrorContext(ctx, "claim zip export", "error", err)
			return
		}
		s.buildZipExport(ctx, e)
	}
}

func (s *Service) buildZipExport(ctx context.Context, e store.ZipExport) {
	key, files, size, err := s.storeZip(ctx, e)
	reason := ""
	if err != nil {
		if ctx.Err() != nil {
			return // shutting down: the claim lapses and the next start builds it
		}
		s.log.ErrorContext(ctx, "build zip export", "export", e.ID, "attempt", e.Attempts, "error", err)
		var p *problem
		if !errors.As(err, &p) && e.Attempts < zipTries {
			return // the claim lapses and it is tried again
		}
		if p != nil {
			reason = p.reason
		}
		key = ""
	}
	now := s.now()
	finished := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		var err error
		if finished, err = q.FinishZipExport(ctx, e.ID, key, files, size, now, now.Add(zipKeep)); err != nil || !finished {
			return err
		}
		d := map[string]any{"export_id": e.ID, "name": e.Name, "files": files}
		if key == "" {
			d = map[string]any{"export_id": e.ID, "failed": true, "reason": reason}
		} else if err := s.logExport(ctx, q, e.WorkspaceID, e.UserID, map[string]any{"export": e.ID, "query": e.Query,
			"files": files, "bytes": size}); err != nil {
			return err
		}
		return notifications.Notify(ctx, q, e.WorkspaceID, "documents.zip_ready", d, store.NotifyTo{UserIDs: []string{e.UserID}}, now)
	})
	if (err != nil || !finished) && key != "" {
		if derr := s.files.Delete(context.WithoutCancel(ctx), key); derr != nil {
			s.log.ErrorContext(ctx, "delete unrecorded zip export", "key", key, "error", derr)
		}
	}
	if err != nil {
		s.log.ErrorContext(ctx, "finish zip export", "export", e.ID, "error", err)
	}
}

// storeZip builds e's ZIP in a temporary file and stores it; a refusal (no files left, too many) is a *problem.
func (s *Service) storeZip(ctx context.Context, e store.ZipExport) (string, int, int64, error) {
	v, err := url.ParseQuery(e.Query)
	if err != nil {
		return "", 0, 0, err
	}
	f, err := parseFilter(v, e.Zone)
	if err != nil {
		return "", 0, 0, err
	}
	dims, err := groupDims(&http.Request{URL: &url.URL{RawQuery: e.Query}})
	if err != nil {
		return "", 0, 0, err
	}
	files, total, err := s.zipFilesOf(ctx, e.WorkspaceID, f)
	if err != nil {
		return "", 0, 0, err
	}
	tmp, err := os.CreateTemp("", "helvetly-zip-*.zip")
	if err != nil {
		return "", 0, 0, err
	}
	defer func() { _ = tmp.Close(); _ = os.Remove(tmp.Name()) }()
	if err := s.writeZip(ctx, tmp, files, dims, f); err != nil {
		return "", 0, 0, err
	}
	size, err := tmp.Seek(0, 1)
	if err != nil {
		return "", 0, 0, err
	}
	if _, err := tmp.Seek(0, 0); err != nil {
		return "", 0, 0, err
	}
	key := zipExportKey(e)
	if err := s.files.Put(ctx, key, tmp, size, "application/zip", e.Name); err != nil {
		return "", 0, 0, err
	}
	return key, len(files), total, nil
}

// deleteStaleZips deletes expired exports and those of deleted workspaces or former members: the object first, the
// row once storage confirmed it.
func (s *Service) deleteStaleZips(ctx context.Context) {
	stale, err := s.db.StaleZipExports(ctx, s.now())
	if err != nil {
		s.log.ErrorContext(ctx, "list stale zip exports", "error", err)
		return
	}
	for _, e := range stale {
		if e.ObjectKey != "" {
			if err := s.files.Delete(ctx, e.ObjectKey); err != nil {
				s.log.ErrorContext(ctx, "delete zip export", "export", e.ID, "error", err)
				continue
			}
		}
		if err := s.db.DeleteZipExport(ctx, e.ID); err != nil {
			s.log.ErrorContext(ctx, "delete zip export row", "export", e.ID, "error", err)
		}
	}
}
