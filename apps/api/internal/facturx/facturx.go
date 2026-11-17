// Package facturx turns an issued invoice PDF into a Factur-X 1.0 / ZUGFeRD 2.x hybrid: a PDF/A-3B file that keeps
// every page as issued and carries the CII XML as factur-x.xml (ISO 19005-3, Factur-X 1.0.07 §6).
//
// It reads the classic cross-reference table that fpdf writes and rewrites the file once: the catalog and the
// document information are replaced, link annotations get the print flag PDF/A needs, and the XMP metadata, the
// sRGB output intent and the embedded XML are added. A file it cannot make conforming is refused, never patched.
package facturx

import (
	"bytes"
	"compress/zlib"
	"crypto/md5"
	"crypto/sha256"
	_ "embed"
	"encoding/xml"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

// Filename is the attachment's name, fixed by Factur-X and ZUGFeRD 2.x.
const Filename = "factur-x.xml"

// Profile is the Factur-X conformance level of the embedded XML: the full EN 16931 core (ZUGFeRD "COMFORT").
const Profile = "EN 16931"

//go:embed sRGB2014.icc
var srgb []byte

var (
	// ErrUnsupported: the PDF is not one this package can make PDF/A-3 (encrypted, incrementally updated, or using
	// features PDF/A forbids).
	ErrUnsupported = errors.New("facturx: the PDF cannot be converted to PDF/A-3")
	// ErrCMYK: the PDF uses DeviceCMYK (a CMYK JPEG logo), which an sRGB output intent does not allow.
	ErrCMYK = errors.New("facturx: the PDF contains CMYK colour")
)

// Meta is the document information, written identically into the info dictionary and the XMP metadata.
type Meta struct {
	Title, Author     string
	Created, Modified time.Time
}

type object struct {
	num  int
	body []byte // from "N 0 obj" to "endobj"
}

// Embed returns pdf as PDF/A-3B with the Factur-X XML attached.
func Embed(pdf, cii []byte, m Meta) ([]byte, error) {
	objs, root, info, err := parse(pdf)
	if err != nil {
		return nil, err
	}
	for i, o := range objs {
		if o.num == root || o.num == info { // both are replaced below
			continue
		}
		if objs[i].body, err = conform(o.body); err != nil {
			return nil, err
		}
	}
	catalog, err := catalogOf(objs[slices.IndexFunc(objs, func(o object) bool { return o.num == root })].body)
	if err != nil {
		return nil, err
	}
	n := len(objs)
	xmp, icc, file, spec := n+1, n+2, n+3, n+4
	replace := map[int]string{
		root: catalog + fmt.Sprintf("/Metadata %d 0 R /OutputIntents [<< /Type /OutputIntent /S /GTS_PDFA1 "+
			"/OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /DestOutputProfile %d 0 R >>] "+
			"/AF [%d 0 R] /Names << /EmbeddedFiles << /Names [(%s) %d 0 R] >> >> >>", xmp, icc, spec, Filename, spec),
		info: infoDict(m),
	}

	var out bytes.Buffer
	out.WriteString("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
	offsets := make([]int, 0, n+4)
	for _, o := range objs {
		offsets = append(offsets, out.Len())
		if d, ok := replace[o.num]; ok {
			fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", o.num, d)
			continue
		}
		out.Write(o.body)
		out.WriteByte('\n')
	}
	stream := func(num int, dict string, data []byte) {
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n<< %s /Length %d >>\nstream\n", num, dict, len(data))
		out.Write(data)
		out.WriteString("\nendstream\nendobj\n")
	}
	// The metadata stream stays unfiltered so that it is readable without the PDF (ISO 19005-3 6.6.2.1).
	stream(xmp, "/Type /Metadata /Subtype /XML", xmpPacket(m))
	stream(icc, "/N 3 /Filter /FlateDecode", deflate(srgb))
	sum := md5.Sum(cii) // /CheckSum is MD5 by definition (ISO 32000-1 table 44)
	stream(file, fmt.Sprintf("/Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode "+
		"/Params << /ModDate (%s) /Size %d /CheckSum <%x> >>", pdfDate(m.Modified), len(cii), sum), deflate(cii))
	offsets = append(offsets, out.Len())
	fmt.Fprintf(&out, "%d 0 obj\n<< /Type /Filespec /F (%s) /UF (%s) /Desc (Factur-X invoice) "+
		"/AFRelationship /Alternative /EF << /F %d 0 R /UF %d 0 R >> >>\nendobj\n", spec, Filename, Filename, file, file)

	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, off := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", off)
	}
	id := sha256.Sum256(append(slices.Clone(pdf), cii...))
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R /ID [<%x> <%x>] >>\nstartxref\n%d\n%%%%EOF\n",
		len(offsets)+1, root, info, id[:16], id[:16], xref)
	return out.Bytes(), nil
}

var (
	reStartXref = regexp.MustCompile(`startxref\s+(\d+)\s+%%EOF\s*$`)
	reRef       = func(key string) *regexp.Regexp { return regexp.MustCompile(key + `\s+(\d+)\s+0\s+R`) }
	reRoot      = reRef("/Root")
	reInfo      = reRef("/Info")
	rePages     = reRef("/Pages")
	reLang      = regexp.MustCompile(`/Lang\s*\(([A-Za-z0-9-]*)\)`)
)

// parse reads a single-section classic cross-reference table whose objects are numbered 1..n without gaps.
func parse(pdf []byte) (objs []object, root, info int, err error) {
	bad := func(why string) ([]object, int, int, error) {
		return nil, 0, 0, fmt.Errorf("%w: %s", ErrUnsupported, why)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.")) {
		return bad("not a PDF")
	}
	m := reStartXref.FindSubmatch(pdf)
	if m == nil {
		return bad("no startxref")
	}
	xref, _ := strconv.Atoi(string(m[1]))
	if xref <= 0 || xref >= len(pdf) || !bytes.HasPrefix(pdf[xref:], []byte("xref")) {
		return bad("no classic cross-reference table")
	}
	table, trailer, ok := bytes.Cut(pdf[xref+len("xref"):], []byte("trailer"))
	if !ok {
		return bad("no trailer")
	}
	for _, k := range []string{"/Prev", "/Encrypt", "/XRefStm"} {
		if bytes.Contains(trailer, []byte(k)) {
			return bad("trailer has " + k)
		}
	}
	lines := strings.Fields(string(table))
	if len(lines) < 2 || lines[0] != "0" {
		return bad("cross-reference table does not start at object 0")
	}
	count, _ := strconv.Atoi(lines[1])
	if count < 2 || len(lines) != 2+3*count {
		return bad("cross-reference table is not one subsection")
	}
	offsets := make([]int, count)
	for i := range count {
		off, f := lines[2+3*i], lines[4+3*i]
		if (i == 0) != (f == "f") || (i > 0 && f != "n") {
			return bad("cross-reference table has free objects")
		}
		offsets[i], _ = strconv.Atoi(off)
	}
	ends := append(slices.Clone(offsets[1:]), xref)
	slices.Sort(ends)
	for num := 1; num < count; num++ {
		start := offsets[num]
		i, _ := slices.BinarySearch(ends, start+1)
		if start <= 0 || i >= len(ends) {
			return bad("object offset outside the file")
		}
		body := bytes.TrimRight(pdf[start:ends[i]], " \r\n\t")
		if !bytes.HasPrefix(body, fmt.Appendf(nil, "%d 0 obj", num)) || !bytes.HasSuffix(body, []byte("endobj")) {
			return bad(fmt.Sprintf("object %d is not where the table says", num))
		}
		objs = append(objs, object{num, body})
	}
	r, i := reRoot.FindSubmatch(trailer), reInfo.FindSubmatch(trailer)
	if r == nil || i == nil {
		return bad("trailer has no /Root or /Info")
	}
	root, _ = strconv.Atoi(string(r[1]))
	info, _ = strconv.Atoi(string(i[1]))
	if root < 1 || root >= count || info < 1 || info >= count || root == info {
		return bad("trailer references outside the table")
	}
	return objs, root, info, nil
}

// forbidden in any object dictionary of a PDF/A-3 file whose only attachment is the one Embed adds.
var forbidden = []string{"/JavaScript", "/Launch", "/Type /EmbeddedFile", "/FileAttachment", "/Sound", "/Movie",
	"/Interpolate true", "/Alternates", "/OPI", "/PS ", "/Subtype /PS", "/Subtype /Type1", "/Subtype /MMType1",
	"/Subtype /Type3", "/TR "}

// conform checks one object's dictionary (never its stream data) and gives link annotations the print flag.
func conform(body []byte) ([]byte, error) {
	dict, data, isStream := bytes.Cut(body, []byte("stream\n"))
	if bytes.Contains(dict, []byte("/DeviceCMYK")) {
		return nil, ErrCMYK
	}
	for _, f := range forbidden {
		if bytes.Contains(dict, []byte(f)) {
			return nil, fmt.Errorf("%w: uses %s", ErrUnsupported, strings.TrimSpace(f))
		}
	}
	// fpdf writes link annotations inline in the page without /F; PDF/A wants them printed (6.3.2).
	fixed := bytes.ReplaceAll(dict, []byte("/Type /Annot /Subtype /Link /Rect"), []byte("/Type /Annot /Subtype /Link /F 4 /Rect"))
	if bytes.Count(fixed, []byte("/Type /Annot")) != bytes.Count(fixed, []byte("/Subtype /Link /F 4 ")) {
		return nil, fmt.Errorf("%w: has an annotation other than a link", ErrUnsupported)
	}
	if !isStream {
		return fixed, nil
	}
	return slices.Concat(fixed, []byte("stream\n"), data), nil
}

// catalogOf is the start of the new catalog: the original's page tree and language, nothing that PDF/A forbids.
func catalogOf(body []byte) (string, error) {
	for _, k := range []string{"/AcroForm", "/OpenAction", "/AA", "/Outlines", "/OCProperties", "/StructTreeRoot",
		"/Metadata", "/OutputIntents", "/AF"} {
		if bytes.Contains(body, []byte(k)) {
			return "", fmt.Errorf("%w: catalog has %s", ErrUnsupported, k)
		}
	}
	p := rePages.FindSubmatch(body)
	if p == nil {
		return "", fmt.Errorf("%w: catalog has no /Pages", ErrUnsupported)
	}
	c := "<< /Type /Catalog /Pages " + string(p[1]) + " 0 R "
	if l := reLang.FindSubmatch(body); l != nil && len(l[1]) > 0 {
		c += "/Lang (" + string(l[1]) + ") "
	}
	return c, nil
}

func infoDict(m Meta) string {
	var b strings.Builder
	b.WriteString("<< ")
	if m.Title != "" {
		b.WriteString("/Title " + pdfText(m.Title) + " ")
	}
	if m.Author != "" {
		b.WriteString("/Author " + pdfText(m.Author) + " ")
	}
	fmt.Fprintf(&b, "/Producer (Helvetly) /CreationDate (%s) /ModDate (%s) >>", pdfDate(m.Created), pdfDate(m.Modified))
	return b.String()
}

// xmpPacket mirrors infoDict (ISO 19005-3 6.6.3) and declares the Factur-X extension schema (Factur-X 1.0.07 §6.2.2).
func xmpPacket(m Meta) []byte {
	esc := func(s string) string {
		var b strings.Builder
		_ = xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	dc := ""
	if m.Title != "" {
		dc += `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">` + esc(m.Title) + `</rdf:li></rdf:Alt></dc:title>`
	}
	if m.Author != "" {
		dc += `<dc:creator><rdf:Seq><rdf:li>` + esc(m.Author) + `</rdf:li></rdf:Seq></dc:creator>`
	}
	property := func(name, description string) string {
		return `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>` + name + `</pdfaProperty:name>` +
			`<pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category>` +
			`<pdfaProperty:description>` + description + `</pdfaProperty:description></rdf:li>`
	}
	return []byte(`<?xpacket begin="` + "\ufeff" + `" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format>` + dc + `</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Helvetly</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>` + xmpDate(m.Created) + `</xmp:CreateDate><xmp:ModifyDate>` + xmpDate(m.Modified) + `</xmp:ModifyDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>` +
		property("DocumentFileName", "The name of the embedded XML document") +
		property("DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER") +
		property("Version", "The actual version of the standard applying to the embedded XML document") +
		property("ConformanceLevel", "The conformance level of the embedded XML document") + `</rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>` + Filename + `</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>` + Profile + `</fx:ConformanceLevel></rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`)
}

// pdfText is a PDF text string in UTF-16BE with a byte order mark, so any name survives unescaped.
func pdfText(s string) string {
	var b strings.Builder
	b.WriteString("<FEFF")
	for _, u := range utf16.Encode([]rune(s)) {
		fmt.Fprintf(&b, "%04X", u)
	}
	return b.String() + ">"
}

// Dates are UTC with an explicit offset in both forms, so the info dictionary and XMP state the same instant.
func pdfDate(t time.Time) string { return t.UTC().Format("D:20060102150405") + "+00'00'" }
func xmpDate(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05") + "+00:00" }

func deflate(b []byte) []byte {
	var out bytes.Buffer
	w := zlib.NewWriter(&out)
	_, _ = w.Write(b) // a bytes.Buffer does not fail
	_ = w.Close()
	return out.Bytes()
}
