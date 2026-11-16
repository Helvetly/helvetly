package invoices

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // DecodeConfig of uploaded logos
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

const (
	logoPath      = "/api/v1/invoice-settings/logo"
	maxLogoSize   = 2 << 20
	minLogoSide   = 64
	maxLogoSide   = 4000
	logoFormField = "file"
)

func logoKey(workspaceID, id string) string {
	return "workspaces/" + workspaceID + "/invoice-settings/" + id
}

// checkLogo validates an upload by its bytes, never its name: a PNG or JPEG of sane size that the PDF
// renderer can embed. It returns the content type to store.
func checkLogo(b []byte) (string, error) {
	invalid := func(msg string) (string, error) { return "", validationFailed(map[string]string{logoFormField: msg}) }
	ct := http.DetectContentType(b)
	switch {
	case ct == "image/webp":
		return invalid("WebP is not supported: upload the logo as PNG or JPEG.")
	case strings.Contains(ct, "xml") || bytes.Contains(b[:min(len(b), 1024)], []byte("<svg")):
		return invalid("SVG is not supported: upload the logo as PNG or JPEG.")
	case ct != "image/png" && ct != "image/jpeg":
		return invalid("Upload the logo as a PNG or JPEG image.")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return invalid("This image cannot be read: upload another PNG or JPEG.")
	}
	if min(cfg.Width, cfg.Height) >= minLogoSide && max(cfg.Width, cfg.Height) <= maxLogoSide {
		if _, _, err := image.Decode(bytes.NewReader(b)); err != nil { // the header alone can hide a truncated file
			return invalid("This image cannot be read: upload another PNG or JPEG.")
		}
	}
	if min(cfg.Width, cfg.Height) < minLogoSide || max(cfg.Width, cfg.Height) > maxLogoSide {
		return invalid(fmt.Sprintf("Use an image of at least %d px on its short side and at most %d px on its long side (this one is %d × %d).",
			minLogoSide, maxLogoSide, cfg.Width, cfg.Height))
	}
	if err := invoicepdf.CheckLogo(b); err != nil {
		return invalid("This image format cannot go into a PDF (for example an interlaced or 16-bit PNG): save it as a plain PNG or JPEG.")
	}
	return ct, nil
}

func readLogo(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLogoSize+1<<20)
	if err := r.ParseMultipartForm(maxLogoSize + 1<<20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return nil, validationFailed(map[string]string{logoFormField: "Use an image of at most 2 MB."})
		}
		return nil, badRequest("Send the logo as multipart/form-data in the field file.")
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	headers := r.MultipartForm.File[logoFormField]
	if len(headers) != 1 {
		return nil, validationFailed(map[string]string{logoFormField: "Choose one image."})
	}
	if headers[0].Size > maxLogoSize {
		return nil, validationFailed(map[string]string{logoFormField: "Use an image of at most 2 MB."})
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

// putLogo stores the new logo, points the settings at it, then removes the previous object.
func (s *Service) putLogo(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, err := readLogo(w, r)
	if err != nil {
		return err
	}
	ct, err := checkLogo(b)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), auth.NewID("lgo")
	key := logoKey(sess.Workspace.ID, id)
	name := "logo.png"
	if ct == "image/jpeg" {
		name = "logo.jpg"
	}
	var set Settings
	var old *string
	stored := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockInvoiceSettings(ctx, sess.Workspace.ID); err != nil {
			return err
		}
		var err error
		if set, err = loadSettings(ctx, q, sess.Workspace.ID); err != nil {
			return err
		}
		if set.LogoFileID != nil {
			previous, err := s.logoBytes(ctx, sess.Workspace.ID, set)
			if err != nil {
				return err
			}
			if sha256.Sum256(previous) == sha256.Sum256(b) {
				return nil
			}
		}
		if err := q.ReserveObject(ctx, sess.Workspace.ID, key, int64(len(b)), true, s.now()); err != nil {
			return err
		}
		stored = true
		if err := s.files.Put(ctx, key, bytes.NewReader(b), int64(len(b)), ct, name); err != nil {
			return err
		}
		old, set.LogoFileID = set.LogoFileID, &id
		set.derive()
		return q.PutInvoiceSettings(ctx, sess.Workspace.ID, set, s.now())
	})
	if err != nil {
		if stored {
			s.removeLogo(ctx, sess, &id)
		}
		return err
	}
	s.removeLogo(ctx, sess, old)
	auth.WriteJSON(w, http.StatusOK, data(set))
	return nil
}

func (s *Service) deleteLogo(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	_, old, err := s.setLogo(r.Context(), sess, nil)
	if err != nil {
		return err
	}
	if old == nil {
		return store.ErrNotFound
	}
	s.removeLogo(r.Context(), sess, old)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// setLogo saves logo_file_id and returns the settings and the previous id.
func (s *Service) setLogo(ctx context.Context, sess store.Session, id *string) (Settings, *string, error) {
	var set Settings
	var old *string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockInvoiceSettings(ctx, sess.Workspace.ID); err != nil {
			return err
		}
		var err error
		if set, err = loadSettings(ctx, q, sess.Workspace.ID); err != nil {
			return err
		}
		old, set.LogoFileID = set.LogoFileID, id
		set.derive()
		return q.PutInvoiceSettings(ctx, sess.Workspace.ID, set, s.now())
	})
	return set, old, err
}

// removeLogo deletes a logo object no setting points at any more; a failure only leaves an orphan behind.
func (s *Service) removeLogo(ctx context.Context, sess store.Session, id *string) {
	if id == nil {
		return
	}
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	if err := s.files.Delete(ctx, logoKey(sess.Workspace.ID, *id)); err != nil {
		s.log.WarnContext(ctx, "orphaned logo", "workspace", sess.Workspace.ID, "id", *id, "error", err)
	}
}

func (s *Service) getLogo(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	set, err := loadSettings(r.Context(), s.db.Q, sess.Workspace.ID)
	if err != nil {
		return err
	}
	if set.LogoFileID == nil {
		return store.ErrNotFound
	}
	return storage.Serve(w, r, s.files, "", logoKey(sess.Workspace.ID, *set.LogoFileID), "logo", "")
}

// logoBytes: the current logo for a PDF, nil when none is set.
func (s *Service) logoBytes(ctx context.Context, workspaceID string, set Settings) ([]byte, error) {
	if set.LogoFileID == nil {
		return nil, nil
	}
	return s.files.Get(ctx, logoKey(workspaceID, *set.LogoFileID))
}
