package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// paidInvoice inserts an issued invoice of client with one payment (dated paidOn) and one refund, and returns their ids.
func (e *env) paidInvoice(b *browser, client, paidOn string) (invoice, payment, refund string) {
	e.t.Helper()
	invoice, payment, refund = auth.NewID("inv"), auth.NewID("pay"), auth.NewID("ref")
	ctx := context.Background()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date, currency, language, vat_mode,
			discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, created_at, updated_at)
			VALUES ($1, $2, 'invoice', 'paid', '2026-007', $3, '2026-01-10', '2026-02-10', 'CHF', 'de', 'none', 0, 10000, 0, 10000, 0,
			10000, 0, '[]', now(), now())`, []any{invoice, b.workspace, client}},
		{`INSERT INTO invoice_payments (id, invoice_id, amount, paid_on, method, created_at) VALUES ($1, $2, 10000, $3, 'bank_transfer', now())`,
			[]any{payment, invoice, paidOn}},
		{`INSERT INTO invoice_refunds (id, invoice_id, amount, refunded_on, method, created_at) VALUES ($1, $2, 100, $3, 'bank_transfer', now())`,
			[]any{refund, invoice, paidOn}},
	} {
		if _, err := e.raw.Exec(ctx, q.sql, q.args...); err != nil {
			e.t.Fatal(err)
		}
	}
	return invoice, payment, refund
}

// attachUpload posts a file to the payment's (or refund's) documents.
func (e *env) attachUpload(b *browser, path, name, content string, want int) (store.Document, bool) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, err := mw.CreateFormFile("file", name)
	if err != nil {
		e.t.Fatal(err)
	}
	_, _ = w.Write([]byte(content))
	_ = mw.Close()
	resp, raw := e.send(b, "POST", path, &buf, mw.FormDataContentType())
	if resp.StatusCode != want {
		e.t.Fatalf("attach %s: %d %s", name, resp.StatusCode, raw)
	}
	var out struct {
		Data   store.Document
		Reused bool
	}
	_ = json.Unmarshal(raw, &out)
	return out.Data, out.Reused
}

func (e *env) paymentDocs(invoice string) map[string][]store.PaymentDocument {
	e.t.Helper()
	out := map[string][]store.PaymentDocument{}
	pays, err := e.st.Payments(context.Background(), invoice)
	if err != nil {
		e.t.Fatal(err)
	}
	for _, p := range pays {
		out[p.ID] = p.Documents
	}
	refs, err := e.st.Refunds(context.Background(), invoice)
	if err != nil {
		e.t.Fatal(err)
	}
	for _, r := range refs {
		out[r.ID] = r.Documents
	}
	return out
}

func (e *env) auditKinds(b *browser) []string {
	e.t.Helper()
	rows, err := e.raw.Query(context.Background(), `SELECT kind FROM financial_events WHERE workspace_id = $1 ORDER BY seq`, b.workspace)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			e.t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	return kinds
}

func TestPaymentFileUploadIsFiledLinkedAndDeduplicated(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cli := e.client(b, "Acme AG")
	inv, pay, ref := e.paidInvoice(b, cli, "2025-11-06")
	base := "/api/v1/invoices/" + inv

	d, reused := e.attachUpload(b, base+"/payments/"+pay+"/documents", "gutschrift.pdf", pdf+"gutschrift", 201)
	if reused || d.Folder == nil || d.Folder.Name != store.BankStatementsFolderName || !slices.Contains(d.Tags, "payment-confirmation") {
		t.Fatalf("uploaded: %+v", d)
	}
	if !d.RecordFile || len(d.Links) != 1 || d.Links[0].Type != "payment" || d.Links[0].ID != inv || d.Links[0].Label != "2026-007" ||
		!d.Links[0].Retains {
		t.Fatalf("payment link: %+v", d.Links)
	}
	// the folder is the client's Documents/<payment year>/Bank Statements
	folder, err := e.st.DocumentFolder(t.Context(), b.workspace, d.Folder.ID)
	if err != nil || folder.ParentID == nil {
		t.Fatal(folder, err)
	}
	if year, err := e.st.DocumentFolder(t.Context(), b.workspace, *folder.ParentID); err != nil || year.Name != "2025" {
		t.Fatalf("year folder: %+v %v", year, err)
	}
	if got := e.paymentDocs(inv)[pay]; len(got) != 1 || got[0].ID != d.ID || got[0].Name != "gutschrift.pdf" ||
		got[0].ContentType != "application/pdf" || got[0].Size != int64(len(pdf+"gutschrift")) {
		t.Fatalf("payment documents: %+v", got)
	}

	// the same bytes again, for the refund: the Document is linked, not stored twice
	again, reused := e.attachUpload(b, base+"/refunds/"+ref+"/documents", "copy.pdf", pdf+"gutschrift", 200)
	if !reused || again.ID != d.ID || len(e.paymentDocs(inv)[ref]) != 1 || e.files.count() != 1 {
		t.Fatalf("dedupe: %+v reused=%v objects=%d", again, reused, e.files.count())
	}
	if kinds := e.auditKinds(b); !slices.Equal(kinds, []string{"invoice.payment_file_attached", "invoice.payment_file_attached"}) {
		t.Fatalf("audit: %v", kinds)
	}

	// another workspace cannot reach the payment
	other := e.workspace()
	e.fails(other, "POST", base+"/payments/"+pay+"/documents", map[string]any{"document_id": d.ID}, 404, "not_found")
	e.fails(b, "POST", base+"/payments/pay_missing/documents", map[string]any{"document_id": d.ID}, 404, "not_found")
}

func TestPaymentFileExistingDocumentLocksUntilUnlinked(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cli := e.client(b, "Acme AG")
	inv, pay, _ := e.paidInvoice(b, cli, "2026-03-02")
	path := "/api/v1/invoices/" + inv + "/payments/" + pay + "/documents"
	mine := e.folder(b, "Bank", nil)
	elsewhere := e.folder(b, "Elsewhere", nil)
	d := e.uploaded(b, "statement.pdf", pdf+"statement", "folder_id", mine.ID)

	// a document of another workspace, an HR file, a trashed file or none at all is never linked
	other := e.workspace()
	foreign := e.uploaded(other, "foreign.pdf", pdf+"foreign")
	e.fails(b, "POST", path, map[string]any{"document_id": foreign.ID}, 422, "validation_failed")
	hr := auth.NewID("doc")
	if err := e.st.CreateDocument(t.Context(), b.workspace, b.user, store.Document{ID: hr, HRPrivate: true, Name: "payslip.pdf",
		Size: 3, ContentType: "application/pdf", ObjectKey: "workspaces/" + b.workspace + "/hr/" + hr, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	e.fails(b, "POST", path, map[string]any{"document_id": hr}, 422, "validation_failed")
	e.fails(b, "POST", path, map[string]any{"document_id": ""}, 422, "validation_failed")

	var got one[store.Document]
	e.do(b, "POST", path, map[string]any{"document_id": d.ID}, 201, &got)
	if got.Data.FolderID == nil || *got.Data.FolderID != mine.ID || !got.Data.RecordFile {
		t.Fatalf("picked document moved or not locked: %+v", got.Data)
	}
	// a linked file cannot be moved, trashed or unlinked through Documents, nor offered to organizing
	e.fails(b, "PATCH", "/api/v1/documents/"+d.ID, map[string]any{"folder_id": elsewhere.ID}, 409, "record_move_locked")
	if out := e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{d.ID}}); out.Updated != 0 {
		t.Fatalf("trashed a payment's file: %+v", out)
	}
	e.fails(b, "DELETE", "/api/v1/documents/"+d.ID+"/links/payment/"+inv, nil, 409, "retained")
	e.fails(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": []map[string]any{{"document_id": d.ID,
		"folder": "Arbitrary", "tags": []string{}}}}, 409, "record_move_locked")
	candidates, err := e.st.OrganizeDocuments(t.Context(), b.workspace, nil, 100, "2026-11-27")
	if err != nil || slices.ContainsFunc(candidates, func(c store.Document) bool { return c.ID == d.ID }) {
		t.Fatalf("organize offers a payment's file: %v", err)
	}
	// Group by type counts it as a payment confirmation
	if p := e.list(b, "type=payment_confirmations"); len(p.Data) != 1 || p.Data[0].ID != d.ID {
		t.Fatalf("payment confirmations group: %v", names(p.Data))
	}

	e.do(b, "DELETE", path+"/"+d.ID, nil, 204, nil)
	e.fails(b, "DELETE", path+"/"+d.ID, nil, 404, "not_found")
	if len(e.paymentDocs(inv)[pay]) != 0 {
		t.Fatal("still linked")
	}
	e.do(b, "PATCH", "/api/v1/documents/"+d.ID, map[string]any{"folder_id": elsewhere.ID}, 200, nil)
	if kinds := e.auditKinds(b); !slices.Equal(kinds, []string{"invoice.payment_file_attached", "invoice.payment_file_removed"}) {
		t.Fatalf("audit: %v", kinds)
	}
}

func TestDeletingAPaymentRemovesItsFileLinks(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cli := e.client(b, "Acme AG")
	inv, pay, ref := e.paidInvoice(b, cli, "2026-03-02")
	d := e.uploaded(b, "statement.pdf", pdf+"statement")
	e.do(b, "POST", "/api/v1/invoices/"+inv+"/payments/"+pay+"/documents", map[string]any{"document_id": d.ID}, 201, nil)
	// the documented form: document_id as a multipart field
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("document_id", d.ID)
	_ = mw.Close()
	if resp, raw := e.send(b, "POST", "/api/v1/invoices/"+inv+"/refunds/"+ref+"/documents", &buf, mw.FormDataContentType()); resp.StatusCode != 201 {
		t.Fatalf("multipart document_id: %d %s", resp.StatusCode, raw)
	}
	if ok, err := e.st.DeleteRefund(t.Context(), inv, ref); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if !e.get(b, d.ID).RecordFile {
		t.Fatal("the payment's link went with the refund")
	}
	if ok, err := e.st.DeletePayment(t.Context(), inv, pay); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if got := e.get(b, d.ID); got.RecordFile || len(got.Links) != 0 {
		t.Fatalf("links after deleting the payment: %+v", got.Links)
	}
}
