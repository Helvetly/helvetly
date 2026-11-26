package heidi

import (
	"net/http"

	langtag "golang.org/x/text/language"
	"golang.org/x/text/language/display"
)

// The interface language is used only when neither the request nor prior user messages indicate a language.
func uiLanguage(r *http.Request, selected string) string {
	if tag, err := langtag.Parse(selected); err == nil && tag != langtag.Und {
		return tag.String()
	}
	if tags, _, err := langtag.ParseAcceptLanguage(r.Header.Get("Accept-Language")); err == nil {
		for _, tag := range tags {
			if tag != langtag.Und {
				return tag.String()
			}
		}
	}
	return "en"
}

// The multilingual model sees the original words. An overlapping article or a customer's name cannot pin the reply to a guessed language.
func replyInstruction(ui string) string {
	tag, err := langtag.Parse(ui)
	// Only registered language, script and region names enter instructions, never custom tag extensions.
	base, script, region := tag.Raw()
	if err != nil || base.String() == "und" || base.IsPrivateUse() {
		tag = langtag.English
	} else {
		tag, _ = langtag.Compose(base, script, region)
	}
	return "# Reply language\n\nUse the language the user explicitly requests. Otherwise use the language of the user's latest substantive message, including languages outside Helvetly's interface languages. For a language-neutral follow-up such as \"ok\", a number or an invoice ID, use the most recent earlier user message that establishes a language. If neither the request nor earlier user messages establish one, use the interface language (" + display.English.Tags().Name(tag) + "). A client name, record, attachment, interface label or previous assistant answer does not set the user's language. Preserve names, numbers, dates and currencies."
}
