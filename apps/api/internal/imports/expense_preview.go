package imports

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Receipt autofill: the expense form sends up to five files, the pages of one receipt or supplier invoice, and gets
// the checked reading (receipt reading v2) back, to review. Nothing is stored: no expense, document, import batch or
// file; only the AI usage ledger counts the call.

const (
	previewMaxFiles  = 5
	previewMaxOutput = 8192       // line items make the answer long
	previewMaxPixels = 50_000_000 // decoded size, so a small file cannot unpack into gigabytes
	previewOverhead  = 64 << 10   // multipart framing and the request id, on top of the files
)

var previewRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// previewFile is one page sent for reading.
type previewFile struct {
	contentType string
	data        []byte
}

// RegisterExpensePreview adds POST /api/v1/expenses/receipt-preview and POST /api/v1/expenses/{id}/read. Registered
// apart from Register so the methods can be wired in cmd/helvetly without touching the generic import routes.
func (s *Service) RegisterExpensePreview(mux *http.ServeMux) {
	for pattern, fn := range map[string]handler{
		"POST /api/v1/expenses/receipt-preview": s.expensePreview,
		"POST /api/v1/expenses/{id}/read":       s.expenseReread,
	} {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := fn(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
}

func (s *Service) expensePreview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	if err := s.readerAdmitted(r, sess); err != nil {
		return err
	}
	requestID, files, err := readPreviewForm(w, r)
	if err != nil {
		return err
	}
	reading, err := s.readReceipt(ctx, sess, requestID, files)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": reading})
	return nil
}

// readerAdmitted: the rate limit, the person's scope, then plan, provider and permission, before any file is read
// (they are checked again inside the budget's admission).
func (s *Service) readerAdmitted(r *http.Request, sess store.Session) error {
	if !s.limit.Allow(r) {
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Wait a minute before reading another receipt.", nil)
	}
	if err := need(sess, "write:expenses"); err != nil {
		return err
	}
	return s.previewGate(r.Context(), s.db.Q, sess, "")
}

// readReceipt sends the pages as one document under the automation pool and returns the checked reading. One user
// action reading these files is one operation: a repeat is refused instead of paying twice.
func (s *Service) readReceipt(ctx context.Context, sess store.Session, requestID string, files []previewFile) (receiptReading, error) {
	key := sha256.New()
	key.Write([]byte(sess.User.ID + "|" + requestID))
	attached := make([]aimodel.File, len(files))
	for i, f := range files {
		sum := sha256.Sum256(f.data)
		key.Write([]byte("|" + hex.EncodeToString(sum[:])))
		attached[i] = aimodel.File{Name: "page-" + strconv.Itoa(i+1) + receiptExtension(f.contentType), ContentType: f.contentType, Bytes: f.data}
	}
	operation := "rcp_" + hex.EncodeToString(key.Sum(nil)[:16])

	categories, list, err := receiptCategories(ctx, s.db.Q, sess.Workspace.ID)
	if err != nil {
		return receiptReading{}, err
	}
	budget := s.budget // a copy: the shared budget's gate is never changed per request
	budget.Gate = func(ctx context.Context, q store.Q, workspaceID string) error {
		return s.previewGate(ctx, q, sess, operation)
	}
	req := aimodel.Request{
		Instructions: "You read receipts and supplier invoices for Helvetly's expense form. " + receiptPrompt + rules + "\n\n" + list,
		Message:      "The document is attached (" + strconv.Itoa(len(files)) + " file(s), in page order).",
		Files:        attached,
		Schema: &aimodel.Schema{Name: "receipt_v2", JSON: map[string]any{"type": "object", "additionalProperties": false,
			"required": []string{"records"}, "properties": map[string]any{"records": map[string]any{"type": "array", "items": receiptSchema}}}},
	}
	call := aimodel.Call{Kind: "import", Operation: operation, Step: "0", MaxOutput: previewMaxOutput, Caps: aimodel.ImportCaps}
	reply, err := budget.Generate(ctx, s.provider, sess.Workspace, req, call)
	if err := previewError(err); err != nil {
		return receiptReading{}, err
	}
	rec, err := previewRecord(reply.Text)
	if err != nil {
		return receiptReading{}, err
	}
	return checkReceipt(rec, categories)
}

// previewGate: the checks of a model call (plan, provider, the service's own gate) plus the expenses feature and the
// person's live permission. With an operation it also refuses one whose call was already made.
func (s *Service) previewGate(ctx context.Context, q store.Q, sess store.Session, operation string) error {
	ws := sess.Workspace.ID
	if err := s.gate(ctx, q, ws, sess.User.ID); err != nil {
		return err
	}
	if err := expensesKind.allowed(ctx, q, ws); err != nil {
		return err
	}
	role, err := q.MemberRole(ctx, ws, sess.User.ID)
	if err != nil {
		return err
	}
	scopes, err := q.MemberScopes(ctx, ws, sess.User.ID)
	if err != nil {
		return err
	}
	if !permissions.Allows(role, scopes, "write:expenses") {
		return auth.Error(http.StatusForbidden, "forbidden", "You are not allowed to do that.", map[string]any{"scope": "write:expenses"})
	}
	if operation == "" {
		return nil
	}
	if _, _, calls, err := q.AICallSpend(ctx, ws, operation, "0", ""); err != nil || calls > 0 {
		return errors.Join(err, auth.Error(http.StatusConflict, "receipt_already_read", "This receipt was already sent for reading. Choose Recognize receipt again to read it anew.", nil))
	}
	return nil
}

// readPreviewForm streams the multipart body: one request id and one to five files, nothing else, never to disk.
// Every file must be a receipt the model reads.
func readPreviewForm(w http.ResponseWriter, r *http.Request) (requestID string, files []previewFile, err error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxFileBytes+previewOverhead)
	_, params, perr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if perr != nil || params["boundary"] == "" {
		return "", nil, invalid("Send a multipart form with request_id and file.")
	}
	mr := multipart.NewReader(r.Body, params["boundary"])
	size := 0
	for {
		part, perr := mr.NextPart()
		if errors.Is(perr, io.EOF) {
			break
		}
		if perr != nil {
			return "", nil, previewBodyError(perr)
		}
		switch {
		case part.FormName() == "request_id" && requestID == "":
			b, rerr := io.ReadAll(io.LimitReader(part, 128))
			if rerr != nil {
				return "", nil, previewBodyError(rerr)
			}
			requestID = string(bytes.TrimSpace(b))
		case part.FormName() == "file" && len(files) < previewMaxFiles:
			b, rerr := io.ReadAll(io.LimitReader(part, int64(maxFileBytes-size+1)))
			if rerr != nil {
				return "", nil, previewBodyError(rerr)
			}
			if size += len(b); size > maxFileBytes {
				return "", nil, previewTooLarge
			}
			if len(b) == 0 {
				return "", nil, invalid("Choose a receipt to read; a file is missing or empty.")
			}
			contentType, serr := sniff(part.FileName(), b)
			if serr != nil {
				return "", nil, invalid(serr.Error())
			}
			if err := checkPreviewFile(contentType, b); err != nil {
				return "", nil, err
			}
			files = append(files, previewFile{contentType: contentType, data: b})
		case part.FormName() == "file":
			return "", nil, invalid("Send at most five pages of one receipt.")
		default:
			return "", nil, invalid("Send the receipt's files as file and a request_id, nothing else.")
		}
	}
	switch {
	case !previewRequestID.MatchString(requestID):
		return "", nil, invalid("Send a request_id of 8 to 64 letters, digits, - or _.")
	case len(files) == 0:
		return "", nil, invalid("Choose a receipt to read; the file is missing or empty.")
	}
	return requestID, files, nil
}

var previewTooLarge = auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large", "The receipt's files must be at most 25 MB together.", nil)

func previewBodyError(err error) error {
	if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
		return previewTooLarge
	}
	return invalid("Send a multipart form with request_id and file.")
}

// checkPreviewFile accepts what the model reads (PDF, PNG, JPEG, WebP) and refuses a file that is no valid one of
// those before anything is sent: a ZIP or spreadsheet is no receipt, and an image must decode to a bounded size.
func checkPreviewFile(contentType string, data []byte) error {
	var cfg image.Config
	var err error
	switch contentType {
	case typePNG:
		cfg, err = png.DecodeConfig(bytes.NewReader(data))
	case typeJPEG:
		cfg, err = jpeg.DecodeConfig(bytes.NewReader(data))
	case typeWEBP:
		cfg, err = webpConfig(data)
	case typePDF:
		// shortcut: only the end marker is checked, not the PDF's structure; the model's own reader refuses the rest.
		if !bytes.Contains(data[max(0, len(data)-2048):], []byte("%%EOF")) {
			return invalid("The PDF looks damaged. Export it again or enter the details yourself.")
		}
		return nil
	default:
		return invalid("Only a PDF, PNG, JPEG or WebP receipt can be read automatically.")
	}
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > previewMaxPixels {
		return invalid("The image is damaged or too large to read. Use a smaller photo.")
	}
	return nil
}

var errWebP = errors.New("not a WebP image")

// webpConfig reads a WebP's canvas size from its first chunk (VP8X extended, VP8 lossy or VP8L lossless), as the
// format specifies: no decoder is needed to bound the image before it is sent.
func webpConfig(b []byte) (image.Config, error) {
	if len(b) < 30 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return image.Config{}, errWebP
	}
	var w, h int
	switch string(b[12:16]) {
	case "VP8X": // 24-bit canvas width and height minus one, after 4 bytes of flags
		w = 1 + (int(b[24]) | int(b[25])<<8 | int(b[26])<<16)
		h = 1 + (int(b[27]) | int(b[28])<<8 | int(b[29])<<16)
	case "VP8 ": // a key frame: start code 9d 01 2a, then 14-bit width and height
		if b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return image.Config{}, errWebP
		}
		w = int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff)
		h = int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff)
	case "VP8L": // signature 2f, then 14-bit width and height minus one
		if b[20] != 0x2f {
			return image.Config{}, errWebP
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		w = 1 + int(bits&0x3fff)
		h = 1 + int(bits>>14&0x3fff)
	default:
		return image.Config{}, errWebP
	}
	return image.Config{Width: w, Height: h}, nil
}

func receiptExtension(contentType string) string {
	return receiptExt[contentType][len("receipt"):]
}

// previewError turns the budget's refusals into answers the form can show.
func previewError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, aimodel.ErrQuota):
		return auth.Error(http.StatusForbidden, "quota_exceeded", "This workspace has used its monthly AI import and filing allowance.", nil)
	case errors.Is(err, aimodel.ErrTooLarge):
		return auth.Error(http.StatusForbidden, "quota_exceeded", "This receipt is larger than the remaining monthly AI import and filing allowance.", nil)
	case errors.Is(err, aimodel.ErrCap), errors.Is(err, aimodel.ErrAttempts):
		return auth.Error(http.StatusRequestEntityTooLarge, "receipt_too_large", "This receipt is larger than one AI reading may be. Use a smaller photo or enter the details yourself.", nil)
	case errors.Is(err, aimodel.ErrUnfunded):
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "Reading receipts is paused while the service's AI budget is being updated.", nil)
	case errors.Is(err, aimodel.ErrUncertain):
		return auth.Error(http.StatusServiceUnavailable, "ai_busy", "Another AI request is in progress for this workspace. Try again in a moment.", nil)
	case aimodel.Busy(err):
		return auth.Error(http.StatusServiceUnavailable, "ai_busy", "The AI is busy right now. Try again in a minute.", nil)
	case errors.Is(err, aimodel.ErrProvider):
		return auth.Error(http.StatusServiceUnavailable, "ai_failed", "The AI couldn't read the receipt right now. Try again in a moment or enter the details yourself.", nil)
	}
	return err // an auth error of the gate, or an unexpected one
}

// previewRecord is the single receipt the model found: none or several is an answer, never a guess of the first.
func previewRecord(text string) (json.RawMessage, error) {
	unreadable := auth.Error(http.StatusBadGateway, "receipt_unreadable", "The AI model's answer could not be read. Try again or enter the details yourself.", nil)
	var out struct {
		Records []json.RawMessage `json:"records"`
	}
	if json.Unmarshal(bytes.TrimSpace([]byte(text)), &out) != nil {
		return nil, unreadable
	}
	switch len(out.Records) {
	case 1:
		return out.Records[0], nil
	case 0:
		return nil, auth.Error(http.StatusUnprocessableEntity, "no_receipt", "No receipt was found in this file.", nil)
	}
	return nil, auth.Error(http.StatusUnprocessableEntity, "multiple_receipts", "These files hold more than one receipt. Read each receipt on its own.", nil)
}
