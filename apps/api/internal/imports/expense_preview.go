package imports

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	"slices"
	"strings"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Receipt autofill: the expense form sends ONE chosen receipt and gets suggestions for its fields back, to review.
// Nothing is stored: no expense, document, import batch or file; only the AI usage ledger counts the call.

const (
	previewMaxOutput = 4096
	previewMaxPixels = 50_000_000 // decoded size, so a small file cannot unpack into gigabytes
	previewOverhead  = 64 << 10   // multipart framing and the request id, on top of the file
)

// previewBands: the schema holds two amount/rate pairs, so a receipt with more bands (or a total the pairs cannot add
// up to) must leave all four null rather than look complete with a part of the total.
const previewBands = " If the receipt shows VAT at more than two rates, or its full gross total cannot be written as at most two " +
	"amount and rate pairs that add up to it, set amount, vat_rate, amount_2 and vat_rate_2 to null; never report only some of the bands."

var previewRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// previewFields are the suggestions' keys; reverse_charge is read but never suggested (see previewSuggestions).
var previewFields = []string{"supplier_name", "supplier_vat_number", "supplier_country", "reference", "description",
	"document_date", "due_date", "currency", "amount", "vat_rate", "amount_2", "vat_rate_2"}

// previewAmounts are the fields that only make sense together (currency, mode, lines): all suggested or none.
var previewAmounts = []string{"currency", "amount", "vat_rate", "amount_2", "vat_rate_2"}

// RegisterExpensePreview adds POST /api/v1/expenses/receipt-preview. Registered apart from Register so the method can
// be wired in cmd/helvetly without touching the generic import routes.
func (s *Service) RegisterExpensePreview(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/expenses/receipt-preview", s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		if err := s.expensePreview(w, r, sess); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				err = auth.ErrNotFound
			}
			s.auth.WriteError(w, r, err)
		}
	}))
}

func (s *Service) expensePreview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	if !s.limit.Allow(r) {
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Wait a minute before reading another receipt.", nil)
	}
	if err := need(sess, "write:expenses"); err != nil {
		return err
	}
	// Plan, provider and permission are checked before the file is read, and again inside the budget's admission.
	if err := s.previewGate(ctx, s.db.Q, sess, ""); err != nil {
		return err
	}
	requestID, name, data, err := readPreviewForm(w, r)
	if err != nil {
		return err
	}
	contentType, err := sniff(name, data)
	if err != nil {
		return invalid(err.Error())
	}
	if err := checkPreviewFile(contentType, data); err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	// One user action reading one file is one operation: a repeat is refused instead of paying twice.
	key := sha256.Sum256([]byte(sess.User.ID + "|" + requestID + "|" + hex.EncodeToString(sum[:])))
	operation := "rcp_" + hex.EncodeToString(key[:16])

	budget := s.budget // a copy: the shared budget's gate is never changed per request
	budget.Gate = func(ctx context.Context, q store.Q, workspaceID string) error {
		return s.previewGate(ctx, q, sess, operation)
	}
	req := aimodel.Request{
		Instructions: "You read one receipt or supplier invoice for Helvetly's expense form. " + expensesKind.Prompt + previewBands + rules,
		Message:      "The receipt is attached.",
		Files:        []aimodel.File{{Name: "receipt" + receiptExtension(contentType), ContentType: contentType, Bytes: data}},
		Schema: &aimodel.Schema{Name: "receipt_preview", JSON: map[string]any{"type": "object", "additionalProperties": false,
			"required": []string{"records"}, "properties": map[string]any{"records": map[string]any{"type": "array", "items": expensesKind.Schema}}}},
	}
	call := aimodel.Call{Kind: "import", Operation: operation, Step: "0", MaxOutput: previewMaxOutput, Caps: aimodel.ImportCaps}
	reply, err := budget.Generate(ctx, s.provider, sess.Workspace, req, call)
	if err := previewError(err); err != nil {
		return err
	}
	rec, err := previewRecord(reply.Text)
	if err != nil {
		return err
	}
	fields, issues, err := s.previewSuggestions(ctx, sess, rec)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"fields": fields, "issues": issues}})
	return nil
}

// previewGate: the checks of a model call (plan, provider, the service's own gate) plus the expenses feature and the
// person's live permission. With an operation it also refuses one whose call was already made.
func (s *Service) previewGate(ctx context.Context, q store.Q, sess store.Session, operation string) error {
	ws := sess.Workspace.ID
	if err := s.gate(ctx, q, ws); err != nil {
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

// readPreviewForm streams the multipart body: exactly one file and one request id, nothing else, never to disk.
func readPreviewForm(w http.ResponseWriter, r *http.Request) (requestID, name string, data []byte, err error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxFileBytes+previewOverhead)
	_, params, perr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if perr != nil || params["boundary"] == "" {
		return "", "", nil, invalid("Send a multipart form with request_id and file.")
	}
	mr := multipart.NewReader(r.Body, params["boundary"])
	for {
		part, perr := mr.NextPart()
		if errors.Is(perr, io.EOF) {
			break
		}
		if perr != nil {
			return "", "", nil, previewBodyError(perr)
		}
		switch {
		case part.FormName() == "request_id" && requestID == "":
			b, rerr := io.ReadAll(io.LimitReader(part, 128))
			if rerr != nil {
				return "", "", nil, previewBodyError(rerr)
			}
			requestID = strings.TrimSpace(string(b))
		case part.FormName() == "file" && data == nil:
			b, rerr := io.ReadAll(io.LimitReader(part, maxFileBytes+1))
			if rerr != nil {
				return "", "", nil, previewBodyError(rerr)
			}
			data, name = b, part.FileName()
		default:
			return "", "", nil, invalid("Send one receipt as file and a request_id, nothing else.")
		}
	}
	switch {
	case !previewRequestID.MatchString(requestID):
		return "", "", nil, invalid("Send a request_id of 8 to 64 letters, digits, - or _.")
	case len(data) == 0:
		return "", "", nil, invalid("Choose one receipt to read; the file is missing or empty.")
	case len(data) > maxFileBytes:
		return "", "", nil, auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large", "The receipt must be at most 25 MB.", nil)
	}
	if name = strings.TrimSpace(name); name == "" {
		name = "receipt"
	}
	return requestID, name, data, nil
}

func previewBodyError(err error) error {
	if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
		return auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large", "The receipt must be at most 25 MB.", nil)
	}
	return invalid("Send a multipart form with request_id and file.")
}

// checkPreviewFile accepts what the model reads (PDF, PNG, JPEG, WebP) and refuses a file that is no valid one of those
// before anything is sent: a ZIP or spreadsheet is no receipt, and an image must decode to a bounded size.
func checkPreviewFile(contentType string, data []byte) error {
	var cfg image.Config
	var err error
	switch contentType {
	case typePNG:
		cfg, err = png.DecodeConfig(bytes.NewReader(data))
	case typeJPEG:
		cfg, err = jpeg.DecodeConfig(bytes.NewReader(data))
	case typePDF:
		// shortcut: only the end marker is checked, not the PDF's structure; the model's own reader refuses the rest.
		if !bytes.Contains(data[max(0, len(data)-2048):], []byte("%%EOF")) {
			return invalid("The PDF looks damaged. Export it again or enter the details yourself.")
		}
		return nil
	case typeWEBP:
		// shortcut: the standard library and go.mod have no WebP decoder, and imports/files.go has none, so only the
		// sniffed RIFF/WEBP header is checked and size is bounded by the 25 MB body limit; add the pixel bound when a
		// WebP decoder (x/image) enters go.mod for another feature, rather than hand-writing one here.
		return nil
	default:
		return invalid("Only a PDF, PNG, JPEG or WebP receipt can be read automatically.")
	}
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > previewMaxPixels {
		return invalid("The image is damaged or too large to read. Use a smaller photo.")
	}
	return nil
}

func receiptExtension(contentType string) string {
	return strings.TrimPrefix(receiptExt[contentType], "receipt")
}

// previewError turns the budget's refusals into answers the form can show.
func previewError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, aimodel.ErrQuota):
		return auth.Error(http.StatusForbidden, "quota_exceeded", "This workspace has used its monthly AI allowance.", nil)
	case errors.Is(err, aimodel.ErrTooLarge):
		return auth.Error(http.StatusForbidden, "quota_exceeded", "This receipt is larger than the remaining monthly AI allowance.", nil)
	case errors.Is(err, aimodel.ErrCap), errors.Is(err, aimodel.ErrAttempts):
		return auth.Error(http.StatusRequestEntityTooLarge, "receipt_too_large", "This receipt is larger than one AI reading may be. Use a smaller photo or enter the details yourself.", nil)
	case errors.Is(err, aimodel.ErrUnfunded):
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "Reading receipts is paused while the service's AI budget is being updated.", nil)
	case errors.Is(err, aimodel.ErrUnaccounted), errors.Is(err, aimodel.ErrUncertain):
		return auth.Error(http.StatusServiceUnavailable, "ai_busy", "Another AI request is in progress for this workspace, or its usage is being reconciled. Try again in a moment.", nil)
	case errors.Is(err, aimodel.ErrProvider):
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "The AI model could not read the receipt. Try again later or enter the details yourself.", nil)
	}
	return err // an auth error of the gate, or an unexpected one
}

// previewRecord is the single receipt the model found: none or several is an answer, never a guess of the first.
func previewRecord(text string) (map[string]json.RawMessage, error) {
	unreadable := auth.Error(http.StatusBadGateway, "receipt_unreadable", "The AI model's answer could not be read. Try again or enter the details yourself.", nil)
	var out struct {
		Records []map[string]json.RawMessage `json:"records"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(text)), &out) != nil {
		return nil, unreadable
	}
	switch len(out.Records) {
	case 1:
		return out.Records[0], nil
	case 0:
		return nil, auth.Error(http.StatusUnprocessableEntity, "no_receipt", "No receipt was found in this file.", nil)
	}
	return nil, auth.Error(http.StatusUnprocessableEntity, "multiple_receipts", "This file holds more than one receipt. Attach each receipt as its own file.", nil)
}

// previewSuggestions are the valid fields of the record (null for the rest) and a message per field to check. The
// create rules of an imported expense decide validity. The amounts are all-or-nothing and never carry an assumption:
// a missing VAT rate is not a default, and a reverse charge (which the form cannot record yet) fills no amount.
func (s *Service) previewSuggestions(ctx context.Context, sess store.Session, rec map[string]json.RawMessage) (map[string]any, map[string]string, error) {
	data := clean(expensesKind, rec)
	_, bad, err := checkExpense(ctx, s.db.Q, sess.Workspace.ID, sess.User, sess.Workspace.Today(s.now()), data)
	if err != nil {
		return nil, nil, err
	}
	fields, issues := map[string]any{}, map[string]string{}
	for _, f := range previewFields {
		fields[f] = nil
		raw, ok := data[f]
		switch {
		case !ok:
		case bad[f] != "":
			issues[f] = bad[f]
		default:
			var v string
			if json.Unmarshal(raw, &v) == nil {
				if f == "currency" || f == "supplier_country" {
					v = strings.ToUpper(v)
				}
				fields[f] = v
			}
		}
	}
	reverse := false
	if raw, ok := data["reverse_charge"]; ok {
		_, reverse = map[string]bool{"true": true, "yes": true}[strings.ToLower(strings.Trim(string(raw), `"`))]
	}
	present, complete := false, fields["currency"] != nil && fields["amount"] != nil && fields["vat_rate"] != nil &&
		(fields["amount_2"] == nil) == (fields["vat_rate_2"] == nil) && len(issues) == 0
	for _, f := range previewAmounts {
		_, had := data[f]
		present = present || had
	}
	for _, f := range previewFields {
		if _, bad := issues[f]; bad && slices.Contains(previewAmounts, f) {
			complete = false
		}
	}
	switch {
	case reverse:
		issues["amounts"] = "This receipt says the recipient owes the VAT (reverse charge), which the form cannot record yet. No amount, VAT rate or currency was filled in; enter them yourself."
	case present && !complete:
		issues["amounts"] = "The receipt did not show the currency, an amount and its VAT rate clearly, so no amount, VAT rate or currency was filled in; enter them yourself."
	}
	if reverse || (present && !complete) {
		for _, f := range previewAmounts {
			fields[f] = nil
		}
	}
	return fields, issues, nil
}
