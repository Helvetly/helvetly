package aimodel

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type openAI struct {
	key, url string
	card     RateCard
	client   *http.Client
}

// NewOpenAI keeps credentials on the server. baseURL is the API root of OpenAI or a compatible gateway
// (https://api.openai.com/v1, validated at startup); model is one of Cards (validated at startup), asked for at its
// card's tier, never upgraded to a faster or dearer one.
func NewOpenAI(key, baseURL, model string) Provider {
	if key == "" {
		return nil
	}
	return &openAI{key: key, card: Cards[model], url: baseURL + "/responses", client: &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

type inputPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"`
	FileData string `json:"file_data,omitempty"`
	Filename string `json:"filename,omitempty"`
}
type inputMessage struct {
	Role    string      `json:"role"`
	Content []inputPart `json:"content"`
}

type responseInput struct {
	Model           string         `json:"model"`
	Store           bool           `json:"store"`
	Instructions    string         `json:"instructions"`
	Input           []inputMessage `json:"input"`
	MaxOutputTokens int64          `json:"max_output_tokens"`
	ServiceTier     string         `json:"service_tier"`
	Text            *textOptions   `json:"text,omitempty"`
}

type textOptions struct {
	Format struct {
		Type   string         `json:"type"`
		Name   string         `json:"name"`
		Schema map[string]any `json:"schema"`
		Strict bool           `json:"strict"`
	} `json:"format"`
}

func (p *openAI) input(in Request) responseInput {
	input := []inputMessage{}
	for _, m := range in.History {
		if m.Role == "user" || m.Role == "assistant" {
			kind := "input_text"
			if m.Role == "assistant" {
				kind = "output_text"
			}
			input = append(input, inputMessage{Role: m.Role, Content: []inputPart{{Type: kind, Text: m.Text}}})
		}
	}
	parts := []inputPart{{Type: "input_text", Text: in.Message}}
	for _, f := range in.Files {
		data := "data:" + f.ContentType + ";base64," + base64.StdEncoding.EncodeToString(f.Bytes)
		if f.ContentType == "application/pdf" {
			parts = append(parts, inputPart{Type: "input_file", FileData: data, Filename: f.Name})
		} else {
			parts = append(parts, inputPart{Type: "input_image", ImageURL: data})
		}
	}
	input = append(input, inputMessage{Role: "user", Content: parts})
	out := responseInput{Model: p.card.Model, ServiceTier: p.card.Tier, Store: false, Instructions: in.Instructions, Input: input, MaxOutputTokens: in.MaxOutputTokens}
	if in.Schema != nil {
		out.Text = &textOptions{}
		out.Text.Format.Type, out.Text.Format.Name, out.Text.Format.Schema, out.Text.Format.Strict = "json_schema", in.Schema.Name, in.Schema.JSON, true
	}
	return out
}

func (p *openAI) Answer(ctx context.Context, in Request) (Reply, error) {
	body := p.input(in)
	b, err := json.Marshal(body)
	if err != nil {
		return Reply{}, err
	}
	r, err := http.NewRequestWithContext(ctx, "POST", p.url, bytes.NewReader(b))
	if err != nil {
		return Reply{}, err
	}
	r.Header.Set("Authorization", "Bearer "+p.key)
	r.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(r)
	if err != nil {
		return Reply{}, transportError(err)
	}
	defer resp.Body.Close()
	zero := int64(0)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		reply := Reply{}
		if resp.StatusCode >= 400 && resp.StatusCode < 500 { // refused before generating: nothing billed
			reply.Tokens, reply.Usage = &zero, &Usage{Model: p.card.Model, Tier: p.card.Tier}
		}
		return reply, statusError(resp)
	}
	failed := &ProviderError{HTTPStatus: resp.StatusCode, RequestID: resp.Header.Get("x-request-id")}
	b, err = io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
	if err != nil || len(b) > 2<<20 {
		failed.Kind, failed.Err = FailInvalid, errors.New("the response is unreadable or too large")
		return Reply{}, failed
	}
	var out struct {
		ID                string `json:"id"`
		Model             string `json:"model"`
		ServiceTier       string `json:"service_tier"`
		Status            string `json:"status"`
		IncompleteDetails *struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type    string `json:"type"`
				Text    string `json:"text"`
				Refusal string `json:"refusal"`
			} `json:"content"`
		} `json:"output"`
		Usage *struct {
			InputTokens  *int64 `json:"input_tokens"`
			OutputTokens *int64 `json:"output_tokens"`
			TotalTokens  *int64 `json:"total_tokens"`
			InputDetails *struct {
				CachedTokens *int64 `json:"cached_tokens"`
			} `json:"input_tokens_details"`
			OutputDetails *struct {
				ReasoningTokens *int64 `json:"reasoning_tokens"`
			} `json:"output_tokens_details"`
		} `json:"usage"`
	}
	if err = json.Unmarshal(b, &out); err != nil {
		failed.Kind, failed.Err = FailInvalid, errors.New("the response is not JSON")
		return Reply{}, failed
	}
	reply := Reply{}
	if u := out.Usage; u != nil {
		reply.Tokens = u.TotalTokens
		// Without every part of the breakdown the call is not priced: its cost is reconciled, never guessed.
		if u.InputTokens != nil && u.OutputTokens != nil && u.InputDetails != nil && u.InputDetails.CachedTokens != nil &&
			u.OutputDetails != nil && u.OutputDetails.ReasoningTokens != nil {
			reply.Usage = &Usage{Input: *u.InputTokens, CachedInput: *u.InputDetails.CachedTokens, Output: *u.OutputTokens,
				Reasoning: *u.OutputDetails.ReasoningTokens, Model: out.Model, Tier: out.ServiceTier, RequestID: out.ID}
		}
	}
	for _, item := range out.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" {
				reply.Text += part.Text
			} else if part.Type == "refusal" {
				reply.Text += part.Refusal
			}
		}
	}
	failed.Status, failed.ResponseID = out.Status, out.ID
	switch {
	case len(reply.Text) > maxReplyBytes:
		failed.Kind, reply.Text = FailEmpty, ""
	case out.Status == "incomplete":
		// Its usage is known and settled; a caller may keep the partial text (Reply.Text) of a cut-short answer.
		failed.Kind = FailIncomplete
		if out.IncompleteDetails != nil {
			failed.Reason = out.IncompleteDetails.Reason
		}
	case out.Status != "completed":
		failed.Kind = FailServer
	case strings.TrimSpace(reply.Text) == "":
		failed.Kind = FailEmpty
	default:
		return reply, nil
	}
	return reply, failed
}

// transportError classifies a request that got no response: its outcome is unknown.
func transportError(err error) error {
	kind := FailNetwork
	if ne, ok := errors.AsType[net.Error](err); errors.Is(err, context.DeadlineExceeded) || ok && ne.Timeout() {
		kind = FailTimeout
	}
	return &ProviderError{Kind: kind, Err: err}
}

// statusError reads an error response's status and OpenAI error object ({"error":{"type","code","message"}}).
func statusError(resp *http.Response) error {
	e := &ProviderError{HTTPStatus: resp.StatusCode, RequestID: resp.Header.Get("x-request-id")}
	var body struct {
		Error struct {
			Type    string `json:"type"`
			Code    any    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&body) == nil {
		e.Type, e.Message = body.Error.Type, body.Error.Message
		if body.Error.Code != nil {
			e.Code = fmt.Sprint(body.Error.Code)
		}
	}
	switch {
	case resp.StatusCode == http.StatusTooManyRequests && e.Code != "insufficient_quota":
		e.Kind = FailRateLimited
	case resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode == http.StatusUnauthorized,
		resp.StatusCode == http.StatusForbidden, resp.StatusCode == http.StatusNotFound:
		e.Kind = FailConfig // an exhausted account, a wrong key or a model the key may not use
	case resp.StatusCode >= 500:
		e.Kind = FailServer
	default:
		e.Kind = FailRejected
	}
	return e
}

// InputTokens uses the official count endpoint with the identical input before starting generation.
func (p *openAI) InputTokens(ctx context.Context, in Request) (int64, error) {
	input := p.input(in)
	body := struct {
		Model        string         `json:"model"`
		Instructions string         `json:"instructions"`
		Input        []inputMessage `json:"input"`
		Text         *textOptions   `json:"text,omitempty"`
	}{input.Model, input.Instructions, input.Input, input.Text}
	b, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	r, err := http.NewRequestWithContext(ctx, "POST", p.url+"/input_tokens", bytes.NewReader(b))
	if err != nil {
		return 0, err
	}
	r.Header.Set("Authorization", "Bearer "+p.key)
	r.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(r)
	if err != nil {
		return 0, transportError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, statusError(resp)
	}
	var out struct {
		Object      string `json:"object"`
		InputTokens *int64 `json:"input_tokens"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&out); err != nil || out.Object != "response.input_tokens" || out.InputTokens == nil || *out.InputTokens < 0 {
		return 0, &ProviderError{Kind: FailInvalid, HTTPStatus: resp.StatusCode, RequestID: resp.Header.Get("x-request-id"), Err: errors.New("the input count is invalid")}
	}
	return *out.InputTokens, nil
}

func (p *openAI) Card() RateCard { return p.card }
