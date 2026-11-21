package engagements

import (
	"context"
	"slices"
	"strconv"
	"testing"
)

// Pages served by SQL (stored-column sorts) join into the same list as one big page, and a listed engagement
// whose due period is missing still gets it opened.
func TestListSQLPagingMatchesOnePage(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	var first view
	for _, title := range []string{"beta", "Alpha", "gamma", "alpha 2", "Delta"} {
		v := e.create(b, input(c, map[string]any{"title": title}))
		if first.ID == "" {
			first = v
		}
	}
	type page struct {
		Data []view         `json:"data"`
		Meta map[string]int `json:"meta"`
	}
	titles := func(list []view) []string {
		var out []string
		for _, v := range list {
			out = append(out, v.Title)
		}
		return out
	}
	for _, sort := range []string{"title", "-title", "client", "-client", "-created_at", "-ends"} {
		var all page
		e.do(b, "GET", "/api/v1/engagements?page_size=200&sort="+sort, nil, 200, &all)
		var joined []string
		for n := 1; n <= 6; n++ {
			var p page
			e.do(b, "GET", "/api/v1/engagements?page_size=2&sort="+sort+"&page="+strconv.Itoa(n), nil, 200, &p)
			if p.Meta["total"] != 5 || p.Meta["total_pages"] != 3 {
				t.Fatalf("%s page %d: %+v", sort, n, p.Meta)
			}
			joined = append(joined, titles(p.Data)...)
		}
		if !slices.Equal(joined, titles(all.Data)) {
			t.Fatalf("%s: pages %v, one page %v", sort, joined, titles(all.Data))
		}
	}
	var byTitleDesc page
	e.do(b, "GET", "/api/v1/engagements?sort=-title", nil, 200, &byTitleDesc)
	if got := titles(byTitleDesc.Data); !slices.Equal(got, []string{"gamma", "Delta", "beta", "alpha 2", "Alpha"}) {
		t.Fatalf("by title descending: %v", got)
	}
	var byTitle page
	e.do(b, "GET", "/api/v1/engagements?sort=title", nil, 200, &byTitle)
	if got := titles(byTitle.Data); !slices.Equal(got, []string{"Alpha", "alpha 2", "beta", "Delta", "gamma"}) {
		t.Fatalf("case-insensitive title order: %v", got)
	}

	if _, err := e.pool.Exec(context.Background(), `DELETE FROM engagement_periods WHERE engagement_id = $1`, first.ID); err != nil {
		t.Fatal(err)
	}
	e.do(b, "GET", "/api/v1/engagements", nil, 200, &byTitle)
	if len(e.periodRows(first.ID)) == 0 {
		t.Fatal("listing did not open the due period")
	}
}
