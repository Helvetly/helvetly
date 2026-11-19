package customdomains

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"helvetly.com/api/internal/store"
)

// Hostname is what Cloudflare says of one custom hostname.
type Hostname struct {
	ID     string
	Name   string
	Status string // the hostname's: pending, active, moved, blocked, deleted, …
	SSL    string // its certificate's: initializing, pending_validation, …, active, validation_timed_out, …
	// Records are the TXT records Cloudflare asks for (ownership, certificate validation), besides the CNAME.
	Records []store.DomainRecord
	// Errors are Cloudflare's verification and validation errors, for the settings' "Problem: …".
	Errors []string
}

// Cloudflare is the part of the Cloudflare API custom domains use: custom hostnames on one zone.
type Cloudflare interface {
	Create(ctx context.Context, hostname string) (Hostname, error)
	Get(ctx context.Context, id string) (Hostname, error)
	Delete(ctx context.Context, id string) error
	// List is every custom hostname of the zone, listPage at a time: the daily check of active domains.
	List(ctx context.Context) ([]Hostname, error)
}

var (
	// ErrNotFound: Cloudflare has no such custom hostname.
	ErrNotFound = errors.New("cloudflare: custom hostname not found")
	// ErrDuplicate: the hostname is already a custom hostname on some zone.
	ErrDuplicate = errors.New("cloudflare: custom hostname exists")
	// ErrRateLimited: Cloudflare answered 429; it blocks the token's calls for the next five minutes.
	ErrRateLimited = errors.New("cloudflare: rate limited")
)

// callGap spaces the process's calls to at most 600 per five minutes: half of the 1200 Cloudflare allows per user,
// leaving the rest to Terraform and the dashboard.
const callGap = 500 * time.Millisecond

// listPage is the largest page of the custom hostnames list: 50 000 domains are 50 calls.
const listPage = 1000

type client struct {
	base, zone, token string
	http              *http.Client

	mu   sync.Mutex
	last time.Time
}

// NewCloudflare talks to apiURL (https://api.cloudflare.com/client/v4) about the custom hostnames of zoneID.
func NewCloudflare(apiURL, zoneID, token string) Cloudflare {
	return &client{base: strings.TrimSuffix(apiURL, "/"), zone: zoneID, token: token, http: &http.Client{Timeout: 20 * time.Second}}
}

// wait keeps callGap between calls, or returns when ctx ends.
func (c *client) wait(ctx context.Context) error {
	c.mu.Lock()
	next := c.last.Add(callGap)
	now := time.Now()
	if next.Before(now) {
		next = now
	}
	c.last = next
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Until(next)):
		return nil
	}
}

type apiHostname struct {
	ID     string `json:"id"`
	Name   string `json:"hostname"`
	Status string `json:"status"`
	SSL    struct {
		Status            string `json:"status"`
		ValidationRecords []struct {
			TXTName  string `json:"txt_name"`
			TXTValue string `json:"txt_value"`
		} `json:"validation_records"`
		ValidationErrors []struct {
			Message string `json:"message"`
		} `json:"validation_errors"`
	} `json:"ssl"`
	Ownership struct {
		Type  string `json:"type"`
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"ownership_verification"`
	VerificationErrors []string `json:"verification_errors"`
}

func (h apiHostname) hostname() Hostname {
	out := Hostname{ID: h.ID, Name: h.Name, Status: h.Status, SSL: h.SSL.Status, Errors: h.VerificationErrors}
	if h.Ownership.Type == "txt" && h.Ownership.Name != "" {
		out.Records = append(out.Records, store.DomainRecord{Type: "TXT", Name: h.Ownership.Name, Value: h.Ownership.Value})
	}
	for _, r := range h.SSL.ValidationRecords {
		if r.TXTName != "" {
			out.Records = append(out.Records, store.DomainRecord{Type: "TXT", Name: r.TXTName, Value: r.TXTValue})
		}
	}
	for _, e := range h.SSL.ValidationErrors {
		out.Errors = append(out.Errors, e.Message)
	}
	return out
}

func (c *client) Create(ctx context.Context, hostname string) (Hostname, error) {
	body := map[string]any{"hostname": hostname, "ssl": map[string]any{"method": "http", "type": "dv",
		"settings": map[string]string{"min_tls_version": "1.2"}}}
	var h apiHostname
	err := c.call(ctx, http.MethodPost, "", body, &h)
	return h.hostname(), err
}

func (c *client) Get(ctx context.Context, id string) (Hostname, error) {
	var h apiHostname
	err := c.call(ctx, http.MethodGet, "/"+url.PathEscape(id), nil, &h)
	return h.hostname(), err
}

// Delete removes the custom hostname; one already gone is no error.
func (c *client) Delete(ctx context.Context, id string) error {
	err := c.call(ctx, http.MethodDelete, "/"+url.PathEscape(id), nil, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

func (c *client) List(ctx context.Context) ([]Hostname, error) {
	var all []Hostname
	for page := 1; ; page++ {
		var hs []apiHostname
		if err := c.call(ctx, http.MethodGet, fmt.Sprintf("?page=%d&per_page=%d", page, listPage), nil, &hs); err != nil {
			return nil, err
		}
		for _, h := range hs {
			all = append(all, h.hostname())
		}
		if len(hs) < listPage {
			return all, nil
		}
	}
}

// duplicateCode is Cloudflare's "Duplicate custom hostname found".
const duplicateCode = 1406

func (c *client) call(ctx context.Context, method, path string, in, out any) error {
	if err := c.wait(ctx); err != nil {
		return err
	}
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/zones/"+url.PathEscape(c.zone)+"/custom_hostnames"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("cloudflare %s custom hostname: %w", method, err)
	}
	defer resp.Body.Close()
	var env struct {
		Success bool `json:"success"`
		Errors  []struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&env); err != nil && resp.StatusCode < 300 {
		return fmt.Errorf("cloudflare %s custom hostname: reading the answer: %w", method, err)
	}
	switch resp.StatusCode {
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusTooManyRequests:
		return ErrRateLimited
	}
	if resp.StatusCode >= 300 || !env.Success {
		msgs := make([]string, 0, len(env.Errors))
		for _, e := range env.Errors {
			if e.Code == duplicateCode {
				return ErrDuplicate
			}
			msgs = append(msgs, fmt.Sprintf("%d %s", e.Code, e.Message))
		}
		return fmt.Errorf("cloudflare %s custom hostname: HTTP %d: %s", method, resp.StatusCode, strings.Join(msgs, "; "))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(env.Result, out)
}
