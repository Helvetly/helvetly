package invoices

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestCreateDraftUsesCallerTx(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess := store.Session{Workspace: store.Workspace{ID: b.workspace}}
	ctx, boom := context.Background(), errors.New("rollback")
	var id string
	err := e.st.Tx(ctx, func(q store.Q) (err error) {
		id, err = e.svc.CreateDraft(ctx, q, sess, clientID, func(inv *store.Invoice) {
			inv.Lines = []store.InvoiceLine{{Description: "Hours", Quantity: 2000, UnitPrice: 10000, VATCategory: "S", VATRate: 810}}
		})
		if err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) || id == "" {
		t.Fatalf("err %v id %q", err, id)
	}
	e.do(b, "GET", "/api/v1/invoices/"+id, nil, http.StatusNotFound, nil)
}

func TestCreateDraft(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess := store.Session{Workspace: store.Workspace{ID: b.workspace}}
	ctx := context.Background()
	var id string
	err := e.st.Tx(ctx, func(q store.Q) (err error) {
		id, err = e.svc.CreateDraft(ctx, q, sess, clientID, func(inv *store.Invoice) {
			inv.Lines = []store.InvoiceLine{{Description: "Hours", Quantity: 2000, UnitPrice: 10000, VATCategory: "S", VATRate: 810}}
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	inv := e.invoice(b, "GET", "/api/v1/invoices/"+id, nil, http.StatusOK)
	if inv.Status != "draft" || len(inv.Lines) != 1 {
		t.Fatalf("got %+v", inv)
	}

	for name, fill := range map[string]func(*store.Invoice){
		"S without rate": func(inv *store.Invoice) {
			inv.Lines = []store.InvoiceLine{{Quantity: 1000, UnitPrice: 100, VATCategory: "S"}}
		},
		"Z with rate": func(inv *store.Invoice) {
			inv.Lines = []store.InvoiceLine{{Quantity: 1000, UnitPrice: 100, VATCategory: "Z", VATRate: 810}}
		},
		"unknown category": func(inv *store.Invoice) {
			inv.Lines = []store.InvoiceLine{{Quantity: 1000, UnitPrice: 100, VATCategory: "X"}}
		},
		"zero quantity": func(inv *store.Invoice) { inv.Lines = []store.InvoiceLine{{VATCategory: "S", VATRate: 810}} },
	} {
		err := e.st.Tx(ctx, func(q store.Q) error {
			_, err := e.svc.CreateDraft(ctx, q, sess, clientID, fill)
			return err
		})
		if err == nil {
			t.Errorf("%s: want a validation error", name)
		}
	}
	err = e.st.Tx(ctx, func(q store.Q) error {
		_, err := e.svc.CreateDraft(ctx, q, sess, "cli_missing", func(*store.Invoice) {})
		return err
	})
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown client: %v", err)
	}
}

func TestCreateDraftNoVATForcesO(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess := store.Session{Workspace: store.Workspace{ID: b.workspace}}
	ctx := context.Background()
	var id string
	err := e.st.Tx(ctx, func(q store.Q) (err error) {
		id, err = e.svc.CreateDraft(ctx, q, sess, clientID, func(inv *store.Invoice) {
			inv.VATMode = "none"
			inv.Lines = []store.InvoiceLine{{Description: "Hours", Quantity: 1000, UnitPrice: 100, VATCategory: "S", VATRate: 810}}
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if l := e.invoice(b, "GET", "/api/v1/invoices/"+id, nil, http.StatusOK).Lines[0]; l.VATCategory != "O" {
		t.Fatalf("got %+v", l)
	}
}
