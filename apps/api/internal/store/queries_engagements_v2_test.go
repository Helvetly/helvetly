package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func seedEngPeriod(t *testing.T, s *store.Store, ws, cli, eng string) {
	t.Helper()
	ctx := context.Background()
	if err := s.CreateEngagement(ctx, ws, newEngagement(eng, cli), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InsertPeriod(ctx, store.EngagementPeriod{ID: "per_" + eng, EngagementID: eng, Index: 1,
		StartsOn: "2026-01-31", EndsOn: "2026-02-27", Quantity: 30500}); err != nil {
		t.Fatal(err)
	}
}

func TestBackfillFullQuantity(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	seedEngPeriod(t, s, "wsp_a", "cli_a", "eng_1")
	ps, err := s.EngagementPeriods(ctx, "eng_1")
	if err != nil || len(ps) != 1 || ps[0].FullQuantity != 30500 || ps[0].NaturalEndsOn != "2026-02-27" || ps[0].QuantityManual {
		t.Fatalf("%+v %v", ps, err)
	}
	if err := s.SetPeriodQuantityProrated(ctx, "per_eng_1", 10000); err != nil {
		t.Fatal(err)
	}
	if ps, _ = s.EngagementPeriods(ctx, "eng_1"); ps[0].Quantity != 10000 || ps[0].FullQuantity != 30500 || ps[0].QuantityManual {
		t.Fatalf("prorated %+v", ps[0])
	}
	if err := s.SetPeriodFullQuantity(ctx, "per_eng_1", 40000); err != nil {
		t.Fatal(err)
	}
	if ps, _ = s.EngagementPeriods(ctx, "eng_1"); ps[0].FullQuantity != 40000 || ps[0].Quantity != 10000 || ps[0].QuantityManual {
		t.Fatalf("full %+v", ps[0])
	}
	if err := s.SetPeriodFullQuantity(ctx, "nope", 1); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if err := s.SetPeriodQuantity(ctx, "per_eng_1", 20000); err != nil {
		t.Fatal(err)
	}
	if ps, _ = s.EngagementPeriods(ctx, "eng_1"); !ps[0].QuantityManual {
		t.Fatal("manual flag not set")
	}
}

func TestEngagementV2FieldsRoundTrip(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	e := newEngagement("eng_1", "cli_a")
	if err := s.CreateEngagement(ctx, "wsp_a", e, t0); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Engagement(ctx, "wsp_a", "eng_1", false)
	if got.Rollover || got.AutoInvoice || got.InvoiceDetail != "summary" {
		t.Fatalf("defaults %+v", got)
	}
	got.Rollover, got.AutoInvoice, got.InvoiceDetail = true, true, "per_entry"
	if err := s.SaveEngagement(ctx, "wsp_a", got, t0); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Engagement(ctx, "wsp_a", "eng_1", false)
	auto, err := s.AutoInvoiceEngagements(ctx)
	if !got.Rollover || !got.AutoInvoice || got.InvoiceDetail != "per_entry" || err != nil || len(auto) != 1 {
		t.Fatalf("saved %+v auto %v %v", got, auto, err)
	}
	if ids, err := s.LiveEngagementIDs(ctx, "wsp_b"); err != nil || len(ids) != 0 {
		t.Fatalf("other workspace ids %v %v", ids, err)
	}
	if ids, _ := s.LiveEngagementIDs(ctx, "wsp_a"); len(ids) != 1 {
		t.Fatalf("ids %v", ids)
	}
	_ = s.DeleteEngagement(ctx, "wsp_a", "eng_1", t0)
	if auto, _ = s.AutoInvoiceEngagements(ctx); len(auto) != 0 {
		t.Fatal("deleted engagement still auto")
	}
}

func notice(id, eng, kind string) store.EngagementNotice {
	return store.EngagementNotice{ID: id, EngagementID: eng, PeriodID: "per_" + eng, Kind: kind, CreatedAt: t0}
}

func TestNoticeOncePerPeriodKind(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	seedEngPeriod(t, s, "wsp_a", "cli_a", "eng_1")
	for i, want := range []bool{true, false} {
		if ok, err := s.AddNotice(ctx, notice("n"+string(rune('1'+i)), "eng_1", "ending_soon")); err != nil || ok != want {
			t.Fatalf("try %d: %v %v", i, ok, err)
		}
	}
	if ok, err := s.AddNotice(ctx, notice("n3", "eng_1", "under_pace")); err != nil || !ok {
		t.Fatalf("other kind: %v %v", ok, err)
	}
}

func TestClaimNoticesOnce(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	seedEngPeriod(t, s, "wsp_a", "cli_a", "eng_1")
	seedEngPeriod(t, s, "wsp_b", "cli_b", "eng_b")
	_, _ = s.AddNotice(ctx, notice("n1", "eng_1", "ending_soon"))
	_, _ = s.AddNotice(ctx, notice("n2", "eng_1", "under_pace"))
	_, _ = s.AddNotice(ctx, notice("n3", "eng_b", "ending_soon"))
	got, err := s.ClaimNotices(ctx, "wsp_a", t0.Add(time.Hour))
	if err != nil || len(got) != 2 || got[0].ID != "n1" || got[1].ID != "n2" || got[0].Title != "German" || got[0].Number != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	if again, err := s.ClaimNotices(ctx, "wsp_a", t0.Add(time.Hour)); err != nil || len(again) != 0 {
		t.Fatalf("claimed twice: %+v %v", again, err)
	}
	if other, err := s.ClaimNotices(ctx, "wsp_b", t0); err != nil || len(other) != 1 || other[0].ID != "n3" {
		t.Fatalf("other workspace: %+v %v", other, err)
	}
}

func TestDigestWorkspacesOnlyWithPendingAndDigestOn(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	if ids, _ := s.DigestWorkspaces(ctx); len(ids) != 0 {
		t.Fatalf("no notices: %v", ids)
	}
	seedEngPeriod(t, s, "wsp_a", "cli_a", "eng_1")
	seedEngPeriod(t, s, "wsp_b", "cli_b", "eng_b")
	_, _ = s.AddNotice(ctx, notice("n1", "eng_1", "ending_soon"))
	_, _ = s.AddNotice(ctx, notice("n2", "eng_b", "ending_soon"))
	if st, err := s.EngagementSettings(ctx, "wsp_a"); err != nil || !st.Digest {
		t.Fatalf("default %+v %v", st, err)
	}
	if err := s.PutEngagementSettings(ctx, "wsp_b", store.EngagementSettings{Digest: false}, t0); err != nil {
		t.Fatal(err)
	}
	if st, _ := s.EngagementSettings(ctx, "wsp_b"); st.Digest {
		t.Fatal("digest should be off")
	}
	if st, _ := s.EngagementSettings(ctx, "wsp_a"); !st.Digest {
		t.Fatal("other workspace affected")
	}
	if ids, _ := s.DigestWorkspaces(ctx); len(ids) != 1 || ids[0].ID != "wsp_a" {
		t.Fatalf("digest off: %v", ids)
	}
	_, _ = s.ClaimNotices(ctx, "wsp_a", t0)
	if ids, _ := s.DigestWorkspaces(ctx); len(ids) != 0 {
		t.Fatalf("all notified: %v", ids)
	}
	_, _ = s.AddNotice(ctx, notice("n3", "eng_1", "under_pace"))
	if err := s.DeleteWorkspace(ctx, "wsp_a", "wdl_a", "usr_a", t0); err != nil {
		t.Fatal(err)
	}
	if ids, _ := s.DigestWorkspaces(ctx); len(ids) != 0 {
		t.Fatalf("deleted workspace: %v", ids)
	}
}

func TestDigestRecipientsOwnersAndAdmins(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	for id, role := range map[string]string{"usr_o": "owner", "usr_a": "admin", "usr_m": "member"} {
		if err := s.CreateUser(ctx, store.User{ID: id, Email: id + "@x.ch", Name: "N-" + id}, t0); err != nil {
			t.Fatal(err)
		}
		if err := s.AddMember(ctx, "wsp_a", id, role, t0); err != nil {
			t.Fatal(err)
		}
	}
	users, emails, err := s.DigestRecipients(ctx, "wsp_a")
	if err != nil || len(users) != 2 || len(emails) != 2 || emails[0] != "usr_a@x.ch" || emails[1] != "usr_o@x.ch" {
		t.Fatalf("%v %v %v", users, emails, err)
	}
	if u, _, _ := s.DigestRecipients(ctx, "wsp_b"); len(u) != 0 {
		t.Fatalf("other workspace %v", u)
	}
}
