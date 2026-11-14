// Package retentiontest is a fake storage lock for tests: embed a Lock in a fake storage to make it protect objects.
package retentiontest

import (
	"context"
	"sync"
	"time"

	"helvetly.com/api/internal/storage"
)

// Lock records each lock it applies; Fail, when set, is returned instead. Off makes it a storage with protection off.
type Lock struct {
	mu     sync.Mutex
	Fail   error
	Off    bool
	locked []applied
}

type applied struct {
	key   string
	until time.Time
}

func (l *Lock) RetentionMode() string {
	if l.Off {
		return ""
	}
	return "COMPLIANCE"
}

// RetainUntil: the deadline, at least a day after the request.
func (l *Lock) RetainUntil(requested time.Time, deadline *time.Time) time.Time {
	until := requested.AddDate(0, 0, 1)
	if deadline != nil && deadline.After(until) {
		until = *deadline
	}
	return until.UTC().Truncate(time.Second)
}

func (l *Lock) Retain(_ context.Context, key string, until time.Time) (storage.Lock, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.Fail != nil {
		return storage.Lock{}, l.Fail
	}
	l.locked = append(l.locked, applied{key, until})
	return storage.Lock{VersionID: "v-" + key, Mode: "COMPLIANCE", Until: until}, nil
}

// SetFail changes Fail while other goroutines may lock.
func (l *Lock) SetFail(err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.Fail = err
}

// Count: how many times key was locked.
func (l *Lock) Count(key string) (n int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, a := range l.locked {
		if a.key == key {
			n++
		}
	}
	return n
}

// Until: the date key was last locked to, zero when never.
func (l *Lock) Until(key string) (t time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, a := range l.locked {
		if a.key == key {
			t = a.until
		}
	}
	return t
}

// Keys: every locked key, in order.
func (l *Lock) Keys() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]string, len(l.locked))
	for i, a := range l.locked {
		out[i] = a.key
	}
	return out
}
