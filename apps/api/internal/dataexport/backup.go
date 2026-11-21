package dataexport

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/store"
)

// backupRetry is how long a deletion whose archive failed waits before the next try.
const backupRetry = time.Hour

// RunBackups stores, every minute, the archive of each workspace deleted since: the owner's whole export plus
// deletion.json (who deleted it, when, and its members), kept for disputes under the records' retention.
func (s *Service) RunBackups(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		s.BackupDeleted(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// BackupDeleted archives the deletions waiting for it; a failure is recorded and tried again after backupRetry.
func (s *Service) BackupDeleted(ctx context.Context) {
	list, err := s.db.PendingBackups(ctx, s.now().Add(-backupRetry), 10)
	if err != nil {
		s.log.ErrorContext(ctx, "list pending workspace backups", "error", err)
		return
	}
	for _, d := range list {
		err := s.backup(ctx, d)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			s.log.ErrorContext(ctx, "workspace backup", "deletion", d.ID, "workspace", d.WorkspaceID, "error", err)
			if err := s.db.BackupFailed(ctx, d.ID, err.Error(), s.now()); err != nil {
				s.log.ErrorContext(ctx, "record workspace backup failure", "deletion", d.ID, "error", err)
			}
		}
	}
}

// BackupKey is where the archive of a deletion is stored.
func BackupKey(d store.PendingBackup) string {
	return "workspaces/" + d.WorkspaceID + "/backups/" + d.ID + ".zip"
}

func (s *Service) backup(ctx context.Context, d store.PendingBackup) error {
	tmp, err := os.CreateTemp("", "helvetly-backup-*.zip") // a workspace's files can be larger than memory
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	defer func() { _ = tmp.Close() }()
	deletion, err := json.MarshalIndent(map[string]any{"deletion_id": d.ID, "workspace_id": d.WorkspaceID,
		"deleted_by": d.DeletedBy, "deleted_at": d.DeletedAt.UTC(), "members": d.Members}, "", "  ")
	if err != nil {
		return err
	}
	z := zip.NewWriter(tmp)
	err = s.writeWorkspace(ctx, z, store.Workspace{ID: d.WorkspaceID, Name: d.Name}, map[string][]byte{"deletion.json": deletion})
	if err == nil {
		err = z.Close()
	}
	if err != nil {
		return fmt.Errorf("write archive: %w", err)
	}
	size, err := tmp.Seek(0, io.SeekEnd)
	if err == nil {
		_, err = tmp.Seek(0, io.SeekStart)
	}
	if err != nil {
		return err
	}
	key := BackupKey(d)
	stored := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockPendingBackup(ctx, d); errors.Is(err, store.ErrNotFound) {
			return nil
		} else if err != nil {
			return err
		}
		if err := s.files.Put(ctx, key, tmp, size, "application/zip", "helvetly-workspace-"+d.WorkspaceID+"-deleted-"+
			d.DeletedAt.UTC().Format(time.DateOnly)+".zip"); err != nil {
			return err
		}
		if err := retention.Request(ctx, q, s.files, d.WorkspaceID, key, d.DeletedAt.UTC().Format(time.DateOnly), s.now()); err != nil {
			return err
		}
		if err := q.BackupStored(ctx, d.ID, key, size, s.now()); err != nil {
			return err
		}
		stored = true
		return nil
	})
	if err != nil || !stored {
		return err
	}
	retention.Settle(ctx, s.db, s.files, s.log, key)
	return nil
}
