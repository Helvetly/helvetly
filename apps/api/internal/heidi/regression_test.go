package heidi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/store"
)

func TestConcurrentUploadsCreateOneCanonicalFile(t *testing.T) {
	_, mux, _, files := fixture(t)
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, id := range []string{"parallel_a", "parallel_b"} {
		wg.Go(func() { statuses <- chat(t, mux, id, "Keep attachment", "%PDF-1.7\nconcurrent").Code })
	}
	wg.Wait()
	close(statuses)
	got := map[int]int{}
	for status := range statuses {
		got[status]++
	}
	// both may store their object before the locked check; the refused one is deleted, one canonical file stays
	if got[200] != 1 || got[409] != 1 || len(files.objects) != 1 || files.puts-files.deletes != 1 {
		t.Fatalf("statuses=%v objects=%d puts=%d deletes=%d", got, len(files.objects), files.puts, files.deletes)
	}
}

func TestLegacyDocumentHashAndTenantIsolation(t *testing.T) {
	s, mux, sess, files := fixture(t)
	pdf := "%PDF-1.7\nlegacy bytes"
	now := s.now()
	files.objects["legacy"] = []byte(pdf)
	if err := s.db.CreateDocument(context.Background(), sess.Workspace.ID, sess.User.ID, store.Document{ID: "doc_legacy", Name: "historical.pdf", ObjectKey: "legacy", Size: int64(len(pdf)), ContentType: "application/pdf", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	w := chat(t, mux, "legacy", "Keep attachment", pdf)
	if w.Code != 409 || files.puts != 0 {
		t.Fatalf("legacy: %d puts=%d %s", w.Code, files.puts, w.Body)
	}
	// A successful upload of different bytes with the same size commits the verified legacy hash.
	w = chat(t, mux, "different", "Keep attachment", strings.Replace(pdf, "legacy", "LEGACY", 1))
	if w.Code != 200 || files.puts != 1 {
		t.Fatalf("same size different bytes: %d puts=%d %s", w.Code, files.puts, w.Body)
	}
	list, _, err := s.db.ListDocuments(context.Background(), sess.Workspace.ID, store.DocumentFilter{Sort: "name"}, 10, 0)
	sum := sha256.Sum256([]byte(pdf))
	legacyHash := ""
	for _, doc := range list {
		if doc.ID == "doc_legacy" {
			legacyHash = textValue(doc.SHA256)
		}
	}
	if err != nil || len(list) != 2 || legacyHash != hex.EncodeToString(sum[:]) {
		t.Fatalf("backfill %+v %v", list, err)
	}
	other := store.Workspace{ID: "ws_other_heidi", Name: "Other", Timezone: "Europe/Zurich"}
	if err := s.db.CreateWorkspace(context.Background(), other, other.Timezone, now); err != nil {
		t.Fatal(err)
	}
	if err := s.db.AddMember(context.Background(), other.ID, sess.User.ID, "owner", now); err != nil {
		t.Fatal(err)
	}
	sess.Workspace = other
	w = chat(t, mux, "other", "Keep attachment", pdf)
	if w.Code != 200 || files.puts != 2 {
		t.Fatalf("tenant: %d puts=%d %s", w.Code, files.puts, w.Body)
	}
}

func TestStorageAdmissionUsesNewByteCountAndDoesNotOverrideDuplicate(t *testing.T) {
	s, mux, _, files := fixture(t)
	pdf := "%PDF-1.7\nquota bytes"
	var observed []int64
	s.allowStorage = func(_ context.Context, _ store.Q, _ store.Session, size int64) error {
		observed = append(observed, size)
		return nil
	}
	if w := chat(t, mux, "quota", "Keep attachment", pdf); w.Code != 200 {
		t.Fatalf("upload %d %s", w.Code, w.Body)
	}
	for _, size := range observed {
		if size != int64(len(pdf)) {
			t.Fatalf("counted multipart overhead: %v", observed)
		}
	}
	s.allowStorage = func(context.Context, store.Q, store.Session, int64) error {
		return auth.Error(402, "limit_reached", "Storage is full.", nil)
	}
	if w := chat(t, mux, "same", "Keep attachment", pdf); w.Code != 409 {
		t.Fatalf("duplicate must precede quota: %d %s", w.Code, w.Body)
	}
	if w := chat(t, mux, "new", "Keep attachment", pdf+" changed"); w.Code != 402 || files.puts != 1 {
		t.Fatalf("quota changed storage: %d puts=%d %s", w.Code, files.puts, w.Body)
	}
}

func TestCanceledUploadCleansObjectOutsideCanceledContext(t *testing.T) {
	s, mux, _, files := fixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	files.afterPut = cancel
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("conversation_id", "cancelled")
	_ = form.WriteField("message", "Keep attachment")
	f, _ := form.CreateFormFile("files[]", "cancel.pdf")
	_, _ = f.Write([]byte("%PDF-1.7\ncancelled"))
	_ = form.Close()
	r := httptest.NewRequest("POST", "/api/v1/heidi/chat", &body).WithContext(ctx)
	r.Header.Set("X-CSRF-Token", "csrf")
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 500 || files.puts != 1 || files.deletes != 1 || files.deleteCanceled || len(files.objects) != 0 {
		t.Fatalf("status=%d puts=%d deletes=%d canceled=%v objects=%d", w.Code, files.puts, files.deletes, files.deleteCanceled, len(files.objects))
	}
	if _, err := s.db.HeidiMessages(context.Background(), "ws_heidi", "usr_heidi", "cancelled"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("transaction committed after cancellation: %v", err)
	}
}

func seedEngagement(t *testing.T, s *Service, sess *store.Session, id, title string) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.db.Client(ctx, sess.Workspace.ID, "cli_heidi"); errors.Is(err, store.ErrNotFound) {
		if err = s.db.CreateClient(ctx, sess.Workspace.ID, "cli_heidi", map[string]any{"name": "Müller AG"}, s.now()); err != nil {
			t.Fatal(err)
		}
	}
	unit := "hour"
	e := store.Engagement{ID: id, ClientID: "cli_heidi", Title: title, Unit: &unit, Quantity: 10000, Billing: "arrears", PriceBasis: "net", UnitPrice: 10000, Currency: "CHF", VATCategory: "S", VATRate: 810, StartDate: sess.Workspace.Today(s.now())[:7] + "-01", Recurrence: "monthly", Interval: 1, InvoiceDetail: "summary"}
	if err := s.db.CreateEngagement(ctx, sess.Workspace.ID, &e, s.now()); err != nil {
		t.Fatal(err)
	}
	s.engagements = engagements.New(s.db, s.auth, nil, slog.Default())
}
func findConfirmation(t *testing.T, w *httptest.ResponseRecorder) Confirmation {
	t.Helper()
	for line := range strings.SplitSeq(w.Body.String(), "\n") {
		if strings.HasPrefix(line, "data: ") {
			var c Confirmation
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &c) == nil && c.Type == "confirmation" {
				return c
			}
		}
	}
	t.Fatalf("no confirmation in %d %s", w.Code, w.Body)
	return Confirmation{}
}

func TestEngagementConfirmationSurvivesReloadAndExecutesOnce(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	seedEngagement(t, s, sess, "eng_heidi", "Lessons")
	w := chat(t, mux, "work", "Trag 1,5 Stunden für Müller AG ein: Konjunktiv II")
	c := findConfirmation(t, w)
	if strings.Contains(w.Body.String(), `"type":"done"`) {
		t.Fatal("paused turn must not finish")
	}
	entries, err := s.db.Entries(context.Background(), "eng_heidi", "")
	if err != nil || len(entries) != 0 {
		t.Fatalf("wrote before confirmation: %+v %v", entries, err)
	}
	w = call(mux, "GET", "/api/v1/heidi/conversations/work", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"confirmation"`) {
		t.Fatalf("reload: %d %s", w.Code, w.Body)
	}
	payload := `{"conversation_id":"work","confirmation_id":"` + c.ID + `","approved":true}`
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() { statuses <- call(mux, "POST", "/api/v1/heidi/chat/confirm", payload, "application/json").Code })
	}
	wg.Wait()
	close(statuses)
	got := map[int]int{}
	for code := range statuses {
		got[code]++
	}
	entries, err = s.db.Entries(context.Background(), "eng_heidi", "")
	if got[200] != 1 || got[409] != 1 || err != nil || len(entries) != 1 || entries[0].Quantity != 1500 || textValue(entries[0].Note) != "Konjunktiv II" {
		t.Fatalf("statuses=%v entries=%+v err=%v", got, entries, err)
	}
	w = call(mux, "GET", "/api/v1/heidi/conversations/work", "", "")
	if strings.Contains(w.Body.String(), `"confirmation"`) {
		t.Fatal("consumed confirmation restored")
	}
}

func TestEngagementChoiceAndExpiredConfirmation(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	seedEngagement(t, s, sess, "eng_one", "Lesson one")
	seedEngagement(t, s, sess, "eng_two", "Lesson two")
	w := chat(t, mux, "choice", "Log 2h for Müller")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"form"`) {
		t.Fatalf("choice: %d %s", w.Code, w.Body)
	}
	w = chat(t, mux, "choice", "Engagement: Lesson two (#2)")
	c := findConfirmation(t, w)
	s.now = func() time.Time { return time.Now().Add(6 * time.Minute) }
	w = call(mux, "POST", "/api/v1/heidi/chat/confirm", `{"conversation_id":"choice","confirmation_id":"`+c.ID+`","approved":true}`, "application/json")
	if w.Code != 409 {
		t.Fatalf("expired: %d %s", w.Code, w.Body)
	}
	entries, err := s.db.Entries(context.Background(), "eng_two", "")
	if err != nil || len(entries) != 0 {
		t.Fatalf("expired wrote entries: %+v %v", entries, err)
	}
}

type testProvider struct {
	input    int64
	countErr error
	calls    atomic.Int32
	answer   func(context.Context, ProviderRequest) (ProviderReply, error)
	// scope answers the scope classifier (nil: in scope, zero tokens); classified counts its calls apart from calls.
	scope      func(ProviderRequest) (ProviderReply, error)
	classified atomic.Int32
}

func (p *testProvider) Card() aimodel.RateCard { return aimodel.Cards[aimodel.DefaultModel] }
func (p *testProvider) InputTokens(context.Context, ProviderRequest) (int64, error) {
	return p.input, p.countErr
}
func (p *testProvider) Answer(ctx context.Context, r ProviderRequest) (ProviderReply, error) {
	if r.Schema != nil && r.Schema.Name == "heidi_scope" {
		p.classified.Add(1)
		if p.scope != nil {
			return p.scope(r)
		}
		zero := int64(0)
		return ProviderReply{Text: `{"in_scope":true,"reason":"test"}`, Tokens: &zero}, nil
	}
	p.calls.Add(1)
	return p.answer(ctx, r)
}

func TestProviderUsageIsActualAndInputBudgetIsCheckedBeforeGeneration(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	tokens := int64(43)
	p := &testProvider{input: 20, answer: func(_ context.Context, r ProviderRequest) (ProviderReply, error) {
		if r.MaxOutputTokens != 80 {
			t.Errorf("output cap=%d", r.MaxOutputTokens)
		}
		return ProviderReply{Text: "Explanation.", Tokens: &tokens}, nil
	}}
	s.provider = p
	s.allowance = func(context.Context, store.Q, string) (int64, error) { return 100, nil }
	w := chat(t, mux, "model", "Explain this accounting term")
	if w.Code != 200 {
		t.Fatalf("provider: %d %s", w.Code, w.Body)
	}
	u, err := s.db.HeidiUsage(context.Background(), sess.Workspace.ID, s.now().In(sess.Workspace.Location()).Format("2006-01"))
	if err != nil || u.TokensUsed != 43 || u.Uncertain {
		t.Fatalf("usage=%+v err=%v", u, err)
	}
	p.input = 50
	w = chat(t, mux, "model", "Explain another term")
	if w.Code != 403 || p.calls.Load() != 1 {
		t.Fatalf("oversized input generated: %d calls=%d %s", w.Code, p.calls.Load(), w.Body)
	}
	u, err = s.db.HeidiUsage(context.Background(), sess.Workspace.ID, s.now().In(sess.Workspace.Location()).Format("2006-01"))
	if err != nil || u.Uncertain || u.TokensUsed != 43 {
		t.Fatalf("declined input usage=%+v err=%v", u, err)
	}
}

func TestUnknownProviderUsageBlocksOnlyFurtherModelCalls(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	p := &testProvider{input: 10, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		return ProviderReply{}, context.DeadlineExceeded
	}}
	s.provider = p
	// The provider call had started (its step was streamed), so the failure is an error frame.
	w := chat(t, mux, "unknown", "Explain a term")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"error"`) || strings.Contains(w.Body.String(), `"type":"done"`) {
		t.Fatalf("unknown: %d %s", w.Code, w.Body)
	}
	w = chat(t, mux, "again", "Explain another term")
	if w.Code != 503 || p.calls.Load() != 1 {
		t.Fatalf("unknown usage retried provider: %d calls=%d", w.Code, p.calls.Load())
	}
	u, err := s.db.HeidiUsage(context.Background(), sess.Workspace.ID, s.now().In(sess.Workspace.Location()).Format("2006-01"))
	if err != nil || !u.Uncertain || u.TokensUsed != 0 {
		t.Fatalf("unknown was fabricated: %+v %v", u, err)
	}
	w = chat(t, mux, "local", "Which invoices are overdue?")
	if w.Code != 200 {
		t.Fatalf("local command blocked: %d %s", w.Code, w.Body)
	}
}

func TestImportRequestWithFilesOffersTheImportFormWithoutTheModel(t *testing.T) {
	s, mux, _, _ := fixture(t)
	p := &testProvider{input: 10, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		t.Error("the model was asked")
		return ProviderReply{}, nil
	}}
	s.provider = p
	w := chat(t, mux, "import", "Please import these clients", "%PDF-1.7 list")
	body := w.Body.String()
	if w.Code != 200 || !strings.Contains(body, `"intent":"import"`) || !strings.Contains(body, `"options":["Clients","Engagements","Expenses","Invoices","Products \u0026 services"]`) || p.calls.Load() != 0 {
		t.Fatalf("import form: %d %s", w.Code, body)
	}
	if w := chat(t, mux, "import", "Import as: Clients"); w.Code != 200 || p.calls.Load() != 0 {
		t.Fatalf("form answer: %d %s", w.Code, w.Body)
	}
}
