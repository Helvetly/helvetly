package billing

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// currentOffer is the offer on sale, parsed.
func (e *env) currentOffer() Offer {
	e.t.Helper()
	v, err := e.st.CurrentOffer(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	o, err := LoadOffer(v)
	if err != nil {
		e.t.Fatal(err)
	}
	return o
}

var variants atomic.Int64

// publishVariant publishes the current offer changed by change under a new id, through the operator's path, and
// moves every workspace onto it (as a new subscription would be).
func (e *env) publishVariant(change func(*Offer)) string {
	e.t.Helper()
	o := e.currentOffer()
	change(&o)
	o.ID = fmt.Sprintf("test-%d-%d", os.Getpid(), variants.Add(1))
	if err := PublishOffer(context.Background(), e.st, o, "test", "test variant"); err != nil {
		e.t.Fatal(err)
	}
	e.exec(`UPDATE workspace_billing SET offer_id = $1`, o.ID)
	return o.ID
}

// setPlanValue publishes a variant where key on plan has state and value (nil: none), without per-seat growth.
func (e *env) setPlanValue(plan string, key Limit, state string, value *int64) {
	e.t.Helper()
	e.publishVariant(func(o *Offer) {
		for i, r := range o.Records {
			if r.Key == string(key) {
				o.Records[i].Values[plan] = OfferValue{State: state, Value: value}
				if r.Type != KindAccess {
					o.Records[i].PerAdditionalPaidSeat[plan] = 0
				}
			}
		}
		o.UsagePolicy.Pooled = removed(o.UsagePolicy.Pooled, string(key))
	})
}

func removed(keys []string, key string) []string {
	out := []string{}
	for _, k := range keys {
		if k != key {
			out = append(out, k)
		}
	}
	return out
}

// override gives the workspace its own value of key through the operator's path.
func (e *env) override(ws string, key Limit, state string, value *int64, expires *time.Time) {
	e.t.Helper()
	w := store.WorkspaceLimit{WorkspaceID: ws, Key: string(key), State: state, Value: value, ExpiresAt: expires, Reason: "test"}
	if err := SetWorkspaceOverride(context.Background(), e.st, w, "test", e.svc.now()); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) clearOverride(ws string, key Limit) {
	e.t.Helper()
	if err := ClearWorkspaceOverride(context.Background(), e.st, ws, string(key), "test", "test"); err != nil {
		e.t.Fatal(err)
	}
}

func n64(v int64) *int64 { return &v }

func mustRights(t *testing.T, e *env, ws string) Rights {
	t.Helper()
	r, err := e.svc.Entitlements(context.Background(), e.st.Q, ws)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
