package heidi

import (
	"context"
	"errors"
	"fmt"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/store"
)

// importTurn answers files the chat sent to an import that works out what they are: the chat then follows that import
// (its progress, what was found and the review) under this answer.
func importTurn(ctx context.Context, q store.Q, sess store.Session, id string) (turn, error) {
	b, err := q.ImportBatch(ctx, sess.Workspace.ID, sess.User.ID, id)
	if errors.Is(err, store.ErrNotFound) || err == nil && b.Kind != imports.Auto {
		return turn{}, auth.ErrNotFound
	}
	if err != nil {
		return turn{}, err
	}
	names := []string{}
	for _, f := range b.Files {
		names = append(names, f.Name)
	}
	files := "this file"
	if len(names) != 1 {
		files = fmt.Sprintf("these %d files", len(names))
	}
	return turn{ImportID: id, importFiles: names, Text: "I'm reading " + files + " and working out what each one is: " +
		"an invoice you issued, a bill you received, a contract, a client list or a price list. What I find shows up " +
		"below, with anything that needs a look. Nothing is created until you choose Import."}, nil
}
