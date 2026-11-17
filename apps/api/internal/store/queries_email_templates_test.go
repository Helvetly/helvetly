package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestEmailTemplatesAreWorkspaceScoped(t *testing.T) {
	q, pool := typesDB(t)
	exec(t, pool, `INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_b', 'B', 'UTC', now())`)
	ctx, now := context.Background(), time.Now().UTC().Truncate(time.Microsecond)
	if err := q.SetEmailTemplate(ctx, "wsp_a", EmailTemplate{Kind: "quote", Language: "fr", Subject: "Offre {number}", Body: "Bonjour"}, "usr_1", now); err != nil {
		t.Fatal(err)
	}
	got, err := q.EmailTemplates(ctx, "wsp_a")
	want := EmailTemplate{Subject: "Offre {number}", Body: "Bonjour"}
	if err != nil || len(got) != 1 || !got[0].UpdatedAt.Equal(now) || got[0].Subject != want.Subject || got[0].Body != want.Body {
		t.Fatalf("got %+v, %v", got, err)
	}
	if got, err := q.EmailTemplates(ctx, "wsp_b"); err != nil || len(got) != 0 {
		t.Fatalf("other workspace sees %+v, %v", got, err)
	}
	if _, err := q.EmailTemplate(ctx, "wsp_b", "quote", "fr"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestSetEmailTemplateUpserts(t *testing.T) {
	q, _ := typesDB(t)
	ctx, now := context.Background(), time.Now().UTC().Truncate(time.Microsecond)
	for _, s := range []string{"one", "two"} {
		if err := q.SetEmailTemplate(ctx, "wsp_a", EmailTemplate{Kind: "invoice", Language: "de", Subject: s, Body: s}, "usr_1", now); err != nil {
			t.Fatal(err)
		}
	}
	got, err := q.EmailTemplates(ctx, "wsp_a")
	if err != nil || len(got) != 1 || got[0].Subject != "two" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestDeleteEmailTemplateIsIdempotent(t *testing.T) {
	q, _ := typesDB(t)
	ctx, now := context.Background(), time.Now().UTC()
	if err := q.SetEmailTemplate(ctx, "wsp_a", EmailTemplate{Kind: "invoice", Language: "en", Subject: "s", Body: "b"}, "", now); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := q.DeleteEmailTemplate(ctx, "wsp_a", "invoice", "en"); err != nil {
			t.Fatalf("delete %d: %v", i, err)
		}
	}
	if _, err := q.EmailTemplate(ctx, "wsp_a", "invoice", "en"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestEmailTemplateChecksRefuseUnknownKindAndLanguage(t *testing.T) {
	q, _ := typesDB(t)
	ctx, now := context.Background(), time.Now().UTC()
	for _, c := range []EmailTemplate{{Kind: "receipt", Language: "de"}, {Kind: "invoice", Language: "pl"}} {
		if err := q.SetEmailTemplate(ctx, "wsp_a", c, "", now); err == nil {
			t.Fatalf("%+v accepted", c)
		}
	}
}
