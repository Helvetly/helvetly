package billing

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// planned is a usageEnv workspace on price (price_bm Basic, price_pm Pro), its clock in the middle of the month.
func planned(t *testing.T, price string) (*env, string) {
	t.Helper()
	e := usageEnv(t)
	ws := e.workspace().workspace
	e.subscribe(ws, price)
	return e, ws
}

func (e *env) stored(ws string) int64 {
	e.t.Helper()
	n, err := e.st.StoredBytes(context.Background(), ws)
	if err != nil {
		e.t.Fatal(err)
	}
	return n
}

// limitCode is the API error code a refusal answers with ("" when err is no API error).
func limitCode(err error) string {
	if err == nil {
		return ""
	}
	if !strings.Contains(err.Error(), "limit_reached") {
		return err.Error()
	}
	return "limit_reached"
}

// TestStorageCountsKeptBytesUpToTheCap: Basic's 500 MB at cap-1, cap and cap+1; a write of the same key again counts
// only its growth; a record the business must keep is counted but never refused; only a confirmed delete frees room;
// another workspace's bytes never count.
func TestStorageCountsKeptBytesUpToTheCap(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_bm")
	max := e.cap(ws, Storage)
	if max != 500_000_000 {
		t.Fatalf("Basic storage %d, the offer sells 500 MB", max)
	}
	e.exec(`INSERT INTO stored_objects (object_key, workspace_id, size, created_at, verified_at) VALUES ('seed', $1, $2, now(), now())`, ws, max-2)
	reserve := func(ws, key string, n int64, admit bool) error {
		return e.st.ReserveObject(ctx, ws, key, n, admit, time.Now())
	}
	for _, step := range []struct {
		key  string
		n    int64
		want string
	}{{"a", 1, ""}, {"b", 1, ""}, {"c", 1, "limit_reached"}, {"b", 1, ""}} {
		if got := limitCode(reserve(ws, step.key, step.n, true)); got != step.want {
			t.Fatalf("reserve %s: %q, want %q", step.key, got, step.want)
		}
	}
	if got := e.stored(ws); got != max {
		t.Fatalf("stored %d, want the cap %d", got, max)
	}
	if err := reserve(ws, "invoice.pdf", 10, false); err != nil {
		t.Fatalf("an issued invoice's PDF over the cap: %v", err)
	}
	other := e.workspace().workspace
	e.subscribe(other, "price_bm")
	if err := reserve(other, "other", 1, true); err != nil || e.stored(other) != 1 {
		t.Fatalf("another workspace is held back by this one's storage: %v %d", err, e.stored(other))
	}
	for _, key := range []string{"invoice.pdf", "b"} {
		if err := e.st.ObjectDeleted(ctx, key); err != nil {
			t.Fatal(err)
		}
	}
	if err := reserve(ws, "c", 1, true); err != nil {
		t.Fatalf("room after a confirmed delete: %v", err)
	}
}

// TestDowngradeOverStorageKeepsEverythingAndBlocksGrowth: Pro's files stay after a downgrade to Basic far below them;
// new uploads are refused honestly, records keep being counted, nothing is deleted.
func TestDowngradeOverStorageKeepsEverythingAndBlocksGrowth(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_pm")
	if err := e.st.ReserveObject(ctx, ws, "big", 2_000_000_000, true, time.Now()); err != nil {
		t.Fatalf("2 GB on Pro: %v", err)
	}
	e.subscribe(ws, "price_bm")
	err := e.st.ReserveObject(ctx, ws, "more", 1, true, time.Now())
	if !denied(err) || !strings.Contains(err.Error(), "500 MB of storage") {
		t.Fatalf("an upload over Basic's cap: %v", err)
	}
	if err := e.st.ReserveObject(ctx, ws, "quote.pdf", 1000, false, time.Now()); err != nil {
		t.Fatalf("a sent quote's PDF over the cap: %v", err)
	}
	if got := e.stored(ws); got != 2_000_001_000 {
		t.Fatalf("stored %d after the downgrade: nothing may be dropped", got)
	}
}

// TestDownloadsReserveAndSettleWhatWasSent: Basic's 2 GB at cap-1, cap and cap+1; a cancelled download keeps what it
// sent and gives the rest back; a reservation counts in the month it was made in; a workspace without a plan still
// reads its files, uncounted.
func TestDownloadsReserveAndSettleWhatWasSent(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_bm")
	max := e.cap(ws, Downloads)
	if max != 2_000_000_000 {
		t.Fatalf("Basic downloads %d, the offer sells 2 GB", max)
	}
	settle, err := e.svc.ReserveDownload(ctx, ws, max-1)
	if err != nil {
		t.Fatal(err)
	}
	settle(max - 2) // cancelled one byte early: the unsent byte comes back
	if got := e.usedIn(ws, Downloads, time.Now()); got != max-2 {
		t.Fatalf("used %d after a cancelled download", got)
	}
	for _, step := range []struct {
		n    int64
		want string
	}{{1, ""}, {1, ""}, {1, "limit_reached"}} {
		settle, err := e.svc.ReserveDownload(ctx, ws, step.n)
		if got := limitCode(err); got != step.want {
			t.Fatalf("download of %d at %d used: %q, want %q", step.n, e.usedIn(ws, Downloads, time.Now()), got, step.want)
		}
		if err == nil {
			settle(step.n)
		}
	}
	if _, err := e.svc.ReserveDownload(ctx, ws, 1); err == nil || !strings.Contains(err.Error(), "2 GB of downloads a month") {
		t.Fatalf("the refusal must say what is used up: %v", err)
	}
	e.exec(`UPDATE workspace_billing SET status = 'canceled' WHERE workspace_id = $1`, ws)
	if settle, err := e.svc.ReserveDownload(ctx, ws, 10); err != nil {
		t.Fatalf("a locked workspace must still read its files: %v", err)
	} else {
		settle(10)
	}
}

func TestDownloadMonthBoundary(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_bm")
	month := store.UsagePeriodStart(time.Now())
	e.svc.now = func() time.Time { return month.Add(-time.Second) } // the last second of the previous month
	settle, err := e.svc.ReserveDownload(ctx, ws, 2_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.svc.now = func() time.Time { return month.Add(time.Hour) }
	settle(2_000_000_000) // finished after midnight: still last month's
	if got := e.usedIn(ws, Downloads, month.Add(-time.Second)); got != 2_000_000_000 {
		t.Fatalf("last month's downloads %d", got)
	}
	if settle, err := e.svc.ReserveDownload(ctx, ws, 2_000_000_000); err != nil {
		t.Fatalf("a new month's full allowance: %v", err)
	} else {
		settle(0)
	}
}

// TestLastDownloadBytesAcrossConnections: ten downloads on separate connections race for the last 1 MB: one wins.
func TestLastDownloadBytesAcrossConnections(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_bm")
	settle, err := e.svc.ReserveDownload(ctx, ws, e.cap(ws, Downloads)-1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	settle(e.cap(ws, Downloads) - 1_000_000)
	var won sync.WaitGroup
	results := make(chan error, 10)
	for range 10 {
		won.Go(func() {
			_, err := e.svc.ReserveDownload(ctx, ws, 1_000_000)
			results <- err
		})
	}
	won.Wait()
	close(results)
	n := 0
	for err := range results {
		if err == nil {
			n++
		} else if !denied(err) {
			t.Fatal(err)
		}
	}
	if n != 1 {
		t.Fatalf("%d of ten downloads got the last megabyte", n)
	}
}

// TestTrialDownloadsAndEmailsAreOnePoolForTheTrial: the trial's 1 GB of downloads and 30 recipients last the trial,
// across the month's end, not per member.
func TestTrialDownloadsAndEmailsAreOnePoolForTheTrial(t *testing.T) {
	ctx := context.Background()
	e := usageEnv(t)
	owner := e.workspace()
	e.join(owner.workspace, "member")
	month := store.UsagePeriodStart(time.Now())
	e.trialing(owner.workspace, "fp_1", month.Add(-48*time.Hour)) // began in the previous month
	if d, m := e.cap(owner.workspace, Downloads), e.cap(owner.workspace, Emails); d != 1_000_000_000 || m != 30 {
		t.Fatalf("trial downloads %d, emails %d", d, m)
	}
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		VALUES ($1, $2, 'last-month', '', $3, 0, 999999999, now(), now()), ($1, $4, 'last-month', '', $3, 0, 29, now(), now())`,
		owner.workspace, string(Downloads), month.AddDate(0, 0, -1).Format("2006-01"), string(Emails))
	if _, err := e.svc.ReserveDownload(ctx, owner.workspace, 2); !denied(err) {
		t.Fatalf("the trial's downloads restarted with the month: %v", err)
	}
	if _, err := e.svc.ReserveEmail(ctx, owner.workspace, 2, 0); !denied(err) {
		t.Fatalf("the trial's emails restarted with the month: %v", err)
	}
	if _, err := e.svc.ReserveEmail(ctx, owner.workspace, 1, 0); err != nil {
		t.Fatalf("the trial's 30th recipient: %v", err)
	}
}

// TestBusinessEmailCountsRecipientsAndAttachmentBytes: Basic's 100 recipients at cap-1, cap and cap+1 (To and Cc
// alike), attachments times recipients, both limits or neither, a message over 10 MiB refused as too large.
func TestBusinessEmailCountsRecipientsAndAttachmentBytes(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_bm")
	if m, a := e.cap(ws, Emails), e.cap(ws, EmailAttachments); m != 100 || a != 100_000_000 {
		t.Fatalf("Basic emails %d, attachments %d", m, a)
	}
	settle, err := e.svc.ReserveEmail(ctx, ws, 98, 0)
	if err != nil {
		t.Fatal(err)
	}
	settle(true)
	settle, err = e.svc.ReserveEmail(ctx, ws, 1, 0) // the 99th: refused at SMTP, given back
	if err != nil {
		t.Fatal(err)
	}
	settle(false)
	if got := e.usedIn(ws, Emails, time.Now()); got != 98 {
		t.Fatalf("a refused send kept its recipient: %d", got)
	}
	if _, err := e.svc.ReserveEmail(ctx, ws, 2, 0); err != nil { // the 99th and 100th: outcome unknown, kept
		t.Fatalf("recipients 99 and 100: %v", err)
	}
	if _, err := e.svc.ReserveEmail(ctx, ws, 1, 0); limitCode(err) != "limit_reached" || !strings.Contains(err.Error(), "Download the PDF") {
		t.Fatalf("the 101st recipient: %v", err)
	}

	other := e.workspace().workspace
	e.subscribe(other, "price_bm")
	if _, err := e.svc.ReserveEmail(ctx, other, 3, 10_485_761); err == nil || !strings.Contains(err.Error(), "attachments_too_large") {
		t.Fatalf("an email over 10 MiB: %v", err)
	}
	if _, err := e.svc.ReserveEmail(ctx, other, 9, 10_000_000); err != nil { // 90 MB
		t.Fatal(err)
	}
	if _, err := e.svc.ReserveEmail(ctx, other, 2, 5_000_001); limitCode(err) != "limit_reached" {
		t.Fatalf("attachments over 100 MB: %v", err)
	}
	if got := e.usedIn(other, Emails, time.Now()); got != 9 {
		t.Fatalf("a refused attachment still took its recipients: %d", got)
	}
}

// TestEmailInsideATransactionHoldingTheBillingLock: a quote is saved and emailed in one transaction that holds the
// workspace's billing lock; the email's reservation must not wait on it.
func TestEmailInsideATransactionHoldingTheBillingLock(t *testing.T) {
	e, ws := planned(t, "price_bm") // pauses for t.Parallel: the deadline starts after it
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := e.st.Tx(ctx, func(q store.Q) error {
		if err := q.LockBilling(ctx, ws); err != nil {
			return err
		}
		settle, err := e.svc.ReserveEmail(ctx, ws, 1, 100)
		if err == nil {
			settle(true)
		}
		return err
	})
	if err != nil {
		t.Fatalf("reserving an email under the billing lock: %v", err)
	}
}

func TestLastEmailRecipientAcrossConnections(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_bm")
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		VALUES ($1, $2, 'seed', '', $3, 0, 99, now(), now())`, ws, string(Emails), store.UsagePeriod(time.Now()))
	var wg sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for range 10 {
		wg.Go(func() {
			if _, err := e.svc.ReserveEmail(ctx, ws, 1, 0); err == nil {
				mu.Lock()
				won++
				mu.Unlock()
			} else if !denied(err) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if won != 1 {
		t.Fatalf("%d of ten emails got the last recipient", won)
	}
}

// TestOwnExportHasItsOwnSmallAllowance: with every download used, the owner's whole export still goes: one at a time,
// one a week (an export that sent nothing does not count), four a month.
func TestOwnExportHasItsOwnSmallAllowance(t *testing.T) {
	ctx := context.Background()
	e, ws := planned(t, "price_pm")
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		VALUES ($1, $2, 'seed', '', $3, 0, $4, now(), now())`, ws, string(Downloads), store.UsagePeriod(time.Now()), e.cap(ws, Downloads))
	code := func(err error) string {
		if err == nil {
			return ""
		}
		code, _, _ := strings.Cut(err.Error(), ":")
		return code
	}
	month := store.UsagePeriodStart(time.Now())
	at := func(d time.Duration) { e.svc.now = func() time.Time { return month.Add(d) } }
	at(time.Hour)
	failed, err := e.svc.ReserveSnapshot(ctx, ws)
	if err != nil {
		t.Fatalf("the owner's export with downloads used up: %v", err)
	}
	if _, err := e.svc.ReserveSnapshot(ctx, ws); code(err) != "export_running" {
		t.Fatalf("a second export while one runs: %v", err)
	}
	failed(0) // failed before its first byte
	day := 24 * time.Hour
	for i, start := range []time.Duration{2 * time.Hour, 8 * day, 15 * day, 22 * day} {
		at(start)
		settle, err := e.svc.ReserveSnapshot(ctx, ws)
		if err != nil {
			t.Fatalf("export %d: %v", i+1, err)
		}
		settle(1000)
		at(start + 6*day)
		if _, err := e.svc.ReserveSnapshot(ctx, ws); code(err) != "export_weekly" {
			t.Fatalf("an export six days after export %d: %v", i+1, err)
		}
	}
	at(29 * day)
	if _, err := e.svc.ReserveSnapshot(ctx, ws); code(err) != "export_monthly" {
		t.Fatalf("a fifth export in a month: %v", err)
	}
}

type sentMail struct{ n int }

func (s *sentMail) Send(context.Context, mail.Message) error { s.n++; return nil }

// TestInvoiceEmailStopsAtTheCapAndThePDFStays: an issued invoice's PDF is counted in storage; its email to two
// recipients fits Basic's last two, the next is refused with a way out, and the PDF still downloads.
func TestInvoiceEmailStopsAtTheCapAndThePDFStays(t *testing.T) {
	e := usageEnv(t)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_bm")
	sender := &sentMail{}
	files := &admissionFiles{objects: map[string][]byte{}}
	mux := http.NewServeMux()
	invoices.New(e.st, e.svc.auth, invoiceFiles{files}, mail.Metered{Sender: sender, Meter: e.svc}, quiet).Register(mux)
	srv := httptest.NewServer(e.svc.Guard(mux))
	t.Cleanup(srv.Close)
	e.srv = srv
	if code, body := e.do(owner, http.MethodPut, "/api/v1/invoice-settings", issueSettings); code != http.StatusOK {
		t.Fatalf("settings: %d %v", code, body)
	}
	code, body := e.do(owner, http.MethodPost, "/api/v1/invoices", map[string]any{"client_id": e.buyer(ws),
		"lines": []any{map[string]any{"description": "Beratung", "quantity": "1", "unit": "hour", "unit_price": "100.00"}}})
	if code != http.StatusCreated {
		t.Fatalf("draft: %d %v", code, body)
	}
	id := dataOf(body)["id"].(string)
	if code, body := e.do(owner, http.MethodPost, "/api/v1/invoices/"+id+"/issue", nil); code != http.StatusOK {
		t.Fatalf("issue: %d %v", code, body)
	}
	if got := e.stored(ws); got == 0 {
		t.Fatal("the issued invoice's PDF is not counted")
	}
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		VALUES ($1, $2, 'seed', '', $3, 0, 98, now(), now())`, ws, string(Emails), store.UsagePeriod(time.Now()))
	send := map[string]any{"to": []string{"ap@kunde.ch"}, "cc": []string{"cfo@kunde.ch"}}
	if code, body := e.do(owner, http.MethodPost, "/api/v1/invoices/"+id+"/send", send); code != http.StatusOK || sender.n != 1 {
		t.Fatalf("the 99th and 100th recipients: %d %v (sent %d)", code, body, sender.n)
	}
	code, body = e.do(owner, http.MethodPost, "/api/v1/invoices/"+id+"/send", map[string]any{"to": []string{"ap@kunde.ch"}})
	if code != http.StatusPaymentRequired || errorCode(body) != "limit_reached" || !strings.Contains(fmt.Sprint(body), "Download the PDF") || sender.n != 1 {
		t.Fatalf("the 101st recipient: %d %v", code, body)
	}
	if code, _ := e.do(owner, http.MethodGet, "/api/v1/invoices/"+id+"/pdf", nil); code != http.StatusOK {
		t.Fatalf("the PDF after the email cap: %d", code)
	}
}
