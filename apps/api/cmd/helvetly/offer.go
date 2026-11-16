package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/store"
)

const offerUsage = `usage:
  helvetly offer catalog [-offer ID]
  helvetly offer validate FILE
  helvetly offer diff FILE
  helvetly offer publish -actor NAME -reason TEXT FILE
  helvetly offer override set -workspace ID -key KEY (-limit N | -unlimited | -enable | -disable) [-expires RFC3339] -actor NAME -reason TEXT
  helvetly offer override clear -workspace ID -key KEY -actor NAME -reason TEXT`

// offerCommand runs `helvetly offer …` on the database at DATABASE_URL: the operator's way to check, compare and
// publish an offer file and to give one workspace its own value of a limit. Every write is audited (offer_audit).
func offerCommand(args []string, out io.Writer) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is not set")
	}
	db, err := store.Open(ctx, url)
	if err != nil {
		return err
	}
	defer db.Close()
	return runOffer(ctx, db, args, out, time.Now().UTC())
}

func runOffer(ctx context.Context, db *store.Store, args []string, out io.Writer, now time.Time) error {
	if len(args) == 0 {
		return errors.New(offerUsage)
	}
	switch args[0] {
	case "catalog":
		return catalog(ctx, db, args[1:], out)
	case "validate", "diff", "publish":
		return offerFile(ctx, db, args[0], args[1:], out)
	case "override":
		if len(args) > 1 && (args[1] == "set" || args[1] == "clear") {
			return override(ctx, db, args[1], args[2:], out, now)
		}
	}
	return errors.New(offerUsage)
}

func offerFile(ctx context.Context, db *store.Store, cmd string, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("offer "+cmd, flag.ContinueOnError)
	actor := fs.String("actor", "", "who publishes (required)")
	reason := fs.String("reason", "", "why (required)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New(offerUsage)
	}
	f, err := os.Open(fs.Arg(0))
	if err != nil {
		return err
	}
	defer f.Close()
	o, err := billing.ParseOffer(f)
	if err != nil {
		return err
	}
	switch cmd {
	case "validate":
		defs, err := db.LimitDefs(ctx)
		if err != nil {
			return err
		}
		if err := o.Validate(defs); err != nil {
			return err
		}
		fmt.Fprintf(out, "valid: %s, %d records, checksum %s\n", o.ID, len(o.Records), o.Checksum())
	case "diff":
		cur, err := db.CurrentOffer(ctx)
		if err != nil {
			return fmt.Errorf("reading the current offer: %w", err)
		}
		old, err := billing.LoadOffer(cur)
		if err != nil {
			return err
		}
		n, err := db.WorkspacesOnOffer(ctx, cur.ID)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "current %s (checksum %s, %d workspaces stay on it) -> %s (checksum %s)\n", cur.ID, cur.Checksum, n, o.ID, o.Checksum())
		for _, line := range billing.DiffOffers(old, o) {
			fmt.Fprintln(out, line)
		}
	case "publish":
		if err := billing.PublishOffer(ctx, db, o, *actor, *reason); err != nil {
			return err
		}
		fmt.Fprintf(out, "published %s (checksum %s): new subscriptions get it; workspaces keep their offer\n", o.ID, o.Checksum())
	}
	return nil
}

// catalog prints the Stripe catalogue of the offer on sale (or -offer's) as JSON, for the billing repository's
// catalogue tool: the prices are kept in the offer, not copied by hand.
func catalog(ctx context.Context, db *store.Store, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("offer catalog", flag.ContinueOnError)
	id := fs.String("offer", "", "a published offer's id; none: the one on sale")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New(offerUsage)
	}
	v, err := db.CurrentOffer(ctx)
	if *id != "" {
		v, err = db.Offer(ctx, *id)
	}
	if err != nil {
		return fmt.Errorf("reading the offer: %w", err)
	}
	c, err := billing.ExportCatalog(v)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(c)
}

func override(ctx context.Context, db *store.Store, cmd string, args []string, out io.Writer, now time.Time) error {
	fs := flag.NewFlagSet("offer override "+cmd, flag.ContinueOnError)
	ws := fs.String("workspace", "", "workspace id (required)")
	key := fs.String("key", "", "feature or limit key (required)")
	limit := fs.Int64("limit", -1, "limited to this value (0 or more)")
	unlimited := fs.Bool("unlimited", false, "unlimited, where the key allows it")
	enable := fs.Bool("enable", false, "a feature: enabled")
	disable := fs.Bool("disable", false, "a feature: disabled")
	expires := fs.String("expires", "", "when it ends (RFC 3339); none: until cleared")
	actor := fs.String("actor", "", "who sets it (required)")
	reason := fs.String("reason", "", "why (required)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *ws == "" || *key == "" || fs.NArg() != 0 {
		return errors.New(offerUsage)
	}
	if cmd == "clear" {
		if err := billing.ClearWorkspaceOverride(ctx, db, *ws, *key, *actor, *reason); err != nil {
			return err
		}
		fmt.Fprintf(out, "cleared %s for %s: its plan's value applies\n", *key, *ws)
		return nil
	}
	w := store.WorkspaceLimit{WorkspaceID: *ws, Key: *key, Reason: *reason}
	chosen := 0
	if *limit >= 0 {
		w.State, w.Value, chosen = billing.StateLimited, limit, chosen+1
	}
	for state, on := range map[string]bool{billing.StateUnlimited: *unlimited, billing.StateEnabled: *enable, billing.StateDisabled: *disable} {
		if on {
			w.State, chosen = state, chosen+1
		}
	}
	if chosen != 1 {
		return errors.New("give exactly one of -limit, -unlimited, -enable and -disable")
	}
	if *expires != "" {
		t, err := time.Parse(time.RFC3339, *expires)
		if err != nil {
			return fmt.Errorf("-expires: %w", err)
		}
		w.ExpiresAt = &t
	}
	if err := billing.SetWorkspaceOverride(ctx, db, w, *actor, now); err != nil {
		return err
	}
	fmt.Fprintf(out, "set %s for %s: %s\n", *key, *ws, w.State)
	return nil
}
