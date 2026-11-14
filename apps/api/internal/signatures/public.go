package signatures

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

var (
	errLinkInvalid = auth.Error(http.StatusNotFound, "link_invalid", "This signing link doesn't work. Ask the sender for a new one.", nil)
	errLinkExpired = auth.Error(http.StatusGone, "link_expired", "This signing link has expired. Ask the sender for a new one.", nil)
)

func notSignable(msg string) error { return auth.Error(http.StatusConflict, "not_signable", msg, nil) }

type signingView struct {
	Request struct {
		Title     string    `json:"title"`
		Message   *string   `json:"message"`
		Status    string    `json:"status"`
		Sender    sender    `json:"sender"`
		Workspace string    `json:"workspace"`
		ExpiresAt time.Time `json:"expires_at"`
		PageCount int       `json:"page_count"`
	} `json:"request"`
	Signer struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Email  string `json:"email"`
		Status string `json:"status"`
	} `json:"signer"`
	Fields      []store.SignatureField `json:"fields"`
	ConsentText string                 `json:"consent_text"`
}

type sender struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func senderOf(r store.SignatureRequest) sender {
	if r.CreatedBy == nil {
		return sender{Name: r.WorkspaceName}
	}
	return sender{Name: r.CreatedBy.Name, Email: r.SenderEmail}
}

func view(r store.SignatureRequest, signerID string) signingView {
	var v signingView
	v.Request.Title, v.Request.Message, v.Request.Status = r.Title, r.Message, r.Status
	v.Request.Sender, v.Request.Workspace = senderOf(r), r.WorkspaceName
	v.Request.ExpiresAt, v.Request.PageCount = r.ExpiresAt, r.PageCount
	for _, sg := range r.Signers {
		if sg.ID == signerID {
			v.Signer.ID, v.Signer.Name, v.Signer.Email, v.Signer.Status = sg.ID, sg.Name, sg.Email, sg.Status
		}
	}
	v.Fields = []store.SignatureField{}
	for _, f := range r.Fields {
		if f.SignerID == signerID {
			v.Fields = append(v.Fields, f)
		}
	}
	v.ConsentText = ConsentText
	return v
}

// validToken: what rand.Text makes (base32, 26 characters); anything else is refused before the database.
func validToken(t string) bool {
	if len(t) < 16 || len(t) > 64 {
		return false
	}
	for _, c := range t {
		if (c < 'A' || c > 'Z') && (c < '2' || c > '7') {
			return false
		}
	}
	return true
}

// signer resolves the link's token: the request (statuses derived) and the signer's id.
func (s *Service) signer(ctx context.Context, q store.Q, token string) (store.SignatureRequest, string, error) {
	if !validToken(token) {
		return store.SignatureRequest{}, "", errLinkInvalid
	}
	ws, rid, sid, err := q.SignerByToken(ctx, hashToken(token))
	if errors.Is(err, store.ErrNotFound) {
		return store.SignatureRequest{}, "", errLinkInvalid
	}
	if err != nil {
		return store.SignatureRequest{}, "", err
	}
	r, err := s.load(ctx, q, ws, rid)
	return r, sid, err
}

func signerIn(r store.SignatureRequest, id string) store.Signer {
	for _, sg := range r.Signers {
		if sg.ID == id {
			return sg
		}
	}
	return store.Signer{}
}

func (s *Service) writeView(w http.ResponseWriter, r *http.Request, token string) error {
	req, sid, err := s.signer(r.Context(), s.db.Q, token)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(view(req, sid)))
	return nil
}

// publicView shows the request to the signer; the first visit while it is open records the view.
func (s *Service) publicView(w http.ResponseWriter, r *http.Request) error {
	ctx, token := r.Context(), r.PathValue("token")
	req, sid, err := s.signer(ctx, s.db.Q, token)
	if err != nil {
		return err
	}
	if sg := signerIn(req, sid); req.Status == "pending" && sg.ViewedAt == nil && sg.SignedAt == nil && sg.DeclinedAt == nil {
		err := s.db.Tx(ctx, func(q store.Q) error {
			if err := q.LockSignatureRequest(ctx, req.ID); err != nil {
				return err
			}
			ip, ua := client(r)
			first, err := q.MarkSignerViewed(ctx, sid, s.now(), ip, ua)
			if err != nil || !first {
				return err
			}
			if err := s.event(ctx, q, req.ID, "viewed", &sid, r, nil); err != nil {
				return err
			}
			return notifySender(ctx, q, req, "signature.viewed", map[string]any{"signer": sg.Name}, s.now())
		})
		if err != nil {
			return err
		}
	}
	return s.writeView(w, r, token)
}

func (s *Service) publicDocument(w http.ResponseWriter, r *http.Request) error {
	req, _, err := s.signer(r.Context(), s.db.Q, r.PathValue("token"))
	if err != nil {
		return err
	}
	if req.Status == "revoked" || req.Status == "expired" {
		return errLinkExpired
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	return s.servePDF(w, r, req)
}

type signBody struct {
	Consent   bool `json:"consent"`
	Signature struct {
		Method string `json:"method"`
		Image  string `json:"image"`
	} `json:"signature"`
	Values map[string]string `json:"values"`
}

// decodeSign reads the signing body: as auth's Decode (JSON only, unknown fields refused), with room for the image.
func (s *Service) decodeSign(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); ct != "application/json" {
		s.auth.WriteError(w, r, auth.Error(http.StatusUnsupportedMediaType, "unsupported_media_type", "Send the request as application/json.", nil))
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		s.auth.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "The request body is not valid.", nil))
		return false
	}
	if err := dec.Decode(new(json.RawMessage)); err != io.EOF {
		s.auth.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "The request body is not valid.", nil))
		return false
	}
	return true
}

// signatureImage: the PNG of a data URL, or the reason it can't be used.
func signatureImage(dataURL string) ([]byte, string) {
	raw, ok := strings.CutPrefix(dataURL, "data:image/png;base64,")
	if !ok {
		return nil, "Send the signature as a PNG image."
	}
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(b) > signatureLimit {
		return nil, "The signature image is too large or damaged."
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(b))
	if err != nil || cfg.Width < 10 || cfg.Height < 10 || cfg.Width > 2000 || cfg.Height > 1000 {
		return nil, "The signature image is too large or damaged."
	}
	return b, ""
}

// openFor checks, under the request's lock, that this signer may act on it now.
func openFor(req store.SignatureRequest, sid string) error {
	sg := signerIn(req, sid)
	switch {
	case req.Status == "expired":
		return errLinkExpired
	case req.Status != "pending":
		return notSignable("This request is no longer out for signature.")
	case sg.SignedAt != nil:
		return notSignable("You have already signed.")
	case sg.DeclinedAt != nil:
		return notSignable("You have declined to sign.")
	case !isDue(req, sid):
		return notSignable("It isn't your turn to sign yet.")
	}
	return nil
}

func (s *Service) publicSign(w http.ResponseWriter, r *http.Request) error {
	if s.mail == nil {
		return errMailUnavailable
	}
	var body signBody
	if !s.decodeSign(w, r, &body) {
		return nil
	}
	ctx, token := r.Context(), r.PathValue("token")
	var after func()
	var signed string
	err := s.db.Tx(ctx, func(q store.Q) error {
		req, sid, err := s.signer(ctx, q, token)
		if err != nil {
			return err
		}
		if err := q.LockSignatureRequest(ctx, req.ID); err != nil {
			return err
		}
		if req, err = s.load(ctx, q, req.WorkspaceID, req.ID); err != nil {
			return err
		}
		if err := openFor(req, sid); err != nil {
			return err
		}
		bad := map[string]string{}
		if !body.Consent {
			bad["consent"] = "Agree to sign electronically to continue."
		}
		if body.Signature.Method != "typed" && body.Signature.Method != "drawn" {
			bad["signature"] = "Type or draw your signature."
		}
		img, msg := signatureImage(body.Signature.Image)
		if msg != "" {
			bad["signature"] = msg
		}
		sg := signerIn(req, sid)
		values := map[string]string{}
		for _, f := range req.Fields {
			if f.SignerID != sid {
				continue
			}
			switch f.Kind {
			case "date":
				values[f.ID] = s.now().In(zone(req)).Format("02.01.2006")
			case "name":
				values[f.ID] = sg.Name
			case "text":
				v, msg := PlainText(strings.ReplaceAll(body.Values[f.ID], "\n", " "), maxTextLen)
				if msg != "" {
					bad["values."+f.ID] = msg
				}
				values[f.ID] = v
			}
		}
		for id := range body.Values {
			if _, ok := values[id]; !ok {
				bad["values."+id] = "This isn't one of your text fields."
			}
		}
		if len(bad) > 0 {
			return validationFailed(bad)
		}
		ip, ua := client(r)
		now := s.now()
		if err := q.SignSigner(ctx, sid, now, ip, ua, body.Signature.Method, img); err != nil {
			return err
		}
		for id, v := range values {
			if err := q.SetSignatureFieldValue(ctx, id, v); err != nil {
				return err
			}
		}
		sum := sha256.Sum256(img)
		if err := s.event(ctx, q, req.ID, "signed", &sid, r, map[string]string{"consent": ConsentText,
			"method": body.Signature.Method, "signature_sha256": hex.EncodeToString(sum[:])}); err != nil {
			return err
		}
		if req, err = s.load(ctx, q, req.WorkspaceID, req.ID); err != nil {
			return err
		}
		if next := due(req); len(next) > 0 {
			remaining := 0
			for _, other := range req.Signers {
				if other.SignedAt == nil {
					remaining++
				}
			}
			if err := notifySender(ctx, q, req, "signature.signed", map[string]any{"signer": sg.Name, "remaining": remaining},
				now); err != nil {
				return err
			}
			if req.SigningOrder == "sequential" && signerIn(req, next[0].ID).SentAt == nil {
				after = func() { _ = s.invite(context.WithoutCancel(ctx), req, next, "sent") }
			}
			return nil
		}
		done, err := s.complete(ctx, q, req)
		if err != nil {
			return err
		}
		if err := notifySender(ctx, q, req, "signature.completed", nil, s.now()); err != nil {
			return err
		}
		signed = done.key
		after = func() {
			s.retain(ctx, done.key, done.req.OriginalKey) // locked (the original extended) only once the completion committed
			s.sendCompleted(context.WithoutCancel(ctx), done)
		}
		return nil
	})
	if err != nil {
		if signed != "" {
			s.removeObject(ctx, signed)
		}
		if errors.Is(err, store.ErrAdmissionDenied) {
			return auth.Error(http.StatusConflict, "completion_unavailable", "The completed document cannot be saved right now. Contact the sender so they can make room, then try signing again.", nil)
		}
		return err
	}
	if after != nil {
		after()
	}
	return s.writeView(w, r, token)
}

func (s *Service) publicDecline(w http.ResponseWriter, r *http.Request) error {
	if s.mail == nil {
		return errMailUnavailable
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, token := r.Context(), r.PathValue("token")
	var declined store.SignatureRequest
	var who store.Signer
	err := s.db.Tx(ctx, func(q store.Q) error {
		req, sid, err := s.signer(ctx, q, token)
		if err != nil {
			return err
		}
		if err := q.LockSignatureRequest(ctx, req.ID); err != nil {
			return err
		}
		if req, err = s.load(ctx, q, req.WorkspaceID, req.ID); err != nil {
			return err
		}
		if err := openFor(req, sid); err != nil {
			return err
		}
		reason, msg := PlainText(body.Reason, maxReasonLen)
		if msg != "" {
			return validationFailed(map[string]string{"reason": msg})
		}
		now := s.now()
		if err := q.DeclineSigner(ctx, sid, now, reason); err != nil {
			return err
		}
		if err := q.SetSignatureStatus(ctx, req.ID, "declined", now); err != nil {
			return err
		}
		declined, who = req, signerIn(req, sid)
		who.DeclineReason = &reason
		if err := notifySender(ctx, q, req, "signature.declined", map[string]any{"signer": who.Name, "reason": reason}, now); err != nil {
			return err
		}
		return s.event(ctx, q, req.ID, "declined", &sid, r, map[string]string{"reason": reason})
	})
	if err != nil {
		return err
	}
	if declined.SenderEmail != "" {
		if err := s.mail.Send(ctx, declinedMessage(declined, who)); err != nil {
			s.log.ErrorContext(ctx, "send decline notice", "request", declined.ID, "error", err)
		}
	}
	return s.writeView(w, r, token)
}

func (s *Service) sendCompleted(ctx context.Context, done completed) {
	to := []string{}
	for _, sg := range done.req.Signers {
		to = append(to, sg.Email)
	}
	if done.req.SenderEmail != "" {
		to = append(to, done.req.SenderEmail)
	}
	for i, addr := range to {
		if err := s.mail.Send(ctx, completedMessage(done, addr)); err != nil {
			// the recipient's position, not the address: logs must not carry personal data
			s.log.ErrorContext(ctx, "send signed PDF", "request", done.req.ID, "recipient", i, "error", err)
		}
	}
}

// notifySender tells the person who sent the request (nobody when they are gone).
func notifySender(ctx context.Context, q store.Q, req store.SignatureRequest, event string, data map[string]any, now time.Time) error {
	if req.CreatedBy == nil {
		return nil
	}
	if data == nil {
		data = map[string]any{}
	}
	data["request_id"], data["title"] = req.ID, req.Title
	return notifications.Notify(ctx, q, req.WorkspaceID, event, data, store.NotifyTo{UserIDs: []string{req.CreatedBy.ID}}, now)
}
