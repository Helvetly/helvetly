package quotes

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

type listPage struct {
	Data []store.Quote
	Meta struct {
		Page       int `json:"page"`
		PageSize   int `json:"page_size"`
		Total      int `json:"total"`
		TotalPages int `json:"total_pages"`
	} `json:"meta"`
}

func TestListPagesSortsAndFilters(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	kunde := e.client(b)
	beta := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, beta, map[string]any{"name": "Beta GmbH", "email": "ap@beta.ch",
		"street": "Hauptstrasse", "street_number": "1", "zip": "3000", "city": "Bern", "country": "CH", "language": "de"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	add := func(name, client, issued, qty string, extra map[string]any) store.Quote {
		body := map[string]any{"client_id": client, "issue_date": issued, "lines": []any{line(qty, "100.00")}}
		for k, v := range extra {
			body[k] = v
		}
		q := e.quote(b, "POST", "/api/v1/quotes", body, http.StatusCreated)
		// created one minute apart, in the order made
		if _, err := e.pool.Exec(context.Background(), `UPDATE quotes SET created_at = $2 WHERE id = $1`, q.ID,
			fixedNow.Add(time.Duration(len(names))*time.Minute)); err != nil {
			t.Fatal(err)
		}
		names[q.ID] = name
		return q
	}
	q1 := add("q1", kunde, "2026-10-01", "0.5", nil)                                     // 54.05, sent and expired: Q-2026-001
	add("q2", kunde, "2026-11-01", "2", map[string]any{"reference": "Projekt Seeblick"}) // 216.20, draft
	q3 := add("q3", beta, "2026-11-10", "10", nil)                                       // 1081.00, sent: Q-2026-002
	q4 := add("q4", beta, "2026-11-16", "1", nil)                                        // 108.10, accepted: Q-2026-003
	add("q5", beta, "2026-11-16", "3", nil)                                              // 324.30, draft
	for _, q := range []store.Quote{q1, q3, q4} {
		e.quote(b, "POST", "/api/v1/quotes/"+q.ID+"/send", map[string]any{"email": false}, http.StatusOK)
	}
	e.quote(b, "POST", "/api/v1/quotes/"+q4.ID+"/accept", map[string]any{}, http.StatusOK)

	list := func(query string) listPage {
		t.Helper()
		var p listPage
		e.do(b, "GET", "/api/v1/quotes?"+query, nil, http.StatusOK, &p)
		return p
	}
	order := func(p listPage) string {
		out := make([]string, len(p.Data))
		for i, q := range p.Data {
			out[i] = names[q.ID]
		}
		return strings.Join(out, ",")
	}
	for _, tc := range []struct{ query, want string }{
		{"", "q5,q4,q3,q2,q1"},
		{"status=draft", "q5,q2"},
		{"status=sent", "q3"},
		{"status=expired", "q1"},
		{"status=accepted,declined", "q4"},
		{"status=draft&status=expired", "q5,q2,q1"},
		{"search=seeblick", "q2"},
		{"search=BETA", "q5,q4,q3"},
		{"search=Q-2026-001", "q1"},
		{"search=" + url.QueryEscape("100%"), ""},
		{"client_name=beta", "q5,q4,q3"},
		{"client_id=" + kunde, "q2,q1"},
		{"issued_from=2026-11-01&issued_to=2026-11-10", "q3,q2"},
		{"issued_from=2026-11-16", "q5,q4"},
		{"total_min=200&total_max=400", "q5,q2"},
		{"total_min=1081", "q3"},
		{"total_max=54.05", "q1"},
		{"sort=total", "q1,q4,q2,q5,q3"},
		{"sort=-total", "q3,q5,q2,q4,q1"},
		{"sort=number", "q1,q3,q4,q2,q5"},
		{"sort=-number", "q4,q3,q1,q5,q2"},
		{"sort=status", "q2,q5,q3,q4,q1"},
		{"sort=client", "q3,q4,q5,q1,q2"},
		{"sort=issue_date", "q1,q2,q3,q4,q5"},
		{"sort=-valid_until", "q5,q4,q3,q2,q1"},
		{"sort=created_at", "q1,q2,q3,q4,q5"},
		{"client_name=beta&status=draft,accepted&sort=total", "q4,q5"},
	} {
		t.Run(tc.query, func(t *testing.T) {
			p := list(tc.query)
			if got := order(p); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if p.Meta.Total != len(p.Data) || p.Meta.Page != 1 || p.Meta.PageSize != 50 {
				t.Fatalf("meta %+v for %d rows", p.Meta, len(p.Data))
			}
		})
	}

	t.Run("pages", func(t *testing.T) {
		first, last := list("page_size=2"), list("page_size=2&page=3")
		if order(first) != "q5,q4" || first.Meta.Total != 5 || first.Meta.TotalPages != 3 || first.Meta.PageSize != 2 {
			t.Fatalf("first page %q %+v", order(first), first.Meta)
		}
		if order(last) != "q1" || last.Meta.Page != 3 {
			t.Fatalf("last page %q %+v", order(last), last.Meta)
		}
		if beyond := list("page_size=2&page=4"); len(beyond.Data) != 0 || beyond.Meta.Total != 5 {
			t.Fatalf("beyond the last page %+v", beyond)
		}
	})

	t.Run("statuses are as the reader sees them", func(t *testing.T) {
		p := list("sort=number")
		got := []string{}
		for _, q := range p.Data {
			got = append(got, q.Status)
		}
		if !slices.Equal(got, []string{"expired", "sent", "accepted", "draft", "draft"}) {
			t.Fatalf("statuses %v", got)
		}
	})

	for _, query := range []string{"page=0", "page=x", "page_size=0", "page_size=201", "status=open", "status=draft,paid",
		"issued_from=2026-02-30", "issued_to=yesterday", "total_min=abc", "total_max=1e3", "sort=price", "sort=-amount",
		"search=" + strings.Repeat("a", 201), "client_name=" + strings.Repeat("b", 201)} {
		t.Run("400 "+query[:min(len(query), 30)], func(t *testing.T) {
			e.fails(b, "GET", "/api/v1/quotes?"+query, nil, http.StatusBadRequest, "invalid_request", "")
		})
	}

	t.Run("another workspace", func(t *testing.T) {
		var p listPage
		e.do(e.workspace(), "GET", "/api/v1/quotes?search=Q-2026", nil, http.StatusOK, &p)
		if len(p.Data) != 0 || p.Meta.Total != 0 {
			t.Fatalf("other workspace lists %+v", p)
		}
	})
}
