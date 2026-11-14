package imports

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"

	"helvetly.com/api/internal/aimodel"
)

// Limits on what one upload may hold (docs/imports-contract.md, "Files").
const (
	maxFiles      = 10
	maxFileBytes  = 10 << 20
	maxEntries    = 50
	maxEntryBytes = 10 << 20
	maxZipBytes   = 50 << 20
	maxZipRatio   = 100
	maxSheetRows  = 5000
	chunkChars    = 12_000 // one model call's text, so its records fit the output cap
)

// The content types a file is stored and read as, decided from its bytes.
const (
	typePDF  = "application/pdf"
	typePNG  = "image/png"
	typeJPEG = "image/jpeg"
	typeWEBP = "image/webp"
	typeText = "text/plain"
	typeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	typeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	typeZIP  = "application/zip"
)

// unsupported is a file the import cannot read, with the reason for the person.
type unsupported struct{ reason string }

func (u unsupported) Error() string { return u.reason }

func refuse(name, reason string) error { return unsupported{name + ": " + reason} }

// sniff names a file's type from its bytes alone; the filename and the declared type are never trusted.
func sniff(name string, b []byte) (string, error) {
	switch {
	case len(b) == 0:
		return "", refuse(name, "the file is empty.")
	case bytes.HasPrefix(b, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}):
		return "", refuse(name, "old Excel (.xls) and Word (.doc) files can't be read. Save it as .xlsx or .docx and upload it again.")
	case len(b) > 12 && string(b[4:8]) == "ftyp" && strings.Contains("heic heix hevc mif1 msf1", string(b[8:12])):
		return "", refuse(name, "HEIC photos can't be read yet. Export the photo as JPEG and upload it again.")
	}
	switch ct := http.DetectContentType(b); {
	case ct == typePDF, ct == typePNG, ct == typeJPEG, ct == typeWEBP:
		return ct, nil
	case ct == "application/zip":
		return zipType(b), nil
	case strings.HasPrefix(ct, "text/plain"), strings.HasPrefix(ct, "text/csv"):
		if !utf8.Valid(bytes.TrimPrefix(b, []byte("\xEF\xBB\xBF"))) {
			return "", refuse(name, "the text is not UTF-8. Save it as CSV UTF-8 and upload it again.")
		}
		return typeText, nil
	}
	return "", refuse(name, "use PDF, PNG, JPEG, WEBP, Excel (.xlsx), Word (.docx), CSV or a ZIP of them.")
}

// zipType tells an Office file (a ZIP with a known part) from a plain ZIP.
func zipType(b []byte) string {
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return typeZIP
	}
	for _, f := range r.File {
		switch f.Name {
		case "xl/workbook.xml":
			return typeXLSX
		case "word/document.xml":
			return typeDOCX
		}
	}
	return typeZIP
}

// entry is one readable file of a ZIP, or the reason it is skipped.
type entry struct {
	index        int
	name         string
	size         int64
	contentType  string
	unsupportedR string
}

// zipEntries lists a ZIP's files one level deep, decompressing each to check the limits on the actual bytes (a
// header's sizes can lie). Over a limit the whole ZIP is refused; an unreadable entry is listed with its reason.
func zipEntries(name string, b []byte) ([]entry, error) {
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, refuse(name, "the ZIP file is damaged.")
	}
	var list []entry
	var total int64
	for i, f := range r.File {
		base := path.Base(f.Name)
		if f.FileInfo().IsDir() || strings.HasPrefix(base, ".") || strings.HasPrefix(f.Name, "__MACOSX/") || strings.Contains(f.Name, "/__MACOSX/") {
			continue
		}
		if len(list) == maxEntries {
			return nil, refuse(name, fmt.Sprintf("a ZIP may hold at most %d files.", maxEntries))
		}
		data, err := readEntry(f)
		if err != nil {
			return nil, refuse(name, err.Error())
		}
		total += int64(len(data))
		if total > maxZipBytes {
			return nil, refuse(name, "the ZIP unpacks to more than 50 MB.")
		}
		if f.CompressedSize64 > 0 && uint64(len(data)) > maxZipRatio*f.CompressedSize64 {
			return nil, refuse(name, "the ZIP is compressed suspiciously far; it is not opened.")
		}
		e := entry{index: i, name: name + " › " + f.Name, size: int64(len(data))}
		ct, err := sniff(base, data)
		switch {
		case err != nil:
			e.unsupportedR = err.Error()
		case ct == typeZIP:
			e.unsupportedR = base + ": a ZIP inside a ZIP is not opened. Upload it on its own."
		default:
			e.contentType = ct
		}
		list = append(list, e)
	}
	if len(list) == 0 {
		return nil, refuse(name, "the ZIP holds no files.")
	}
	return list, nil
}

func readEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("%s can't be unpacked", f.Name)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxEntryBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%s can't be unpacked", f.Name)
	}
	if len(data) > maxEntryBytes {
		return nil, fmt.Errorf("%s unpacks to more than 10 MB", f.Name)
	}
	return data, nil
}

// entryBytes reads entry index of a stored ZIP again, for the job.
func entryBytes(zipBytes []byte, index int) ([]byte, error) {
	r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil || index < 0 || index >= len(r.File) {
		return nil, errors.New("the ZIP entry can't be read")
	}
	return readEntry(r.File[index])
}

// chunk is one model call's input: text, or a file the model reads itself.
type chunk struct {
	text string
	file *aimodel.File
}

// chunks turns a file into model input: PDFs and images as themselves, text and spreadsheets as text in chunks.
func chunks(name, contentType string, b []byte) ([]chunk, error) {
	switch contentType {
	case typePDF, typePNG, typeJPEG, typeWEBP:
		return []chunk{{file: &aimodel.File{Name: name, ContentType: contentType, Bytes: b}}}, nil
	case typeText:
		return splitText(string(bytes.TrimPrefix(b, []byte("\xEF\xBB\xBF")))), nil
	case typeDOCX:
		text, err := docxText(b)
		if err != nil {
			return nil, err
		}
		return splitText(text), nil
	case typeXLSX:
		sheets, err := xlsxSheets(b)
		if err != nil {
			return nil, err
		}
		var out []chunk
		for _, s := range sheets {
			out = append(out, splitText(s)...)
		}
		return out, nil
	}
	return nil, unsupported{name + ": this file type can't be read."}
}

// splitText cuts text into chunks of about chunkChars at line ends. A first line that looks like a CSV header is
// repeated at the top of every chunk, so each chunk can be read on its own.
func splitText(text string) []chunk {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	header := ""
	if len(lines) > 1 && strings.ContainsAny(lines[0], ",;\t") {
		header, lines = lines[0]+"\n", lines[1:]
	}
	var out []chunk
	var b strings.Builder
	for _, line := range lines {
		if b.Len() > 0 && b.Len()+len(line) > chunkChars {
			out = append(out, chunk{text: header + b.String()})
			b.Reset()
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	if strings.TrimSpace(b.String()) != "" {
		out = append(out, chunk{text: header + b.String()})
	}
	return out
}

// xlsxSheets returns each non-empty sheet as CSV text headed by its name, at most maxSheetRows rows each.
func xlsxSheets(b []byte) ([]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(b), excelize.Options{UnzipSizeLimit: maxZipBytes, UnzipXMLSizeLimit: maxEntryBytes})
	if err != nil {
		return nil, unsupported{"the Excel file can't be opened: save it again as .xlsx."}
	}
	defer f.Close()
	var out []string
	for _, sheet := range f.GetSheetList() {
		rows, err := f.Rows(sheet)
		if err != nil {
			return nil, fmt.Errorf("read sheet: %w", err)
		}
		var buf strings.Builder
		w := csv.NewWriter(&buf)
		n := 0
		for rows.Next() && n < maxSheetRows {
			cols, err := rows.Columns()
			if err != nil {
				_ = rows.Close()
				return nil, fmt.Errorf("read row: %w", err)
			}
			if strings.TrimSpace(strings.Join(cols, "")) == "" {
				continue
			}
			if err := w.Write(cols); err != nil {
				_ = rows.Close()
				return nil, err
			}
			n++
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		w.Flush()
		if n > 0 {
			out = append(out, buf.String())
		}
	}
	if len(out) == 0 {
		return nil, unsupported{"the Excel file has no rows."}
	}
	return out, nil
}

// docxText returns a Word document's paragraphs as lines (tabs and breaks kept), from word/document.xml.
func docxText(b []byte) (string, error) {
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return "", unsupported{"the Word file is damaged."}
	}
	for _, f := range r.File {
		if f.Name != "word/document.xml" {
			continue
		}
		data, err := readEntry(f)
		if err != nil {
			return "", unsupported{"the Word file can't be read: " + err.Error() + "."}
		}
		var out strings.Builder
		d := xml.NewDecoder(bytes.NewReader(data))
		inText := false
		for {
			tok, err := d.Token()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return "", unsupported{"the Word file can't be read."}
			}
			switch t := tok.(type) {
			case xml.StartElement:
				switch t.Name.Local {
				case "t":
					inText = true
				case "tab":
					out.WriteByte('\t')
				case "br", "cr":
					out.WriteByte('\n')
				}
			case xml.EndElement:
				switch t.Name.Local {
				case "t":
					inText = false
				case "p":
					out.WriteByte('\n')
				case "tc":
					out.WriteByte('\t')
				}
			case xml.CharData:
				if inText {
					out.Write(t)
				}
			}
		}
		if strings.TrimSpace(out.String()) == "" {
			return "", unsupported{"the Word file has no text."}
		}
		return out.String(), nil
	}
	return "", unsupported{"the Word file has no document part."}
}
