// Package aimodel is the external AI model shared by Heidi and AI import: the provider interface, the OpenAI
// Responses client and the workspace's monthly token budget with its at-most-once rule (docs/heidi-contract.md).
package aimodel

import (
	"context"
	"errors"
	"fmt"
	"time"
)

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

// Tokens (input + output) is nil when the provider outcome cannot be accounted for, including timeouts. Usage is the
// breakdown the call is priced by; nil when the provider reported only a total.
type Reply struct {
	Text   string
	Tokens *int64
	Usage  *Usage
}

type Provider interface {
	Answer(context.Context, Request) (Reply, error)
	InputTokens(context.Context, Request) (int64, error)
	// Card prices the provider's model; calls are reserved and settled by it.
	Card() RateCard
}

// Reasons a provider call failed: Kind of ProviderError, stored on its ai_calls row.
const (
	FailRateLimited = "rate_limited" // 429: the provider is busy; try again shortly
	FailOverloaded  = "overloaded"   // 503 "model overloaded": refused before generating; try again shortly
	FailConfig      = "config"       // credentials, model or the provider account (401, 403, 404, insufficient_quota)
	FailRejected    = "rejected"     // another 4xx: the provider refused this request
	FailServer      = "server"       // 5xx
	FailTimeout     = "timeout"
	FailNetwork     = "network"
	FailIncomplete  = "incomplete" // the response stopped early; Reason says why (max_output_tokens, content_filter)
	FailEmpty       = "empty"      // completed without text, or with more than a reply may hold
	FailInvalid     = "invalid"    // the response was not the JSON the API documents
)

// ProviderError says why a provider call failed, for the log and the caller's answer. It never holds the prompt, the
// answer or the key.
type ProviderError struct {
	Kind       string
	HTTPStatus int
	// Type, Code and Message are the provider's error object.
	Type, Code, Message string
	// Status is the response's status, Reason its incomplete_details.reason.
	Status, Reason string
	// RequestID is the provider's x-request-id, ResponseID the response's id.
	RequestID, ResponseID string
	// RetryAfter is the provider's Retry-After on a rate limit or an overload, capped at maxRetryWait; 0 = none.
	RetryAfter time.Duration
	Err        error
}

func (e *ProviderError) Error() string {
	s := "model provider: " + e.Kind
	if e.Reason != "" {
		s += " (" + e.Reason + ")"
	}
	if e.HTTPStatus != 0 {
		s += fmt.Sprintf(" HTTP %d", e.HTTPStatus)
	}
	if e.Code != "" || e.Message != "" {
		s += ": " + e.Code + " " + e.Message
	}
	if e.Err != nil {
		s += ": " + e.Err.Error()
	}
	return s
}

func (e *ProviderError) Unwrap() error { return e.Err }

// failure is the short reason stored on the call's row: the kind, and why an incomplete response stopped.
func (e *ProviderError) failure() string {
	if e.Reason != "" {
		return e.Kind + ":" + e.Reason
	}
	return e.Kind
}

// FailureKind is the Kind of the ProviderError within err, "" when there is none.
func FailureKind(err error) string {
	if pe, ok := errors.AsType[*ProviderError](err); ok {
		return pe.Kind
	}
	return ""
}

// Busy says the provider refused the call within err as rate limited or overloaded: nothing was generated or billed.
func Busy(err error) bool {
	k := FailureKind(err)
	return k == FailRateLimited || k == FailOverloaded
}
