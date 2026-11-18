// Package ainotice is the one AI-use notice people approve before Helvetly sends anything to the AI model: its
// version and texts. An approval counts only for the version in force (store.AIConsent), so changing the texts means
// a new version and everyone approves again.
package ainotice

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
)

//go:embed notice.json
var raw []byte

type Point struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type Section struct {
	ID     string  `json:"id"`
	Title  string  `json:"title"`
	Points []Point `json:"points"`
}

type Text struct {
	Title    string    `json:"title"`
	Lead     string    `json:"lead"`
	Sections []Section `json:"sections"`
}

// Notice is the notice in one language, with the version an approval of it records.
type Notice struct {
	Version string `json:"version"`
	Text
}

var file struct {
	Version string          `json:"version"`
	SHA256  string          `json:"sha256"`
	Texts   map[string]Text `json:"texts"`
}

// Version is the notice in force; an approval of any other (or none, before versions) does not count.
var Version string

func init() {
	if err := json.Unmarshal(raw, &file); err != nil {
		panic("ainotice: " + err.Error())
	}
	Version = file.Version
}

// For is the notice in lang, or in English for a language it has no text in.
func For(lang string) Notice {
	t, ok := file.Texts[lang]
	if !ok {
		t = file.Texts["en"]
	}
	return Notice{Version: Version, Text: t}
}

// textsHash is the SHA-256 of the texts as re-encoded, so formatting the file does not change it.
func textsHash() string {
	b, err := json.Marshal(file.Texts)
	if err != nil {
		panic("ainotice: " + err.Error())
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
