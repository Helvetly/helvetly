package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// runRetention: `helvetly retention status` prints the protection mode and the objects per status; `helvetly retention
// backfill [-apply] [-limit N]` lists (or, with -apply, queues) business-record objects without a protection request.
func runRetention(args []string, out io.Writer) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(args) == 0 || (args[0] != "status" && args[0] != "backfill") {
		return fmt.Errorf("usage: helvetly retention status | backfill [-apply] [-limit N]")
	}
	fs := flag.NewFlagSet("retention "+args[0], flag.ContinueOnError)
	apply := fs.Bool("apply", false, "queue the listed objects (default: only list them)")
	limit := fs.Int("limit", 1000, "at most this many objects per run; run again to continue")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	files, err := storage.New(cfg.S3, db)
	if err != nil {
		return err
	}
	mode := retention.Mode(files)
	fmt.Fprintf(out, "protection: %s\n", describeMode(mode, cfg.S3.ObjectLockDays))
	if args[0] == "status" {
		counts, err := db.RetentionCounts(ctx)
		if err != nil {
			return err
		}
		for _, s := range []string{store.RetentionNotRequested, store.RetentionPending, store.RetentionFailed, store.RetentionConfirmed} {
			fmt.Fprintf(out, "%-14s %d\n", s, counts[s])
		}
		return nil
	}
	todo, err := retention.Backfill(ctx, db, files, *limit, *apply, time.Now())
	if err != nil {
		return err
	}
	for _, b := range todo {
		fmt.Fprintf(out, "%s\t%s\t%s\n", b.WorkspaceID, b.Day.Format(time.DateOnly), b.Key)
	}
	verb := "would queue"
	if *apply {
		verb = "queued"
	}
	if mode == "" {
		verb += " as not_requested"
	}
	fmt.Fprintf(out, "%s %d objects\n", verb, len(todo))
	return nil
}

func describeMode(mode string, days int) string {
	if mode == "" {
		return "off (S3_OBJECT_LOCK_DAYS=0): objects are stored but never confirmed as protected"
	}
	return fmt.Sprintf("required, %s, at least %d days and to each record's business deadline", mode, days)
}
