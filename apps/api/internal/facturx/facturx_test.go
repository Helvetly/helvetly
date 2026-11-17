package facturx

import (
	"bytes"
	"compress/zlib"
	"crypto/md5"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/pdffont"
)

var (
	created  = time.Date(2026, 11, 3, 9, 30, 0, 0, time.FixedZone("CET", 3600))
	modified = time.Date(2026, 11, 17, 21, 0, 5, 0, time.UTC)
	meta     = Meta{Title: "Rechnung 2026-001", Author: "Müller & Söhne <AG>", Created: created, Modified: modified}
	cii      = []byte(`<?xml version="1.0" encoding="UTF-8"?>` + "\n<rsm:CrossIndustryInvoice/>\n")
)

// invoice is a PDF made like invoicepdf makes one: embedded TrueType text, a PNG with alpha and a link.
func invoice(t *testing.T) []byte {
	t.Helper()
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetTitle("Rechnung 2026-001", true)
	pdf.SetAuthor("Muster GmbH", true)
	pdf.AddPage()
	txt := pdffont.New(pdf)
	txt.Font("", 10)
	pdf.SetXY(20, 20)
	txt.Cell(100, 6, "Zahlbar innert 30 Tagen – Grüezi", "L")
	pdf.LinkString(20, 20, 100, 6, "https://revolut.me/muster")
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.NRGBA{200, 0, 0, 128})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	pdf.RegisterImageOptionsReader("logo", fpdf.ImageOptions{ImageType: "PNG"}, &b)
	pdf.ImageOptions("logo", 150, 20, 20, 0, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func objectBody(t *testing.T, pdf []byte, num int) string {
	t.Helper()
	objs, _, _, err := parse(pdf)
	if err != nil {
		t.Fatal(err)
	}
	return string(objs[num-1].body)
}

func TestEmbed(t *testing.T) {
	in := invoice(t)
	out, err := Embed(in, cii, meta)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := Embed(in, cii, meta); !bytes.Equal(out, again) {
		t.Error("the same input gave different files")
	}
	if !bytes.HasPrefix(out, []byte("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")) {
		t.Errorf("header %q", out[:16])
	}
	objs, root, info, err := parse(out) // the rewritten table must point at every object exactly
	if err != nil {
		t.Fatalf("output does not parse: %v", err)
	}
	trailer := string(out[bytes.LastIndex(out, []byte("trailer")):])
	if !regexp.MustCompile(`/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]`).MatchString(trailer) {
		t.Errorf("trailer has no file identifier: %s", trailer)
	}

	catalog := objectBody(t, out, root)
	n := len(objs)
	for _, want := range []string{"/Type /Catalog", "/Pages 1 0 R", fmt.Sprintf("/Metadata %d 0 R", n-3),
		"/S /GTS_PDFA1", fmt.Sprintf("/DestOutputProfile %d 0 R", n-2), fmt.Sprintf("/AF [%d 0 R]", n),
		fmt.Sprintf("/EmbeddedFiles << /Names [(factur-x.xml) %d 0 R] >>", n)} {
		if !strings.Contains(catalog, want) {
			t.Errorf("catalog lacks %q: %s", want, catalog)
		}
	}
	spec := objectBody(t, out, n)
	for _, want := range []string{"/Type /Filespec", "/F (factur-x.xml)", "/UF (factur-x.xml)",
		"/AFRelationship /Alternative", fmt.Sprintf("/EF << /F %d 0 R /UF %d 0 R >>", n-1, n-1)} {
		if !strings.Contains(spec, want) {
			t.Errorf("file specification lacks %q: %s", want, spec)
		}
	}

	file := objectBody(t, out, n-1)
	sum := md5.Sum(cii)
	for _, want := range []string{"/Type /EmbeddedFile", "/Subtype /text#2Fxml", "/ModDate (D:20261117210005+00'00')",
		fmt.Sprintf("/Size %d", len(cii)), fmt.Sprintf("/CheckSum <%x>", sum)} {
		if !strings.Contains(file, want) {
			t.Errorf("embedded file lacks %q: %s", want, file)
		}
	}
	if got := inflate(t, streamData(t, file)); !bytes.Equal(got, cii) {
		t.Errorf("embedded XML = %q", got)
	}

	if body := objectBody(t, out, info); !strings.Contains(body, "/CreationDate (D:20261103083000+00'00')") ||
		!strings.Contains(body, "/ModDate (D:20261117210005+00'00')") || !strings.Contains(body, "/Producer (Helvetly)") ||
		!strings.Contains(body, "/Title "+pdfText(meta.Title)) || !strings.Contains(body, "/Author "+pdfText(meta.Author)) {
		t.Errorf("info dictionary %s", body)
	}

	packet := streamData(t, objectBody(t, out, n-3))
	if strings.Contains(objectBody(t, out, n-3), "/Filter") {
		t.Error("the metadata stream is filtered")
	}
	values := xmpValues(t, packet)
	for k, want := range map[string]string{"part": "3", "conformance": "B", "title": meta.Title, "creator": meta.Author,
		"Producer": "Helvetly", "CreateDate": "2026-11-03T08:30:00+00:00", "ModifyDate": "2026-11-17T21:00:05+00:00",
		"DocumentFileName": "factur-x.xml", "DocumentType": "INVOICE", "Version": "1.0", "ConformanceLevel": "EN 16931"} {
		if values[k] != want {
			t.Errorf("XMP %s = %q, want %q", k, values[k], want)
		}
	}

	if !bytes.Contains(out, []byte("/Type /Annot /Subtype /Link /F 4 /Rect")) {
		t.Error("the link annotation has no print flag")
	}
	if bytes.Contains(out, []byte("FPDF")) {
		t.Error("the original info dictionary is still in the file")
	}
}

func TestEmbedWithoutTitleOrAuthor(t *testing.T) {
	out, err := Embed(invoice(t), cii, Meta{Created: created, Modified: modified})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out, []byte("/Title")) || bytes.Contains(out, []byte("dc:title")) || bytes.Contains(out, []byte("dc:creator")) {
		t.Error("an empty title or author was written")
	}
}

func TestEmbedRefuses(t *testing.T) {
	page := "<< /Type /Page /Parent 1 0 R /Resources 2 0 R /MediaBox [0 0 595 842] >>"
	pages := "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"
	info := "<< /Producer (x) >>"
	catalog := "<< /Type /Catalog /Pages 1 0 R >>"
	for _, tt := range []struct {
		name    string
		pdf     []byte
		want    error
		because string
	}{
		{"not a PDF", []byte("hello"), ErrUnsupported, ""},
		{"CMYK image", minimal(pages, "<< /XObject << /I 5 0 R >> >>", page, info, "<< /Type /XObject /Subtype /Image /ColorSpace /DeviceCMYK >>", catalog), ErrCMYK, ""},
		{"core font", minimal(pages, "<< /Font << /F1 5 0 R >> >>", page, info, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", catalog), ErrUnsupported, "Type1"},
		{"JavaScript", minimal(pages, "<< >>", page, info, "<< /S /JavaScript /JS (app.alert(1)) >>", catalog), ErrUnsupported, "JavaScript"},
		{"open action", minimal(pages, "<< >>", page, info, "<< /Type /Catalog /Pages 1 0 R /OpenAction [3 0 R /Fit] >>"), ErrUnsupported, "OpenAction"},
		{"another annotation", minimal(pages, "<< >>", "<< /Type /Page /Parent 1 0 R /Annots [<< /Type /Annot /Subtype /Text /Rect [0 0 1 1] >>] >>", info, catalog), ErrUnsupported, "annotation"},
		{"existing attachment", minimal(pages, "<< >>", page, info, "<< /Type /EmbeddedFile >>", catalog), ErrUnsupported, "EmbeddedFile"},
		{"incremental update", bytes.Replace(minimal(pages, "<< >>", page, info, catalog), []byte("/Root"), []byte("/Prev 9 /Root"), 1), ErrUnsupported, "Prev"},
		{"encrypted", bytes.Replace(minimal(pages, "<< >>", page, info, catalog), []byte("/Root"), []byte("/Encrypt 2 0 R /Root"), 1), ErrUnsupported, "Encrypt"},
		{"wrong offsets", bytes.Replace(minimal(pages, "<< >>", page, info, catalog), []byte("3 0 obj"), []byte("3  0 obj"), 1), ErrUnsupported, "cross-reference"},
	} {
		_, err := Embed(tt.pdf, cii, meta)
		if !errors.Is(err, tt.want) || !strings.Contains(fmt.Sprint(err), tt.because) {
			t.Errorf("%s: err = %v, want %v (%s)", tt.name, err, tt.want, tt.because)
		}
	}
	if _, err := Embed(minimal(pages, "<< >>", page, info, catalog), cii, meta); err != nil {
		t.Errorf("the minimal file itself is refused: %v", err)
	}
}

// minimal is a PDF of the given objects (1..n), with /Info the fourth and /Root the last.
func minimal(bodies ...string) []byte {
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	var offsets []int
	for i, body := range bodies {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, body)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(bodies)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<<\n/Size %d\n/Root %d 0 R\n/Info 4 0 R\n>>\nstartxref\n%d\n%%%%EOF\n", len(bodies)+1, len(bodies), xref)
	return b.Bytes()
}

func streamData(t *testing.T, body string) []byte {
	t.Helper()
	_, data, ok := strings.Cut(body, "stream\n")
	data, _, ok2 := strings.Cut(data, "\nendstream")
	if !ok || !ok2 {
		t.Fatalf("not a stream: %.80s", body)
	}
	if m := regexp.MustCompile(`/Length (\d+)`).FindStringSubmatch(body); m == nil || m[1] != fmt.Sprint(len(data)) {
		t.Errorf("/Length %v for %d bytes", m, len(data))
	}
	return []byte(data)
}

func inflate(t *testing.T, b []byte) []byte {
	t.Helper()
	r, err := zlib.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// xmpValues parses the packet as XML and returns the text of each leaf element by local name.
func xmpValues(t *testing.T, packet []byte) map[string]string {
	t.Helper()
	if !bytes.HasPrefix(packet, []byte("<?xpacket begin=\"\ufeff\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>")) ||
		!bytes.HasSuffix(packet, []byte(`<?xpacket end="w"?>`)) {
		t.Errorf("packet wrapper: %.60q … %.30q", packet, packet[len(packet)-30:])
	}
	values := map[string]string{}
	d := xml.NewDecoder(bytes.NewReader(packet))
	var stack []string
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return values
		}
		if err != nil {
			t.Fatalf("XMP is not well-formed: %v", err)
		}
		switch tok := tok.(type) {
		case xml.StartElement:
			stack = append(stack, tok.Name.Local)
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if s := strings.TrimSpace(string(tok)); s != "" && len(stack) > 0 {
				name := stack[len(stack)-1]
				if name == "li" && len(stack) >= 3 { // dc:title and dc:creator hold their value in rdf:Alt/Seq > rdf:li
					name = stack[len(stack)-3]
				}
				if _, seen := values[name]; !seen {
					values[name] = s
				}
			}
		}
	}
}
