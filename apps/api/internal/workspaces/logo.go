package workspaces

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/imagecheck"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

const (
	maxLogoSize   = 2 << 20
	logoFormField = "file"
)

// logoRules: a square PNG or JPEG; the interface sends 512 px, the server accepts up to 1024.
var logoRules = imagecheck.Rules{MinSide: 64, MaxSide: 1024, Square: true}

var errLogoAdminOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the workspace logo.", nil)

func logoKey(workspaceID, id string) string {
	return "workspaces/" + workspaceID + "/workspace-logo/" + id
}

func invalidFile(msg string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": map[string]string{logoFormField: msg}})
}

func readLogo(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLogoSize+1<<20)
	if err := r.ParseMultipartForm(maxLogoSize + 1<<20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return nil, invalidFile("Use an image of at most 2 MB.")
		}
		return nil, auth.Error(http.StatusBadRequest, "invalid_request", "Send the logo as multipart/form-data in the field file.", nil)
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	headers := r.MultipartForm.File[logoFormField]
	if len(headers) != 1 {
		return nil, invalidFile("Choose one image.")
	}
	if headers[0].Size > maxLogoSize {
		return nil, invalidFile("Use an image of at most 2 MB.")
	}
	f, err := headers[0].Open()
	if err != nil {
		return nil, fmt.Errorf("open logo upload: %w", err)
	}
	defer f.Close()
	b, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read logo upload: %w", err)
	}
	return b, nil
}

func (s *Service) putLogo(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errLogoAdminOnly)
		return
	}
	b, err := readLogo(w, r)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	ct, problem := imagecheck.Check(b, logoRules)
	if problem != "" {
		s.auth.WriteError(w, r, invalidFile(problem))
		return
	}
	ctx, ws, id := r.Context(), sess.Workspace.ID, auth.NewID("wlg")
	name := "logo.png"
	if ct == "image/jpeg" {
		name = "logo.jpg"
	}
	current, stored := id, false
	var old *string
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockWorkspaceLogo(ctx, ws); err != nil {
			return err
		}
		prev, err := q.WorkspaceLogoID(ctx, ws)
		if err != nil {
			return err
		}
		if prev != nil {
			previous, err := s.files.Get(ctx, logoKey(ws, *prev))
			if err != nil {
				return err
			}
			if sha256.Sum256(previous) == sha256.Sum256(b) { // the same bytes: nothing to store
				current = *prev
				return nil
			}
		}
		key := logoKey(ws, id)
		if err := q.ReserveObject(ctx, ws, key, int64(len(b)), true, s.now()); err != nil {
			return err
		}
		stored = true
		if err := s.files.Put(ctx, key, bytes.NewReader(b), int64(len(b)), ct, name); err != nil {
			return err
		}
		old = prev
		return q.SetWorkspaceLogoID(ctx, ws, &id)
	})
	if err != nil {
		if stored {
			s.removeLogo(ctx, ws, &id)
		}
		s.logoError(w, r, err)
		return
	}
	s.removeLogo(ctx, ws, old)
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"logo_url": store.WorkspaceLogoURL(ws, &current)}})
}

func (s *Service) deleteLogo(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errLogoAdminOnly)
		return
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	var old *string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockWorkspaceLogo(ctx, ws); err != nil {
			return err
		}
		var err error
		if old, err = q.WorkspaceLogoID(ctx, ws); err != nil {
			return err
		}
		if old == nil {
			return store.ErrNotFound
		}
		return q.SetWorkspaceLogoID(ctx, ws, nil)
	})
	if err != nil {
		s.logoError(w, r, err)
		return
	}
	s.removeLogo(ctx, ws, old)
	w.WriteHeader(http.StatusNoContent)
}

// getLogo serves the session workspace's logo to any of its members.
func (s *Service) getLogo(w http.ResponseWriter, r *http.Request, sess store.Session) {
	s.serveLogo(w, r, sess.Workspace.ID, sess.User.ID)
}

// getWorkspaceLogo serves the logo of one of the person's workspaces (the switcher lists them all); a workspace they
// do not belong to answers like one without a logo.
func (s *Service) getWorkspaceLogo(w http.ResponseWriter, r *http.Request, sess store.Session) {
	s.serveLogo(w, r, r.PathValue("id"), sess.User.ID)
}

func (s *Service) serveLogo(w http.ResponseWriter, r *http.Request, workspaceID, userID string) {
	id, err := s.db.MemberWorkspaceLogoID(r.Context(), workspaceID, userID)
	if err == nil && id == nil {
		err = store.ErrNotFound
	}
	if err == nil {
		// The empty billing workspace: a small identity image is app chrome, like the document logo and avatars, and counts
		// against no download allowance. The key and the membership check above are the target workspace's.
		err = storage.Serve(w, r, s.files, "", logoKey(workspaceID, *id), "logo", "")
	}
	if err != nil {
		s.logoError(w, r, err)
	}
}

// logoError: no logo, no such workspace and a workspace of others are all the same 404.
func (s *Service) logoError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		err = auth.ErrNotFound
	}
	s.auth.WriteError(w, r, err)
}

// removeLogo deletes a logo object nothing points at any more; a failure only leaves an orphan behind.
func (s *Service) removeLogo(ctx context.Context, workspaceID string, id *string) {
	if id == nil {
		return
	}
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	if err := s.files.Delete(ctx, logoKey(workspaceID, *id)); err != nil {
		s.log.WarnContext(ctx, "orphaned workspace logo", "workspace", workspaceID, "id", *id, "error", err)
	}
}
