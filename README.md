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
  issued invoice. Network delivery (Peppol access points, national APIs) is not built in; files can be exported.
- **Engagements**: committed work per client with a delivery log and draft invoices in advance or in arrears.
- **Signatures and templates**: simple electronic signatures (SES, not qualified) on PDFs with an audit trail, and
  PDF templates filled from client data.
- **Employees and payroll register**: records of the company's own staff (not users, no seats), pay terms with
  history, private employee documents with retention from researched rules, and a register of pay computed by a person
  or a payroll system (manual or CSV import), approved apart from paid, corrected by new entries, booked once.
- **Client portal**: clients sign in on their own host to see invoices, engagements and shared documents.
- **Notifications**: in-app and email notifications with per-person preferences.
- **Subscription billing (optional)**: Stripe Checkout, webhooks, seats and plan limits. Off without a Stripe key.
- **AI features (optional)**: an assistant (Heidi) and AI-assisted imports through an OpenAI-compatible API, used
  only after a workspace owner or admin consents. Off without an API key.
- **Public API and MCP**: personal API tokens for a documented subset of the API (OpenAPI 3.1 at
  `/api/v1/openapi.json`) and a Model Context Protocol endpoint over the same operations.

Helvetly holds no certification. The legal texts in `apps/web/content/legal` are drafts under review.

## Architecture

```text
apps/api        Go API; builds the single `helvetly` binary, which embeds the two static exports below
apps/platform   the signed-in app (Next.js static export)
apps/portal     the client portal (Next.js static export, served for PORTAL_URL's host)
apps/web        the public website (Next.js static export, deployed on its own)
packages/ui     shared components (shadcn/ui), theme, logo
e2e             Playwright end-to-end and visual tests against the real API
```

The binary serves `/api/*` on every host, the portal for requests to `PORTAL_URL`'s host and the platform for any
other host. It applies database migrations at start. `GET /api/health` answers while the process runs;
`GET /api/ready` also checks the database. The developer documentation site is maintained separately.

Stack: Go (standard library `net/http`, pgx, goose), PostgreSQL, Next.js 16, React 19, Tailwind CSS 4, shadcn/ui,
TanStack Query, Turborepo, Vitest, Storybook and Playwright.

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
| Hosts          | `PORTAL_URL`'s host gets the client portal, any other host the platform; `/api/*` is the API on both                                                                          |
| Health         | `GET /api/health` (process), `GET /api/ready` (also the database); `helvetly healthcheck [ready\|health]`                                                                     |
| Settings       | environment only, validated at start; a bad value stops the start with a message naming it                                                                                    |
| Migrations     | applied at start, forward only                                                                                                                                                |
| Stop           | SIGTERM drains requests and background work within 15 s; allow at least 30 s                                                                                                  |
| Client address | `X-Forwarded-For` is believed only from `TRUSTED_PROXY_CIDRS` (set it to your proxy; `cloudflare` adds Cloudflare's ranges and lets `CF-IPCountry` pick the billing currency) |

Production needs at least `DATABASE_URL`, `PUBLIC_URL`, `PORTAL_URL` (another host), `SECRET_KEY`
(`openssl rand -base64 32`; keep a backup), `SMTP_*`, `MAIL_FROM` and the five `S3_*` settings; never set
`AUTH_DEV_SIGNIN`. Every setting is described in [.env.example](.env.example). Build-time values
(`NEXT_PUBLIC_*`, Docker build arguments) end up in the browser's JavaScript: public URLs only, never secrets.

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

### Billing

Billing is optional. With `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set, prices are read from your Stripe
account by lookup key `helvetly_<basic|pro|business>_<month|year>`: recurring, per seat, with the metadata
`helvetly_pricing=per_seat`. Create those prices in your own Stripe account. Plan features and limits come from a
published offer: `limits` defines every key, `offer_versions` keeps each published offer (never changed afterwards),
`limit_plans` its values per plan (a feature enabled or disabled, a limit limited or unlimited, growing with every
paid seat where the offer says so), and `limit_workspaces` gives one workspace its own value until it expires. A
workspace stays on the offer it subscribed under. `helvetly offer validate|diff|publish FILE` checks, compares and
publishes an offer file, and `helvetly offer override set|clear` sets one workspace's value; each change is audited
in `offer_audit`. `GET /api/v1/public/offers/current` serves the current prices and public comparison. Without
billing, no plan limit applies. The webhook endpoint is `<PUBLIC_URL>/api/webhooks/stripe`.
Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.*`,
`charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` and `charge.refunded`. An opened dispute
alerts the owners and admins; a lost one ends the subscription it paid at once, or takes back the AI token pack's
tokens (as much as is left this month). A full refund takes back a pack's tokens; a refunded subscription payment
changes nothing, since you cancel the subscription yourself if you mean to. The endpoint's API version does not
matter: billing reads only the event's id, type and object id, and reads the object again from Stripe with its pinned
version, so a version change needs no new endpoint or secret. Only while rotating the signing secret, set
`STRIPE_WEBHOOK_SECRET=whsec_new,whsec_old`: both verify, and an event delivered twice is applied once.

Plan changes and seats are invoiced at once: added seats and upgrades are charged, removed seats and downgrades
credited to the customer's Stripe balance. An upgrade, monthly to yearly and leaving the trial take effect once that
invoice is paid. When a renewal fails, the plan keeps working until three days after the paid period ended; then
the workspace is read-only until the invoice is paid (Stripe's retries continue meanwhile). A second subscription
of the same workspace is cancelled with its unused time credited.

Optional extra AI tokens: one-time prices of the product `helvetly_ai_tokens`, each with the metadata
`helvetly_ai_tokens=<tokens>`. A workspace on a plan buys one through Checkout; once paid, its tokens add to the
plan's monthly AI allowance for the month (in the workspace's time zone) and lapse with it. With
`STRIPE_MANAGED_PAYMENTS=true`, Checkout uses Stripe Managed Payments (Stripe is the merchant of record); the
products then need an eligible tax code such as `txcd_10103001`.

## Known limitations

- Not released: no published images or packages, no upgrade guarantees yet.
- The business year is the calendar year.
- E-invoice network delivery (Peppol, KSeF API) is not wired; the XML export works.
- File retention needs S3 Object Lock (above); there are no qualified timestamps or qualified e-signatures.
- The interface is in English only.
- The employees module calculates no pay, tax or contributions and produces no payslips, certificates or filings: it
  records and exports what a person or a payroll system computed. Jurisdiction data is research, not legal advice.

## Contributing, security and license

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, commits, pull requests and the quality gate.
- [AGENTS.md](AGENTS.md): layout and conventions, for people and coding agents.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- License: GNU Affero General Public License v3.0 only ([LICENSE](LICENSE), SPDX `AGPL-3.0-only`). Third-party
  material keeps its own license ([NOTICE](NOTICE)). Contributions are welcome under the
  [Contributor License Agreement](CONTRIBUTING.md#contributor-license-agreement).
