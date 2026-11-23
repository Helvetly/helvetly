package imports

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"helvetly.com/api/internal/store"
)

// RunExpiry discards expired unfinished imports every ten minutes until ctx ends.
func (s *Service) RunExpiry(ctx context.Context) {
	tick := time.NewTicker(10 * time.Minute)
	defer tick.Stop()
	for {
		if err := s.ExpireTick(ctx); err != nil {
			s.log.ErrorContext(ctx, "import expiry", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// ExpireTick discards every unfinished import idle for store.ImportExpiry as its owner's Discard would, one batch per
// transaction with an imports.expired audit entry; claims make concurrent instances skip each other's batches.
func (s *Service) ExpireTick(ctx context.Context) error {
	for ctx.Err() == nil {
		var keys []string
		err := s.db.Tx(ctx, func(q store.Q) error {
			b, err := q.ClaimExpiredImport(ctx, s.now())
			if err != nil {
				return err
			}
			k, known := Kinds[b.Kind]
			if keys, err = drop(ctx, q, b.WorkspaceID, b.UserID, b.ID, known && k.Private); err != nil {
				return err
			}
			payload, err := json.Marshal(map[string]any{"kind": b.Kind, "user_id": b.UserID})
			if err != nil {
				return err
			}
			return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: b.WorkspaceID, Kind: "imports.expired",
				SubjectType: "import", SubjectID: b.ID, At: s.now(), Payload: payload})
		})
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		s.deleteKept(ctx, keys)
	}
	return nil
}
