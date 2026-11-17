package einvoice

import (
	"bytes"
	"compress/zlib"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/store"
)

// issuedPDF is the PDF issuing would store for inv, with a Revolut link so that annotations are covered too.
func issuedPDF(t *testing.T, inv store.Invoice) []byte {
	t.Helper()
	inv.Language = "en"
	inv.Payment.RevolutURL = ptr("https://revolut.me/helvetly")
	out, err := invoicepdf.Render(invoicepdf.Document{Invoice: inv, Seller: *inv.Seller, Buyer: *inv.Buyer,
		Created: time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// embeddedXML is the inflated stream of the file's only embedded file.
func embeddedXML(t *testing.T, pdf []byte) []byte {
	t.Helper()
	i := bytes.Index(pdf, []byte("/Type /EmbeddedFile"))
	if i < 0 {
		t.Fatal("no embedded file")
	}
	_, data, _ := bytes.Cut(pdf[i:], []byte("stream\n"))
	data, _, _ = bytes.Cut(data, []byte("\nendstream"))
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestFacturXML(t *testing.T) {
	out, err := FacturXML(simple())
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if !strings.Contains(s, "<ram:GuidelineSpecifiedDocumentContextParameter>\n      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>") ||
		strings.Contains(s, "BusinessProcessSpecifiedDocumentContextParameter") || strings.Contains(s, "xrechnung") {
		t.Errorf("Factur-X context:\n%s", s)
	}
	if xr := mustCII(t, simple()); !strings.Contains(xr, "<ram:ID>"+peppolProcess+"</ram:ID>") || !strings.Contains(xr, xrechnungID) {
		t.Error("XRechnung CII lost its process or guideline")
	}

	noRef := simple()
	noRef.Reference = nil
	if out, _ := FacturXML(noRef); bytes.Contains(out, []byte("BuyerReference")) {
		t.Error("Factur-X wrote a stand-in buyer reference")
	}
	if xr := mustCII(t, noRef); !strings.Contains(xr, "<ram:BuyerReference>n/a</ram:BuyerReference>") {
		t.Error("XRechnung lost its mandatory buyer reference")
	}

	// EN 16931 needs no seller contact: none is written without one, and a partial one has no empty element.
	for _, tc := range []struct {
		name         string
		phone, email *string
		want, absent []string
	}{
		{"none", nil, nil, nil, []string{"DefinedTradeContact"}},
		{"email only", nil, ptr("billing@helvetly.example"), []string{"<ram:URIID>billing@helvetly.example</ram:URIID>"}, []string{"TelephoneUniversalCommunication"}},
		{"phone only", ptr("+41 44 123 45 67"), nil, []string{"<ram:CompleteNumber>+41 44 123 45 67</ram:CompleteNumber>"}, []string{"EmailURIUniversalCommunication"}},
	} {
		inv := simple()
		inv.Seller.Phone, inv.Seller.Email = tc.phone, tc.email
		out, err := FacturXML(inv)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		seller := string(out[bytes.Index(out, []byte("<ram:SellerTradeParty>")):bytes.Index(out, []byte("</ram:SellerTradeParty>"))])
		for _, w := range tc.want {
			if !strings.Contains(seller, w) {
				t.Errorf("%s: seller lacks %s:\n%s", tc.name, w, seller)
			}
		}
		for _, a := range tc.absent {
			if strings.Contains(seller, a) {
				t.Errorf("%s: seller has %s:\n%s", tc.name, a, seller)
			}
		}
	}
}

func TestFacturX(t *testing.T) {
	inv := simple()
	inv.Language = "en"
	issued := time.Date(2026, 11, 7, 9, 0, 0, 0, time.UTC)
	inv.IssuedAt = &issued
	out, err := FacturX(inv, issuedPDF(t, inv), issued.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	want, _ := FacturXML(inv)
	if got := embeddedXML(t, out); !bytes.Equal(got, want) {
		t.Errorf("embedded XML differs from FacturXML:\n%s", got)
	}
	for _, s := range []string{"<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>", "<pdfaid:part>3</pdfaid:part>",
		`<rdf:li xml:lang="x-default">Invoice 2026-0042</rdf:li>`, "<rdf:li>Helvetly AG</rdf:li>",
		"<xmp:CreateDate>2026-11-07T09:00:00+00:00</xmp:CreateDate>", "/Subtype /Link /F 4 "} {
		if !bytes.Contains(out, []byte(s)) {
			t.Errorf("Factur-X file lacks %s", s)
		}
	}
	if _, err := FacturX(func() store.Invoice { i := simple(); i.Status = "draft"; return i }(), issuedPDF(t, inv), issued); err != ErrUnsupported {
		t.Errorf("draft: %v", err)
	}
}

func TestFacturXExportIsArchivedAndReused(t *testing.T) {
	inv := simple()
	key := "workspaces/wsp_archive/invoices/inv-1/inv-1.pdf"
	inv.PDFKey = &key
	pdf := issuedPDF(t, inv)
	e := newArchiveEnvWith(t, inv)
	e.files.objects[key] = pdf

	first := e.get(context.Background(), "factur-x")
	if first.Code != 200 {
		t.Fatalf("first: %d %s", first.Code, first.Body.String())
	}
	h := first.Header()
	if h.Get("Content-Type") != "application/pdf" || h.Get("Content-Disposition") != `attachment; filename="2026-0042.pdf"` ||
		h.Get("X-Helvetly-XML-Version") != "helvetly-factur-x-1" {
		t.Errorf("headers %v", h)
	}
	if !bytes.HasPrefix(first.Body.Bytes(), []byte("%PDF-1.7")) || !bytes.Contains(embeddedXML(t, first.Body.Bytes()), []byte("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>")) {
		t.Error("not a Factur-X PDF")
	}
	if second := e.get(context.Background(), "factur-x"); second.Code != 200 || !bytes.Equal(second.Body.Bytes(), first.Body.Bytes()) {
		t.Fatal("archive was not reused")
	}
	if e.files.puts != 1 || !bytes.Equal(e.files.objects[key], pdf) {
		t.Fatalf("puts %d; the issued PDF must stay untouched", e.files.puts)
	}
	record, err := e.db.InvoiceXML(context.Background(), e.sess.Workspace.ID, "inv-1", "factur-x")
	if err != nil || !strings.HasSuffix(record.ObjectKey, ".pdf") || record.Filename != "2026-0042.pdf" {
		t.Fatalf("archive record %+v, %v", record, err)
	}
	name, file, err := e.svc.Export(context.Background(), e.sess, inv, "factur-x")
	if err != nil || name != "2026-0042.pdf" || !bytes.Equal(file, first.Body.Bytes()) {
		t.Fatalf("Export: %s %d bytes, %v", name, len(file), err)
	}

	// without the stored PDF there is nothing to embed the XML in
	delete(e.files.objects, key)
	if got := e.get(context.Background(), "xrechnung-ubl"); got.Code != 200 {
		t.Fatalf("XML export failed: %s", got.Body.String())
	}
}

func TestFacturXWithoutStoredPDF(t *testing.T) {
	e := newArchiveEnv(t) // issued without a pdf_key
	if got := e.get(context.Background(), "factur-x"); got.Code != 409 || !strings.Contains(got.Body.String(), "invalid_state") {
		t.Fatalf("%d %s", got.Code, got.Body.String())
	}
	if e.files.puts != 0 {
		t.Fatal("archived a file for an invoice without its PDF")
	}
}

// TestFacturXOfficial validates Factur-X files of every official fixture with Mustang (veraPDF for PDF/A-3 and the
// Factur-X XSD and Schematron for the XML) when HELVETLY_TEST_FACTURX names the runner scripts/validate-einvoice.sh
// provides; it takes the fixture folder and fails unless every file is valid.
func TestFacturXOfficial(t *testing.T) {
	runner := os.Getenv("HELVETLY_TEST_FACTURX")
	if runner == "" {
		t.Log("HELVETLY_TEST_FACTURX not set: official validation not run")
		return
	}
	dir := t.TempDir()
	issued := time.Date(2026, 11, 7, 9, 0, 0, 0, time.UTC)
	for name, inv := range officialFixtures() {
		inv.IssuedAt = &issued
		out, err := FacturX(inv, issuedPDF(t, inv), issued.Add(time.Minute))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".pdf"), out, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if out, err := exec.Command(runner, dir).CombinedOutput(); err != nil {
		t.Fatalf("Factur-X validation: %v\n%s", err, out)
	}
}
