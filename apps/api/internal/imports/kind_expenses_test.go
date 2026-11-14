package imports

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// rec builds a record from field → JSON literal.
func rec(fields map[string]string) Data {
	d := Data{}
	for k, v := range fields {
		d[k] = json.RawMessage(v)
	}
	return d
}

func expenseSession(t *testing.T) (*store.Store, store.Session, *pgxpool.Pool) {
	t.Helper()
	st, raw := storetest.New(t)
	ctx, now := context.Background(), time.Now()
	ws := store.Workspace{ID: auth.NewID("wsp"), Name: "Acme", Timezone: "Europe/Zurich"}
	u := store.User{ID: auth.NewID("usr"), Email: ws.ID + "@example.com", Name: "Anna"}
	for _, err := range []error{st.CreateWorkspace(ctx, ws, ws.Timezone, now), st.CreateUser(ctx, u, now)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	return st, store.Session{User: u, Workspace: ws, Role: "owner"}, raw
}

func TestExpensesKindCheck(t *testing.T) {
	t.Parallel()
	st, sess, _ := expenseSession(t)
	tests := []struct {
		name   string
		data   map[string]string
		issues []string // the fields with a message
	}{
		{"receipt at one rate", map[string]string{"supplier_name": `"Migros"`, "document_date": `"2026-03-02"`, "amount": `"108.10"`, "vat_rate": `"8.1"`}, nil},
		{"two rates", map[string]string{"amount": `"25.00"`, "vat_rate": `"8.1"`, "amount_2": `"180.00"`, "vat_rate_2": `"3.8"`}, nil},
		{"amount as a JSON number", map[string]string{"amount": `108.1`, "vat_rate": `8.1`}, nil},
		{"no VAT shown", map[string]string{"amount": `"40.00"`}, nil},
		{"no amount", map[string]string{"supplier_name": `"Migros"`, "vat_rate": `"8.1"`}, []string{"amount"}},
		{"negative amount", map[string]string{"amount": `"-10.00"`}, []string{"amount"}},
		{"huge amount", map[string]string{"amount": `"100000000.01"`}, []string{"amount"}},
		{"three decimals", map[string]string{"amount": `"1.005"`}, []string{"amount"}},
		{"second rate without its amount", map[string]string{"amount": `"10.00"`, "vat_rate_2": `"2.6"`}, []string{"amount_2"}},
		{"bad second amount", map[string]string{"amount": `"10.00"`, "amount_2": `"ten"`}, []string{"amount_2"}},
		{"bad date", map[string]string{"amount": `"10.00"`, "document_date": `"31.12.2025"`}, []string{"document_date"}},
		{"impossible date", map[string]string{"amount": `"10.00"`, "document_date": `"2025-02-30"`}, []string{"document_date"}},
		{"due before the date", map[string]string{"amount": `"10.00"`, "document_date": `"2025-02-10"`, "due_date": `"2025-02-01"`}, []string{"due_date"}},
		{"unknown currency", map[string]string{"amount": `"10.00"`, "currency": `"XYZ"`}, []string{"currency"}},
		{"currency without cents", map[string]string{"amount": `"10.00"`, "currency": `"JPY"`}, []string{"currency"}},
		{"rate over 100", map[string]string{"amount": `"10.00"`, "vat_rate": `"181"`}, []string{"vat_rate"}},
		{"rate is an amount", map[string]string{"amount": `"10.00"`, "vat_rate": `"8.10 CHF"`}, []string{"vat_rate"}},
		{"not a Swiss rate", map[string]string{"amount": `"10.00"`, "vat_rate": `"19"`}, []string{"vat_rate"}},
		{"old Swiss rate in 2025", map[string]string{"amount": `"10.00"`, "vat_rate": `"7.7"`, "document_date": `"2025-01-10"`}, []string{"vat_rate"}},
		{"old Swiss rate in 2023", map[string]string{"amount": `"10.00"`, "vat_rate": `"7.7"`, "document_date": `"2023-12-31"`}, nil},
		{"new rate before 2024", map[string]string{"amount": `"10.00"`, "vat_rate_2": `"2.6"`, "amount_2": `"5.00"`, "document_date": `"2023-06-01"`}, []string{"vat_rate_2"}},
		{"German VAT from a German supplier", map[string]string{"amount": `"119.00"`, "vat_rate": `"19"`, "supplier_country": `"DE"`, "currency": `"EUR"`}, nil},
		{"unknown country", map[string]string{"amount": `"10.00"`, "supplier_country": `"XX"`}, []string{"supplier_country"}},
		{"reverse charge abroad", map[string]string{"amount": `"10.00"`, "supplier_country": `"IE"`, "reverse_charge": `true`}, nil},
		{"reverse charge as the review's Yes", map[string]string{"amount": `"10.00"`, "supplier_country": `"IE"`, "reverse_charge": `"Yes"`}, nil},
		{"reverse charge at home", map[string]string{"amount": `"10.00"`, "reverse_charge": `true`}, []string{"reverse_charge"}},
		{"reverse charge unreadable", map[string]string{"amount": `"10.00"`, "reverse_charge": `"maybe"`}, []string{"reverse_charge"}},
		{"supplier too long", map[string]string{"amount": `"10.00"`, "supplier_name": `"` + strings.Repeat("a", 201) + `"`}, []string{"supplier_name"}},
		{"wrong type", map[string]string{"amount": `"10.00"`, "supplier_name": `{"x":1}`}, []string{"supplier_name"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues, err := expensesKind.Check(context.Background(), st.Q, sess.Workspace.ID, rec(tt.data))
			if err != nil {
				t.Fatal(err)
			}
			if got := slices.Sorted(maps.Keys(issues)); !slices.Equal(got, tt.issues) {
				t.Fatalf("issues %v, want fields %v", issues, tt.issues)
			}
		})
	}
}

func TestExpensesKindCreate(t *testing.T) {
	t.Parallel()
	st, sess, _ := expenseSession(t)
	ctx := context.Background()
	create := func(data Data) (string, error) { return createFrom(ctx, st, sess, data, Source{Name: "receipt.pdf"}) }
	today := sess.Workspace.Today(time.Now())

	t.Run("a draft from the import, at the receipt's rates", func(t *testing.T) {
		id, err := create(rec(map[string]string{"supplier_name": `"Hotel Adler"`, "document_date": `"2026-03-02"`, "reference": `"R-17"`,
			"amount": `"25.00"`, "vat_rate": `"8.1"`, "amount_2": `"180.00"`, "vat_rate_2": `"3.8"`}))
		if err != nil {
			t.Fatal(err)
		}
		e, err := st.Expense(ctx, sess.Workspace.ID, id, today, false)
		if err != nil {
			t.Fatal(err)
		}
		if e.Status != "draft" || e.Source != "import" || e.Total.String() != "205.00" || e.VATTotal.String() != "8.46" || len(e.Lines) != 2 {
			t.Fatalf("expense %+v", e)
		}
		if e.CreatedBy == nil || e.CreatedBy.ID != sess.User.ID {
			t.Fatalf("created by %+v", e.CreatedBy)
		}
	})

	t.Run("no VAT shown claims none, even for a VAT-registered workspace", func(t *testing.T) {
		id, err := create(rec(map[string]string{"supplier_name": `"Kiosk"`, "amount": `"12.00"`}))
		if err != nil {
			t.Fatal(err)
		}
		e, err := st.Expense(ctx, sess.Workspace.ID, id, today, false)
		if err != nil {
			t.Fatal(err)
		}
		if e.VATTotal != 0 || e.Total.String() != "12.00" || e.Lines[0].VATRate != 0 {
			t.Fatalf("expense %+v", e)
		}
	})

	t.Run("a foreign currency waits for its exchange rate", func(t *testing.T) {
		id, err := create(rec(map[string]string{"supplier_name": `"Bahn"`, "amount": `"119.00"`, "vat_rate": `"19"`,
			"supplier_country": `"DE"`, "currency": `"EUR"`}))
		if err != nil {
			t.Fatal(err)
		}
		e, err := st.Expense(ctx, sess.Workspace.ID, id, today, false)
		if err != nil {
			t.Fatal(err)
		}
		if e.Currency != "EUR" || e.ExchangeRateSource != nil || !slices.Contains(e.MissingFields, "exchange_rate") || e.DeductibleVAT != 0 {
			t.Fatalf("expense %+v", e)
		}
	})

	t.Run("an invalid record is refused with its fields", func(t *testing.T) {
		_, err := create(rec(map[string]string{"amount": `"-1"`, "currency": `"XYZ"`}))
		if err == nil || !strings.HasPrefix(err.Error(), "validation_failed:") {
			t.Fatalf("err %v", err)
		}
	})
}

func TestExpensesKindDuplicate(t *testing.T) {
	t.Parallel()
	st, sess, raw := expenseSession(t)
	ctx := context.Background()
	receipt := map[string]string{"supplier_name": `"Migros"`, "document_date": `"2026-03-02"`, "amount": `"108.10"`, "vat_rate": `"8.1"`}
	dup := func(fields map[string]string) *store.ImportDuplicate {
		t.Helper()
		d, err := expensesKind.Duplicate(ctx, st.Q, sess.Workspace.ID, rec(fields))
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	if d := dup(receipt); d != nil {
		t.Fatalf("duplicate before any expense: %+v", d)
	}
	var id string
	if err := st.Tx(ctx, func(q store.Q) error {
		var err error
		id, err = expensesKind.Create(ctx, q, sess, rec(map[string]string{"supplier_name": `"Migros"`, "document_date": `"2026-03-02"`,
			"amount": `"108.10"`, "vat_rate": `"8.1"`, "reference": `"B-99"`}), Source{})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	with := func(k, v string) map[string]string {
		m := maps.Clone(receipt)
		m[k] = v
		return m
	}
	tests := []struct {
		name   string
		data   map[string]string
		reason string // "" for no duplicate
	}{
		{"the same receipt imported again", receipt, "same date and total"},
		{"supplier in other case", with("supplier_name", `"MIGROS"`), "same date and total"},
		{"same reference, other amount", with("reference", `"b-99"`), "same reference"},
		{"other total", with("amount", `"108.15"`), ""},
		{"other date", with("document_date", `"2026-03-03"`), ""},
		{"other supplier", with("supplier_name", `"Coop"`), ""},
		{"other currency", with("currency", `"EUR"`), ""},
		{"no supplier", map[string]string{"document_date": `"2026-03-02"`, "amount": `"108.10"`, "vat_rate": `"8.1"`}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := dup(tt.data)
			switch {
			case tt.reason == "" && d != nil:
				t.Fatalf("duplicate %+v, want none", d)
			case tt.reason != "" && (d == nil || d.ID != id || d.Reason != tt.reason || d.Label != "Expense 1 · Migros"):
				t.Fatalf("duplicate %+v, want %s (%s)", d, id, tt.reason)
			}
		})
	}

	t.Run("a deleted expense or another workspace's is no duplicate", func(t *testing.T) {
		other, otherSess, _ := expenseSession(t)
		if d, err := expensesKind.Duplicate(ctx, other.Q, otherSess.Workspace.ID, rec(receipt)); err != nil || d != nil {
			t.Fatalf("other workspace: %+v, %v", d, err)
		}
		if _, err := raw.Exec(ctx, `UPDATE expenses SET deleted_at=now() WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
		if d := dup(receipt); d != nil {
			t.Fatalf("deleted expense flagged: %+v", d)
		}
	})
}

func createFrom(ctx context.Context, st *store.Store, sess store.Session, data Data, src Source) (string, error) {
	var id string
	err := st.Tx(ctx, func(q store.Q) error {
		var err error
		id, err = expensesKind.Create(ctx, q, sess, data, src)
		return err
	})
	return id, err
}

func TestExpensesKindLinksTheReceiptDocument(t *testing.T) {
	t.Parallel()
	st, sess, raw := expenseSession(t)
	ctx := context.Background()
	doc := store.Document{ID: auth.NewID("doc"), Name: "migros.pdf", Size: 1200, ContentType: "application/pdf",
		ObjectKey: "workspaces/" + sess.Workspace.ID + "/documents/migros.pdf", CreatedAt: time.Now()}
	if err := st.CreateDocument(ctx, sess.Workspace.ID, sess.User.ID, doc); err != nil {
		t.Fatal(err)
	}
	receipt := rec(map[string]string{"supplier_name": `"Migros"`, "amount": `"108.10"`, "vat_rate": `"8.1"`})
	links := func(expenseID string) int {
		t.Helper()
		var n int
		if err := raw.QueryRow(ctx, `SELECT count(*) FROM document_links WHERE target_type='expense' AND target_id=$1`,
			expenseID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("a file of its own: its Document is linked to the draft", func(t *testing.T) {
		id, err := createFrom(ctx, st, sess, receipt, Source{DocumentID: &doc.ID, Name: doc.Name})
		if err != nil {
			t.Fatal(err)
		}
		d, err := st.Document(ctx, sess.Workspace.ID, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.ContainsFunc(d.Links, func(l store.DocumentLink) bool { return l.Type == "expense" && l.ID == id }) {
			t.Fatalf("links %+v, want expense %s", d.Links, id)
		}
	})

	t.Run("a ZIP entry has no Document: the draft has no link", func(t *testing.T) {
		id, err := createFrom(ctx, st, sess, receipt, Source{Name: "receipts.zip › migros.jpg"})
		if err != nil {
			t.Fatal(err)
		}
		if n := links(id); n != 0 {
			t.Fatalf("%d links for a ZIP entry", n)
		}
	})

	t.Run("a failed link rolls the draft back", func(t *testing.T) {
		missing := "doc_missing"
		if _, err := createFrom(ctx, st, sess, receipt, Source{DocumentID: &missing}); err == nil {
			t.Fatal("linked a missing Document")
		}
		var n int
		if err := raw.QueryRow(ctx, `SELECT count(*) FROM expenses WHERE workspace_id=$1`, sess.Workspace.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 2 {
			t.Fatalf("%d expenses, want the 2 created above", n)
		}
	})
}

func TestExpenseImportKeepsTheFileAsTheReceipt(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	ctx := context.Background()
	jpeg := func(text string) []byte { return append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, text...) }
	migros, coop := jpeg("migros receipt"), jpeg("coop receipt")
	var zipped bytes.Buffer
	zw := zip.NewWriter(&zipped)
	w, err := zw.Create("scans/coop.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(coop); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	reply := answer(`{"records":[{"supplier_name":"Shop","amount":"108.10","vat_rate":"8.1"}]}`)
	e.model.replies = append(e.model.replies, reply, reply, reply)
	b := decode[store.ImportBatch](t, e.upload("expenses", map[string][]byte{"migros.jpg": migros, "scans.zip": zipped.Bytes(),
		"list.csv": []byte("supplier_name,amount\nShop,108.10\n")}))
	got := e.extracted(b.ID)
	if len(got.Records) != 3 {
		t.Fatalf("records: %+v", got.Records)
	}
	commit := func() commitOut {
		ids := []string{}
		for _, r := range got.Records {
			ids = append(ids, r.ID)
		}
		return decode[commitOut](t, e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids}))
	}

	// A refused receipt (here the storage limit) leaves neither the draft nor the copied object behind.
	e.db.SetAdmission(func(_ context.Context, _ store.Q, _, resource string, _ int64) error {
		if resource == "storage_bytes" {
			return fmt.Errorf("%w: %w", store.ErrAdmissionDenied, auth.Error(402, "limit_reached", "Your plan's storage is full.", nil))
		}
		return nil
	})
	e.files.mu.Lock()
	before := len(e.files.objects)
	e.files.mu.Unlock()
	failed := commit()
	e.files.mu.Lock()
	after := len(e.files.objects)
	e.files.mu.Unlock()
	refused := 0
	for _, res := range failed.Results {
		if res.Status == "failed" && res.Error != nil && res.Error.Code == "limit_reached" {
			refused++
		}
	}
	if refused != 2 || after != before { // the CSV's draft has no receipt to refuse
		t.Fatalf("refused: %+v objects %d → %d", failed.Results, before, after)
	}
	e.db.SetAdmission(nil)

	receipts := map[string][]byte{} // name → stored bytes
	for _, res := range commit().Results {
		if res.Status != "created" {
			t.Fatalf("commit: %+v", res)
		}
		list, err := e.db.Receipts(ctx, *res.EntityID)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range list {
			e.files.mu.Lock()
			stored := e.files.objects[r.ObjectKey]
			e.files.mu.Unlock()
			sum := sha256.Sum256(stored)
			if r.ContentType != "image/jpeg" || r.Size != int64(len(stored)) || r.SHA256 != hex.EncodeToString(sum[:]) ||
				!strings.HasPrefix(r.ObjectKey, "workspaces/ws_a/expenses/"+*res.EntityID+"/") {
				t.Fatalf("receipt %+v", r)
			}
			receipts[r.Name] = stored
		}
	}
	// The photo and the ZIP entry are receipts with their own bytes; the CSV lists expenses and is no receipt.
	if len(receipts) != 2 || !bytes.Equal(receipts["migros.jpg"], migros) || !bytes.Equal(receipts["coop.jpg"], coop) {
		t.Fatalf("receipts: %v", slices.Collect(maps.Keys(receipts)))
	}
}

// Bytes already kept as another expense's receipt are reused, not a Document: the import still keeps its own copy
// and links no Document.
func TestExpenseImportOfAnotherExpensesReceipt(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	ctx, now := context.Background(), time.Now()
	photo := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, "kept receipt"...)
	sum := sha256.Sum256(photo)
	firstID, err := createFrom(ctx, e.db, *e.sess, rec(map[string]string{"amount": `"10.00"`}), Source{Name: "kept.jpg"})
	if err != nil {
		t.Fatal(err)
	}
	kept := store.Receipt{ID: auth.NewID("rcp"), Name: "kept.jpg", Size: int64(len(photo)), ContentType: "image/jpeg",
		CreatedAt: now, SHA256: hex.EncodeToString(sum[:]), ObjectKey: "workspaces/ws_a/expenses/" + firstID + "/kept.jpg"}
	if err := e.db.CreateReceipt(ctx, "ws_a", firstID, "usr_a", kept); err != nil {
		t.Fatal(err)
	}
	e.files.objects[kept.ObjectKey] = photo
	e.model.replies = append(e.model.replies, answer(`{"records":[{"supplier_name":"Shop","amount":"10.00"}]}`))
	b := decode[store.ImportBatch](t, e.upload("expenses", map[string][]byte{"again.jpg": photo}))
	got := e.extracted(b.ID)
	if !got.Files[0].Reused || len(got.Records) != 1 {
		t.Fatalf("batch: %+v", got)
	}
	out := decode[commitOut](t, e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": []string{got.Records[0].ID}}))
	if out.Results[0].Status != "created" {
		t.Fatalf("commit: %+v", out.Results)
	}
	list, err := e.db.Receipts(ctx, *out.Results[0].EntityID)
	if err != nil || len(list) != 1 || list[0].ObjectKey == kept.ObjectKey || list[0].SHA256 != kept.SHA256 {
		t.Fatalf("receipts %+v %v", list, err)
	}
}
