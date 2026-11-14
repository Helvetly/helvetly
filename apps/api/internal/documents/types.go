package documents

import (
	"bytes"
	"net/http"
	"path"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

type fileType struct {
	contentType string
	sniff       []string // what http.DetectContentType must start with; "ole" = the legacy Office header
	kind        string
}

const (
	sniffZip = "application/zip"
	sniffOle = "ole"
)

var textSniff = []string{"text/plain"}

// fileTypes: the allowed extensions, the content type stored for each, what the first bytes must look like, and the
// kind the UI groups them by.
var fileTypes = map[string]fileType{
	".pdf":  {"application/pdf", []string{"application/pdf"}, "pdf"},
	".png":  {"image/png", []string{"image/png"}, "image"},
	".jpg":  {"image/jpeg", []string{"image/jpeg"}, "image"},
	".jpeg": {"image/jpeg", []string{"image/jpeg"}, "image"},
	".webp": {"image/webp", []string{"image/webp"}, "image"},
	".gif":  {"image/gif", []string{"image/gif"}, "image"},
	".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []string{sniffZip}, "spreadsheet"},
	".xls":  {"application/vnd.ms-excel", []string{sniffOle}, "spreadsheet"},
	".ods":  {"application/vnd.oasis.opendocument.spreadsheet", []string{sniffZip}, "spreadsheet"},
	".csv":  {"text/csv", textSniff, "spreadsheet"},
	".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", []string{sniffZip}, "document"},
	".doc":  {"application/msword", []string{sniffOle}, "document"},
	".odt":  {"application/vnd.oasis.opendocument.text", []string{sniffZip}, "document"},
	".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", []string{sniffZip}, "presentation"},
	".odp":  {"application/vnd.oasis.opendocument.presentation", []string{sniffZip}, "presentation"},
	".txt":  {"text/plain", textSniff, "text"},
	".md":   {"text/markdown", textSniff, "text"},
	".json": {"application/json", textSniff, "text"},
	".xml":  {"application/xml", []string{"text/xml", "text/plain"}, "text"},
	".zip":  {"application/zip", []string{sniffZip}, "archive"},
}

// Kinds the list can filter by, in the order the UI shows them.
var kinds = []string{"pdf", "image", "spreadsheet", "document", "presentation", "text", "archive"}

// oleMagic starts the legacy Office formats (.xls, .doc), which http.DetectContentType does not name.
var oleMagic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// detectType: the content type to store for a file with this name and these first bytes, or "" when not allowed.
func detectType(name string, head []byte) string {
	t, ok := fileTypes[strings.ToLower(path.Ext(name))]
	if !ok {
		return ""
	}
	sniffed := http.DetectContentType(head)
	for _, want := range t.sniff {
		if want == sniffOle && bytes.HasPrefix(head, oleMagic) || want != sniffOle && strings.HasPrefix(sniffed, want) {
			return t.contentType
		}
	}
	return ""
}

// kindOf groups a stored content type; files from before Documents may have one outside the allow-list.
func kindOf(contentType string) string {
	for _, t := range fileTypes {
		if t.contentType == contentType {
			return t.kind
		}
	}
	return "other"
}

// contentTypes: every stored content type of the kinds.
func contentTypes(of []string) []string {
	var out []string
	for _, t := range fileTypes {
		if slices.Contains(of, t.kind) && !slices.Contains(out, t.contentType) {
			out = append(out, t.contentType)
		}
	}
	return out
}

func previewable(contentType string) bool {
	return contentType == "application/pdf" || strings.HasPrefix(contentType, "image/")
}

// displayName: an uploaded name without any path or control characters, at most 255 characters.
func displayName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, path.Base(strings.ReplaceAll(name, `\`, "/")))
	name = strings.TrimSpace(name)
	if runes := []rune(name); len(runes) > 255 {
		name = string(runes[:255])
	}
	if name == "" || name == "." || name == "/" || name == ".." {
		return "file"
	}
	return name
}

// checkName: a typed folder or file name, trimmed, or the reason it can't be used.
func checkName(name string) (string, string) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return "", "Enter a name."
	case utf8.RuneCountInString(name) > 255:
		return "", "Use at most 255 characters."
	case name == "." || name == "..",
		strings.ContainsAny(name, `/\`),
		strings.ContainsFunc(name, unicode.IsControl):
		return "", `A name can't be "." or "..", or contain "/" or "\".`
	}
	return name, ""
}

// keyName: the display name reduced to characters safe in an object key.
func keyName(name string) string {
	safe := strings.Map(func(r rune) rune {
		if r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '-' || r == '_') {
			return r
		}
		return '_'
	}, name)
	if len(safe) > 100 {
		safe = safe[len(safe)-100:] // keep the extension
	}
	return safe
}
