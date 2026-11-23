package documents

import (
	"context"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// autoEnv: a workspace with two clients and helpers that make records of its files.
type autoEnv struct {
	e          *env
	b          *browser
	acme, beta string
	n          int
}

func newAutoEnv(t *testing.T) *autoEnv {
	e := newEnv(t)
	b := e.workspace()
	return &autoEnv{e: e, b: b, acme: e.client(b, "Acme AG"), beta: e.client(b, "Beta GmbH")}
}

func (a *autoEnv) exec(sql string, args ...any) {
	a.e.t.Helper()
	if _, err := a.e.raw.Exec(context.Background(), sql, args...); err != nil {
		a.e.t.Fatal(err)
	}
}

// file uploads a new file, into folder unless it is "".
func (a *autoEnv) file(folder string) store.Document {
	a.n++
	name, content := auth.NewID("f")+".pdf", pdf+auth.NewID("x")
	if folder == "" {
		return a.e.uploaded(a.b, name, content)
	}
	return a.e.uploaded(a.b, name, content, "folder_id", folder)
}

func (a *autoEnv) key(id string) string {
	var k string
	if err := a.e.raw.QueryRow(context.Background(), `SELECT object_key FROM documents WHERE id = $1`, id).Scan(&k); err != nil {
		a.e.t.Fatal(err)
	}
	return k
}

func (a *autoEnv) quote(client, number, pdfKey string) string {
	id := auth.NewID("quo")
	a.exec(`INSERT INTO quotes (id, workspace_id, client_id, number, status, issue_date, valid_until, currency, language, vat_mode,
		note, discount_percent, lines, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown,
		pdf_key, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'sent', '2026-03-01', '2026-04-01', 'CHF', 'de', 'none', '', 0, '[]', 0, 0, 0, 0, 0, 0, '[]',
		nullif($5, ''), now(), now())`, id, a.b.workspace, client, number, pdfKey)
	return id
}

func (a *autoEnv) contractsFolder(client string, year int) string {
	var id string
	err := a.e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = q.ContractsFolder(context.Background(), a.b.workspace, client, year, a.b.user, time.Now())
		return err
	})
	if err != nil {
		a.e.t.Fatal(err)
	}
	return id
}

// contract: a contract numbered number made from a new quote of acme, filed in its Contracts folder of 2026
// (AddQuoteContract tags it).
func (a *autoEnv) contract(quote, number string) store.Document {
	d := a.file(a.contractsFolder(a.acme, 2026))
	if err := a.e.st.AddQuoteContract(context.Background(), a.b.workspace, a.quote(a.acme, quote, ""), d.ID,
		number, "", a.b.user, time.Now()); err != nil {
		a.e.t.Fatal(err)
	}
	return d
}

func (a *autoEnv) retag(id string) store.Document {
	a.e.t.Helper()
	if err := a.e.st.AutoTag(context.Background(), a.b.workspace, id, time.Now()); err != nil {
		a.e.t.Fatal(err)
	}
	return a.e.get(a.b, id)
}

func TestAutoTagsOfEachRecord(t *testing.T) {
	a := newAutoEnv(t)
	ctx := context.Background()
	for _, tc := range []struct {
		name string
		make func() string // the file's id, its record made
		want []string
	}{
		{"invoice by its PDF", func() string {
			d := a.file("")
			a.e.invoice(a.b, a.acme, "invoice", "2026/IN/005", 2026, "")
			a.exec(`UPDATE invoices SET pdf_key = $1 WHERE number = '2026/IN/005'`, a.key(d.ID))
			return d.ID
		}, []string{"invoice", "year-2026", "client-acme-ag", "2026-in-005"}},
		{"credit note by its link", func() string {
			d := a.file("")
			a.e.invoice(a.b, a.beta, "credit_note", "2025/CN/002", 2025, "")
			var inv string
			_ = a.e.raw.QueryRow(ctx, `SELECT id FROM invoices WHERE number = '2025/CN/002'`).Scan(&inv)
			if err := a.e.st.AddDocumentLink(ctx, a.b.workspace, d.ID, "invoice", inv, a.b.user, time.Now()); err != nil {
				t.Fatal(err)
			}
			return d.ID
		}, []string{"credit-note", "year-2025", "client-beta-gmbh", "2025-cn-002"}},
		{"debit note imported from its original", func() string {
			d := a.file("")
			a.e.invoice(a.b, a.acme, "debit_note", "D-7", 2024, d.ID)
			return d.ID
		}, []string{"debit-note", "year-2024", "client-acme-ag", "d-7"}},
		{"quote by its PDF", func() string {
			d := a.file(a.e.recordFolder(a.b, a.acme, "quotes", 2026))
			a.quote(a.acme, "2026/Q/001", a.key(d.ID))
			return d.ID
		}, []string{"quote", "year-2026", "client-acme-ag", "2026-q-001"}},
		{"quote revision", func() string {
			d := a.file("")
			q := a.quote(a.beta, "2026/Q/003", "quotes/other.pdf")
			a.exec(`INSERT INTO quote_revisions (workspace_id, quote_id, revision, sent_to, snapshot, pdf_key, created_at)
				VALUES ($1, $2, 1, '{}', '{}', $3, now())`, a.b.workspace, q, a.key(d.ID))
			return d.ID
		}, []string{"quote", "year-2026", "client-beta-gmbh", "2026-q-003"}},
		{"contract from a quote", func() string { return a.contract("2026/Q/002", "2026/C/001").ID },
			[]string{"contract", "year-2026", "client-acme-ag", "2026-c-001", "from-quote-2026-q-002"}},
		{"signed copy of a contract", func() string {
			original := a.contract("2026/Q/004", "2026/C/002")
			signed := a.file(a.e.recordFolder(a.b, a.acme, "signatures", 2026))
			a.exec(`INSERT INTO signature_requests (id, workspace_id, document_id, signed_document_id, title, signing_order, status,
					original_key, original_sha256, page_count, expires_at, created_at, updated_at, completed_at)
				VALUES ($1, $2, $3, $4, 'Contract', 'parallel', 'pending', 'k', repeat('a', 64), 1, now(), now(), now(), now())`,
				"sig_auto", a.b.workspace, original.ID, signed.ID)
			if err := a.e.st.CompleteSignatureRequest(ctx, "sig_auto", signed.ID, "abc", time.Now()); err != nil {
				t.Fatal(err)
			}
			if got := a.e.get(a.b, original.ID).Tags; !slices.Contains(got, "signed") {
				t.Fatalf("signed original = %v", got)
			}
			return signed.ID
		}, []string{"contract", "signed", "year-2026", "client-acme-ag", "2026-c-002", "from-quote-2026-q-004"}},
		{"imported completed contract", func() string { return a.file(a.contractsFolder(a.beta, 2025)).ID },
			[]string{"contract", "year-2025", "client-beta-gmbh"}},
		{"receipt of an expense", func() string {
			d := a.file("")
			exp := a.e.expense(a.b, a.e.category(a.b, "Büro Material"), "2025-05-05")
			if err := a.e.st.AddDocumentLink(ctx, a.b.workspace, d.ID, "expense", exp, a.b.user, time.Now()); err != nil {
				t.Fatal(err)
			}
			return d.ID
		}, []string{"receipt", "year-2025", "expense-buero-material"}},
		{"engagement document", func() string { return a.file(a.e.recordFolder(a.b, a.beta, "engagements", 2026)).ID },
			[]string{"engagement", "year-2026", "client-beta-gmbh"}},
		{"client upload", func() string { return a.file(a.e.recordFolder(a.b, a.acme, "documents", 2026)).ID },
			[]string{"year-2026", "client-acme-ag"}},
		{"plain file", func() string { return a.file("").ID }, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := tc.make()
			d := a.retag(id)
			if !slices.Equal(d.Tags, tc.want) || !slices.Equal(d.AutoTags, tc.want) {
				t.Fatalf("tags = %v, auto = %v, want %v", d.Tags, d.AutoTags, tc.want)
			}
			if again := a.retag(id); !slices.Equal(again.Tags, tc.want) {
				t.Fatalf("tagged again = %v", again.Tags)
			}
		})
	}
}

// Removing an automatic tag keeps it away through later tagging (a move, a new link, the backfill); the person's own
// tags stay theirs, and automatic tags take no room of the 10.
func TestRemovedAutoTagStaysRemoved(t *testing.T) {
	a := newAutoEnv(t)
	d := a.file(a.e.recordFolder(a.b, a.acme, "invoices", 2026))
	a.e.invoice(a.b, a.acme, "invoice", "2026/IN/001", 2026, d.ID)
	if got := a.retag(d.ID).Tags; !slices.Equal(got, []string{"invoice", "year-2026", "client-acme-ag", "2026-in-001"}) {
		t.Fatalf("tags = %v", got)
	}
	mine := []string{"invoice", "client-acme-ag", "2026-in-001", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}
	a.e.do(a.b, "PATCH", "/api/v1/documents/"+d.ID, map[string]any{"tags": mine,
		"folder_id": a.e.recordFolder(a.b, a.acme, "invoices", 2025)}, 200, nil)
	got := a.retag(d.ID)
	if want := append(slices.Clone(mine[3:]), mine[:3]...); !slices.Equal(got.Tags, want) ||
		!slices.Equal(got.AutoTags, []string{"invoice", "client-acme-ag", "2026-in-001"}) {
		t.Fatalf("after removal: tags = %v, auto = %v", got.Tags, got.AutoTags)
	}
	a.exec(`UPDATE documents SET auto_tagged_at = NULL WHERE id = $1`, d.ID)
	if err := a.e.svc.BackfillAutoTags(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := a.e.get(a.b, d.ID); slices.Contains(got.Tags, "year-2026") || len(got.Tags) != len(mine) {
		t.Fatalf("after backfill: %v", got.Tags)
	}
	a.e.fails(a.b, "PATCH", "/api/v1/documents/"+d.ID, map[string]any{"tags": append(mine, "k")}, 422, "validation_failed")
}

// The backfill tags each file from before once: the people's tags stay (a typed tag the app would set stays theirs),
// nothing doubles, and a second run changes nothing.
func TestBackfillAutoTagsIdempotent(t *testing.T) {
	a := newAutoEnv(t)
	inv := a.file("")
	a.e.invoice(a.b, a.acme, "invoice", "2026/IN/009", 2026, inv.ID)
	upload := a.file(a.e.recordFolder(a.b, a.beta, "documents", 2025))
	plain := a.file("")
	a.exec(`UPDATE documents SET tags = '{invoice,urgent}', auto_tags = '{}', auto_tagged_at = NULL WHERE id = $1`, inv.ID)
	a.exec(`UPDATE documents SET tags = '{}', auto_tags = '{}', auto_tagged_at = NULL WHERE id = ANY($1)`, []string{upload.ID, plain.ID})
	want := map[string][2][]string{
		inv.ID:    {{"invoice", "urgent", "year-2026", "client-acme-ag", "2026-in-009"}, {"year-2026", "client-acme-ag", "2026-in-009"}},
		upload.ID: {{"year-2025", "client-beta-gmbh"}, {"year-2025", "client-beta-gmbh"}},
		plain.ID:  {{}, {}},
	}
	for run := range 2 {
		if err := a.e.svc.BackfillAutoTags(context.Background()); err != nil {
			t.Fatal(err)
		}
		for id, w := range want {
			if d := a.e.get(a.b, id); !slices.Equal(d.Tags, w[0]) || !slices.Equal(d.AutoTags, w[1]) {
				t.Fatalf("run %d %s: tags = %v, auto = %v, want %v", run, id, d.Tags, d.AutoTags, w)
			}
		}
		var left int
		_ = a.e.raw.QueryRow(context.Background(), `SELECT count(*) FROM documents WHERE auto_tagged_at IS NULL AND NOT hr_private
			AND deleted_at IS NULL`).Scan(&left)
		if left != 0 {
			t.Fatalf("run %d: %d files untagged", run, left)
		}
	}
	// tag search finds them as before
	if p := a.e.list(a.b, "tag=year-2025"); len(p.Data) != 1 || p.Data[0].ID != upload.ID {
		t.Fatalf("tag search = %+v", p.Data)
	}
}
