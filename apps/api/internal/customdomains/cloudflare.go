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
	"strconv"
	"strings"
	"sync"
	"time"
)

// Hostname is what Cloudflare says of one custom hostname.
type Hostname struct {
	ID     string
	Name   string
	Status string // the hostname's: pending, active, moved, blocked, deleted, …
	SSL    string // its certificate's: initializing, pending_validation, …, active, validation_timed_out, …
	// OwnershipName and OwnershipValue are the TXT record that proves the domain is the customer's
	// (_cf-custom-hostname.<host>); empty when Cloudflare names none.
	OwnershipName, OwnershipValue string
	// Errors are Cloudflare's verification and validation errors, for the settings' "Problem: …".
	Errors    []string
	CreatedAt time.Time
}

// Cloudflare is the part of the Cloudflare API custom domains use: custom hostnames on one zone.
type Cloudflare interface {
	Create(ctx context.Context, hostname string) (Hostname, error)
	Get(ctx context.Context, id string) (Hostname, error)
	// Refresh asks Cloudflare to validate the hostname and its certificate again now (a PATCH with the settings it
	// was created with), for a domain still on its way: Cloudflare otherwise retries on a growing backoff.
	Refresh(ctx context.Context, id string) (Hostname, error)
	// Find is the zone's custom hostname named hostname; ErrNotFound when the zone has none.
	Find(ctx context.Context, hostname string) (Hostname, error)
	Delete(ctx context.Context, id string) error
	// List calls page with every custom hostname of the zone, one page at a time, until page fails.
	List(ctx context.Context, page func([]Hostname) error) error
}

var (
	// ErrNotFound: Cloudflare has no such custom hostname.
	ErrNotFound = errors.New("cloudflare: custom hostname not found")
	// ErrDuplicate: the hostname is already a custom hostname on some zone.
	ErrDuplicate = errors.New("cloudflare: custom hostname exists")
	// ErrRateLimited: Cloudflare answered 429, or did shortly before; calls wait until it allows them again.
	ErrRateLimited = errors.New("cloudflare: rate limited")
)

const (
	// callGap spaces the process's calls to at most 600 per five minutes: half of the 1200 Cloudflare allows per user
	// (dashboard, API tokens and keys together), leaving the rest to Terraform and people.
	callGap = 500 * time.Millisecond
	// rateLimitPause: after a 429 Cloudflare refuses every call for five minutes, unless Retry-After says otherwise.
	rateLimitPause = 5 * time.Minute
	// listPage is the page size asked for (Cloudflare documents 5 to 1000). The pages are followed by result_info,
	// never by the length of a page, since Cloudflare may answer with fewer.
	listPage = 1000
	// oneLimit and pageLimit cap an answer's size: one hostname is a few KB, a page of listPage some MB.
	oneLimit  = 1 << 20
	pageLimit = 16 << 20
	// maxPages stops a walk whose answers never say how many pages there are and never run out.
	maxPages = 10_000
)

// duplicateCode is Cloudflare's "Duplicate custom hostname found".
const duplicateCode = 1406

type client struct {
	base, zone, token string
	http              *http.Client
	gap               time.Duration // callGap; tests leave it out

	mu          sync.Mutex
	last        time.Time
	pausedUntil time.Time
}

// NewCloudflare talks to apiURL (https://api.cloudflare.com/client/v4) about the custom hostnames of zoneID.
func NewCloudflare(apiURL, zoneID, token string) Cloudflare {
	return &client{base: strings.TrimSuffix(apiURL, "/"), zone: zoneID, token: token, gap: callGap, http: &http.Client{Timeout: 20 * time.Second}}
}

// wait keeps callGap between calls; ErrRateLimited while Cloudflare refuses calls, or ctx's error when it ends.
func (c *client) wait(ctx context.Context) error {
	c.mu.Lock()
	now := time.Now()
	if now.Before(c.pausedUntil) {
		c.mu.Unlock()
		return ErrRateLimited
	}
	next := c.last.Add(c.gap)
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

func (c *client) pause(retryAfter string) {
	wait := rateLimitPause
	if s, err := strconv.Atoi(retryAfter); err == nil && s > 0 {
		wait = time.Duration(s) * time.Second
	}
	c.mu.Lock()
	c.pausedUntil = time.Now().Add(wait)
	c.mu.Unlock()
}

type apiHostname struct {
	ID        string    `json:"id"`
	Name      string    `json:"hostname"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	SSL       struct {
		Status           string `json:"status"`
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
	out := Hostname{ID: h.ID, Name: h.Name, Status: h.Status, SSL: h.SSL.Status, Errors: h.VerificationErrors, CreatedAt: h.CreatedAt}
	if h.Ownership.Type == "txt" && h.Ownership.Name != "" && h.Ownership.Value != "" {
		out.OwnershipName, out.OwnershipValue = strings.ToLower(strings.TrimSuffix(h.Ownership.Name, ".")), h.Ownership.Value
	}
	for _, e := range h.SSL.ValidationErrors {
		out.Errors = append(out.Errors, e.Message)
	}
	return out
}

// sslSettings: a DV certificate validated over HTTP, which Cloudflare completes by itself once the CNAME is in place.
var sslSettings = map[string]any{"method": "http", "type": "dv", "settings": map[string]string{"min_tls_version": "1.2"}}

func (c *client) Create(ctx context.Context, hostname string) (Hostname, error) {
	var h apiHostname
	err := c.call(ctx, http.MethodPost, "", map[string]any{"hostname": hostname, "ssl": sslSettings}, &h, nil)
	return h.hostname(), err
}

func (c *client) Get(ctx context.Context, id string) (Hostname, error) {
	var h apiHostname
	err := c.call(ctx, http.MethodGet, "/"+url.PathEscape(id), nil, &h, nil)
	return h.hostname(), err
}

func (c *client) Refresh(ctx context.Context, id string) (Hostname, error) {
	var h apiHostname
	err := c.call(ctx, http.MethodPatch, "/"+url.PathEscape(id), map[string]any{"ssl": sslSettings}, &h, nil)
	return h.hostname(), err
}

// Delete removes the custom hostname; one already gone is no error.
func (c *client) Delete(ctx context.Context, id string) error {
	err := c.call(ctx, http.MethodDelete, "/"+url.PathEscape(id), nil, nil, nil)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

var errFound = errors.New("found")

func (c *client) Find(ctx context.Context, hostname string) (Hostname, error) {
	var found Hostname
	// The filter is exact on Cloudflare's side; the names are compared again here, so a filter it ignored costs pages,
	// never a wrong answer.
	err := c.pages(ctx, url.Values{"hostname": {hostname}}, func(hs []Hostname) error {
		for _, h := range hs {
			if strings.EqualFold(h.Name, hostname) {
				found = h
				return errFound
			}
		}
		return nil
	})
	switch {
	case errors.Is(err, errFound):
		return found, nil
	case err != nil:
		return Hostname{}, err
	}
	return Hostname{}, ErrNotFound
}

func (c *client) List(ctx context.Context, page func([]Hostname) error) error {
	return c.pages(ctx, url.Values{}, page)
}

// resultInfo is Cloudflare's paging of a list.
type resultInfo struct {
	Page       int `json:"page"`
	TotalPages int `json:"total_pages"`
}

// pages walks the list query matches until result_info says it was the last page, or a page is empty.
func (c *client) pages(ctx context.Context, query url.Values, page func([]Hostname) error) error {
	query.Set("per_page", strconv.Itoa(listPage))
	for n := 1; ; n++ {
		query.Set("page", strconv.Itoa(n))
		var hs []apiHostname
		var info resultInfo
		if err := c.call(ctx, http.MethodGet, "?"+query.Encode(), nil, &hs, &info); err != nil {
			return err
		}
		out := make([]Hostname, len(hs))
		for i, h := range hs {
			out[i] = h.hostname()
		}
		if len(out) > 0 {
			if err := page(out); err != nil {
				return err
			}
		}
		if len(hs) == 0 || (info.TotalPages > 0 && n >= info.TotalPages) || n >= maxPages {
			return nil
		}
	}
}

func (c *client) call(ctx context.Context, method, path string, in, out any, info *resultInfo) error {
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
	limit := int64(oneLimit)
	if info != nil {
		limit = pageLimit
	}
	var env struct {
		Success bool `json:"success"`
		Errors  []struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
		Result     json.RawMessage `json:"result"`
		ResultInfo resultInfo      `json:"result_info"`
	}
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, limit)).Decode(&env)
	switch resp.StatusCode {
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusTooManyRequests:
		c.pause(resp.Header.Get("Retry-After"))
		return ErrRateLimited
	}
	if decodeErr != nil {
		return fmt.Errorf("cloudflare %s custom hostname: HTTP %d, reading the answer: %w", method, resp.StatusCode, decodeErr)
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
	if info != nil {
		*info = env.ResultInfo
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(env.Result, out)
}
