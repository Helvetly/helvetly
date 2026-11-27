package calsync

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"

	"helvetly.com/api/internal/store"
)

// Provider errors the jobs act on.
var (
	// errAuth: the provider refused the token (401) or the refresh token (invalid_grant): the connection is revoked.
	errAuth = errors.New("calendar access revoked")
	// errGone: the event or subscription is not there (404, 410).
	errGone = errors.New("calendar item gone")
	// errSyncExpired: the sync token or delta link is no longer valid; a full sync starts again.
	errSyncExpired = errors.New("calendar sync token expired")
	// errRateLimited: the provider asked to slow down (429, 503), or did shortly before.
	errRateLimited = errors.New("calendar provider rate limited")
)

// account is the calendar account an OAuth exchange connected.
type account struct {
	Subject, Email string
	Scopes         []string
}

type calendar struct {
	ID, Name string
	Primary  bool
	Color    string // "#rrggbb", or empty
}

var hexColorRe = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// hexColor is a provider's calendar colour as "#rrggbb", or empty when it is anything else.
func hexColor(raw string) string {
	c := strings.ToLower(strings.TrimSpace(raw))
	if !hexColorRe.MatchString(c) {
		return ""
	}
	return c
}

// event is a session as pushed to the host's calendar.
type event struct {
	Summary, Description, Location string
	Start, End                     time.Time
	WorkspaceID, OccurrenceID      string
	Meeting                        bool // ask for a Meet or Teams link (on creation)
}

type pushed struct{ ID, ETag, MeetingURL string }

// change is one event of an imported calendar.
type change struct {
	ID         string
	Start, End time.Time
	Busy       bool   // takes the host's time (not free, not cancelled)
	Removed    bool   // cancelled or deleted
	Workspace  string // a Helvetly event's workspace (its private property), "" for others
	Occurrence string
}

type changes struct {
	Items []change
	Token string // the next sync token or delta link
}

// session is one connection's access to its provider: calls are spaced and paused per connection.
type session struct{ id, access string }

// provider is Google Calendar or Microsoft Graph, as the jobs and handlers use them.
type provider interface {
	name() string
	oauth() *oauth2.Config
	authOptions() []oauth2.AuthCodeOption
	// account reads the exchanged token's ID token (straight from the token endpoint over TLS, so its signature
	// need not be checked: OpenID Connect Core 3.1.3.7) and its granted scopes.
	account(tok *oauth2.Token, nonce string, now time.Time) (account, error)
	scopesOK(granted []string) bool
	revoke(ctx context.Context, refresh string) error
	calendars(ctx context.Context, s session) ([]calendar, error)
	create(ctx context.Context, s session, cal string, ev event) (pushed, error)
	update(ctx context.Context, s session, cal, id string, ev event) (pushed, error)
	remove(ctx context.Context, s session, cal, id string) error
	changes(ctx context.Context, s session, cal, token string, now time.Time) (changes, error)
	watch(ctx context.Context, s session, cal, id, secret string, now time.Time) (providerID, resourceID string, expires time.Time, err error)
	unwatch(ctx context.Context, s session, w store.CalendarWatch) error
}

// client is the HTTP side shared by both providers: JSON calls, per-connection spacing and a pause on 429 or 503.
type client struct {
	http *http.Client
	gap  time.Duration // between calls of one connection
	// webhook is where change notifications go; "" = none (no public https PUBLIC_URL): polling only.
	webhook string

	mu          sync.Mutex
	last        map[string]time.Time
	pausedUntil time.Time
}

func newClient(gap time.Duration, webhook string) *client {
	return &client{http: &http.Client{Timeout: 20 * time.Second}, gap: gap, webhook: webhook, last: map[string]time.Time{}}
}

const defaultPause = 30 * time.Second

func (c *client) wait(ctx context.Context, key string) error {
	c.mu.Lock()
	now := time.Now()
	if now.Before(c.pausedUntil) {
		c.mu.Unlock()
		return errRateLimited
	}
	next := c.last[key].Add(c.gap)
	if next.Before(now) {
		next = now
	}
	c.last[key] = next
	if len(c.last) > 10000 { // forget idle connections
		for k, t := range c.last {
			if t.Before(now.Add(-time.Minute)) {
				delete(c.last, k)
			}
		}
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Until(next)):
		return nil
	}
}

func (c *client) pause(retryAfter string) {
	wait := defaultPause
	if s, err := strconv.Atoi(retryAfter); err == nil && s > 0 {
		wait = min(time.Duration(s)*time.Second, time.Hour)
	}
	c.mu.Lock()
	c.pausedUntil = time.Now().Add(wait)
	c.mu.Unlock()
}

// call sends body as JSON to url (absolute) and decodes the answer into out. Status classes become the errors above.
func (c *client) call(ctx context.Context, s session, method, url string, body, out any, header map[string]string) error {
	if err := c.wait(ctx, s.id); err != nil {
		return err
	}
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if s.access != "" {
		req.Header.Set("Authorization", "Bearer "+s.access)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	switch {
	case res.StatusCode == http.StatusTooManyRequests || res.StatusCode == http.StatusServiceUnavailable:
		c.pause(res.Header.Get("Retry-After"))
		return errRateLimited
	case res.StatusCode == http.StatusUnauthorized:
		return errAuth
	case res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone:
		return fmt.Errorf("%s %s: %d: %w", method, path(url), res.StatusCode, errGone)
	case res.StatusCode >= 300:
		return fmt.Errorf("%s %s: %d %s", method, path(url), res.StatusCode, snippet(raw))
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// path drops the query (sync tokens, delta links) from a URL in an error.
func path(url string) string {
	p, _, _ := strings.Cut(url, "?")
	return p
}

func snippet(raw []byte) string {
	if len(raw) > 200 {
		raw = raw[:200]
	}
	return strings.TrimSpace(string(raw))
}

// idClaims reads the payload of an ID token received from the token endpoint and checks its audience, nonce and expiry.
func idClaims(tok *oauth2.Token, clientID, nonce string, now time.Time, into any) error {
	raw, _ := tok.Extra("id_token").(string)
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return errors.New("no id token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("id token: %w", err)
	}
	var std struct {
		Aud   any    `json:"aud"`
		Nonce string `json:"nonce"`
		Exp   int64  `json:"exp"`
	}
	if err := json.Unmarshal(payload, &std); err != nil {
		return fmt.Errorf("id token: %w", err)
	}
	aud := false
	switch a := std.Aud.(type) {
	case string:
		aud = a == clientID
	case []any:
		for _, v := range a {
			aud = aud || v == clientID
		}
	}
	switch {
	case !aud:
		return errors.New("id token for another client")
	case std.Nonce != nonce:
		return errors.New("id token of another sign-in")
	case std.Exp != 0 && now.Unix() > std.Exp+300:
		return errors.New("id token expired")
	}
	return json.Unmarshal(payload, into)
}

func grantedScopes(tok *oauth2.Token) []string {
	s, _ := tok.Extra("scope").(string)
	return strings.Fields(s)
}

// externalID is how a link or busy block names an event: its calendar and its id, since an event id is only unique
// within its calendar (Google) and a link must find the calendar an event was pushed to after the push calendar changed.
func externalID(cal, id string) string { return cal + "|" + id }

func splitExternal(ext string) (cal, id string) {
	cal, id, _ = strings.Cut(ext, "|")
	return cal, id
}
