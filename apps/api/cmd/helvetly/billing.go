package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"os"
	"os/signal"
	"syscall"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/store"
)

const billingUsage = `usage:
  helvetly billing reprice -workspace ID [-apply]   move a live subscription onto the offer on sale's tiered price
                                                    (dry run without -apply; discounts and coupons are kept)`

// billingCommand runs `helvetly billing …` against DATABASE_URL and the Stripe account of STRIPE_SECRET_KEY
// (STRIPE_API_BASE for a fake): the operator's one-off moves of a subscription, never run by CI.
func billingCommand(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] != "reprice" {
		return errors.New(billingUsage)
	}
	fs := flag.NewFlagSet("billing reprice", flag.ContinueOnError)
	ws := fs.String("workspace", "", "workspace id (required)")
	apply := fs.Bool("apply", false, "change the subscription; without it nothing changes")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if *ws == "" || fs.NArg() != 0 {
		return errors.New(billingUsage)
	}
	key, dbURL := os.Getenv("STRIPE_SECRET_KEY"), os.Getenv("DATABASE_URL")
	if key == "" || dbURL == "" {
		return errors.New("DATABASE_URL and STRIPE_SECRET_KEY must be set")
	}
	base := os.Getenv("STRIPE_API_BASE")
	if base == "" {
		base = "https://api.stripe.com"
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := store.Open(ctx, dbURL)
	if err != nil {
		return err
	}
	defer db.Close()
	return billing.Reprice(ctx, db, billing.NewStripeClient(key, base), *ws, *apply, out)
}
