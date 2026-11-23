package calsync

import (
	"context"

	"helvetly.com/api/internal/store"
)

// Leaving reads the calendar connections of a member leaving the workspace (userID), or of every member when the
// workspace is deleted (userID ""), before their rows go with the membership. The returned func, run once the
// removal committed, removes their pushed events and watches at the provider and revokes the grants.
func (s *Service) Leaving(ctx context.Context, workspaceID, userID string) (func(), error) {
	var conns []store.CalendarConnection
	var err error
	if userID == "" {
		conns, err = s.db.WorkspaceCalendarConnections(ctx, workspaceID)
	} else {
		conns, err = s.db.CalendarConnections(ctx, workspaceID, userID)
	}
	if err != nil {
		return nil, err
	}
	type gone struct {
		p       provider
		c       store.CalendarConnection
		links   []store.CalendarLink
		watches []store.CalendarWatch
	}
	var all []gone
	for _, c := range conns {
		p := s.providers[c.Provider]
		if p == nil || c.Status == "revoked" {
			continue
		}
		g := gone{p: p, c: c}
		if g.links, err = s.db.CalendarLinksOfConnection(ctx, c.ID); err != nil {
			return nil, err
		}
		if g.watches, err = s.db.CalendarWatches(ctx, c.ID); err != nil {
			return nil, err
		}
		all = append(all, g)
	}
	return func() {
		ctx := context.WithoutCancel(ctx)
		for _, g := range all {
			s.async(func() { s.cleanUp(ctx, g.p, g.c, g.links, g.watches) })
		}
	}, nil
}
