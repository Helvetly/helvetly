package imports

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type engagementsEnv struct {
	st              *store.Store
	sess            store.Session
	client, foreign string
}

func newEngagementsEnv(t *testing.T) engagementsEnv {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	ctx, now := context.Background(), time.Now()
	ws, other := store.Workspace{ID: auth.NewID("wsp"), Name: "Acme", Timezone: "Europe/Zurich"}, auth.NewID("wsp")
	e := engagementsEnv{st: st, sess: store.Session{Workspace: ws, Role: "owner"}, client: auth.NewID("cli"), foreign: auth.NewID("cli")}
	for _, err := range []error{
		st.CreateWorkspace(ctx, ws, ws.Timezone, now),
		st.CreateWorkspace(ctx, store.Workspace{ID: other, Name: "Other"}, "Europe/Zurich", now),
		st.CreateClient(ctx, ws.ID, e.client, map[string]any{"name": "Müller AG", "vat_number": "CHE-123.456.788 MWST",
			"email": "info@mueller.ch"}, now),
		st.CreateClient(ctx, other, e.foreign, map[string]any{"name": "Müller AG"}, now),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	return e
}

// modelRecord: a model's output as JSON values.
func modelRecord(t *testing.T, fields map[string]any) Data {
	t.Helper()
	d := Data{}
	for k, v := range fields {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		d[k] = raw
	}
	return d
}

// retainer is a valid monthly retainer, matched to the client by name.
func retainer() map[string]any {
	return map[string]any{"client_name": "müller ag", "title": "Support retainer", "quantity": "20", "unit": "hour",
		"unit_price": "150.00", "recurrence": "monthly", "start_date": "2026-12-01", "billing": "advance"}
}

func with(base map[string]any, changes map[string]any) map[string]any {
	for k, v := range changes {
		if v == nil {
			delete(base, k)
		} else {
			base[k] = v
		}
	}
	return base
}

func TestEngagementsCheck(t *testing.T) {
	e := newEngagementsEnv(t)
	long := string(make([]byte, 300))
	for _, tc := range []struct {
		name    string
		fields  map[string]any
		invalid []string
	}{
		{"matched by name", retainer(), nil},
		{"matched by VAT number as written", with(retainer(), map[string]any{"client_name": "Mueller", "client_vat_number": "CHE 123 456 788 MWST"}), nil},
		{"matched by email", with(retainer(), map[string]any{"client_name": "Mueller", "client_email": "INFO@mueller.ch"}), nil},
		{"chosen in review", with(retainer(), map[string]any{"client_name": "Nobody", "client_id": e.client}), nil},
		{"one-off with an end", with(retainer(), map[string]any{"recurrence": "none", "end_date": "2027-03-31"}), nil},
		{"no client matches", with(retainer(), map[string]any{"client_name": "Unknown GmbH"}), []string{"client_id"}},
		{"no client named", with(retainer(), map[string]any{"client_name": nil}), []string{"client_id"}},
		{"another workspace's client", with(retainer(), map[string]any{"client_id": e.foreign}), []string{"client_id"}},
		{"client id not a string: matched by name", with(retainer(), map[string]any{"client_id": 42}), nil},
		{"client id not a string, no match", with(retainer(), map[string]any{"client_id": 42, "client_name": "Unknown"}), []string{"client_id"}},
		{"missing title, quantity and price", with(retainer(), map[string]any{"title": nil, "quantity": nil, "unit_price": nil}),
			[]string{"quantity", "title", "unit_price"}},
		{"hostile values", with(retainer(), map[string]any{"title": long, "quantity": "-3", "unit_price": "1e99", "unit": "parsec",
			"interval": 1_000_000, "billing": "<script>", "vat_rate": "800", "currency": "ZZZZ"}),
			[]string{"billing", "currency", "interval", "quantity", "title", "unit", "unit_price", "vat_rate"}},
		{"date out of range", with(retainer(), map[string]any{"start_date": "1900-01-01"}), []string{"start_date"}},
		{"one-off without an end", with(retainer(), map[string]any{"recurrence": "none"}), []string{"end_date"}},
		{"end before start", with(retainer(), map[string]any{"end_date": "2026-01-01"}), []string{"end_date"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			invalid, err := engagementsKind.Check(context.Background(), e.st.Q, e.sess.Workspace.ID, modelRecord(t, tc.fields))
			if err != nil {
				t.Fatal(err)
			}
			if !sameKeys(invalid, tc.invalid) {
				t.Fatalf("invalid = %v, want fields %v", invalid, tc.invalid)
			}
		})
	}
}

func sameKeys(m map[string]string, keys []string) bool {
	if len(m) != len(keys) {
		return false
	}
	for _, k := range keys {
		if m[k] == "" {
			return false
		}
	}
	return true
}

func TestEngagementsCreateAndDuplicate(t *testing.T) {
	e := newEngagementsEnv(t)
	ctx := context.Background()
	data := modelRecord(t, retainer())
	if dup, err := engagementsKind.Duplicate(ctx, e.st.Q, e.sess.Workspace.ID, data); err != nil || dup != nil {
		t.Fatalf("before create: duplicate = %v, %v", dup, err)
	}
	var id string
	if err := e.st.Tx(ctx, func(q store.Q) error {
		var err error
		id, err = engagementsKind.Create(ctx, q, e.sess, data, Source{})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	got, err := e.st.Engagement(ctx, e.sess.Workspace.ID, id, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClientID != e.client || got.Title != "Support retainer" || got.StartDate != "2026-12-01" || got.Recurrence != "monthly" {
		t.Fatalf("created %+v", got)
	}
	periods, err := e.st.EngagementPeriods(ctx, id)
	if err != nil || len(periods) != 1 {
		t.Fatalf("periods = %v, %v; want the first one opened", periods, err)
	}

	for _, tc := range []struct {
		name    string
		fields  map[string]any
		matches bool
	}{
		{"same client, title and start", with(retainer(), map[string]any{"title": "SUPPORT RETAINER"}), true},
		{"another start", with(retainer(), map[string]any{"start_date": "2027-01-01"}), false},
		{"another title", with(retainer(), map[string]any{"title": "Hosting"}), false},
		{"no client", with(retainer(), map[string]any{"client_name": "Unknown GmbH"}), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dup, err := engagementsKind.Duplicate(ctx, e.st.Q, e.sess.Workspace.ID, modelRecord(t, tc.fields))
			if err != nil {
				t.Fatal(err)
			}
			if (dup != nil) != tc.matches || (dup != nil && dup.ID != id) {
				t.Fatalf("duplicate = %+v, want match %v", dup, tc.matches)
			}
		})
	}
}

func TestEngagementsCreateRefusesAChangedRecord(t *testing.T) {
	e := newEngagementsEnv(t)
	ctx := context.Background()
	data := modelRecord(t, with(retainer(), map[string]any{"client_id": e.foreign}))
	err := e.st.Tx(ctx, func(q store.Q) error {
		_, err := engagementsKind.Create(ctx, q, e.sess, data, Source{})
		return err
	})
	if err == nil || !strings.HasPrefix(err.Error(), "validation_failed:") {
		t.Fatalf("err = %v, want validation_failed", err)
	}
}
