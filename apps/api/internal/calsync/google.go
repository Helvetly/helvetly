package calsync

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"helvetly.com/api/internal/store"
)

// Google Calendar: events pushed with sendUpdates=none and no attendees, marked by private extended properties; busy
// times through events.list with a syncToken; change hints through events.watch channels.

const (
	scopeEvents   = "https://www.googleapis.com/auth/calendar.events"
	scopeCalList  = "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
	googleWatchTL = 7 * 24 * time.Hour
	// googleGap keeps a connection under Google's 5 requests a second per user.
	googleGap = 200 * time.Millisecond
	// meetPoll: how often a pending Meet link is asked for again while the request's 10 s run.
	meetPoll = time.Second
)

type google struct {
	*client
	cfg    oauth2.Config
	api    string // …/calendar/v3
	revURL string
}

// newGoogle talks to Google, or with root set to a fake serving every endpoint under it.
func newGoogle(clientID, secret, redirect, root, webhook string) *google {
	ep := oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"}
	api, rev := "https://www.googleapis.com/calendar/v3", "https://oauth2.googleapis.com/revoke"
	if root != "" {
		ep = oauth2.Endpoint{AuthURL: root + "/auth", TokenURL: root + "/token"}
		api, rev = root+"/calendar/v3", root+"/revoke"
	}
	ep.AuthStyle = oauth2.AuthStyleInParams
	return &google{client: newClient(googleGap, webhook), api: api, revURL: rev, cfg: oauth2.Config{ClientID: clientID, ClientSecret: secret,
		RedirectURL: redirect, Endpoint: ep, Scopes: []string{"openid", "email", scopeEvents, scopeCalList}}}
}

func (g *google) name() string          { return "google" }
func (g *google) oauth() *oauth2.Config { return &g.cfg }
func (g *google) authOptions() []oauth2.AuthCodeOption {
	return []oauth2.AuthCodeOption{oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("include_granted_scopes", "true")}
}

func (g *google) account(tok *oauth2.Token, nonce string, now time.Time) (account, error) {
	var c struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	if err := idClaims(tok, g.cfg.ClientID, nonce, now, &c); err != nil {
		return account{}, err
	}
	if c.Sub == "" || c.Email == "" || !c.EmailVerified {
		return account{}, errors.New("google: no verified email in the id token")
	}
	return account{Subject: c.Sub, Email: strings.ToLower(c.Email), Scopes: grantedScopes(tok)}, nil
}

func (g *google) scopesOK(granted []string) bool {
	return slices.Contains(granted, scopeEvents) && slices.Contains(granted, scopeCalList)
}

func (g *google) revoke(ctx context.Context, refresh string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.revURL, strings.NewReader(url.Values{"token": {refresh}}.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := g.http.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusBadRequest { // 400: already revoked or expired
		return fmt.Errorf("google revoke: %d", res.StatusCode)
	}
	return nil
}

func (g *google) calendars(ctx context.Context, s session) ([]calendar, error) {
	var out []calendar
	page := ""
	for {
		var res struct {
			Items []struct {
				ID, Summary, SummaryOverride string
				Primary                      bool
			} `json:"items"`
			NextPageToken string `json:"nextPageToken"`
		}
		q := url.Values{"minAccessRole": {"reader"}, "maxResults": {"250"}}
		if page != "" {
			q.Set("pageToken", page)
		}
		if err := g.call(ctx, s, http.MethodGet, g.api+"/users/me/calendarList?"+q.Encode(), nil, &res, nil); err != nil {
			return nil, err
		}
		for _, c := range res.Items {
			out = append(out, calendar{ID: c.ID, Name: cmpOr(c.SummaryOverride, c.Summary, c.ID), Primary: c.Primary})
		}
		if page = res.NextPageToken; page == "" {
			return out, nil
		}
	}
}

type gTime struct {
	DateTime string `json:"dateTime,omitempty"`
	Date     string `json:"date,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}

type gEvent struct {
	ID                 string       `json:"id,omitempty"`
	ETag               string       `json:"etag,omitempty"`
	Status             string       `json:"status,omitempty"`
	Summary            string       `json:"summary,omitempty"`
	Description        string       `json:"description,omitempty"`
	Location           string       `json:"location,omitempty"`
	Start              *gTime       `json:"start,omitempty"`
	End                *gTime       `json:"end,omitempty"`
	Transparency       string       `json:"transparency,omitempty"`
	ExtendedProperties *gProps      `json:"extendedProperties,omitempty"`
	ConferenceData     *gConference `json:"conferenceData,omitempty"`
	HangoutLink        string       `json:"hangoutLink,omitempty"`
}

type gProps struct {
	Private map[string]string `json:"private,omitempty"`
}

type gCreateRequest struct {
	RequestID             string            `json:"requestId,omitempty"`
	ConferenceSolutionKey map[string]string `json:"conferenceSolutionKey,omitempty"`
	Status                *struct {
		StatusCode string `json:"statusCode"`
	} `json:"status,omitempty"`
}

type gConference struct {
	CreateRequest *gCreateRequest `json:"createRequest,omitempty"`
	EntryPoints   []struct {
		EntryPointType string `json:"entryPointType"`
		URI            string `json:"uri"`
	} `json:"entryPoints,omitempty"`
}

func (c *gConference) video() string {
	if c == nil {
		return ""
	}
	for _, e := range c.EntryPoints {
		if e.EntryPointType == "video" {
			return e.URI
		}
	}
	return ""
}

// Private extended properties that mark a Helvetly event, with its workspace, so a calendar connected in two
// workspaces never takes one's session for the other's.
const (
	propOccurrence = "helvetly_occurrence"
	propWorkspace  = "helvetly_workspace"
)

func (g *google) body(ev event) gEvent {
	return gEvent{Summary: ev.Summary, Description: ev.Description, Location: ev.Location, Transparency: "opaque",
		Start:              &gTime{DateTime: ev.Start.UTC().Format(time.RFC3339), TimeZone: "UTC"},
		End:                &gTime{DateTime: ev.End.UTC().Format(time.RFC3339), TimeZone: "UTC"},
		ExtendedProperties: &gProps{Private: map[string]string{propOccurrence: ev.OccurrenceID, propWorkspace: ev.WorkspaceID}}}
}

func (g *google) events(cal string) string {
	return g.api + "/calendars/" + url.PathEscape(cal) + "/events"
}

func (g *google) create(ctx context.Context, s session, cal string, ev event) (pushed, error) {
	b := g.body(ev)
	q := url.Values{"sendUpdates": {"none"}}
	if ev.Meeting {
		b.ConferenceData = &gConference{CreateRequest: &gCreateRequest{RequestID: rand.Text(),
			ConferenceSolutionKey: map[string]string{"type": "hangoutsMeet"}}}
		q.Set("conferenceDataVersion", "1")
	}
	var res gEvent
	if err := g.call(ctx, s, http.MethodPost, g.events(cal)+"?"+q.Encode(), b, &res, nil); err != nil {
		return pushed{}, err
	}
	out := pushed{ID: res.ID, ETag: res.ETag, MeetingURL: cmpOr(res.HangoutLink, res.ConferenceData.video())}
	// Meet links are made asynchronously: ask again until it is there or the caller's time runs out.
	for ev.Meeting && out.MeetingURL == "" {
		select {
		case <-ctx.Done():
			return out, nil
		case <-time.After(meetPoll):
		}
		if err := g.call(ctx, s, http.MethodGet, g.events(cal)+"/"+url.PathEscape(res.ID), nil, &res, nil); err != nil {
			return out, nil
		}
		if st := res.ConferenceData; st != nil && st.CreateRequest != nil && st.CreateRequest.Status != nil &&
			st.CreateRequest.Status.StatusCode == "failure" {
			return out, nil
		}
		out.MeetingURL = cmpOr(res.HangoutLink, res.ConferenceData.video())
	}
	return out, nil
}

func (g *google) update(ctx context.Context, s session, cal, id string, ev event) (pushed, error) {
	var res gEvent
	err := g.call(ctx, s, http.MethodPatch, g.events(cal)+"/"+url.PathEscape(id)+"?sendUpdates=none", g.body(ev), &res, nil)
	if err == nil && res.Status == "cancelled" { // patching an event deleted outside brings it back: it was gone
		return pushed{}, errGone
	}
	return pushed{ID: id, ETag: res.ETag}, err
}

func (g *google) remove(ctx context.Context, s session, cal, id string) error {
	err := g.call(ctx, s, http.MethodDelete, g.events(cal)+"/"+url.PathEscape(id)+"?sendUpdates=none", nil, nil, nil)
	if errors.Is(err, errGone) {
		return nil
	}
	return err
}

// changes lists the calendar's events since token, or (token "") from a day ago on, with the next sync token.
func (g *google) changes(ctx context.Context, s session, cal, token string, now time.Time) (changes, error) {
	var out changes
	page := ""
	for {
		q := url.Values{"singleEvents": {"true"}, "maxResults": {"2500"}}
		if token != "" {
			q.Set("syncToken", token)
		} else {
			q.Set("timeMin", now.Add(-24*time.Hour).UTC().Format(time.RFC3339))
		}
		if page != "" {
			q.Set("pageToken", page)
		}
		var res struct {
			TimeZone      string   `json:"timeZone"`
			Items         []gEvent `json:"items"`
			NextPageToken string   `json:"nextPageToken"`
			NextSyncToken string   `json:"nextSyncToken"`
		}
		err := g.call(ctx, s, http.MethodGet, g.events(cal)+"?"+q.Encode(), nil, &res, nil)
		if errors.Is(err, errGone) && token != "" {
			return changes{}, errSyncExpired
		}
		if err != nil {
			return changes{}, err
		}
		zone, _ := time.LoadLocation(res.TimeZone)
		for _, e := range res.Items {
			out.Items = append(out.Items, e.change(zone))
		}
		if page = res.NextPageToken; page == "" {
			out.Token = res.NextSyncToken
			return out, nil
		}
	}
}

func (e gEvent) change(zone *time.Location) change {
	c := change{ID: e.ID, Removed: e.Status == "cancelled", Busy: e.Transparency != "transparent"}
	if e.ExtendedProperties != nil {
		c.Workspace, c.Occurrence = e.ExtendedProperties.Private[propWorkspace], e.ExtendedProperties.Private[propOccurrence]
	}
	var ok1, ok2 bool
	c.Start, ok1 = e.Start.instant(zone)
	c.End, ok2 = e.End.instant(zone)
	if !ok1 || !ok2 || !c.End.After(c.Start) {
		c.Busy = false
	}
	return c
}

// instant is a timed start or end, or an all-day date's midnight in the calendar's zone (UTC when unknown).
func (t *gTime) instant(zone *time.Location) (time.Time, bool) {
	if t == nil {
		return time.Time{}, false
	}
	if t.DateTime != "" {
		v, err := time.Parse(time.RFC3339, t.DateTime)
		return v.UTC(), err == nil
	}
	if zone == nil {
		zone = time.UTC
	}
	v, err := time.ParseInLocation(time.DateOnly, t.Date, zone)
	return v.UTC(), err == nil
}

func (g *google) watch(ctx context.Context, s session, cal, id, secret string, now time.Time) (string, string, time.Time, error) {
	var res struct {
		ResourceID string `json:"resourceId"`
		Expiration string `json:"expiration"`
	}
	body := map[string]any{"id": id, "type": "web_hook", "address": g.webhook + "/google-calendar", "token": secret,
		"params": map[string]string{"ttl": strconv.Itoa(int(googleWatchTL.Seconds()))}}
	if err := g.call(ctx, s, http.MethodPost, g.events(cal)+"/watch", body, &res, nil); err != nil {
		return "", "", time.Time{}, err
	}
	expires := now.Add(googleWatchTL)
	if ms, err := strconv.ParseInt(res.Expiration, 10, 64); err == nil {
		expires = time.UnixMilli(ms).UTC()
	}
	return id, res.ResourceID, expires, nil
}

func (g *google) unwatch(ctx context.Context, s session, w store.CalendarWatch) error {
	body := map[string]string{"id": w.ProviderID}
	if w.ResourceID != nil {
		body["resourceId"] = *w.ResourceID
	}
	err := g.call(ctx, s, http.MethodPost, g.api+"/channels/stop", body, nil, nil)
	if errors.Is(err, errGone) {
		return nil
	}
	return err
}

func cmpOr(vs ...string) string {
	for _, v := range vs {
		if v != "" {
			return v
		}
	}
	return ""
}
