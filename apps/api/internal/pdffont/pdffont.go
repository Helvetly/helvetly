// Package pdffont writes text in any script into an fpdf document: Liberation Sans, the look of every PDF, and per
// character the first Noto fallback that has a glyph (fonts/README.md). A fallback is embedded only in documents that
// use it. Arabic is joined into its presentation forms and right-to-left runs are reordered (shape.go); fpdf does no
// further shaping, so Indic conjuncts and Thai mark stacking are approximations.
package pdffont

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/binary"
	"io"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"codeberg.org/go-pdf/fpdf"
	"golang.org/x/text/unicode/norm"
)

// Family is the primary font's fpdf family, with styles "" and "B".
const Family = "LiberationSans"

//go:embed fonts/*.ttf fonts/*.ttf.gz fonts/emoji-pua.txt
var files embed.FS

type face struct {
	family, file string
	load         func() []byte   // the TrueType bytes
	glyphs       func() *runeSet // the BMP code points it draws
}

func newFace(family, file string) *face {
	f := &face{family: family, file: file}
	f.load = sync.OnceValue(func() []byte {
		b, err := files.ReadFile("fonts/" + file)
		if err != nil {
			panic(err) // embedded: missing only if the build is broken
		}
		if strings.HasSuffix(file, ".gz") {
			zr, err := gzip.NewReader(bytes.NewReader(b))
			if err == nil {
				b, err = io.ReadAll(zr)
			}
			if err != nil {
				panic("pdffont: " + file + ": " + err.Error())
			}
		}
		return b
	})
	f.glyphs = sync.OnceValue(func() *runeSet { return cmap(f.load()) })
	return f
}

var (
	primary = newFace(Family, "LiberationSans-Regular.ttf")
	bold    = newFace(Family, "LiberationSans-Bold.ttf")
	// In order of preference after Liberation Sans; the big CJK fonts last, so they load only when needed.
	fallbacks = []*face{
		newFace("NotoSans", "NotoSans.ttf.gz"),
		newFace("NotoSansArabic", "NotoSansArabic.ttf.gz"),
		newFace("NotoSansDevanagari", "NotoSansDevanagari.ttf.gz"),
		newFace("NotoSansThai", "NotoSansThai.ttf.gz"),
		newFace("NotoSansMath", "NotoSansMath.ttf.gz"),
		newFace("NotoSansSymbols", "NotoSansSymbols.ttf.gz"),
		newFace("NotoSansSymbols2", "NotoSansSymbols2.ttf.gz"),
		newFace("NotoSansSC", "NotoSansSC.ttf.gz"),
		newFace("NotoSansKRHangul", "NotoSansKR-Hangul.ttf.gz"),
		newFace("NotoEmoji", "NotoEmoji.ttf.gz"),
	}
)

// emojiPUA maps an emoji above U+FFFF to the Private Use Area code point NotoEmoji.ttf.gz draws it at.
var emojiPUA = sync.OnceValue(func() map[rune]rune {
	b, _ := files.ReadFile("fonts/emoji-pua.txt")
	m := map[rune]rune{}
	for i, line := range strings.Fields(string(b)) {
		if u, err := strconv.ParseUint(line, 16, 32); err == nil {
			m[rune(u)] = 0xE000 + rune(i)
		}
	}
	return m
})

// Text draws and measures strings in pdf at the style and size of the last Font call.
type Text struct {
	pdf   *fpdf.Fpdf
	style string
	size  float64
	added map[*face]bool
}

// New registers Liberation Sans Regular and Bold in pdf and selects Regular at 10 pt.
func New(pdf *fpdf.Fpdf) *Text {
	pdf.AddUTF8FontFromBytes(Family, "", primary.load())
	pdf.AddUTF8FontFromBytes(Family, "B", bold.load())
	t := &Text{pdf: pdf, added: map[*face]bool{}}
	t.Font("", 10)
	return t
}

// Font selects Liberation Sans in style "" or "B"; fallback glyphs are always regular.
func (t *Text) Font(style string, size float64) {
	t.style, t.size = style, size
	t.pdf.SetFont(Family, style, size)
}

type run struct {
	f *face
	s string
}

// runs turns a logical line into what is drawn left to right, split by the font that has each glyph. A character
// no font has becomes U+FFFD; invisible format characters (joiners, variation selectors) are dropped.
func runs(s string) []run {
	var out []run
	var cur *face
	var b strings.Builder
	for _, r := range visual(shapeArabic(devanagariVowelI([]rune(clean(s))))) {
		if pua, ok := emojiPUA()[r]; ok {
			r = pua
		}
		f := cur
		// combining marks stay with their base when its font has them; everything else prefers Liberation Sans
		if !(unicode.Is(unicode.Mn, r) && cur != nil && cur.glyphs().has(r)) {
			if f = faceFor(r); f == nil {
				r, f = replacement, faceFor(replacement)
			}
		}
		if f != cur && b.Len() > 0 {
			out = append(out, run{cur, b.String()})
			b.Reset()
		}
		cur = f
		b.WriteRune(r)
	}
	if b.Len() > 0 {
		out = append(out, run{cur, b.String()})
	}
	return out
}

// replacement stands for a character no font has (NotoSans draws it).
const replacement = 0xFFFD

func faceFor(r rune) *face {
	if primary.glyphs().has(r) {
		return primary
	}
	for _, f := range fallbacks {
		if f.glyphs().has(r) {
			return f
		}
	}
	return nil
}

// clean composes the text (NFC) and drops what has no glyph of its own: controls, joiners, variation selectors,
// emoji skin-tone modifiers and tags.
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t':
			return ' '
		case unicode.IsControl(r), unicode.Is(unicode.Other_Default_Ignorable_Code_Point, r),
			r >= 0x200B && r <= 0x200F, r >= 0x202A && r <= 0x202E, r >= 0x2060 && r <= 0x206F,
			r >= 0xFE00 && r <= 0xFE0F, r == 0xFEFF, r >= 0x1F3FB && r <= 0x1F3FF, r >= 0xE0000 && r <= 0xE0FFF:
			return -1
		}
		return r
	}, norm.NFC.String(s))
}

// simple: drawn by fpdf as it is, in Liberation Sans alone (the common case; output as before this package).
func simple(rs []run) bool { return len(rs) == 0 || len(rs) == 1 && rs[0].f == primary }

func text(rs []run) string {
	if len(rs) == 0 {
		return ""
	}
	return rs[0].s
}

func (t *Text) use(f *face) {
	if f == primary {
		t.pdf.SetFont(Family, t.style, t.size)
		return
	}
	if !t.added[f] {
		t.pdf.AddUTF8FontFromBytes(f.family, "", f.load())
		t.added[f] = true
	}
	t.pdf.SetFont(f.family, "", t.size)
}

func (t *Text) width(rs []run) float64 {
	w := 0.0
	for _, r := range rs {
		t.use(r.f)
		w += t.pdf.GetStringWidth(r.s)
	}
	t.use(primary)
	return w
}

// Width of s in the current font, as drawn.
func (t *Text) Width(s string) float64 { return t.width(runs(s)) }

// Cell writes s into a w × h cell at the current position like fpdf's CellFormat(w, h, s, "", 0, align, …): align
// takes L, C or R and the vertical letters of CellFormat. The position moves to the cell's right edge.
func (t *Text) Cell(w, h float64, s, align string) {
	rs := runs(s)
	if simple(rs) {
		t.pdf.CellFormat(w, h, text(rs), "", 0, align, false, 0, "")
		return
	}
	x, y := t.pdf.GetXY()
	m := t.pdf.GetCellMargin()
	tw := t.width(rs)
	start := x + m
	switch {
	case strings.Contains(align, "R"):
		start = x + w - m - tw
	case strings.Contains(align, "C"):
		start = x + (w-tw)/2
	}
	vertical := strings.NewReplacer("L", "", "C", "", "R", "").Replace(align)
	for _, r := range rs {
		t.use(r.f)
		rw := t.pdf.GetStringWidth(r.s)
		t.pdf.SetXY(start-m, y) // CellFormat starts the text one cell margin in
		t.pdf.CellFormat(rw+2*m, h, r.s, "", 0, "L"+vertical, false, 0, "")
		start += rw
	}
	t.use(primary)
	t.pdf.SetXY(x+w, y)
}

// Wrap splits s at its line breaks and to width w (less the cell margins, as fpdf's SplitText): after a space, and
// within a word, such as a run of CJK, that does not fit on a line of its own.
func (t *Text) Wrap(s string, w float64) []string {
	var out []string
	for part := range strings.SplitSeq(strings.ReplaceAll(s, "\r", ""), "\n") {
		if simple(runs(part)) {
			if part == "" {
				out = append(out, "")
			} else {
				out = append(out, t.pdf.SplitText(clean(part), w)...)
			}
			continue
		}
		out = append(out, t.wrapLine([]rune(part), w-2*t.pdf.GetCellMargin())...)
	}
	return out
}

func (t *Text) wrapLine(rs []rune, max float64) []string {
	var out []string
	for len(rs) > 0 {
		end, lastSpace := 0, -1
		for end < len(rs) && (end == 0 || t.Width(string(rs[:end+1])) <= max) {
			if unicode.IsSpace(rs[end]) {
				lastSpace = end
			}
			end++
		}
		if end < len(rs) && lastSpace > 0 {
			end = lastSpace + 1
		}
		out = append(out, strings.TrimRight(string(rs[:end]), " "))
		rs = rs[end:]
		for len(rs) > 0 && rs[0] == ' ' {
			rs = rs[1:]
		}
	}
	return out
}

// ---- the cmap of a TrueType font ----

type runeSet [1 << 16 / 64]uint64

func (s *runeSet) has(r rune) bool { return r >= 0 && r <= 0xFFFF && s[r>>6]&(1<<(r&63)) != 0 }

// cmap reads the format-4 Unicode subtable, the one fpdf uses, into the set of code points with a glyph.
func cmap(ttf []byte) *runeSet {
	u16 := func(at int) int {
		if at < 0 || at+2 > len(ttf) {
			return 0
		}
		return int(binary.BigEndian.Uint16(ttf[at:]))
	}
	u32 := func(at int) int {
		if at < 0 || at+4 > len(ttf) {
			return 0
		}
		return int(binary.BigEndian.Uint32(ttf[at:]))
	}
	set := new(runeSet)
	table := 0
	for i := range u16(4) {
		if rec := 12 + 16*i; string(ttf[rec:rec+4]) == "cmap" {
			table = u32(rec + 8)
		}
	}
	sub := 0
	for i := range u16(table + 2) {
		rec := table + 4 + 8*i
		platform, encoding, at := u16(rec), u16(rec+2), table+u32(rec+4)
		if (platform == 3 && encoding == 1 || platform == 0) && u16(at) == 4 {
			sub = at
			break
		}
	}
	if sub == 0 {
		return set
	}
	segs := u16(sub+6) / 2
	ends, starts := sub+14, sub+16+2*segs
	deltas, offsets := starts+2*segs, starts+4*segs
	for i := range segs {
		start, end := u16(starts+2*i), u16(ends+2*i)
		delta, offset := u16(deltas+2*i), u16(offsets+2*i)
		for c := start; c <= end && c != 0xFFFF; c++ {
			g := c + delta
			if offset != 0 {
				if g = u16(offsets + 2*i + offset + 2*(c-start)); g != 0 {
					g += delta
				}
			}
			if g&0xFFFF != 0 {
				set[c>>6] |= 1 << (c & 63)
			}
		}
	}
	return set
}
