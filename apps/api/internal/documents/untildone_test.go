package documents

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

// TestUntilDoneRetries: a start-up step that fails (a full database) is tried again until it succeeds.
func TestUntilDoneRetries(t *testing.T) {
	defer func(d time.Duration) { backfillRetry = d }(backfillRetry)
	backfillRetry = time.Millisecond
	s := &Service{log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	calls := 0
	s.untilDone(context.Background(), "step", func(context.Context) error {
		calls++
		if calls < 3 {
			return errors.New("remaining connection slots are reserved")
		}
		return nil
	})
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls = 0
	s.untilDone(ctx, "step", func(context.Context) error { calls++; return errors.New("down") })
	if calls != 1 {
		t.Fatalf("after cancel: calls = %d, want 1", calls)
	}
}
