package clients

import (
	"context"
	"sync"
	"testing"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uidregister"
)

// fakeRegister knows the companies by UID; down answers every lookup as unavailable.
type fakeRegister struct {
	mu        sync.Mutex
	companies map[string]uidregister.Company
	down      bool
	lookups   int
}

func (f *fakeRegister) Lookup(_ context.Context, uid string) (uidregister.Company, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lookups++
	if f.down {
		return uidregister.Company{}, false, uidregister.ErrUnavailable
	}
	c, ok := f.companies[uidregister.FormatUID(uidregister.ParseUID(uid))]
	return c, ok, nil
}

func (f *fakeRegister) set(down bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.down = down
}

func (f *fakeRegister) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lookups
}

func TestUIDRegisterVerification(t *testing.T) {
	reg := &fakeRegister{companies: map[string]uidregister.Company{
		"CHE-102.753.938": {UID: "CHE-102.753.938", Name: "Swisscom AG", Active: true, VAT: true},
		"CHE-116.281.710": {UID: "CHE-116.281.710", Name: "Gone AG", Active: false},
	}}
	e := newEnvWith(t, reg)
	b := e.workspace()

	type step struct {
		name     string
		body     map[string]any
		down     bool
		verified string // "" = no mark
		lookups  int    // the register's calls so far
	}
	var c store.Client
	for i, s := range []step{
		{"known UID in the VAT field", map[string]any{"name": "Swisscom AG", "vat_number": "CHE-102.753.938 MWST"}, false, "CHE-102.753.938", 1},
		{"unrelated change: no new lookup", map[string]any{"note": "Key account"}, false, "CHE-102.753.938", 1},
		{"same UID in the registration number: still verified", map[string]any{"registration_number": "che102753938"}, false, "CHE-102.753.938", 1},
		{"UID removed", map[string]any{"registration_number": nil, "vat_number": nil}, false, "", 1},
		{"unknown UID: saved, no mark", map[string]any{"registration_number": "CHE-109.322.551"}, false, "", 2},
		{"deleted company: no mark", map[string]any{"registration_number": "CHE-116.281.710"}, false, "", 3},
		{"register down: saved, no mark", map[string]any{"registration_number": "CHE-102.753.938"}, true, "", 4},
		{"register back: next save marks it", map[string]any{"note": "Again"}, false, "CHE-102.753.938", 5},
		{"foreign VAT number only", map[string]any{"registration_number": nil, "vat_number": "DE123456789"}, false, "", 5},
	} {
		reg.set(s.down)
		var out struct{ Data store.Client }
		if i == 0 {
			e.do(b, "POST", "/api/v1/clients", s.body, 201, &out)
		} else {
			e.do(b, "PATCH", "/api/v1/clients/"+c.ID, s.body, 200, &out)
		}
		c = out.Data
		got := ""
		if c.VerifiedUID != nil {
			got = *c.VerifiedUID
		}
		if got != s.verified || (c.UIDVerifiedAt != nil) != (s.verified != "") || reg.count() != s.lookups {
			t.Fatalf("%s: verified %q at %v after %d lookups; want %q after %d", s.name, got, c.UIDVerifiedAt, reg.count(), s.verified, s.lookups)
		}
	}
	// What the answer said is what is stored.
	stored, err := e.st.Client(context.Background(), b.workspace, c.ID)
	if err != nil || stored.VerifiedUID != nil {
		t.Fatalf("stored = %v, %v", stored.VerifiedUID, err)
	}
}

func TestNoRegisterNoMark(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var out struct{ Data store.Client }
	e.do(b, "POST", "/api/v1/clients", map[string]any{"name": "Swisscom AG", "vat_number": "CHE-102.753.938 MWST"}, 201, &out)
	c := out.Data
	if c.VerifiedUID != nil || c.UIDVerifiedAt != nil {
		t.Fatalf("marked without a register: %v", c.VerifiedUID)
	}
}
