package aimodel

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type openAI struct {
	key, model, url string
	client          *http.Client
}

// NewOpenAI keeps credentials on the server. baseURL is the API root of OpenAI or a compatible gateway
// (https://api.openai.com/v1, validated at startup).
func NewOpenAI(key, baseURL, model string) Provider {
	if key == "" {
		return nil
	}
	return &openAI{key: key, model: model, url: baseURL + "/responses", client: &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
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
	out := responseInput{Model: p.model, Store: false, Instructions: in.Instructions, Input: input, MaxOutputTokens: in.MaxOutputTokens}
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
		return Reply{}, fmt.Errorf("OpenAI request failed: %w", err)
	}
	defer resp.Body.Close()
	zero := int64(0)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		reply := Reply{}
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			reply.Tokens = &zero
		}
		return reply, fmt.Errorf("OpenAI returned HTTP %d", resp.StatusCode)
	}
	b, err = io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
	if err != nil || len(b) > 2<<20 {
		return Reply{}, errors.New("OpenAI response is unreadable or too large")
	}
	var out struct {
		Status string `json:"status"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type    string `json:"type"`
				Text    string `json:"text"`
				Refusal string `json:"refusal"`
			} `json:"content"`
		} `json:"output"`
		Usage *struct {
			TotalTokens *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	if err = json.Unmarshal(b, &out); err != nil {
		return Reply{}, errors.New("OpenAI returned invalid JSON")
	}
	reply := Reply{}
	if out.Usage != nil {
		reply.Tokens = out.Usage.TotalTokens
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
	if out.Status != "completed" || strings.TrimSpace(reply.Text) == "" || len(reply.Text) > maxReplyBytes {
		return reply, errors.New("OpenAI did not return a complete text response")
	}
	return reply, nil
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
		return 0, fmt.Errorf("OpenAI input count failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("OpenAI input count returned HTTP %d", resp.StatusCode)
	}
	var out struct {
		Object      string `json:"object"`
		InputTokens *int64 `json:"input_tokens"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&out); err != nil || out.Object != "response.input_tokens" || out.InputTokens == nil || *out.InputTokens < 0 {
		return 0, errors.New("OpenAI input count was invalid")
	}
	return *out.InputTokens, nil
}
