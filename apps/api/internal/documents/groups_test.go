package documents

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

type groupsOut struct {
	Data struct {
		By     string
		Groups []store.DocumentGroup
	}
}

// grouped: a workspace with a file from each source of type, year and client, and the files' ids by name.
type grouped struct {
	e          *env
	b, other   *browser
	acme, beta string
}

func newGrouped(t *testing.T) grouped {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	ctx := context.Background()
	g := grouped{e: e, b: b, other: other, acme: e.client(b, "Acme AG"), beta: e.client(b, "Beta GmbH")}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.raw.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	objectKey := func(id string) string {
		var k string
		if err := e.raw.QueryRow(ctx, `SELECT object_key FROM documents WHERE id = $1`, id).Scan(&k); err != nil {
			t.Fatal(err)
		}
		return k
	}
	invoice := func(kind, client, issue, pdfKey string) string {
		id := auth.NewID("inv")
		exec(`INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date,
				currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
				vat_breakdown, pdf_key, created_at, updated_at)
			VALUES ($1, $2, $3, 'open', $1, $4, $5::date, $5::date, 'CHF', 'de', 'none', 0, 0, 0, 0, 0, 0, 0, '[]', nullif($6, ''), now(), now())`,
			id, b.workspace, kind, client, issue, pdfKey)
		return id
	}
	link := func(doc, typ, target string) {
		t.Helper()
		if err := e.st.AddDocumentLink(ctx, b.workspace, doc, typ, target, b.user, time.Now()); err != nil {
			t.Fatal(err)
		}
	}

	// the record decides: an invoice's PDF (by pdf_key), a credit note (by link), a receipt, a signed PDF
	inv := e.uploaded(b, "a.pdf", pdf+"1")
	invoice("invoice", g.acme, "2025-03-01", objectKey(inv.ID))
	cn := e.uploaded(b, "b.pdf", pdf+"2")
	link(cn.ID, "invoice", invoice("credit_note", g.beta, "2026-01-10", ""))
	receipt := e.uploaded(b, "d.png", png+"4")
	link(receipt.ID, "expense", e.expense(b, "", "2023-05-05"))
	sig := e.uploaded(b, "e.pdf", pdf+"5")
	exec(`INSERT INTO signature_requests (id, workspace_id, document_id, title, signing_order, status, original_key,
			original_sha256, page_count, expires_at, created_at, updated_at, completed_at)
		VALUES ($1, $2, $3, 'NDA', 'parallel', 'completed', 'k', repeat('a', 64), 1, now(), now(), now(), '2022-06-01T12:00:00Z')`,
		auth.NewID("sig"), b.workspace, sig.ID)
	// then the system folder: Clients/Acme AG/Quotes/2024
	e.uploaded(b, "c.pdf", pdf+"3", "folder_id", e.recordFolder(b, g.acme, "quotes", 2024))
	// then AI filing's tags, then the name
	tagged := e.uploaded(b, "f.pdf", pdf+"6")
	named := e.uploaded(b, "Rechnung-7.pdf", pdf+"7")
	exec(`UPDATE documents SET tags = '{vertrag}' WHERE id = $1`, tagged.ID)
	exec(`UPDATE documents SET created_at = '2026-06-01T12:00:00Z' WHERE id = ANY($1)`, []string{tagged.ID, named.ID})
	// nothing known: Other, the upload's year in the workspace's zone (Zurich: already 2024), its linked client
	plain := e.uploaded(b, "notes.pdf", pdf+"8")
	exec(`UPDATE documents SET created_at = '2023-12-31T23:30:00Z' WHERE id = $1`, plain.ID)
	link(plain.ID, "client", g.beta)
	// another workspace's file and an HR file never count
	e.uploaded(other, "Invoice-x.pdf", pdf+"9")
	hr := e.uploaded(b, "Invoice-payslip.pdf", pdf+"10")
	exec(`UPDATE documents SET hr_private = true WHERE id = $1`, hr.ID)
	return g
}

func (g grouped) groups(b *browser, query string) groupsOut {
	g.e.t.Helper()
	var out groupsOut
	g.e.do(b, "GET", "/api/v1/documents/groups?"+query, nil, 200, &out)
	return out
}

func counts(groups []store.DocumentGroup) map[string]int {
	out := map[string]int{}
	for _, gr := range groups {
		out[gr.Key] = gr.Count
	}
	return out
}

func keys(groups []store.DocumentGroup) []string {
	out := []string{}
	for _, gr := range groups {
		out = append(out, gr.Key)
	}
	return out
}

func TestGroupedViewsClassifyEachSource(t *testing.T) {
	g := newGrouped(t)
	byType := g.groups(g.b, "group=type")
	if byType.Data.By != "type" || !slices.Equal(keys(byType.Data.Groups), []string{"invoices", "quotes", "credit_notes", "receipts", "contracts", "other"}) {
		t.Fatalf("type groups = %+v", byType.Data)
	}
	want := map[string]int{"invoices": 2, "quotes": 1, "credit_notes": 1, "receipts": 1, "contracts": 2, "other": 1}
	if got := counts(byType.Data.Groups); !maps(got, want) {
		t.Fatalf("type counts = %v, want %v", got, want)
	}

	years := g.groups(g.b, "group=type,year&type=invoices")
	if years.Data.By != "year" || !slices.Equal(keys(years.Data.Groups), []string{"2026", "2025"}) {
		t.Fatalf("invoice years = %+v", years.Data)
	}
	all := g.groups(g.b, "group=year").Data.Groups
	if want := map[string]int{"2026": 3, "2025": 1, "2024": 2, "2023": 1, "2022": 1}; !maps(counts(all), want) ||
		!slices.Equal(keys(all), []string{"2026", "2025", "2024", "2023", "2022"}) {
		t.Fatalf("year groups = %+v, want %v", all, want)
	}

	clients := g.groups(g.b, "group=client").Data.Groups
	if !slices.Equal(keys(clients), []string{g.acme, g.beta, store.NoClient}) || clients[0].Label != "Acme AG" ||
		clients[0].Count != 2 || clients[1].Count != 2 || clients[2].Count != 4 {
		t.Fatalf("client groups = %+v", clients)
	}
}

func TestGroupedViewsLeafPagingAndFilters(t *testing.T) {
	g := newGrouped(t)
	var leaf page
	g.e.do(g.b, "GET", "/api/v1/documents/groups?group=type,year&type=receipts&year=2023", nil, 200, &leaf)
	if !slices.Equal(names(leaf.Data), []string{"d.png"}) {
		t.Fatalf("receipts of 2023 = %v", names(leaf.Data))
	}
	g.e.do(g.b, "GET", "/api/v1/documents/groups?group=type&type=contracts&page_size=1&sort=name", nil, 200, &leaf)
	if !slices.Equal(names(leaf.Data), []string{"e.pdf"}) || leaf.Meta.Total != 2 || leaf.Meta.TotalPages != 2 {
		t.Fatalf("contracts page 1 = %v %+v", names(leaf.Data), leaf.Meta)
	}
	// the list's own filters narrow a group, and the list takes the group's keys (the search's chips)
	if got := counts(g.groups(g.b, "group=type&search=rechnung").Data.Groups); !maps(got, map[string]int{"invoices": 1}) {
		t.Fatalf("searched type counts = %v", got)
	}
	if got := names(g.e.list(g.b, "type=other&year=2024&client="+g.beta).Data); !slices.Equal(got, []string{"notes.pdf"}) {
		t.Fatalf("list by group keys = %v", got)
	}
	if got := names(g.e.list(g.b, "client=none&type=invoices&sort=name").Data); !slices.Equal(got, []string{"Rechnung-7.pdf"}) {
		t.Fatalf("invoices without a client = %v", got)
	}
	for _, q := range []string{"", "group=type,type", "group=kind", "group=type&type=memo", "group=year&year=12"} {
		g.e.fails(g.b, "GET", "/api/v1/documents/groups?"+q, nil, 400, "invalid_request")
	}
}

func TestMultiClientAndTypeFilters(t *testing.T) {
	g := newGrouped(t)
	choices := "client=" + g.acme + "&client=" + g.beta + "&type=invoices&type=credit_notes"
	if got := names(g.e.list(g.b, choices).Data); !slices.Equal(got, []string{"a.pdf", "b.pdf"}) {
		t.Fatalf("selected files = %v", got)
	}
	if got := counts(g.groups(g.b, "group=type&"+choices).Data.Groups); !maps(got, map[string]int{"invoices": 1, "credit_notes": 1}) {
		t.Fatalf("type counts = %v", got)
	}
	if got := names(g.e.list(g.b, "client="+g.beta+"&type=other&from=2024-01-01&to=2024-01-01").Data); !slices.Equal(got, []string{"notes.pdf"}) {
		t.Fatalf("workspace day = %v", got)
	}
	if got := names(g.e.list(g.other, choices).Data); len(got) != 0 {
		t.Fatalf("foreign files = %v", got)
	}
	g.e.fails(g.b, "GET", "/api/v1/documents?type=invoices&type=unknown", nil, 400, "invalid_request")
	g.e.fails(g.b, "GET", "/api/v1/documents?from=2026-02-01&to=2026-01-31", nil, 400, "invalid_request")
}

func TestGroupedViewsIsolationAndPermissions(t *testing.T) {
	g := newGrouped(t)
	if got := counts(g.groups(g.other, "group=type").Data.Groups); !maps(got, map[string]int{"invoices": 1}) {
		t.Fatalf("the other workspace sees %v", got)
	}
	var leaf page
	g.e.do(g.other, "GET", "/api/v1/documents/groups?group=client&client="+g.acme, nil, 200, &leaf)
	if len(leaf.Data) != 0 || leaf.Meta.Total != 0 {
		t.Fatalf("another workspace's client: %v", names(leaf.Data))
	}
	// the documents' read scope guards both (permissions.Guard, in front of every route in main)
	for _, p := range []string{"/api/v1/documents/groups", "/api/v1/documents/groups/zip"} {
		if need := permissions.Required("GET", p); !slices.Equal(need, []string{"read:documents"}) {
			t.Fatalf("GET %s needs %v", p, need)
		}
	}
}

func readZip(t *testing.T, raw []byte) map[string]string {
	t.Helper()
	z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("not a zip: %v: %.200s", err, raw)
	}
	out := map[string]string{}
	for _, f := range z.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		_ = rc.Close()
		out[f.Name] = string(b)
	}
	return out
}

func TestGroupZip(t *testing.T) {
	g := newGrouped(t)
	resp, raw := g.e.send(g.b, "GET", "/api/v1/documents/groups/zip?group=type,year&type=invoices", nil, "")
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/zip" ||
		resp.Header.Get("Content-Disposition") != `attachment; filename="documents-invoices.zip"` {
		t.Fatalf("zip = %d %v", resp.StatusCode, resp.Header)
	}
	got := readZip(t, raw)
	want := map[string]string{"2025/Acme AG/a.pdf": pdf + "1", "2026/No client/Rechnung-7.pdf": pdf + "7"}
	if len(got) != len(want) || got["2025/Acme AG/a.pdf"] != want["2025/Acme AG/a.pdf"] ||
		got["2026/No client/Rechnung-7.pdf"] != pdf+"7" {
		t.Fatalf("zip entries = %v, want %v", got, want)
	}
	// grouped by client, inside a client: flat
	resp, raw = g.e.send(g.b, "GET", "/api/v1/documents/groups/zip?group=client&client="+g.acme, nil, "")
	if got := readZip(t, raw); resp.StatusCode != 200 || len(got) != 2 || got["a.pdf"] == "" || got["c.pdf"] == "" {
		t.Fatalf("client zip = %v", got)
	}
	var n int
	var payload []byte
	if err := g.e.raw.QueryRow(context.Background(), `SELECT count(*), max(payload::text) FROM financial_events
		WHERE workspace_id = $1 AND kind = 'documents.exported'`, g.b.workspace).Scan(&n, &payload); err != nil || n != 2 {
		t.Fatalf("audited %d exports: %v", n, err)
	}
	var audit struct{ Files int }
	if err := json.Unmarshal(payload, &audit); err != nil || audit.Files != 2 {
		t.Fatalf("audit payload %s", payload)
	}

	g.e.do(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices&check=1", nil, 204, nil)
	g.e.fails(g.b, "GET", "/api/v1/documents/groups/zip?type=quotes&year=1999", nil, 422, "empty")
	g.e.svc.zipFiles = 1
	g.e.fails(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices&check=1", nil, 413, "zip_too_large")
	g.e.svc.zipFiles, g.e.svc.zipBytes = 10, 20
	g.e.fails(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices", nil, 413, "zip_too_large")
}

func TestZipPathsAreSafeAndUnique(t *testing.T) {
	files := []store.GroupedFile{
		{Name: "../../etc/passwd", Type: "other", Year: 2026, Client: store.NoClient},
		{Name: "Report.pdf", Type: "invoices", Year: 2026, Client: "c1", ClientName: "A/B: C"},
		{Name: "report.PDF", Type: "invoices", Year: 2026, Client: "c1", ClientName: "A/B: C"},
		{Name: "report.pdf", Type: "invoices", Year: 2026, Client: "c1", ClientName: "A/B: C"},
		{Name: ".hidden", Type: "invoices", Year: 2025, Client: "c2"},
	}
	got := zipPaths(files, []string{"type"}, store.DocumentFilter{Year: 2026})
	want := []string{"Other/No client/_.._etc_passwd", "Invoices/A_B_ C/Report.pdf", "Invoices/A_B_ C/report (2).PDF",
		"Invoices/A_B_ C/report (3).pdf", "Invoices/Deleted client/hidden"}
	if !slices.Equal(got, want) {
		t.Fatalf("zipPaths = %q, want %q", got, want)
	}
}

func maps(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
