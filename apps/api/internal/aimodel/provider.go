// Package aimodel is the external AI model shared by Heidi and AI import: the provider interface, the OpenAI
// Responses client and the workspace's monthly token budget with its at-most-once rule (docs/heidi-contract.md).
package aimodel

import "context"

// maxReplyBytes bounds a reply's text: a structured extraction of a long spreadsheet chunk is the largest.
const maxReplyBytes = 256 << 10

type File struct {
	Name, ContentType string
	Bytes             []byte
}

// Turn is an earlier message of a conversation; only its text is sent, never its attachments.
type Turn struct {
	Role, Text string
}

// Schema asks for a JSON answer matching JSON (OpenAI strict structured outputs).
type Schema struct {
	Name string
	JSON map[string]any
}

type Request struct {
	Instructions    string
	History         []Turn
	Message         string
	Files           []File
	Schema          *Schema
	MaxOutputTokens int64
}

// Tokens is nil when the provider outcome cannot be accounted for, including timeouts.
type Reply struct {
	Text   string
	Tokens *int64
}

type Provider interface {
	Answer(context.Context, Request) (Reply, error)
	InputTokens(context.Context, Request) (int64, error)
}
