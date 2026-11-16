package heidi

import (
	_ "embed"
	"slices"
	"strings"
	"unicode"
)

// guideText is the Helvetly user guide: the model reads it with every question, and without a model a how-to
// question is answered with its best matching section.
//
//go:embed guide.md
var guideText string

type section struct {
	title    string
	pages    []string // the app paths of the screens it describes (Pages: line)
	text     string
	heading  map[string]bool // words of the title and the Keywords line
	contents map[string]bool
}

var guide = parseGuide(guideText)

func parseGuide(text string) []section {
	out := []section{}
	for part := range strings.SplitSeq(text, "\n## ") {
		title, body, _ := strings.Cut(part, "\n")
		if strings.HasPrefix(title, "# ") {
			continue // the document title
		}
		heading, s := title, section{title: title}
		lines := []string{}
		for line := range strings.SplitSeq(strings.TrimSpace(body), "\n") {
			if keywords, ok := strings.CutPrefix(line, "Keywords:"); ok {
				heading += " " + keywords
				continue
			}
			if pages, ok := strings.CutPrefix(line, "Pages:"); ok {
				s.pages = strings.Split(strings.ReplaceAll(pages, " ", ""), ",")
				continue
			}
			lines = append(lines, line)
		}
		steps := strings.Join(lines, "\n")
		s.text, s.heading, s.contents = "**"+title+"**\n\n"+steps, words(heading), words(steps)
		out = append(out, s)
	}
	return out
}

var stopwords = map[string]bool{"how": true, "the": true, "and": true, "can": true, "you": true, "your": true, "for": true,
	"with": true, "what": true, "where": true, "when": true, "does": true, "this": true, "that": true, "from": true, "into": true,
	"want": true, "need": true, "helvetly": true, "there": true, "are": true, "which": true, "have": true, "has": true}

// words: lowercase words of three letters or more, without a plural s, without stopwords.
func words(text string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len(w) > 3 {
			w = strings.TrimSuffix(w, "s")
		}
		if len([]rune(w)) >= 3 && !stopwords[w] {
			out[w] = true
		}
	}
	return out
}

// guideAnswer is the guide section that best matches the question: a word in its title or keywords counts two, one
// in its steps one. Below three points nothing matches well enough to answer.
func guideAnswer(question string) (string, bool) {
	best, top := "", 0
	for _, s := range guide {
		score := 0
		for w := range words(question) {
			switch {
			case s.heading[w]:
				score += 2
			case s.contents[w]:
				score++
			}
		}
		if score > top {
			best, top = s.text, score
		}
	}
	return best, top >= 3
}

// screen names the Helvetly screen the user asks from and the guide sections about it, so "what is this?" has a
// referent for the scope check and the answer. path is already validated (pagePath); empty = unknown.
func screen(path string) string {
	if path == "" {
		return ""
	}
	titles := []string{}
	for _, s := range guide {
		if slices.Contains(s.pages, path) {
			titles = append(titles, `"`+s.title+`"`)
		}
	}
	// The guide's Pages lines are the allowlist: a path the guide does not know is the caller's text, never context.
	if len(titles) == 0 {
		return ""
	}
	return "The user is on the Helvetly screen " + path + ", described in the guide sections " + strings.Join(titles, ", ") +
		`. "This page", "here" or "this" in the message mean that screen.`
}
