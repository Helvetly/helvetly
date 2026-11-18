package imports

import (
	"context"
	"errors"
	"slices"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

const (
	maxDocumentTags = 10 // as documents' own limits
)

// placeDocument files the source Document of a created record under folder path and adds tags, creating the folders.
// Only a file at the top level, or one the generic AI filing put in its current folder, is moved: a folder the person
// chose is never overridden. A missing or trashed Document is left alone.
func placeDocument(ctx context.Context, q store.Q, sess store.Session, documentID string, path, add []string, now time.Time) error {
	ws := sess.Workspace.ID
	d, err := q.Document(ctx, ws, documentID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && d.DeletedAt != nil) {
		return nil
	}
	if err != nil {
		return err
	}
	if d.FolderID != nil {
		rec, err := q.LockFiling(ctx, ws, documentID)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if rec.Status != "filed" || rec.FolderID == nil || *rec.FolderID != *d.FolderID {
			return nil
		}
	}
	folder, err := q.FolderPath(ctx, ws, sess.User.ID, path, now)
	if err != nil || folder == "" {
		return err
	}
	if d.FolderID == nil || *d.FolderID != folder {
		name := d.Name
		if taken, err := q.FileNameTaken(ctx, ws, &folder, name, d.ID); err != nil {
			return err
		} else if taken != "" {
			if name, err = q.FreeFileName(ctx, ws, &folder, name); err != nil {
				return err
			}
		}
		if err := q.UpdateDocument(ctx, ws, d.ID, name, &folder, now); err != nil {
			return err
		}
	}
	merged := slices.Clone(d.Tags)
	for _, t := range add {
		t = tags.Slug(t)
		if t != "" && !slices.Contains(merged, t) && len(merged) < maxDocumentTags {
			merged = append(merged, t)
		}
	}
	if len(merged) == len(d.Tags) {
		return nil
	}
	return q.SetDocumentTags(ctx, ws, d.ID, merged, now)
}

// invoiceFolder: Invoices/<year of the issue date, or of today when it is not a date>.
func invoiceFolder(issueDate, today string) []string {
	if _, err := time.Parse(time.DateOnly, issueDate); err != nil {
		issueDate = today
	}
	return []string{"Invoices", issueDate[:4]}
}
