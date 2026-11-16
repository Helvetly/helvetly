package store_test

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// TestObjectStoredNeverWaitsOnTheWritersTransaction: storage confirms a PUT made inside the transaction that holds the
// object's row; the confirmation leaves that row alone instead of waiting for a commit that waits for it.
func TestObjectStoredNeverWaitsOnTheWritersTransaction(t *testing.T) {
	st, _ := storetest.New(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := st.ReserveObject(ctx, "wsp_a", "k", 10, false, time.Now()); err != nil {
		t.Fatal(err)
	}
	err := st.Tx(ctx, func(q store.Q) error {
		if err := q.ReserveObject(ctx, "wsp_a", "k", 12, false, time.Now()); err != nil { // the same key written again
			return err
		}
		return st.ObjectStored(ctx, "k", 12, time.Now())
	})
	if err != nil {
		t.Fatalf("confirming under the writer's lock: %v", err)
	}
	if err := st.ObjectStored(ctx, "k", 12, time.Now()); err != nil {
		t.Fatal(err)
	}
	if n, err := st.StoredBytes(ctx, "wsp_a"); err != nil || n != 12 {
		t.Fatalf("stored %d %v", n, err)
	}
}
