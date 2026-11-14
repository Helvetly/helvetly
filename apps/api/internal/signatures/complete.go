package signatures

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/store"
)

type completed struct {
	req  store.SignatureRequest
	name string
	pdf  []byte
	sum  string
	key  string // the stored signed PDF: the caller retains it after the commit, or removes it after a rollback
}

// complete finishes the request in the transaction of the last signature: the stamped PDF with its certificate is
// stored, filed in Documents next to the source and linked to the request (a business record from then on).
// shortcut: the original is read and stamped under the request's lock (one request, bounded by the upload limit);
// moving it out needs a two-step completion with recovery, worth it only if signing at scale shows lock waits.
func (s *Service) complete(ctx context.Context, q store.Q, req store.SignatureRequest) (completed, error) {
	original, err := s.files.Get(ctx, req.OriginalKey)
	if err != nil {
		return completed{}, err
	}
	// the certificate vouches for original_sha256: never stamp other bytes under it
	if sum := sha256.Sum256(original); hex.EncodeToString(sum[:]) != req.OriginalSHA256 {
		s.log.ErrorContext(ctx, "frozen original changed", "request", req.ID, "key", req.OriginalKey)
		return completed{}, auth.Error(http.StatusConflict, "original_changed",
			"The document changed after it was sent, so it can't be signed. Ask the sender to send it again.", nil)
	}
	images, err := q.SignatureImages(ctx, req.ID)
	if err != nil {
		return completed{}, err
	}
	events, err := q.SignatureEvents(ctx, req.ID)
	if err != nil {
		return completed{}, err
	}
	fields := make([]signpdf.Field, 0, len(req.Fields))
	for _, f := range req.Fields {
		fields = append(fields, signpdf.Field{Page: f.Page, Kind: f.Kind, X: f.X, Y: f.Y, W: f.W, H: f.H, Value: deref(f.Value),
			Image: images[f.SignerID]})
	}
	now := s.now()
	cert := signpdf.Certificate{RequestID: req.ID, Title: req.Title, Sender: senderOf(req).Name, Workspace: req.WorkspaceName, Zone: zone(req),
		OriginalSHA256: req.OriginalSHA256, Consent: ConsentText, Created: req.CreatedAt, Completed: now}
	if len(events) > 0 {
		cert.AuditHash = events[len(events)-1].Hash
	}
	for _, sg := range req.Signers {
		c := signpdf.Signer{Name: sg.Name, Email: sg.Email, IP: deref(sg.SignedIP), UserAgent: deref(sg.SignedUA),
			Method: deref(sg.SignatureMethod)}
		if sg.ViewedAt != nil {
			c.Viewed = *sg.ViewedAt
		}
		if sg.SignedAt != nil {
			c.Signed = *sg.SignedAt
		}
		cert.Signers = append(cert.Signers, c)
	}
	pdf, err := signpdf.Stamp(original, fields, cert)
	if err != nil {
		return completed{}, fmt.Errorf("stamp %s: %w", req.ID, err)
	}
	sum := sha256.Sum256(pdf)
	done := completed{req: req, pdf: pdf, sum: hex.EncodeToString(sum[:])}

	folder := req.FolderID
	if folder != nil {
		if _, err := q.DocumentFolder(ctx, req.WorkspaceID, *folder); errors.Is(err, store.ErrNotFound) {
			folder = nil // the folder was trashed or deleted since: the top level
		} else if err != nil {
			return completed{}, err
		}
	}
	if err := q.LockContainer(ctx, req.WorkspaceID, folder); err != nil {
		return completed{}, err
	}
	done.name = fileName(req.Title) + " – signed.pdf"
	if taken, err := q.FileNameTaken(ctx, req.WorkspaceID, folder, done.name, ""); err != nil {
		return completed{}, err
	} else if taken != "" {
		if done.name, err = q.FreeFileName(ctx, req.WorkspaceID, folder, done.name); err != nil {
			return completed{}, err
		}
	}
	userID := ""
	if req.CreatedBy != nil {
		userID = req.CreatedBy.ID
	}
	docID := auth.NewID("doc")
	key := "workspaces/" + req.WorkspaceID + "/documents/" + docID + "/signed.pdf"
	if err := q.Admit(ctx, req.WorkspaceID, "storage_bytes", int64(len(pdf))); err != nil {
		return completed{}, err
	}
	if err := s.files.Put(ctx, key, bytes.NewReader(pdf), int64(len(pdf)), "application/pdf", done.name); err != nil {
		return completed{}, err
	}
	done.key = key
	if err := retention.Request(ctx, q, s.files, req.WorkspaceID, key, latestDay(now), now); err != nil {
		return completed{}, err
	}
	// the original is part of the signed contract: its deadline now counts from the completion too
	if err := retention.Request(ctx, q, s.files, req.WorkspaceID, req.OriginalKey, latestDay(now), now); err != nil {
		return completed{}, err
	}
	err = func() error {
		if err := q.CreateDocument(ctx, req.WorkspaceID, userID, store.Document{ID: docID, FolderID: folder, Name: done.name,
			Size: int64(len(pdf)), ContentType: "application/pdf", SHA256: &done.sum, ObjectKey: key, CreatedAt: now}); err != nil {
			return err
		}
		if err := q.AddDocumentLink(ctx, req.WorkspaceID, docID, "signature", req.ID, userID, now); err != nil {
			return err
		}
		if err := q.CompleteSignatureRequest(ctx, req.ID, docID, done.sum, now); err != nil {
			return err
		}
		return s.event(ctx, q, req.ID, "completed", nil, nil, map[string]string{"document_id": docID, "final_sha256": done.sum})
	}()
	if err != nil {
		s.removeObject(ctx, key)
		return completed{}, err
	}
	done.req.SignedDocument = &store.FolderRef{ID: docID, Name: done.name}
	return done, nil
}

// latestDay: the civil date of now in the time zone furthest ahead (UTC+14), never earlier than any workspace's, so a
// deadline counted from it never ends a year early around New Year.
func latestDay(now time.Time) string { return now.UTC().Add(14 * time.Hour).Format(time.DateOnly) }
