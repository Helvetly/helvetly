package pdffont

import (
	"slices"
	"unicode"
)

// shortcut: a minimal stand-in for OpenType shaping and the Unicode bidi algorithm, which fpdf lacks. Arabic letters
// take their joined presentation forms (with the lam-alef ligature) and right-to-left runs are reversed inside a
// left-to-right line, numbers kept in order and brackets mirrored. Marks are not repositioned, letters beyond the
// table (rarer Arabic-script languages, Syriac, N'Ko) stay unjoined. Use a real shaper (HarfBuzz) if that matters.

type joining struct {
	isolated rune // presentation forms follow: final, then initial and medial for a dual-joining letter
	dual     bool // joins on both sides; otherwise only to the letter before it
}

var arabic = map[rune]joining{
	0x0621: {0xFE80, false}, 0x0622: {0xFE81, false}, 0x0623: {0xFE83, false}, 0x0624: {0xFE85, false},
	0x0625: {0xFE87, false}, 0x0626: {0xFE89, true}, 0x0627: {0xFE8D, false}, 0x0628: {0xFE8F, true},
	0x0629: {0xFE93, false}, 0x062A: {0xFE95, true}, 0x062B: {0xFE99, true}, 0x062C: {0xFE9D, true},
	0x062D: {0xFEA1, true}, 0x062E: {0xFEA5, true}, 0x062F: {0xFEA9, false}, 0x0630: {0xFEAB, false},
	0x0631: {0xFEAD, false}, 0x0632: {0xFEAF, false}, 0x0633: {0xFEB1, true}, 0x0634: {0xFEB5, true},
	0x0635: {0xFEB9, true}, 0x0636: {0xFEBD, true}, 0x0637: {0xFEC1, true}, 0x0638: {0xFEC5, true},
	0x0639: {0xFEC9, true}, 0x063A: {0xFECD, true}, 0x0641: {0xFED1, true}, 0x0642: {0xFED5, true},
	0x0643: {0xFED9, true}, 0x0644: {0xFEDD, true}, 0x0645: {0xFEE1, true}, 0x0646: {0xFEE5, true},
	0x0647: {0xFEE9, true}, 0x0648: {0xFEED, false}, 0x0649: {0xFEEF, false}, 0x064A: {0xFEF1, true},
	// Persian and Urdu letters (Arabic Presentation Forms-A)
	0x067E: {0xFB56, true}, 0x0686: {0xFB7A, true}, 0x0698: {0xFB8A, false}, 0x06A9: {0xFB8E, true},
	0x06AF: {0xFB92, true}, 0x06CC: {0xFBFC, true},
}

const tatweel = 0x0640

// lamAlef: the isolated lam-alef ligature for each alef; the final form follows it.
var lamAlef = map[rune]rune{0x0622: 0xFEF5, 0x0623: 0xFEF7, 0x0625: 0xFEF9, 0x0627: 0xFEFB}

// shapeArabic replaces Arabic letters (in logical order) by the presentation form of their position in the word.
func shapeArabic(rs []rune) []rune {
	if !slices.ContainsFunc(rs, func(r rune) bool { _, ok := arabic[r]; return ok }) {
		return rs
	}
	// neighbour: the letter before (step -1) or after (+1) i, skipping marks; 0 when there is none
	neighbour := func(i, step int) rune {
		for j := i + step; j >= 0 && j < len(rs); j += step {
			if !unicode.Is(unicode.Mn, rs[j]) {
				return rs[j]
			}
		}
		return 0
	}
	joinsNext := func(r rune) bool { return r == tatweel || arabic[r].dual }                          // r connects to what follows
	joinsPrev := func(r rune) bool { _, ok := arabic[r]; return (ok && r != 0x0621) || r == tatweel } // to what precedes
	out := make([]rune, 0, len(rs))
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		j, ok := arabic[r]
		if !ok {
			out = append(out, r)
			continue
		}
		prev, next := joinsNext(neighbour(i, -1)), joinsPrev(neighbour(i, 1))
		if r == 0x0644 && i+1 < len(rs) && lamAlef[rs[i+1]] != 0 {
			lig := lamAlef[rs[i+1]]
			if prev {
				lig++
			}
			out = append(out, lig)
			i++
			continue
		}
		switch {
		case r == 0x0621:
			out = append(out, j.isolated)
		case prev && next && j.dual:
			out = append(out, j.isolated+3)
		case prev:
			out = append(out, j.isolated+1)
		case next && j.dual:
			out = append(out, j.isolated+2)
		default:
			out = append(out, j.isolated)
		}
	}
	return out
}

func rtl(r rune) bool {
	return r >= 0x0590 && r <= 0x08FF || r >= 0xFB1D && r <= 0xFDFF || r >= 0xFE70 && r <= 0xFEFF ||
		r >= 0x10800 && r <= 0x10FFF || r >= 0x1E800 && r <= 0x1EFFF
}

func digit(r rune) bool { return unicode.IsDigit(r) }

var mirror = map[rune]rune{'(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«'}

// visual reorders a logical line for drawing left to right: each run from a right-to-left letter to the last one
// before a left-to-right letter is reversed, with the numbers inside it kept in reading order.
func visual(rs []rune) []rune {
	if !slices.ContainsFunc(rs, rtl) {
		return rs
	}
	out := slices.Clone(rs)
	for i := 0; i < len(out); {
		if !rtl(out[i]) {
			i++
			continue
		}
		end := i
		for k := i + 1; k < len(out) && !(unicode.IsLetter(out[k]) && !rtl(out[k])); k++ {
			if rtl(out[k]) {
				end = k
			}
		}
		span := out[i : end+1]
		slices.Reverse(span)
		for a := 0; a < len(span); a++ {
			if m, ok := mirror[span[a]]; ok {
				span[a] = m
			}
			if !digit(span[a]) {
				continue
			}
			b := a
			for b+1 < len(span) && (digit(span[b+1]) || (b+2 < len(span) && digit(span[b+2]) && unicode.IsPunct(span[b+1]))) {
				b++
			}
			slices.Reverse(span[a : b+1])
			a = b
		}
		i = end + 1
	}
	return out
}

// devanagariVowelI moves the Devanagari vowel sign I (ि), written after its consonant cluster, to before it, where it
// is drawn. Conjuncts stay as consonant + virama + consonant: their glyphs need OpenType shaping.
func devanagariVowelI(rs []rune) []rune {
	if !slices.Contains(rs, 0x093F) {
		return rs
	}
	out := slices.Clone(rs)
	consonant := func(r rune) bool { return r >= 0x0915 && r <= 0x0939 || r >= 0x0958 && r <= 0x095F }
	for i := 1; i < len(out); i++ {
		if out[i] != 0x093F || !consonant(out[i-1]) && out[i-1] != 0x093C {
			continue
		}
		start := i - 1
		for start > 0 && !consonant(out[start]) { // nukta after the consonant
			start--
		}
		for start >= 2 && out[start-1] == 0x094D && consonant(out[start-2]) { // consonant + virama before it
			start -= 2
		}
		copy(out[start+1:i+1], out[start:i])
		out[start] = 0x093F
	}
	return out
}
