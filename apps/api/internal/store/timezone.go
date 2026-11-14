package store

import (
	"sync"
	"time"
	_ "time/tzdata" // workspace time zones must resolve on hosts without zoneinfo
)

var locations sync.Map // IANA name → *time.Location

// ValidTimezone reports whether name is an IANA time zone a workspace may use.
func ValidTimezone(name string) bool {
	_, err := time.LoadLocation(name)
	return err == nil && name != "" && name != "Local" && len(name) <= 64
}

// Location is the workspace's time zone; UTC when the stored name does not load (writes are validated).
func (w Workspace) Location() *time.Location {
	if l, ok := locations.Load(w.Timezone); ok {
		return l.(*time.Location)
	}
	l, err := time.LoadLocation(w.Timezone)
	if err != nil || w.Timezone == "" || w.Timezone == "Local" {
		return time.UTC
	}
	locations.Store(w.Timezone, l)
	return l
}

// Today is the civil date (YYYY-MM-DD) at now in the workspace's time zone.
func (w Workspace) Today(now time.Time) string { return now.In(w.Location()).Format(time.DateOnly) }
