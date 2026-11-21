package store_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

func entry(id, date string, q invoicecalc.Quantity) store.EngagementEntry {
	return store.EngagementEntry{ID: id, PeriodID: "epr_1", Date: date, Quantity: q}
}

func TestEntryOrderingAndUsers(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	if err := s.CreateUser(ctx, store.User{ID: "usr_1", Email: "a@x.ch", Name: "Ann"}, t0); err != nil {
		t.Fatal(err)
	}
	me := &store.UserRef{ID: "usr_1"}
	for i, e := range []store.EngagementEntry{entry("ent_old", "2026-02-01", 1000), entry("ent_a", "2026-02-05", 1500), entry("ent_b", "2026-02-05", 2000)} {
		e.PerformedBy, e.CreatedBy = me, me
		if err := s.CreateEntry(ctx, "eng_1", e, t0.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.Entries(ctx, "eng_1", "")
	if err != nil || len(list) != 3 || list[0].ID != "ent_b" || list[1].ID != "ent_a" || list[2].ID != "ent_old" {
		t.Fatalf("%+v %v", list, err)
	}
	if list[0].PerformedBy == nil || list[0].PerformedBy.Name != "Ann" || list[0].CreatedBy.ID != "usr_1" || list[0].Invoice != nil {
		t.Fatalf("%+v", list[0])
	}
	if d, err := s.LatestEntryDate(ctx, "eng_1"); err != nil || d != "2026-02-05" {
		t.Fatalf("latest %q %v", d, err)
	}
	if list, _ := s.Entries(ctx, "eng_1", "epr_other"); len(list) != 0 {
		t.Fatalf("period filter: %v", list)
	}
}

func TestEntryCRUDAndLatestEmpty(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	if d, err := s.LatestEntryDate(ctx, "eng_1"); err != nil || d != "" {
		t.Fatalf("latest %q %v", d, err)
	}
	if err := s.CreateEntry(ctx, "eng_1", entry("ent_1", "2026-02-01", 1000), t0); err != nil {
		t.Fatal(err)
	}
	e, err := s.Entry(ctx, "eng_1", "ent_1", true)
	if err != nil || e.PerformedBy != nil {
		t.Fatalf("%+v %v", e, err)
	}
	note := "hi"
	e.Quantity, e.Note, e.Date = 2500, &note, "2026-02-03"
	if err := s.SaveEntry(ctx, e); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Entry(ctx, "eng_1", "ent_1", false); got.Quantity != 2500 || *got.Note != "hi" || got.Date != "2026-02-03" {
		t.Fatalf("%+v", got)
	}
	if _, err := s.Entry(ctx, "eng_2", "ent_1", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("other engagement: %v", err)
	}
	if err := s.DeleteEntry(ctx, "ent_1"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteEntry(ctx, "ent_1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestEntryInvoiceVoidReleased(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	insertInvoice(t, pool, "inv_1", "open")
	for _, id := range []string{"ent_1", "ent_2"} {
		if err := s.CreateEntry(ctx, "eng_1", entry(id, "2026-02-01", 1000), t0); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.LinkPeriodInvoice(ctx, "epr_1", "inv_1", "usage"); err != nil {
		t.Fatal(err)
	}
	if err := s.LinkEntries(ctx, []string{"ent_1"}, "inv_1"); err != nil {
		t.Fatal(err)
	}
	e, _ := s.Entry(ctx, "eng_1", "ent_1", false)
	if e.Invoice == nil || e.Invoice.ID != "inv_1" || e.Invoice.Kind != "usage" || e.Invoice.Status != "open" || *e.Invoice.Number != "inv_1" {
		t.Fatalf("%+v", e.Invoice)
	}
	if _, err := pool.Exec(ctx, `UPDATE invoices SET status = 'void' WHERE id = 'inv_1'`); err != nil {
		t.Fatal(err)
	}
	if e, _ = s.Entry(ctx, "eng_1", "ent_1", false); e.Invoice != nil {
		t.Fatalf("void still linked: %+v", e.Invoice)
	}
}

func TestDeletedDraftReleasesEntries(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	insertInvoice(t, pool, "inv_d", "draft")
	if err := s.CreateEntry(ctx, "eng_1", entry("ent_1", "2026-02-01", 1000), t0); err != nil {
		t.Fatal(err)
	}
	if err := s.LinkPeriodInvoice(ctx, "epr_1", "inv_d", "usage"); err != nil {
		t.Fatal(err)
	}
	if err := s.LinkEntries(ctx, []string{"ent_1"}, "inv_d"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.DeleteDraft(ctx, "wsp_a", "inv_d"); err != nil || !ok {
		t.Fatalf("delete draft: %v %v", ok, err)
	}
	e, err := s.Entry(ctx, "eng_1", "ent_1", false)
	if err != nil || e.Invoice != nil {
		t.Fatalf("%+v %v", e, err)
	}
	if links, _ := s.PeriodInvoices(ctx, "epr_1"); len(links) != 0 {
		t.Fatalf("links %v", links)
	}
}

func TestPeriodInvoicesSkipsVoid(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	insertInvoice(t, pool, "inv_adv", "paid")
	insertInvoice(t, pool, "inv_void", "void")
	insertInvoice(t, pool, "inv_use", "draft")
	for id, kind := range map[string]string{"inv_adv": "advance", "inv_void": "usage", "inv_use": "usage"} {
		if err := s.LinkPeriodInvoice(ctx, "epr_1", id, kind); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.LinkPeriodInvoice(ctx, "epr_1", "inv_adv", "advance"); err != nil {
		t.Fatalf("repeat: %v", err)
	}
	list, err := s.PeriodInvoices(ctx, "epr_1")
	if err != nil || len(list) != 2 {
		t.Fatalf("%+v %v", list, err)
	}
	for _, l := range list {
		if l.ID == "inv_void" {
			t.Fatalf("void listed: %+v", list)
		}
	}
}

func TestEntryUsersCarryAvatar(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	if err := s.CreateUser(ctx, store.User{ID: "usr_p", Email: "p@x.ch", Name: "Photo", AvatarURL: "https://g.example/p.png"}, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser(ctx, store.User{ID: "usr_g", Email: "g@x.ch", Name: "Google", AvatarURL: "https://g.example/g.png"}, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser(ctx, store.User{ID: "usr_n", Email: "n@x.ch", Name: "None"}, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.SetUserPhoto(ctx, "usr_p", store.UserPhoto{ObjectKey: "k", ContentType: "image/png", SHA256: strings.Repeat("0123456789abcdef", 4), Size: 1}, t0); err != nil {
		t.Fatal(err)
	}
	for i, id := range []string{"usr_p", "usr_g", "usr_n"} {
		e := entry("ent_"+id, "2026-02-0"+string(rune('1'+i)), 1000)
		e.PerformedBy, e.CreatedBy = &store.UserRef{ID: id}, &store.UserRef{ID: "usr_g"}
		if err := s.CreateEntry(ctx, "eng_1", e, t0); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.Entries(ctx, "eng_1", "")
	if err != nil || len(list) != 3 {
		t.Fatalf("%+v %v", list, err)
	}
	want := map[string]string{"usr_p": "/api/v1/users/usr_p/avatar?v=0123456789ab", "usr_g": "https://g.example/g.png", "usr_n": ""}
	for _, e := range list {
		if got := e.PerformedBy.AvatarURL; got != want[e.PerformedBy.ID] {
			t.Errorf("%s: avatar %q, want %q", e.PerformedBy.ID, got, want[e.PerformedBy.ID])
		}
		if e.CreatedBy.AvatarURL != "https://g.example/g.png" {
			t.Errorf("created by avatar %q", e.CreatedBy.AvatarURL)
		}
	}
}
