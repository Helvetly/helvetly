package documents

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
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
		number, "", a.b.user, time.Date(2026, 2, 10, 12, 0, 0, 0, time.UTC)); err != nil {
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
		}, []string{"invoice", "year-2026-01", "acme-ag", "2026-in-005"}},
		{"credit note by its link", func() string {
			d := a.file("")
			a.e.invoice(a.b, a.beta, "credit_note", "2025/CN/002", 2025, "")
			var inv string
			_ = a.e.raw.QueryRow(ctx, `SELECT id FROM invoices WHERE number = '2025/CN/002'`).Scan(&inv)
			if err := a.e.st.AddDocumentLink(ctx, a.b.workspace, d.ID, "invoice", inv, a.b.user, time.Now()); err != nil {
				t.Fatal(err)
			}
			return d.ID
		}, []string{"credit-note", "year-2025-01", "beta-gmbh", "2025-cn-002"}},
		{"debit note imported from its original", func() string {
			d := a.file("")
			a.e.invoice(a.b, a.acme, "debit_note", "D-7", 2024, d.ID)
			return d.ID
		}, []string{"debit-note", "year-2024-01", "acme-ag", "d-7"}},
		{"quote by its PDF", func() string {
			d := a.file(a.e.recordFolder(a.b, a.acme, "quotes", 2026))
			a.quote(a.acme, "2026/Q/001", a.key(d.ID))
			return d.ID
		}, []string{"quote", "year-2026-03", "acme-ag", "2026-q-001"}},
		{"quote revision", func() string {
			d := a.file("")
			q := a.quote(a.beta, "2026/Q/003", "quotes/other.pdf")
			a.exec(`INSERT INTO quote_revisions (workspace_id, quote_id, revision, sent_to, snapshot, pdf_key, created_at)
				VALUES ($1, $2, 1, '{}', '{"issue_date":"2025-12-31"}', $3, now())`, a.b.workspace, q, a.key(d.ID))
			return d.ID
		}, []string{"quote", "year-2025-12", "beta-gmbh", "2026-q-003"}},
		{"contract from a quote", func() string { return a.contract("2026/Q/002", "2026/C/001").ID },
			[]string{"contract", "year-2026-02", "acme-ag", "2026-c-001", "from-quote-2026-q-002"}},
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
		}, []string{"contract", "signed", "year-2026-02", "acme-ag", "2026-c-002", "from-quote-2026-q-004"}},
		{"imported completed contract", func() string { return a.file(a.contractsFolder(a.beta, 2025)).ID },
			[]string{"contract", "year-2025", "beta-gmbh"}},
		{"receipt of an expense", func() string {
			d := a.file("")
			exp := a.e.expense(a.b, a.e.category(a.b, "Büro Material"), "2025-05-05")
			if err := a.e.st.AddDocumentLink(ctx, a.b.workspace, d.ID, "expense", exp, a.b.user, time.Now()); err != nil {
				t.Fatal(err)
			}
			return d.ID
		}, []string{"receipt", "year-2025-05", "expense-buero-material"}},
		{"engagement document", func() string { return a.file(a.e.recordFolder(a.b, a.beta, "engagements", 2026)).ID },
			[]string{"engagement", "year-2026", "beta-gmbh"}},
		{"client upload", func() string { return a.file(a.e.recordFolder(a.b, a.acme, "documents", 2026)).ID },
			[]string{"year-2026", "acme-ag"}},
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

func TestProtectedAutoTagsStayAfterEditing(t *testing.T) {
	a := newAutoEnv(t)
	d := a.file(a.e.recordFolder(a.b, a.acme, "invoices", 2026))
	a.e.invoice(a.b, a.acme, "invoice", "2026/IN/001", 2026, d.ID)
	a.retag(d.ID)
	mine := []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}
	locked := []string{"invoice", "year-2026-01", "2026-in-001"}
	path := "/api/v1/documents/" + d.ID
	if got := a.e.get(a.b, d.ID); !slices.Equal(got.LockedTags, locked) || !slices.Equal(got.AutoTags, []string{"invoice", "year-2026-01", "acme-ag", "2026-in-001"}) {
		t.Fatalf("locked %v, automatic %v", got.LockedTags, got.AutoTags)
	}
	// Leaving out every automatic tag removes only the client's; kind, date and number stay.
	a.e.do(a.b, "PATCH", path, map[string]any{"tags": mine}, 200, nil)
	got := a.e.get(a.b, d.ID)
	if !slices.Equal(got.Tags, append(slices.Clone(mine), locked...)) || !slices.Equal(got.AutoTags, locked) {
		t.Fatalf("manual edit changed protected tags: tags %v, automatic %v", got.Tags, got.AutoTags)
	}
	if again := a.retag(d.ID); slices.Contains(again.Tags, "acme-ag") {
		t.Fatalf("a removed client tag came back: %v", again.Tags)
	}
	a.e.fails(a.b, "PATCH", path, map[string]any{"tags": append(slices.Clone(mine), "k")}, 422, "validation_failed")
	for _, typed := range []string{"signed", "year-2026-04", "receipt", "payment-confirmation"} {
		a.e.fails(a.b, "PATCH", path, map[string]any{"tags": []string{typed}}, 422, "validation_failed")
	}

	// Before protection, a suppressed automatic tag was recorded here.
	a.exec(`UPDATE documents SET tags = '{}', auto_tags = '{}', record_tags_current = false, removed_auto_tags = ARRAY['year-2026-01', 'invoice', '2026-in-001'] WHERE id = $1`, d.ID)
	if err := a.e.svc.BackfillAutoTags(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := a.e.get(a.b, d.ID); !slices.Equal(got.AutoTags, []string{"invoice", "year-2026-01", "acme-ag", "2026-in-001"}) {
		t.Fatalf("backfill did not restore protected automatic tags: %v", got.AutoTags)
	}

	signed := a.file(a.e.recordFolder(a.b, a.acme, "documents", 2026))
	now := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	a.exec(`INSERT INTO signature_requests (id, workspace_id, document_id, signed_document_id, title, original_key,
		original_sha256, page_count, status, signing_order, expires_at, created_at, updated_at)
		VALUES ('sig_locked', $1, $2, $3, 'tag test', $4, repeat('a', 64), 1, 'pending', 'parallel', $5, $5, $5)`,
		a.b.workspace, d.ID, signed.ID, a.key(d.ID), now)
	if err := a.e.st.CompleteSignatureRequest(context.Background(), "sig_locked", signed.ID, strings.Repeat("b", 64), now); err != nil {
		t.Fatal(err)
	}
	newFolder := a.e.recordFolder(a.b, a.beta, "documents", 2027)
	a.e.do(a.b, "PATCH", "/api/v1/documents/"+signed.ID, map[string]any{
		"folder_id": newFolder, "tags": []string{"urgent"},
	}, 200, nil)
	if got := a.e.get(a.b, signed.ID); !slices.Equal(got.Tags, []string{"urgent", "signed", "year-2026-04", "beta-gmbh"}) {
		t.Fatalf("tags do not follow signature and updated folder: %v", got.Tags)
	}
}

// The backfill tags each file from before once: the people's tags stay (a typed tag the app would set stays theirs),
// nothing doubles, and a second run changes nothing.
func TestBackfillAutoTagsIdempotent(t *testing.T) {
	a := newAutoEnv(t)
	inv := a.file("")
	a.e.invoice(a.b, a.acme, "invoice", "2026/IN/009", 2026, inv.ID)
	upload := a.file(a.e.recordFolder(a.b, a.beta, "documents", 2025))
	plain := a.file("")
	a.exec(`UPDATE documents SET tags = '{invoice,urgent,year-2026}', auto_tags = '{year-2026}', record_tags_current = false WHERE id = $1`, inv.ID)
	a.exec(`UPDATE documents SET tags = '{}', auto_tags = '{}', auto_tagged_at = NULL WHERE id = ANY($1)`, []string{upload.ID, plain.ID})
	want := map[string][2][]string{
		inv.ID:    {{"urgent", "invoice", "year-2026-01", "acme-ag", "2026-in-009"}, {"invoice", "year-2026-01", "acme-ag", "2026-in-009"}},
		upload.ID: {{"year-2025", "beta-gmbh"}, {"year-2025", "beta-gmbh"}},
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
	for _, filter := range []string{"tag=year-2026", "tag=year-2026-01"} {
		if p := a.e.list(a.b, filter); len(p.Data) != 1 || p.Data[0].ID != inv.ID {
			t.Fatalf("%s: %+v", filter, p.Data)
		}
	}
}

func TestEngagementDateAndDocumentChangeRefreshTags(t *testing.T) {
	a := newAutoEnv(t)
	ctx, now := t.Context(), time.Now()
	first, second := a.file(""), a.file("")
	e := store.Engagement{ID: "eng_sample", ClientID: a.acme, Title: "Example", Quantity: 1000,
		Billing: "advance", PriceBasis: "net", Currency: "CHF", VATCategory: "S", StartDate: "2024-02-01",
		Recurrence: "monthly", Interval: 1, InvoiceDetail: "summary", DocumentID: &first.ID}
	if err := a.e.st.CreateEngagement(ctx, a.b.workspace, &e, now); err != nil {
		t.Fatal(err)
	}
	if tags := a.e.get(a.b, first.ID).AutoTags; !slices.Equal(tags, []string{"engagement", "year-2024-02", "acme-ag"}) {
		t.Fatal(tags)
	}
	e.StartDate, e.DocumentID = "2024-07-01", &second.ID
	if err := a.e.st.SaveEngagement(ctx, a.b.workspace, e, now); err != nil {
		t.Fatal(err)
	}
	if len(a.e.get(a.b, first.ID).AutoTags) != 0 || !slices.Contains(a.e.get(a.b, second.ID).AutoTags, "year-2024-07") {
		t.Fatal("stale engagement date")
	}
	if err := a.e.st.DeleteEngagement(ctx, a.b.workspace, e.ID, now); err != nil {
		t.Fatal(err)
	}
	if tags := a.e.get(a.b, second.ID).AutoTags; len(tags) != 0 {
		t.Fatal(tags)
	}
}

// A client's tag is its name's slug: renaming the client renames it, and one a person removed stays removed.
func TestClientTagFollowsRename(t *testing.T) {
	a := newAutoEnv(t)
	ctx, now := t.Context(), time.Now()
	kept, removed := a.file(a.e.recordFolder(a.b, a.acme, "documents", 2026)), a.file(a.e.recordFolder(a.b, a.acme, "documents", 2026))
	a.e.do(a.b, "PATCH", "/api/v1/documents/"+removed.ID, map[string]any{"tags": []string{"mine"}}, 200, nil)
	rename := func(name string) {
		t.Helper()
		if err := a.e.st.Tx(ctx, func(q store.Q) error {
			_, err := q.UpdateClient(ctx, a.b.workspace, a.acme, map[string]any{"name": name}, now)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	rename("Acme Holding")
	if got := a.e.get(a.b, kept.ID).Tags; !slices.Equal(got, []string{"year-2026", "acme-holding"}) {
		t.Fatalf("renamed client's file: %v", got)
	}
	if got := a.e.get(a.b, removed.ID).Tags; !slices.Equal(got, []string{"mine", "year-2026"}) {
		t.Fatalf("a removed client tag came back after the rename: %v", got)
	}
	rename("Invoice") // reads as a kind: keeps its prefix
	if got := a.e.get(a.b, kept.ID).Tags; !slices.Equal(got, []string{"year-2026", "client-invoice"}) {
		t.Fatalf("client named like a kind: %v", got)
	}
}

// A client document uploaded as a consent or power of attorney is tagged with that kind.
func TestClientDocumentTypeKinds(t *testing.T) {
	a := newAutoEnv(t)
	for typ, want := range map[store.ClientDocumentType]string{"consent": "consent", "power_of_attorney": "power-of-attorney", "other": ""} {
		f := store.ClientFile{ID: auth.NewID("doc"), Name: string(typ) + ".pdf", Size: 3, ContentType: "application/pdf",
			CreatedAt: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), ObjectKey: "workspaces/" + a.b.workspace + "/" + auth.NewID("o"), DocumentType: typ}
		if err := a.e.st.CreateClientFile(t.Context(), a.b.workspace, a.acme, a.b.user, &f); err != nil {
			t.Fatal(err)
		}
		if got := a.e.get(a.b, f.ID).LockedTags; !slices.Equal(got, slices.DeleteFunc([]string{want, "year-2026"}, func(s string) bool { return s == "" })) {
			t.Fatalf("%s: locked %v", typ, got)
		}
	}
}

// clientTagRewrite is the one-off production rewrite of the client-<name> tags from before (in the pull request's
// description): <name> unless it could be read as another automatic tag (tags.ClientTag), repeats dropped. It is run
// once after the deploy; running it again changes nothing.
const clientTagRewrite = `BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.unprefixed(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE WHEN t LIKE 'client-_%'
		AND substr(t, 8) !~ '^(signed|year-[0-9]{4}(-(0[1-9]|1[0-2]))?|invoice|partial-invoice|prepayment-invoice|corrected-invoice|proforma-invoice|self-billed-invoice|credit-note|debit-note|quote|contract|engagement|receipt|payment-confirmation|consent|power-of-attorney)$'
		AND substr(t, 8) !~ '^([0-9]|client-|expense-|from-quote-)'
		THEN substr(t, 8) ELSE t END $$;
CREATE OR REPLACE FUNCTION pg_temp.rewritten(tags text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
	SELECT coalesce(array_agg(t ORDER BY first), '{}') FROM (
		SELECT pg_temp.unprefixed(t) AS t, min(i) AS first FROM unnest(tags) WITH ORDINALITY a(t, i) GROUP BY 1) u $$;
UPDATE documents SET tags = pg_temp.rewritten(tags), auto_tags = pg_temp.rewritten(auto_tags),
	removed_auto_tags = pg_temp.rewritten(removed_auto_tags)
WHERE EXISTS (SELECT 1 FROM unnest(tags || auto_tags || removed_auto_tags) t WHERE t <> pg_temp.unprefixed(t));
COMMIT;`

func TestClientTagRewrite(t *testing.T) {
	if !strings.Contains(clientTagRewrite, "'"+tags.ProtectedPattern+"'") {
		t.Fatal("the rewrite's protected pattern is not tags.ProtectedPattern")
	}
	a := newAutoEnv(t)
	type row struct{ tags, auto, removed []string }
	for _, tc := range []struct {
		name       string
		have, want row
	}{
		{"automatic client tag", row{[]string{"urgent", "invoice", "client-acme-ag"}, []string{"invoice", "client-acme-ag"}, nil},
			row{[]string{"urgent", "invoice", "acme-ag"}, []string{"invoice", "acme-ag"}, []string{}}},
		{"a removed one stays removed", row{[]string{"invoice"}, []string{"invoice"}, []string{"client-acme-ag", "expense-x"}},
			row{[]string{"invoice"}, []string{"invoice"}, []string{"acme-ag", "expense-x"}}},
		{"the person's own tag of that name stays one tag", row{[]string{"acme-ag", "client-acme-ag"}, []string{"client-acme-ag"}, nil},
			row{[]string{"acme-ag"}, []string{"acme-ag"}, []string{}}},
		{"names that read as other tags keep the prefix", row{[]string{"client-invoice", "client-2026", "client-year-2026", "client-expense-a", "client-client-a"}, nil, nil},
			row{[]string{"client-invoice", "client-2026", "client-year-2026", "client-expense-a", "client-client-a"}, []string{}, []string{}}},
		{"nothing to do", row{[]string{"client", "clients", "year-2026"}, []string{"year-2026"}, nil},
			row{[]string{"client", "clients", "year-2026"}, []string{"year-2026"}, []string{}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := a.file("")
			a.exec(`UPDATE documents SET tags = $2, auto_tags = $3, removed_auto_tags = $4 WHERE id = $1`, d.ID,
				tc.have.tags, append([]string{}, tc.have.auto...), append([]string{}, tc.have.removed...))
			for range 2 { // idempotent
				a.exec(clientTagRewrite)
				var got row
				if err := a.e.raw.QueryRow(t.Context(), `SELECT tags, auto_tags, removed_auto_tags FROM documents WHERE id = $1`, d.ID).
					Scan(&got.tags, &got.auto, &got.removed); err != nil {
					t.Fatal(err)
				}
				if !slices.Equal(got.tags, tc.want.tags) || !slices.Equal(got.auto, tc.want.auto) || !slices.Equal(got.removed, tc.want.removed) {
					t.Fatalf("got %+v, want %+v", got, tc.want)
				}
			}
		})
	}
}
