package heidi

import (
	"context"
	"helvetly.com/api/internal/store"
	"strings"
	"testing"
	"time"
)

func TestLatestIssuedInvoiceInChat(t *testing.T) {
	_, mux, sess, _ := fixture(t)
	for i, msg := range []string{"jaka ostatnio byla wystawiona faktura", "Quelle est la dernière facture émise ?", "What was the last issued invoice?", "Welche Rechnung wurde zuletzt ausgestellt?", "Qual è l’ultima fattura emessa?"} {
		r := chat(t, mux, "latest"+string(rune('a'+i)), msg)
		if r.Code != 200 || strings.Contains(r.Body.String(), "model") || !strings.Contains(r.Body.String(), `"tokens":0`) {
			t.Fatalf("%q: %d %s", msg, r.Code, r.Body.String())
		}
	}
	sess.Role = "member"
	sess.Scopes = []string{"read:clients"}
	r := chat(t, mux, "denied", "jaka ostatnio byla wystawiona faktura")
	if r.Code != 403 {
		t.Fatalf("restricted: %d %s", r.Code, r.Body.String())
	}
}

func TestLatestIssuedInvoiceUsesTheBusinessDateAndWorkspace(t *testing.T) {
	s, mux, sess, _, raw := fixtureRaw(t)
	ctx := context.Background()
	foreign := store.Workspace{ID: "ws_other", Name: "Other"}
	if err := s.db.CreateWorkspace(ctx, foreign, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, ws := range []string{sess.Workspace.ID, foreign.ID} {
		if err := s.db.CreateClient(ctx, ws, ws+"-buyer", map[string]any{"name": "Buyer " + ws}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []struct{ id, ws, kind, status, date, issued string }{
		{"old", sess.Workspace.ID, "invoice", "open", "2026-10-10", "2026-10-11"},
		{"first", sess.Workspace.ID, "invoice", "open", "2026-10-12", "2026-10-12"},
		{"last-issued", sess.Workspace.ID, "invoice", "paid", "2026-10-12", "2026-10-13"},
		{"new-draft", sess.Workspace.ID, "invoice", "draft", "2026-11-12", "2026-11-11"},
		{"later-proforma", sess.Workspace.ID, "proforma", "open", "2026-12-10", "2026-12-10"},
		{"another-tenant", foreign.ID, "invoice", "open", "2027-10-10", "2027-10-10"},
	} {
		_, err := raw.Exec(ctx, `INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,issue_date,due_date,currency,language,vat_mode,discount_percent,subtotal,discount_amount,net_total,vat_total,total,rounding_amount,vat_breakdown,amount_paid,amount_credited,created_at,updated_at,issued_at)
VALUES ($1,$2,$3,$4,CASE WHEN $4='draft' THEN NULL ELSE $1 END,$2||'-buyer',$5,$5,'CHF','en','none',0,12345,0,12345,0,12345,0,'[]',0,0,now(),now(),CASE WHEN $4='draft' THEN NULL ELSE $6::timestamptz END)`, row.id, row.ws, row.kind, row.status, row.date, row.issued)
		if err != nil {
			t.Fatal(err)
		}
	}
	w := chat(t, mux, "latest-real", "jaka ostatnio byla wystawiona faktura")
	body := w.Body.String()
	for _, want := range []string{"last-issued", "2026-10-12", "Buyer ws_heidi", "123.45", `"kind":"invoice"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
	for _, unwanted := range []string{"later-proforma", "another-tenant", "new-draft"} {
		if strings.Contains(body, unwanted) {
			t.Fatalf("returned %s", unwanted)
		}
	}
}
