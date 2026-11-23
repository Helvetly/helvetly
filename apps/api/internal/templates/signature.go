package templates

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/contractpdf"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// A member's own signature for contracts (Settings → Profile): an image drawn or uploaded, kept as a private object of
// the workspace (never a document, never served to anyone but the member) and the place they sign at, by default the
// workspace's city. Contracts written from a quote print it on the contractor's side with the place and the day.
// Session-only.

const maxPlaceLen = 100

type signatureView struct {
	HasImage     bool   `json:"has_image"`
	Place        string `json:"place"`         // "" = DefaultPlace
	DefaultPlace string `json:"default_place"` // the workspace's city
}

func (s *Service) defaultPlace(ctx context.Context, ws string) (string, error) {
	var settings sellerSettings
	if _, err := s.db.InvoiceSettings(ctx, ws, &settings); err != nil {
		return "", err
	}
	return strings.TrimSpace(settings.Seller.City), nil
}

func (s *Service) signatureView(ctx context.Context, sess store.Session) (signatureView, error) {
	place, err := s.defaultPlace(ctx, sess.Workspace.ID)
	if err != nil {
		return signatureView{}, err
	}
	m, err := s.db.Q.MemberSignatureOf(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return signatureView{}, err
	}
	return signatureView{HasImage: m.ObjectKey != "", Place: m.Place, DefaultPlace: place}, nil
}

func (s *Service) getSignature(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	v, err := s.signatureView(r.Context(), sess)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(v))
	return nil
}

// signatureImage serves the member's own image, to them only, never cached elsewhere.
func (s *Service) signatureImage(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	m, err := s.db.Q.MemberSignatureOf(r.Context(), sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	if m.ObjectKey == "" {
		return store.ErrNotFound
	}
	b, err := s.files.Get(r.Context(), m.ObjectKey)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", m.ContentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, err = w.Write(b)
	return err
}

// putSignatureImage stores a new image (multipart "file", PNG or JPEG of at most 1 MB) and removes the previous one.
func (s *Service) putSignatureImage(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, err := uploads.ReadPhoto(w, r)
	if err != nil {
		return err
	}
	ct, err := uploads.CheckPhoto(b)
	if err != nil {
		return err
	}
	if invoicepdf.CheckLogo(b) != nil {
		return validationFailed(map[string]string{"file": "This image can't be printed: save it as a plain PNG or JPEG."})
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	digest := sha256.Sum256(b)
	sum := hex.EncodeToString(digest[:])
	key := "workspaces/" + ws + "/signatures/" + sess.User.ID + "/" + auth.NewID("sig")
	var old string
	stored := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.LockMemberSignature(ctx, ws, sess.User.ID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if cur.SHA256 == sum {
			return nil
		}
		old = cur.ObjectKey
		if err := q.ReserveObject(ctx, ws, key, int64(len(b)), true, s.now()); err != nil {
			return err
		}
		stored = true
		if err := s.files.Put(ctx, key, bytes.NewReader(b), int64(len(b)), ct, "signature"); err != nil {
			return err
		}
		cur.ObjectKey, cur.ContentType, cur.SHA256, cur.UpdatedAt = key, ct, sum, s.now()
		return q.SetMemberSignature(ctx, ws, sess.User.ID, cur)
	})
	if err != nil {
		if stored {
			s.removeObject(ctx, key)
		}
		return err
	}
	s.removeObject(ctx, old)
	return s.getSignature(w, r, sess)
}

func (s *Service) deleteSignatureImage(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, ws := r.Context(), sess.Workspace.ID
	var old string
	err := s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.LockMemberSignature(ctx, ws, sess.User.ID)
		if err != nil {
			return err
		}
		old = cur.ObjectKey
		cur.ObjectKey, cur.ContentType, cur.SHA256, cur.UpdatedAt = "", "", "", s.now()
		return q.SetMemberSignature(ctx, ws, sess.User.ID, cur)
	})
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	s.removeObject(ctx, old)
	return s.getSignature(w, r, sess)
}

// putSignaturePlace sets where the member signs; empty is the workspace's city.
func (s *Service) putSignaturePlace(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Place string `json:"place"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	place := strings.TrimSpace(in.Place)
	if len([]rune(place)) > maxPlaceLen || strings.ContainsAny(place, "\n\r\t") {
		return validationFailed(map[string]string{"place": "Use one line of at most 100 characters."})
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	err := s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.LockMemberSignature(ctx, ws, sess.User.ID)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		cur.Place, cur.UpdatedAt = place, s.now()
		return q.SetMemberSignature(ctx, ws, sess.User.ID, cur)
	})
	if err != nil {
		return err
	}
	return s.getSignature(w, r, sess)
}

// removeObject deletes an image no one points at; a failure only leaves an orphan for the storage reconciler.
func (s *Service) removeObject(ctx context.Context, key string) {
	if key == "" {
		return
	}
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	if err := s.files.Delete(ctx, key); err != nil {
		s.log.WarnContext(ctx, "orphaned member signature", "key", key, "error", err)
	}
}

// contractorSignature: the member's stored signature for a contract made today, nil without an image. The place is
// theirs, else the workspace's city.
func (s *Service) contractorSignature(ctx context.Context, sess store.Session) (*contractpdf.Signed, error) {
	m, err := s.db.Q.MemberSignatureOf(ctx, sess.Workspace.ID, sess.User.ID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && m.ObjectKey == "") {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	img, err := s.files.Get(ctx, m.ObjectKey)
	if err != nil {
		return nil, err
	}
	place := m.Place
	if place == "" {
		if place, err = s.defaultPlace(ctx, sess.Workspace.ID); err != nil {
			return nil, err
		}
	}
	return &contractpdf.Signed{Image: img, Place: place, Date: sess.Workspace.Today(s.now())}, nil
}

// logSignatureApplied audits that the member's signature was printed on a contract.
func (s *Service) logSignatureApplied(ctx context.Context, q store.Q, sess store.Session, documentID, number string, signed *contractpdf.Signed) error {
	payload, err := json.Marshal(map[string]string{"document_id": documentID, "number": number, "place": signed.Place, "date": signed.Date})
	if err != nil {
		return err
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "contract.signature_applied",
		SubjectType: "document", SubjectID: documentID, ActorID: &sess.User.ID, At: s.now(), Payload: payload})
}
