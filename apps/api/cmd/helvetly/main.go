// Command helvetly runs the API and serves the embedded platform frontend.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/aiwrite"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/avatars"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/books"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/dashboard"
	"helvetly.com/api/internal/dataexport"
	"helvetly.com/api/internal/delivery"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/dunning"
	"helvetly.com/api/internal/einvoice"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/employees"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/feedback"
	"helvetly.com/api/internal/heidi"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/instalments"
	"helvetly.com/api/internal/invitations"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/ledger"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mcp"
	"helvetly.com/api/internal/members"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/platform"
	"helvetly.com/api/internal/portal"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/products"
	"helvetly.com/api/internal/quotes"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/server"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/templates"
	"helvetly.com/api/internal/uidregister"
	"helvetly.com/api/internal/vatreturn"
	"helvetly.com/api/internal/workspaces"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" { // the container's probe: the image has no shell or curl
		if err := healthcheck(os.Getenv("HTTP_ADDR"), os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "retention" { // `helvetly retention …`: storage protection status and backfill
		if err := runRetention(os.Args[2:], os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "offer" { // `helvetly offer …`: validate, diff and publish offers; workspace overrides
		if err := offerCommand(os.Args[2:], os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DevSecretKey {
		slog.Warn("SECRET_KEY is empty: using a fixed development key (AUTH_DEV_SIGNIN); never do this in production")
	}
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := aimodel.SettleUncertain(ctx, db, time.Now()); err != nil {
		return err
	}
	bg := &jobs{restartDelay: time.Minute}
	authSvc, err := auth.New(cfg, db, slog.Default())
	if err != nil {
		return err
	}
	authSvc.OnJoin = notifications.MemberJoined
	authSvc.BearerRoutes = openapi.BearerRoutes("POST /api/mcp") // API tokens: the public catalogue and MCP only
	authSvc.BearerMember = permissions.MayUseAPI
	for _, r := range openapi.Resources() {
		authSvc.TokenResources = append(authSvc.TokenResources, r.Name)
	}
	files, err := storage.New(cfg.S3, db)
	if err != nil {
		return err
	}
	var media *storage.Media // MEDIA_URL: downloads redirect to signed links on that host, served below
	downloads := map[bool]string{true: "proxy", false: "presigned"}[cfg.S3.ProxyDownloads]
	if cfg.MediaURL != "" {
		if media, err = storage.NewMedia(cfg.MediaURL, cfg.SecretKey); err != nil {
			return err
		}
		files.UseMedia(media)
		downloads = "media"
	}
	slog.Info("object storage", "addressing", map[bool]string{true: "virtual", false: "path"}[cfg.S3.VirtualHosted],
		"downloads", downloads,
		"protection", describeMode(retention.Mode(files), cfg.S3.ObjectLockDays))
	portalScopes := portalscope.New(cfg.PortalURL, db.Q)
	clientsSvc := clients.New(db, authSvc, files, slog.Default())
	var mailer invoices.Mailer // stays a nil interface without a mail server: sending answers 503
	var inviteMailer invitations.Mailer
	var signMailer signatures.Mailer
	var templateMailer templates.Mailer
	var notifyMailer notifications.Mailer
	var portalInviteMailer clients.Mailer
	var feedbackMailer feedback.Mailer
	var quoteMailer quotes.Mailer
	var businessMail *mail.Metered // counts business email against the workspace's allowances once billing is wired
	if cfg.MailConfigured() {
		sender := mail.NewSender(cfg.SMTP, cfg.PublicURL)
		businessMail = &mail.Metered{Sender: sender}
		inviteMailer, feedbackMailer = sender, sender                                                                                                                          // joining a workspace and feedback to Helvetly: no business limit
		mailer, signMailer, templateMailer, notifyMailer, portalInviteMailer, quoteMailer = businessMail, businessMail, businessMail, businessMail, businessMail, businessMail // two vars: copying a nil interface between types is fine, a typed nil pointer is not
	}
	clientsSvc.SetMailer(portalInviteMailer, portalScopes)
	var uidRegister uidregister.Register // nil with UID_REGISTER_URL=off: lookups answer "unavailable"
	if cfg.UIDRegisterURL != "" {
		reg := uidregister.New(cfg.UIDRegisterURL)
		uidRegister = reg
		clientsSvc.SetRegister(reg)
	}
	invoicesSvc := invoices.New(db, authSvc, files, mailer, slog.Default())
	authSvc.CompleteOnboarding = invoicesSvc.CompleteOnboarding
	quotesSvc := quotes.New(db, authSvc, invoicesSvc, files, quoteMailer, slog.Default())
	membersSvc := members.New(db, authSvc, slog.Default())
	invitationsSvc := invitations.New(db, authSvc, inviteMailer, cfg.PublicURL, slog.Default())
	productsSvc := products.New(db, authSvc, slog.Default())
	engagementsSvc := engagements.New(db, authSvc, invoicesSvc, slog.Default())
	engagementsSvc.SetMailer(mailer, cfg.PublicURL)
	instalmentsSvc := instalments.New(db, authSvc, invoicesSvc, files, slog.Default())
	instalmentsSvc.SetMailer(mailer)
	billingSvc, err := billing.New(ctx, db, authSvc, cfg, slog.Default())
	if err != nil {
		return err
	}
	db.SetAdmission(billingSvc.AllowResource)
	if businessMail != nil {
		businessMail.Meter = billingSvc
	}
	bg.Go(ctx, "storage count", files.RunReconcile) // every 10 min: counted objects whose write storage never confirmed
	db.SetFeatureGate(billingSvc.RequireFeature)
	// a job leaves an automatic action refused for a used-up limit alone until the month or the cap changes
	db.SetAutomationWait(billingSvc.AutomationWaits)
	membersSvc.SetSeats(billingSvc)      // a member who leaves frees a seat
	invitationsSvc.SetSeats(billingSvc)  // an accepted invitation takes one
	instalmentsSvc.SetLimits(billingSvc) // the job issues invoices outside the guarded routes
	// a new plan's items already due are issued at once, not at the job's next hourly tick
	invoicesSvc.SetPlanCreated(instalmentsSvc.Wake)
	dunningSvc := dunning.New(db, authSvc, invoicesSvc, files, slog.Default())
	dunningSvc.SetMailer(mailer)
	engagementsSvc.AddDigestSource(instalmentsSvc)
	engagementsSvc.AddDigestSource(dunningSvc)
	bg.Go(ctx, "engagements", engagementsSvc.Run) // hourly: automatic drafts, notices and the daily digest
	bg.Go(ctx, "instalments", instalmentsSvc.Run) // hourly: due plan items and reminders
	bg.Go(ctx, "billing seats", billingSvc.Run)   // hourly: per-seat subscriptions billed for the members they have
	bg.Go(ctx, "dunning", dunningSvc.Run)         // hourly: due dunning levels
	if retention.Mode(files) != "" {
		bg.Go(ctx, "retention", retention.NewJob(db, files, slog.Default()).Run) // every 10 min: Object Lock left pending after a commit
	}
	booksSvc := books.New(db, authSvc)
	ledgerSvc := ledger.New(db, authSvc)
	vatReturnSvc := vatreturn.New(db, authSvc)
	bg.Go(ctx, "vat return", vatReturnSvc.Run) // hourly: "VAT return ready to file" once a period ends
	einvoiceSvc := einvoice.New(db, authSvc, files)
	invoicesSvc.SetEInvoice(einvoiceSvc.Export) // invoice emails attach the XML a client asked for
	deliverySvc, err := delivery.New(db, authSvc, einvoiceSvc.Export, cfg.SecretKey, slog.Default(), delivery.FileExport{})
	if err != nil {
		return err
	}
	bg.Go(ctx, "delivery", deliverySvc.Run) // every minute: queued e-invoice transmissions
	expensesSvc := expenses.New(db, authSvc, files, slog.Default())
	documentsSvc := documents.New(db, authSvc, files, cfg.DocumentsMaxUpload, slog.Default())
	employeesSvc := employees.New(db, authSvc, documentsSvc, cfg.SecretKey, slog.Default())
	signaturesSvc := signatures.New(db, authSvc, files, signMailer, cfg.PublicURL, slog.Default())
	templatesSvc := templates.New(db, authSvc, files, templateMailer, signaturesSvc, slog.Default())
	bg.Go(ctx, "documents trash", documentsSvc.Run) // purges the Trash
	notificationsSvc := notifications.New(db, authSvc, notifyMailer, cfg.PublicURL, cfg.SecretKey, slog.Default())
	bg.Go(ctx, "notification emails", notificationsSvc.Run) // batched notification emails
	workspacesSvc := workspaces.New(db, authSvc, billingSvc, files, slog.Default())
	workspacesSvc.SetPortal(portalScopes)
	// The one-time workspace-name suggestion is pinned to the cheapest model, whatever model Heidi is set to.
	var nameModel aimodel.Provider = aimodel.NewOpenAI(cfg.AI.OpenAIKey, cfg.AI.OpenAIBaseURL, aimodel.DefaultModel)
	if cfg.AI.FakeImportModel {
		nameModel = aimodel.Fake{}
	}
	workspacesSvc.SetNamer(nameModel)
	dashboardSvc := dashboard.New(db, authSvc)
	exportSvc := dataexport.New(db, authSvc, files, slog.Default())
	exportSvc.SetHR(employeesSvc)
	exportSvc.SetSnapshots(billingSvc.ReserveSnapshot)    // the owner's whole export: its own small allowance
	bg.Go(ctx, "workspace backups", exportSvc.RunBackups) // every minute: the archive of each deleted workspace
	model := aimodel.NewOpenAI(cfg.AI.OpenAIKey, cfg.AI.OpenAIBaseURL, cfg.AI.Model)
	heidiSvc := heidi.New(db, authSvc, files, engagementsSvc, heidi.Options{
		Provider: model, Allowance: billingSvc.AITokens, CostAllowance: billingSvc.AICost, AllowStorage: billingSvc.AllowStorage,
		File: documentsSvc.QueueFiling,
	})
	importModel := model
	if cfg.AI.FakeImportModel {
		importModel = aimodel.Fake{}
	}
	importsSvc := imports.New(db, authSvc, files, slog.Default(), imports.Options{
		Provider: importModel, Allowance: billingSvc.AIAutomationTokens, CostAllowance: billingSvc.AIAutomationCost, AllowStorage: billingSvc.AllowStorage,
		File: documentsSvc.QueueFiling,
	})
	bg.Go(ctx, "imports", importsSvc.Run) // every few seconds: queued import files
	if importModel != nil {
		// counted in the automation pool with AI import, never in Heidi's
		documentsSvc.SetFiler(importModel, aimodel.Budget{DB: db, Pool: aimodel.PoolAutomation,
			Allowance: billingSvc.AIAutomationTokens, CostAllowance: billingSvc.AIAutomationCost,
			Now: func() time.Time { return time.Now().UTC() }}, imports.Text)
		bg.Go(ctx, "documents AI filing", documentsSvc.RunFiling) // every few seconds: uploads to tag and file
	}
	// "Write with AI" is counted in Heidi's pool, never the automation pool; the fake model answers in development.
	aiWriteSvc := aiwrite.New(db, authSvc, importModel, aimodel.Budget{DB: db, Pool: aimodel.PoolHeidi,
		Allowance: billingSvc.AITokens, CostAllowance: billingSvc.AICost, Now: func() time.Time { return time.Now().UTC() }})
	emailTemplatesSvc := emailtemplate.New(db, authSvc)
	feedbackSvc := feedback.New(db, authSvc, files, feedbackMailer, cfg.FeedbackEmail, slog.Default())
	avatarsSvc := avatars.New(db, authSvc, files, slog.Default())
	authSvc.OnPhotoRemoved = avatarsSvc.RemoveObject
	portalSvc := portal.New(db, authSvc, files, portalScopes, portal.Config{SessionTTL: cfg.SessionTTL, CookieSecure: cfg.CookieSecure}, slog.Default())
	mcpSvc := mcp.New(authSvc, openapi.Operations)
	api := func(mux *http.ServeMux) {
		mux.Handle("GET /api/ready", server.Ready(db.Ping))
		if media != nil {
			mux.Handle("GET /api/media/{token}", media.Handler(files)) // public: the signature is the permission
		}
		openapi.Register(mux)
		mcpSvc.Register(mux)
		authSvc.Register(mux)
		exportSvc.Register(mux)
		clientsSvc.Register(mux)
		uidregister.Routes(mux, authSvc, uidRegister)
		portalSvc.Register(mux)
		invoicesSvc.Register(mux)
		quotesSvc.Register(mux)
		dunningSvc.Register(mux)
		membersSvc.Register(mux)
		invitationsSvc.Register(mux)
		productsSvc.Register(mux)
		engagementsSvc.Register(mux)
		instalmentsSvc.Register(mux)
		booksSvc.Register(mux)
		vatReturnSvc.Register(mux)
		ledgerSvc.Register(mux)
		einvoiceSvc.Register(mux)
		deliverySvc.Register(mux)
		expensesSvc.Register(mux)
		documentsSvc.Register(mux)
		employeesSvc.Register(mux)
		signaturesSvc.Register(mux)
		templatesSvc.Register(mux)
		billingSvc.Register(mux)
		workspacesSvc.Register(mux)
		dashboardSvc.Register(mux)
		heidiSvc.Register(mux)
		aiWriteSvc.Register(mux)
		emailTemplatesSvc.Register(mux)
		feedbackSvc.Register(mux)
		avatarsSvc.Register(mux)
		importsSvc.Register(mux)
		notificationsSvc.Register(mux)
	}

	guarded := permissions.Guard(authSvc, billingSvc.Guard(server.New(platform.Handler(cfg.PortalURL, strings.HasPrefix(cfg.PublicURL, "https://")), api))) // scopes, then plan limits, before the handlers
	mcpSvc.SetAPI(guarded)                                                                                                                                  // tool calls pass the same guards as REST
	guarded = portalScopes.Handler(guarded)                                                                                                                 // /w/<slug>/… on the portal's host: resolved and unprefixed first
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           auth.ForwardedFor(cfg.TrustedProxies, openapi.CORS(cfg.DocsURL, guarded)), // the client address first; the docs playground's CORS before the guards
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second, // no ReadTimeout: it would cut large uploads
	}

	errs := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Addr, "google", cfg.GoogleSignIn(), "email", cfg.EmailSignIn(), "dev_sign_in", cfg.DevSignIn, "billing", cfg.BillingEnabled())
		errs <- srv.ListenAndServe()
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		if err := <-errs; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		deadline, _ := shutdownCtx.Deadline()
		if !bg.Wait(time.Until(deadline)) { // the jobs saw ctx end with the signal; ticks in flight finish before the pool closes
			slog.Warn("background jobs still running at the shutdown deadline")
		}
		slog.Info("stopped")
		return nil
	}
}
