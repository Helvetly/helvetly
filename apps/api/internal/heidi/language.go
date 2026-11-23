package heidi

import (
	"net/http"
	"strings"
	"unicode"

	"helvetly.com/api/internal/aimodel"
)

// languageNames names the languages Heidi tells apart, for the reply instruction.
var languageNames = map[string]string{"en": "English", "de": "German", "fr": "French", "it": "Italian", "pl": "Polish"}

// uiLanguage is the asker's interface language: the form's lang (the platform sends its own), else the first known
// one of Accept-Language, else English.
func uiLanguage(r *http.Request, lang string) string {
	tags := []string{lang}
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		tags = append(tags, strings.TrimSpace(strings.SplitN(part, ";", 2)[0]))
	}
	for _, tag := range tags {
		if code := strings.ToLower(strings.SplitN(tag, "-", 2)[0]); languageNames[code] != "" {
			return code
		}
	}
	return "en"
}

// replyLanguage is the language Heidi answers in: the latest message's, else (a message too short to tell, such as
// "ok", a number or an invoice number) the latest earlier user message's, else the interface's. Empty when the
// message is long enough but in a language the hints do not know: the model then follows the message itself.
// Assistant turns never count, so English record data and local answers cannot flip it.
func replyLanguage(message string, history []aimodel.Turn, ui string) string {
	if lang := guessLanguage(message); lang != "" {
		return lang
	}
	if letterWords(message) >= 3 {
		return ""
	}
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Role != "user" {
			continue
		}
		if lang := guessLanguage(history[i].Text); lang != "" {
			return lang
		}
	}
	return ui
}

// letterWords counts the message's words of two or more letters.
func letterWords(message string) int {
	n := 0
	for _, w := range strings.FieldsFunc(message, func(r rune) bool { return !unicode.IsLetter(r) }) {
		if len([]rune(w)) >= 2 {
			n++
		}
	}
	return n
}

// replyInstruction goes last in the answer's instructions, so nothing after it (guide, screen, files) outweighs it.
func replyInstruction(lang, ui string) string {
	target := "the language of the user's last message"
	if name := languageNames[lang]; name != "" {
		target = name + ", the language of the user's last message"
	}
	return "# Reply language\n\nAlways answer in " + target + ". When that message is too short to tell (such as \"ok\", a number or an invoice number), answer in the language of the user's earlier messages, else in " +
		languageNames[ui] + ". The language of the interface, the user guide, the screen, attached files, record data and your earlier answers never changes it. Names, numbers, amounts and dates keep the formatting given above."
}
