# Helvetly

Business management for small companies, built around Swiss requirements: clients, quotes, invoices with Swiss QR
bills, expenses, documents, e-signatures, a client portal and bookkeeping exports. One Go binary serves the API, the
signed-in app and the client portal; data lives in PostgreSQL and files in an S3-compatible bucket.

> Status: under active development and not released. There are no release images or packages yet. Interfaces,
> settings and the database schema may still change.

## What it does

Each item below is implemented and covered by tests in this repository:

- **Sign-in and workspaces**: passwordless sign-in (emailed code, passkeys, Google), optional TOTP two-factor
  authentication, workspaces with owner/admin/member roles and email invitations, account and workspace data export.
- **Clients**: client records with contacts and files, numbered per workspace.
- **Quotes and invoices**: drafts, gapless numbering per series and year, eight document types (invoice, partial,
  prepayment, debit note, corrected, credit note, proforma, self-billed), payments, sending by email with the PDF, a
  Swiss QR bill page (QR-IBAN, QRR/SCOR), instalment schedules and plans, and dunning with fees and interest.
- **Expenses and documents**: receipts and a document store with SHA-256 deduplication per workspace.
- **Books**: closed periods, an append-only, hash-chained audit log of financial events, a Swiss VAT return (figures,
  CSV, PDF and the eCH-0217 file the ESTV ePortal imports), and a double-entry journal with exports for Banana, bexio,
  Abacus and CSV.
- **E-invoice files**: XRechnung (UBL/CII), Peppol BIS UBL, RO e-Factura (CIUS-RO) and Polish KSeF FA(3) XML of an
  issued invoice, and ZUGFeRD 2.x / Factur-X 1.0 (EN 16931): the issued PDF as PDF/A-3B with the CII XML embedded. Network delivery (Peppol access points, national APIs) is not built in; files can be exported.
- **Engagements**: committed work per client with a delivery log and draft invoices in advance or in arrears.
- **Signatures and templates**: simple electronic signatures (SES, not qualified) on PDFs with an audit trail, and
  PDF templates filled from client data.
- **Employees and payroll register**: records of the company's own staff (not users, no seats), pay terms with
  history, private employee documents with retention from researched rules, and a register of pay computed by a person
  or a payroll system (manual or CSV import), approved apart from paid, corrected by new entries, booked once.
- **Scheduling**: one-off and recurring sessions with clients (weekly, every N weeks, monthly; edited as one session,
  this and following, or all), online or live, hosted by members. Attendance with a cancellation policy, where late
  cancellations and no-shows use a session of an engagement or are invoiced. Invitations, updates and reminders by
  email with `.ics` files; requests to cancel or reschedule and self-booking in the portal, plus booking links for new
  clients. Two-way sync with Google Calendar and Microsoft 365 (optional) and a private iCal feed per member.
- **Client portal**: clients sign in on their own host to see invoices, engagements, sessions and shared documents.
- **Client emails**: every email to clients in the business's name, in the client's language, with Helvetly's own
  wording (changed only per email in a Send dialog), an optional footer, and one Settings page to turn each automatic
  email on or off.
- **Notifications**: in-app and email notifications with per-person preferences.
- **Subscription billing (optional)**: a free plan for one person, paid plans with tiered team prices through Stripe
  Checkout and webhooks, and plan limits. Off without a Stripe key.
- **Workspace audit (optional AI)**: from the dashboard, review inconsistencies between clients, invoices, quotes, expenses, contracts, bank evidence and tax documents. Findings show severity, linked evidence and a suggested next step.
- **AI features (optional)**: an assistant (Heidi) and AI-assisted imports through an OpenAI-compatible API, used
  only after each user approves AI use for themselves in that workspace. Heidi answers from permitted workspace
  records, reads attachments and documents on request, and proposes actions for confirmation. Each member can
  manage their learned topics and reply style in Account settings. Off without an API key.
- **Public API and MCP**: personal API tokens for a documented subset of the API (OpenAPI 3.1 at
  `/api/v1/openapi.json`) and a Model Context Protocol endpoint over the same operations.

Helvetly holds no certification. The legal texts in `apps/web/content/legal` are drafts under review.

## Architecture

```text
apps/api        Go API; builds the single `helvetly` binary, which embeds the two static exports below
apps/platform   the signed-in app (Next.js static export)
apps/portal     the client portal (Next.js static export, served for PORTAL_URL's host)
apps/web        the public website (Next.js static export, deployed on its own)
packages/i18n   translation runtime, locale registry and static-export configuration
packages/ui     shared components (shadcn/ui), theme, logo
e2e             Playwright end-to-end and visual tests against the real API
```

The binary serves `/api/*` on every host, the portal for requests to `PORTAL_URL`'s host and the platform for any
other host. It applies database migrations at start. `GET /api/health` answers while the process runs;
`GET /api/ready` also checks the database. The developer documentation site is maintained separately.

Stack: Go (standard library `net/http`, pgx, goose), PostgreSQL, Next.js 16, React 19, Tailwind CSS 4, shadcn/ui,
TanStack Query, Turborepo, Vitest, Storybook and Playwright.

## Languages

All interfaces keep their English source catalogs (`src/messages/en.json`) in each app and `packages/ui`.
The public website, signed-in application and client portal support English (`en-GB`), Swiss Standard
German (`de-CH`), French (`fr-CH`) and Italian (`it-CH`). The applications' enabled languages are listed
in `browserLocales` in `packages/i18n/src/locales.json`; enable another language there only after
translating both applications.
The public website additionally supports Dutch (`nl-NL`), Czech (`cs-CZ`) and Swedish (`sv-SE`),
including help, guides and legal texts. These languages are public-only; platform and portal language
selection falls back to an existing preference, a supported browser language or English.
The shared `packages/i18n` runtime provides typed keys, ICU messages, interpolation and English fallback.
User data, API identifiers and the language of issued financial documents remain separate from interface language.

To enable another language, add it to `packages/i18n/src/locales.json`, add its JSON catalogs next to
`en.json`, and import them into each `src/lib/i18n.ts` (`createMessages({ en, de, fr, it })` in platform and portal,
`createTranslators` with all public catalogs on the website). Public-only languages stay out of `browserLocales`.
Translate complete messages; ICU plural rules are available for counts.
Marketing and documentation keep English at the existing URLs; other languages use prefixes such as `/de/`.
The website is one static export and one `next dev` server for every configured language: English pages live in
`apps/web/src/app/(default)` at the root, the others in `app/[lang]`, and both render the same page components.

Platform and portal keep all routes unprefixed. Open a link with `?lang=en` to select a supported language and save it
under `helvetly.language` in that origin's `localStorage`. Without a supported query parameter, the saved
language is used, then English. The language menu changes `?lang` while preserving other query parameters
and the fragment; switching reloads the page so module-level labels use the selected language too.
Blocked storage still allows explicit language links. Each origin keeps its own preference.
The menu appears only when more than one language is enabled. Adding languages requires a rebuild.

Marketing Markdown overrides live in `content/<collection>/<locale>/`, alongside the existing English files;
missing files fall back to English. Keep category identifiers stable and translate their displayed labels.
The separately maintained developer documentation has its own locale registry and catalogs.

## Requirements

- Node 26 (`.nvmrc`) and pnpm 12. Node 26 does not ship Corepack: install pnpm with
  `npm install --global pnpm@12.16.1` (the version in `package.json`).
- Go 1.27 (`apps/api/go.mod`).
- Docker with Compose, for the local PostgreSQL, S3 (MaxIOFS), Mailpit and Stripe CLI services.

## Quick start

```bash
pnpm install
cp .env.example .env     # the defaults work locally
pnpm infra:up            # PostgreSQL :5433, S3 :9300, Mailpit :8026, all on 127.0.0.1
pnpm dev                 # API :3333, platform :8000, web :8001, portal :8002
```

Open http://localhost:8000, enter any email address and read the sign-in code in Mailpit at http://localhost:8026.
The first sign-in creates the account and its workspace. Every setting is described in [.env.example](.env.example).
The Stripe CLI service exits at once without a test-mode `STRIPE_SECRET_KEY`; billing is then off.

## Build and test

```bash
pnpm build          # web, platform, portal, then apps/api/bin/helvetly
pnpm test           # unit tests; the Go tests need the local PostgreSQL (pnpm infra:up)
pnpm check          # the full gate: format, lint, typecheck, tests, builds, Storybook, E2E, e-invoice validation
```

`pnpm check` also needs Chromium for Playwright (`pnpm --filter @helvetly/e2e exec playwright install chromium`)
and Docker: E2E starts its own PostgreSQL and S3, and the e-invoice validation runs the official KoSIT validator in
a container.

## Self-hosting

Build the binary (`pnpm build`) or the container image (`docker build -t helvetly .`) and run it with your own
PostgreSQL, S3 bucket, SMTP server and a reverse proxy that terminates TLS for two host names (the platform and the
client portal) and passes the `Host` header through.

### The container image

| Item           | Value                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process        | `/usr/local/bin/helvetly`, uid 65532, no shell; needs no writable path except `/tmp` (give it a volume)                                                                       |
| Listen         | `HTTP_ADDR`, default `:3333`, plain HTTP behind your TLS proxy                                                                                                                |
| Hosts          | `PORTAL_URL`'s host and workspaces' active custom domains get the client portal, any other host the platform; `/api/*` is the API on both                                     |
| Health         | `GET /api/health` (process), `GET /api/ready` (also the database); `helvetly healthcheck [ready\|health]`                                                                     |
| Settings       | environment only, validated at start; a bad value stops the start with a message naming it                                                                                    |
| Migrations     | applied at start, forward only                                                                                                                                                |
| Stop           | SIGTERM drains requests and background work within 15 s; allow at least 30 s                                                                                                  |
| Client address | `X-Forwarded-For` is believed only from `TRUSTED_PROXY_CIDRS` (set it to your proxy; `cloudflare` adds Cloudflare's ranges and lets `CF-IPCountry` pick the billing currency) |

Production needs at least `DATABASE_URL`, `PUBLIC_URL`, `PORTAL_URL` (another host), `SECRET_KEY`
(`openssl rand -base64 32`; keep a backup), `SMTP_*`, `MAIL_FROM` and the five `S3_*` settings; never set
`AUTH_DEV_SIGNIN`. Every setting is described in [.env.example](.env.example). Build-time values
(`NEXT_PUBLIC_*`, Docker build arguments) end up in the browser's JavaScript: public URLs only, never secrets.

### Calendar sync

Optional, with Scheduling: each member connects their own Google Calendar or Microsoft 365 / Outlook calendar.
Sessions are pushed to it (the client is never invited by the provider: Helvetly sends the invitations), Meet or Teams
links are made through it, and the member's busy times come back without titles. Each provider is offered only when
its two settings are set: `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` (a Google Cloud OAuth client
of its own, not the sign-in one, with the Calendar API and the scopes `calendar.events` and
`calendar.calendarlist.readonly`), and `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` (an Entra ID app for
work, school and personal accounts with the delegated Graph permissions `openid email offline_access User.Read
Calendars.ReadWrite`; `MICROSOFT_TENANT` defaults to `common`). Register the redirect URIs
`<PUBLIC_URL>/api/v1/scheduling/calendars/google/callback` and `…/microsoft/callback`. Change notifications arrive at
`<PUBLIC_URL>/api/webhooks/google-calendar` and `/api/webhooks/microsoft-graph` (allow them past any bot challenge);
without a public https `PUBLIC_URL` calendars are polled every 15 minutes instead. Tokens are sealed with `SECRET_KEY`.
Every member also has a private iCal feed (`/api/v1/public/calendar/<token>.ics`) for Apple Calendar and others; do
not cache it at a proxy.

### Custom portal domains

Optional, on the Business plan: a workspace serves its client portal on its own host (`portal.firma.ch`) instead of
`PORTAL_URL/w/<slug>/`, through Cloudflare for SaaS custom hostnames. It needs a Cloudflare zone with Cloudflare for
SaaS and three settings, all or none: `CLOUDFLARE_API_TOKEN` (Zone · SSL and Certificates · Edit on that zone only),
`CLOUDFLARE_ZONE_ID` and `CUSTOM_DOMAIN_TARGET`, a proxied hostname on the zone that is its custom-hostname fallback
origin and reaches this binary; normally `PORTAL_URL`'s host, so customers point their CNAME at the portal's own
address. Your proxy must send requests for any other host from Cloudflare (and only from Cloudflare's ranges) to the
binary with the `Host` header unchanged; the origin never needs a certificate for a customer's domain.

The workspace's settings show two records: `portal.firma.ch CNAME portal.helvetly.com` and the TXT record Cloudflare
names for the custom hostname (`_cf-custom-hostname.portal.firma.ch`). Helvetly creates the custom hostname (HTTP
certificate validation, which Cloudflare completes once the CNAME is in place), follows it, and checks the TXT record
itself: Cloudflare activates a hostname on its CNAME alone, which a dangling record left by a former customer would
give anyone, so the domain goes active only when Cloudflare reports the hostname and its certificate active and the TXT
record has proved ownership once. On such a host only the portal and its API are served, never the platform; with
custom domains on, any host that is neither the installation's nor an active domain gets 404 for everything but the
health checks.

A domain that breaks (CNAME removed, certificate lost, the name moved to another Cloudflare account) falls back to
`/w/<slug>/` at once and the owners are told. A domain pending or failed for 14 days is released and its custom
hostname deleted; a workspace that proves it owns a name another workspace holds without proof (its own TXT record
`_helvetly-verify.<host>`, shown when it tries) takes it over. A plan without the feature turns a domain off; a proven
one is kept and comes back with the plan, an unproven one is released after 14 days. A deleted workspace keeps its
domain for the 30 days it may be restored. A daily cleanup deletes the zone's custom hostnames the app made that no
domain holds any more (a failed delete, a row never stored); names no domain ever had are left alone.

Scale: Cloudflare for SaaS includes 100 custom hostnames on the Free, Pro and Business zone plans, charges USD 0.10 a
month for each further one, and allows at most 50 000 (more on Enterprise). Cloudflare's API allows 1200 calls per five
minutes per user, shared with Terraform and the dashboard; each instance makes at most two a second and pauses when
Cloudflare answers 429 (for its Retry-After, else five minutes). Every domain is checked on its own by id: pending ones
with backoff (1 minute doubling to an hour, refreshing Cloudflare's validation), the others daily. A tick claims up to
100 due domains (`FOR UPDATE SKIP LOCKED`, so instances never check one twice) and checks them four at a time. The
cleanup walks the zone's list by `result_info`, 1000 a page asked, whatever page size Cloudflare grants.

### Releases

A release is a `v<semver>` tag on `main` whose `CI required` check passed; `.github/workflows/release.yml` publishes
`ghcr.io/helvetly/helvetly:<tag>` with a build provenance attestation. Deploy the digest, not the tag, and check it:
`gh attestation verify oci://ghcr.io/helvetly/helvetly@sha256:<digest> --repo Helvetly/helvetly
--signer-workflow Helvetly/helvetly/.github/workflows/release.yml --source-ref refs/tags/<tag>`. Rolling back the image
does not roll the database back: restore it to a point before an upgrade that changed the schema.

### PostgreSQL

The tests run against PostgreSQL 18; older versions are not tested. The database user must be able to create tables
in its schema, because migrations run at every start (under an advisory lock, so several instances can start at
once). For a remote database use TLS with certificate verification (`sslmode=verify-full`). Back it up with
point-in-time recovery and try a restore once.

### Object storage

Any service with the S3 API: `PutObject`, `GetObject` (with `Range`), `HeadObject`, `DeleteObject`, `CopyObject` and
presigned `GET` (SigV4) on one bucket, with credentials limited to that bucket. `S3_ADDRESSING` picks path-style
(default) or virtual-hosted addressing. Downloads are 5-minute presigned URLs, or streamed through the API with
`S3_PROXY_DOWNLOADS=true` when browsers cannot reach the bucket. Back the bucket up separately: database backups do
not include the files.

**Storage is not an archive.** Helvetly can lock issued invoice PDFs, booked receipts and signed documents with S3
Object Lock (`S3_OBJECT_LOCK_DAYS`), but only in a bucket created with Object Lock, which many S3-compatible services
do not offer. Without it, anyone holding the bucket's credentials can delete or overwrite files, and
`helvetly retention status` reports them as not protected. A legal retention duty (for example OR 958f and GeBüV in
Switzerland) also needs backups, access control and a documented process, which this software alone does not provide.

### Operator alerts on Telegram

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` in the API's runtime environment to enable alerts.
Create a bot with [@BotFather](https://t.me/BotFather), open a private chat with the bot and send `/start`.
Use the Telegram Bot API's [getUpdates](https://core.telegram.org/bots/api#getupdates) method privately and
take `message.chat.id` from your own message (the chat type must be `private`). Keep the bot token in your
deployment's secret store.

The bot reports new accounts, Help & feedback submissions, Stripe subscription starts and cancellations,
and Stripe disputes when Helvetly first records them as open. Messages are in Polish and contain internal
IDs instead of email addresses, feedback text or screenshots. Keep `FEEDBACK_EMAIL` configured to receive
the full reports. Alerts queue in PostgreSQL from the time the integration is enabled, retry for up to seven
days and may arrive twice if delivery succeeds before the server can confirm it in the database.

### Billing

Billing is optional. With `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set, prices are read from your Stripe
account by lookup key `<offer>_<basic|pro|business>_<month|year>` (such as `helvetly-v2_pro_month`): recurring,
graduated tiered prices (a flat amount for the people the plan includes, then each further person) whose quantity is
the workspace's people, with the metadata `helvetly_pricing=per_seat`. Create those prices in your own Stripe account;
`helvetly offer catalog` prints them from the published offer, and `helvetly billing reprice -workspace ID [-apply]`
moves a live subscription onto the current offer's price. Before deploying a release that publishes a new offer
in a migration, export its catalogue from a staging database on that release and provision its lookup keys in
Stripe. A workspace without a paid plan is on Free (one person,
no card, no end; nothing is deleted, additions beyond Free's limits are refused). Plan features and limits come from a
published offer: `limits` defines every key, `offer_versions` keeps each published offer (never changed afterwards),
`limit_plans` its values per plan (a feature enabled or disabled, a limit limited or unlimited, growing with every
paid seat where the offer says so), and `limit_workspaces` gives one workspace its own value until it expires. A
workspace stays on the offer it subscribed under. `helvetly offer validate|diff|publish FILE` checks, compares and
publishes an offer file, and `helvetly offer override set|clear` sets one workspace's value; each change is audited
in `offer_audit`. `GET /api/v1/public/offers/current` serves the current prices and public comparison. Monthly
limits count per UTC calendar month (a trial's, for the whole trial) in `usage_events`, one row per counted operation
(an issued invoice, an expense's first save, a sent signature package), kept when the record is deleted; drafts,
quotes, clients, products and engagements count what exists. Without billing, no plan limit applies. The webhook endpoint is `<PUBLIC_URL>/api/webhooks/stripe`.
Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.*`,
`charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` and `charge.refunded`. An opened dispute
alerts the owners and admins; a lost one ends the subscription it paid at once, or takes back the AI token pack's
tokens (as much as is left this month). A full refund takes back a pack's tokens; a refunded subscription payment
changes nothing, since you cancel the subscription yourself if you mean to. The endpoint's API version does not
matter: billing reads only the event's id, type and object id, and reads the object again from Stripe with its pinned
version, so a version change needs no new endpoint or secret. Only while rotating the signing secret, set
`STRIPE_WEBHOOK_SECRET=whsec_new,whsec_old`: both verify, and an event delivered twice is applied once.

Every accepted member (owner, accountant and read-only included) counts as one person on the one subscription
item; the price includes the plan's first people (Basic 1, Pro 2, Business 5) and charges each further one, up to the
plan's most people (Basic 5, Pro 25, Business unlimited). Pooled limits grow with the paid people, counting at least
the included ones. Open invitations and outside recipients are none. A
Checkout records what it sells (offer, plan, interval, currency, price, seats) in `billing_checkouts` before Stripe is
asked, and the webhook settles the subscription only when it matches, putting the workspace on that offer. More seats
than are paid for the period, an upgrade and monthly to yearly are invoiced at once and granted once paid. A smaller
plan and yearly to monthly are scheduled for the paid period's end (a subscription schedule), and fewer seats are
billed from the renewal; nothing is credited and no data is deleted, though new growth beyond the smaller plan is
refused. Increases of the costly monthly allowances (AI, email, transfer, automations) are granted pro rata to what is
left of the UTC month. When a renewal fails, new AI work stops at once and the rest keeps working until three days
after the paid period ended; then the workspace is on Free until the invoice is paid (Stripe's retries continue
meanwhile). A second subscription of the same workspace is cancelled with its unused time credited.

The trial is the offer's (`trial`): its plan's features and limits for one person, for its days and seats (the
current offer: Pro for 14 days and up to 2 people, no overrides; a trial's monthly limits are one pool for the whole
trial). It needs a card, and a customer gets one: the person, their email and their card's fingerprint are kept as
digests in `trial_claims`, and a trial started again with a known card is ended at once. All trials together spend
at most USD 20 a day on the AI model.

AI token packs (one-time prices of the product `helvetly_ai_tokens`) are no longer sold; a pack paid before still adds
its tokens to the plan's monthly AI allowance for its month. With `STRIPE_MANAGED_PAYMENTS=true`, Checkout uses
Stripe Managed Payments (Stripe is the merchant of record); the products then need an eligible tax code such as
`txcd_10103001`.

## Known limitations

- Not released: no published images or packages, no upgrade guarantees yet.
- The business year is the calendar year.
- E-invoice network delivery (Peppol, KSeF API) is not wired; the XML export works.
- File retention needs S3 Object Lock (above); there are no qualified timestamps or qualified e-signatures.
- Scheduling reads no replies from calendars (no inbound mail) and has no CalDAV / iCloud two-way sync; Apple Calendar
  subscribes to the read-only feed. Employees cannot host sessions: hosts are members.
- The employees module calculates no pay, tax or contributions and produces no payslips, certificates or filings: it
  records and exports what a person or a payroll system computed. Jurisdiction data is research, not legal advice.

## Contributing, security and license

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, commits, pull requests and the quality gate.
- [AGENTS.md](AGENTS.md): layout and conventions, for people and coding agents.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- License: GNU Affero General Public License v3.0 only ([LICENSE](LICENSE), SPDX `AGPL-3.0-only`). Third-party
  material keeps its own license ([NOTICE](NOTICE)). Contributions are welcome under the
  [Contributor License Agreement](CONTRIBUTING.md#contributor-license-agreement).
