package calsync

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"helvetly.com/api/internal/store"
)

// Microsoft Graph: events pushed without attendees, marked by a single-value extended property; busy times through
// calendarView/delta over now − 1 day … now + 400 days; change hints through subscriptions with lifecycle
// notifications.

const (
	scopeCalendars = "Calendars.ReadWrite"
	// msWatchTTL: just under Graph's 10 080-minute maximum for Outlook resources.
	msWatchTTL = 10070 * time.Minute
	// msGap spaces one connection's calls; Graph's own limits come back as 429 with Retry-After.
	msGap = 100 * time.Millisecond
	// msProperty is the extended property marking a Helvetly event (any fixed GUID of ours).
	msProperty   = "String {6d1b5c2e-4b7a-4f1e-9a51-3f0c2b8e7d41} Name helvetly_occurrence"
	msTimeFormat = "2006-01-02T15:04:05"
)

type microsoft struct {
	*client
	cfg oauth2.Config
	api string // …/v1.0
}

func newMicrosoft(clientID, secret, tenant, redirect, root, webhook string) *microsoft {
	login := "https://login.microsoftonline.com/" + url.PathEscape(tenant) + "/oauth2/v2.0"
	api := "https://graph.microsoft.com/v1.0"
	if root != "" {
		login, api = root, root+"/v1.0"
	}
	return &microsoft{client: newClient(msGap, webhook), api: api, cfg: oauth2.Config{ClientID: clientID, ClientSecret: secret,
		RedirectURL: redirect, Endpoint: oauth2.Endpoint{AuthURL: login + "/authorize", TokenURL: login + "/token", AuthStyle: oauth2.AuthStyleInParams},
		Scopes: []string{"openid", "email", "offline_access", "User.Read", scopeCalendars}}}
}

func (m *microsoft) name() string          { return "microsoft" }
func (m *microsoft) oauth() *oauth2.Config { return &m.cfg }
func (m *microsoft) authOptions() []oauth2.AuthCodeOption {
	return []oauth2.AuthCodeOption{oauth2.SetAuthURLParam("prompt", "select_account")}
}

func (m *microsoft) account(tok *oauth2.Token, nonce string, now time.Time) (account, error) {
	var c struct {
		OID       string `json:"oid"`
		Sub       string `json:"sub"`
		Email     string `json:"email"`
		Preferred string `json:"preferred_username"`
	}
	if err := idClaims(tok, m.cfg.ClientID, nonce, now, &c); err != nil {
		return account{}, err
	}
	email := strings.ToLower(cmpOr(c.Email, c.Preferred))
	subject := cmpOr(c.OID, c.Sub)
	if subject == "" || !strings.Contains(email, "@") {
		return account{}, errors.New("microsoft: no account email in the id token")
	}
	return account{Subject: subject, Email: email, Scopes: grantedScopes(tok)}, nil
}

// scopesOK: Graph answers its scopes short or as URLs (https://graph.microsoft.com/Calendars.ReadWrite).
func (m *microsoft) scopesOK(granted []string) bool {
	return slices.ContainsFunc(granted, func(s string) bool {
		return strings.EqualFold(strings.TrimPrefix(s, "https://graph.microsoft.com/"), scopeCalendars)
	})
}

// revoke: Microsoft has no per-token revocation; the member removes the app at myapps.microsoft.com.
func (m *microsoft) revoke(context.Context, string) error { return nil }

func (m *microsoft) calendars(ctx context.Context, s session) ([]calendar, error) {
	var out []calendar
	next := m.api + "/me/calendars?$select=id,name,isDefaultCalendar&$top=100"
	for next != "" {
		var res struct {
			Value []struct {
				ID                string `json:"id"`
				Name              string `json:"name"`
				IsDefaultCalendar bool   `json:"isDefaultCalendar"`
			} `json:"value"`
			Next string `json:"@odata.nextLink"`
		}
		if err := m.call(ctx, s, http.MethodGet, next, nil, &res, nil); err != nil {
			return nil, err
		}
		for _, c := range res.Value {
			out = append(out, calendar{ID: c.ID, Name: cmpOr(c.Name, c.ID), Primary: c.IsDefaultCalendar})
		}
		next = res.Next
	}
	return out, nil
}

type msTime struct {
	DateTime string `json:"dateTime"`
	TimeZone string `json:"timeZone"`
}

func (t msTime) instant() (time.Time, bool) {
	zone := time.UTC
	if t.TimeZone != "" && !strings.EqualFold(t.TimeZone, "UTC") {
		z, err := time.LoadLocation(t.TimeZone)
		if err != nil {
			return time.Time{}, false
		}
		zone = z
	}
	v, err := time.ParseInLocation(msTimeFormat, strings.SplitN(t.DateTime, ".", 2)[0], zone)
	return v.UTC(), err == nil
}

type msEvent struct {
	ID          string  `json:"id"`
	ETag        string  `json:"@odata.etag"`
	ShowAs      string  `json:"showAs"`
	IsCancelled bool    `json:"isCancelled"`
	Start       *msTime `json:"start"`
	End         *msTime `json:"end"`
	Removed     *struct {
		Reason string `json:"reason"`
	} `json:"@removed"`
	OnlineMeeting *struct {
		JoinURL string `json:"joinUrl"`
	} `json:"onlineMeeting"`
}

func (m *microsoft) body(ev event) map[string]any {
	b := map[string]any{
		"subject":                       ev.Summary,
		"body":                          map[string]string{"contentType": "text", "content": ev.Description},
		"start":                         msTime{DateTime: ev.Start.UTC().Format(msTimeFormat), TimeZone: "UTC"},
		"end":                           msTime{DateTime: ev.End.UTC().Format(msTimeFormat), TimeZone: "UTC"},
		"location":                      map[string]string{"displayName": ev.Location},
		"showAs":                        "busy",
		"singleValueExtendedProperties": []map[string]string{{"id": msProperty, "value": ev.WorkspaceID + ":" + ev.OccurrenceID}},
	}
	if ev.Meeting {
		b["isOnlineMeeting"], b["onlineMeetingProvider"] = true, "teamsForBusiness"
	}
	return b
}

func (m *microsoft) events(cal string) string {
	return m.api + "/me/calendars/" + url.PathEscape(cal) + "/events"
}

func (m *microsoft) create(ctx context.Context, s session, cal string, ev event) (pushed, error) {
	var res msEvent
	if err := m.call(ctx, s, http.MethodPost, m.events(cal), m.body(ev), &res, nil); err != nil {
		return pushed{}, err
	}
	out := pushed{ID: res.ID, ETag: res.ETag}
	if res.OnlineMeeting != nil {
		out.MeetingURL = res.OnlineMeeting.JoinURL
	}
	return out, nil
}

func (m *microsoft) update(ctx context.Context, s session, cal, id string, ev event) (pushed, error) {
	var res msEvent
	err := m.call(ctx, s, http.MethodPatch, m.events(cal)+"/"+url.PathEscape(id), m.body(ev), &res, nil)
	return pushed{ID: id, ETag: res.ETag}, err
}

func (m *microsoft) remove(ctx context.Context, s session, cal, id string) error {
	err := m.call(ctx, s, http.MethodDelete, m.events(cal)+"/"+url.PathEscape(id), nil, nil, nil)
	if errors.Is(err, errGone) {
		return nil
	}
	return err
}

// changes follows the delta link token, or (token "") starts a calendar view delta over now − 1 day … now + 400 days.
func (m *microsoft) changes(ctx context.Context, s session, cal, token string, now time.Time) (changes, error) {
	next := token
	if next == "" {
		q := url.Values{"startDateTime": {now.Add(-24 * time.Hour).UTC().Format(time.RFC3339)},
			"endDateTime": {now.Add(horizon).UTC().Format(time.RFC3339)}}
		next = m.api + "/me/calendars/" + url.PathEscape(cal) + "/calendarView/delta?" + q.Encode()
	}
	var out changes
	for {
		var res struct {
			Value []msEvent `json:"value"`
			Next  string    `json:"@odata.nextLink"`
			Delta string    `json:"@odata.deltaLink"`
		}
		err := m.call(ctx, s, http.MethodGet, next, nil, &res, map[string]string{"Prefer": "odata.maxpagesize=200, outlook.timezone=\"UTC\""})
		if errors.Is(err, errGone) && token != "" {
			return changes{}, errSyncExpired
		}
		if err != nil {
			return changes{}, err
		}
		for _, e := range res.Value {
			c := change{ID: e.ID, Removed: e.Removed != nil || e.IsCancelled}
			var ok1, ok2 bool
			if e.Start != nil && e.End != nil {
				c.Start, ok1 = e.Start.instant()
				c.End, ok2 = e.End.instant()
			}
			c.Busy = ok1 && ok2 && c.End.After(c.Start) && (e.ShowAs == "busy" || e.ShowAs == "oof" || e.ShowAs == "tentative" ||
				e.ShowAs == "workingElsewhere")
			out.Items = append(out.Items, c)
		}
		switch {
		case res.Next != "":
			next = res.Next
		default:
			out.Token = res.Delta
			return out, nil
		}
	}
}

func (m *microsoft) watch(ctx context.Context, s session, cal, _, secret string, now time.Time) (string, string, time.Time, error) {
	var res struct {
		ID         string    `json:"id"`
		Expiration time.Time `json:"expirationDateTime"`
	}
	body := map[string]any{"changeType": "created,updated,deleted", "notificationUrl": m.webhook + "/microsoft-graph",
		"lifecycleNotificationUrl": m.webhook + "/microsoft-graph/lifecycle", "resource": "me/calendars/" + cal + "/events",
		"expirationDateTime": now.Add(msWatchTTL).UTC().Format(time.RFC3339), "clientState": secret}
	if err := m.call(ctx, s, http.MethodPost, m.api+"/subscriptions", body, &res, nil); err != nil {
		return "", "", time.Time{}, err
	}
	if res.Expiration.IsZero() {
		res.Expiration = now.Add(msWatchTTL)
	}
	return res.ID, "", res.Expiration.UTC(), nil
}

func (m *microsoft) unwatch(ctx context.Context, s session, w store.CalendarWatch) error {
	err := m.call(ctx, s, http.MethodDelete, m.api+"/subscriptions/"+url.PathEscape(w.ProviderID), nil, nil, nil)
	if errors.Is(err, errGone) {
		return nil
	}
	return err
}
