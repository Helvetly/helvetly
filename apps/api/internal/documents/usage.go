package documents

import (
	"context"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

type tally struct {
	Files int   `json:"files"`
	Size  int64 `json:"size"`
}

type kindTally struct {
	Kind string `json:"kind"`
	tally
}

type usage struct {
	tally
	CapacityBytes *int64      `json:"capacity_bytes,omitempty"`
	StoredBytes   int64       `json:"stored_bytes"`
	ByKind        []kindTally `json:"by_kind"`
	Trash         tally       `json:"trash"`
}

func (t *tally) add(files int, size int64) {
	t.Files += files
	t.Size += size
}

// usageOf folds the per-content-type rows into kinds, in the order the UI lists them, leaving out empty ones.
func usageOf(rows []store.UsageRow) usage {
	u := usage{ByKind: []kindTally{}}
	byKind := map[string]*tally{}
	for _, r := range rows {
		if r.Trashed {
			u.Trash.add(r.Files, r.Size)
			continue
		}
		u.add(r.Files, r.Size)
		k := kindOf(r.ContentType)
		if byKind[k] == nil {
			byKind[k] = &tally{}
		}
		byKind[k].add(r.Files, r.Size)
	}
	for _, k := range append(slices.Clone(kinds), "other") {
		if t := byKind[k]; t != nil {
			u.ByKind = append(u.ByKind, kindTally{k, *t})
		}
	}
	return u
}

// SetStorageCapacity supplies the workspace limit used to admit uploads.
func (s *Service) SetStorageCapacity(capacity func(context.Context, string) (int64, error)) {
	s.storageCapacity = capacity
}

func (s *Service) usage(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	rows, err := s.db.DocumentUsage(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	u := usageOf(rows)
	u.StoredBytes, err = s.db.StoredBytes(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	if s.storageCapacity != nil {
		capacity, err := s.storageCapacity(r.Context(), sess.Workspace.ID)
		if err != nil {
			s.log.WarnContext(r.Context(), "document storage capacity unavailable", "err", err)
		} else {
			u.CapacityBytes = &capacity
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(u))
	return nil
}
