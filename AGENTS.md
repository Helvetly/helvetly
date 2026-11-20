# AGENTS.md

Rules for coding agents (and people) working in this repository. If the code and this file disagree, the code wins;
fix this file in the same change.

## 1. What this is

Helvetly is business-management software for small companies: workspaces and sign-in, clients, quotes and invoices
(Swiss QR bills, e-invoice XML), expenses, documents, e-signatures, a client portal, books and VAT exports, employees and a payroll register,
optional Stripe subscription billing and optional AI features. See README.md for the feature list and limits.

This repository holds the application only. Deployment of any particular installation (servers, DNS, credentials)
is not part of it, and nothing here may depend on a private checkout or a secret beyond the CI run's own token.
The two exceptions sit outside CI: the release hand-off to deployment (`DEPLOY_DISPATCH_TOKEN`, in
`.github/workflows/release.yml`) and the CLA check (`CLA_SIGNATURES_TOKEN`, in `.github/workflows/cla.yml`).
Outside contributions need the CLA (`ICLA.md`, `CCLA.md`, CONTRIBUTING.md).
This repository has no `docs/` folder and gets none: design notes, plans, reports and agents' working documents live
in the maintainers' separate documentation repository. Comments that cite `docs/…` refer to it; here the code and tests
are the reference.

## 2. Layout

| Path                         | Package                       | What it is                                                      |
| ---------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `apps/api`                   | `@helvetly/api`               | Go HTTP API; builds the single `helvetly` binary                |
| `apps/platform`              | `@helvetly/platform`          | Next.js app for signed-in users, static export                  |
| `apps/portal`                | `@helvetly/portal`            | Next.js client portal (own host), static export                 |
| `apps/web`                   | `@helvetly/web`               | Next.js public website, static export                           |
| `packages/i18n`              | `@helvetly/i18n`              | Typed ICU translations, locales and static-export configuration |
| `packages/ui`                | `@helvetly/ui`                | shadcn/ui components, theme, `globals.css`, `cn`                |
| `packages/typescript-config` | `@helvetly/typescript-config` | `base.json`, `nextjs.json`                                      |
| `packages/vitest-config`     | `@helvetly/vitest-config`     | Shared Vitest config and test setup                             |
| `e2e`                        | `@helvetly/e2e`               | Playwright E2E and visual tests against the real API            |

## 3. Architecture

- **One binary.** `apps/api` embeds the static exports of `apps/platform` and `apps/portal`
  (`apps/api/internal/platform`, `go:embed`). `/api/*` is the JSON API on every host; other paths are served from
  the portal's files for `PORTAL_URL`'s host and from the platform's for any other. `Dockerfile` builds the image.
- **No server runtime in the frontends.** Platform and portal are `output: 'export'`: no route handlers, server
  actions, middleware or request-time rendering, no dynamic routes without `generateStaticParams`. Data comes from
  the Go API via relative `fetch('/api/...')`; in development `next dev` rewrites `/api/*` to `API_URL`.
- **Languages.** Marketing is one static build (and one `next dev`) for every language: English keeps root URLs in `app/(default)`, which re-exports the pages of `app/[lang]` (the other languages, under their prefix); pages get the language from the route and words come from `translatorFor(lang)` or a `perLanguage` builder, never from module-level constants. Platform and portal use one static build with unprefixed routes: `?lang` selects and saves `helvetly.language` in localStorage, then the stored preference, the browser's languages and English are the fallbacks. Language changes reload the page to update module-level labels. Put interface text in the owning app's `src/messages/en.json` (shared controls in `packages/ui`). Use explicit `localizedHref(path, locale)` for public-site links; API paths and protocol identifiers stay stable. No request-time rendering.
- **Website.** `apps/web` is its own static export (every route known at build time); `build` also runs the internal
  link check (`scripts/check-links.mjs`). It renders the legal texts in `apps/web/content/legal`.
- **API mocks** (`src/mocks` in platform and portal) are test fixtures only: Vitest (`msw/node`) and Storybook.
- **Go API**: standard library first (`net/http`, `log/slog`, `embed`); `cmd/helvetly` wires, `internal/<area>` is
  one package per concern; handlers depend on interfaces passed in from `main`. PostgreSQL through `internal/store`
  (pgx, hand-written SQL, goose migrations embedded and applied at start). Files through `internal/storage` (any
  S3 API). Money only through the pure calculators (`internal/invoicecalc`, `vatcalc`, `ledgercalc`, `instalcalc`,
  `dunningcalc`), PDFs through `internal/invoicepdf` and `internal/pdffont`.
- **Auth** (`internal/auth`): passwordless (Google OIDC, email code, passkeys), sessions bound to one workspace,
  `SignedIn` wraps signed-in routes and requires `X-CSRF-Token` on non-GET requests; personal API tokens
  (`Authorization: Bearer hvt_…`) reach only the operations in `internal/openapi/openapi.json` and `POST /api/mcp`.
- **Portal scope** (`internal/portalscope`): the one place that decides whose client portal a request is for. Every
  workspace has a slug (`portal_slugs`: its current one, plus every earlier one, which redirects pages to the current
  and is never given to another workspace, by a 302 that is never cached since a workspace may take an earlier slug back;
  reserved words refused; changes audited). Slug lookups are rate limited per client address before the database is asked. Its portal is
  `PORTAL_URL/w/<slug>/`: the resolver strips the prefix and puts the workspace in the request context, so the same
  static portal serves it and its API calls go to `/w/<slug>/api/…`; an unknown slug is the portal's 404. `GET /api/v1/public/portal/scope` names the workspace only while its portal is open (plan and a client with it on). An owner or admin can turn the whole portal off (`workspaces.portal_off`, audited): sign-in and every session are refused at once, no invitation goes out, each client's own switch is kept, and the scope answers `portal_closed` (the portal's "not available" page, naming nobody). Under a scope,
  sign-in looks only at that workspace's clients (the same answer whether or not the address exists) and the session
  (`portal_sessions.scoped`, its own cookie per workspace) is valid only there and switches only among that workspace's clients. The shared portal (`PORTAL_URL` itself)
  signs nobody in: unscoped start and verify answer `portal_link_required`, unscoped sessions are not read, and its
  page only emails an address the links of its suppliers' open portals (`POST /api/v1/public/portal/auth/links`:
  the same 202 for every address, limited per client address and per recipient). Links in email come from `CanonicalURL`.
- **Custom portal domains** (`internal/customdomains`, Business feature `custom_portal_domain`, off without
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` and `CUSTOM_DOMAIN_TARGET`): a workspace's portal on its own host
  through Cloudflare for SaaS custom hostnames (`workspace_domains`: one per workspace and hostname among rows not
  removed). The workspace adds a CNAME to the target and the TXT record Cloudflare names (`_cf-custom-hostname.<host>`);
  the row is stored first (it reserves the name), then the custom hostname is made (`context.WithoutCancel`, deleted
  again when the row cannot be stored). Active only when Cloudflare reports the hostname and its certificate active
  and the app found the TXT record itself once (`verified_at`): Cloudflare activates on the CNAME alone. Checks go by
  id (`Get`, or `Refresh` while on the way), never a zone listing; a duplicate on create is adopted only when it is
  the domain's own or no other row ever held it, else made afresh, and "taken" only when the zone does not have it.
  Due domains are claimed with `FOR UPDATE SKIP LOCKED` and checked by a small pool; the client spaces calls (two a
  second) and pauses on 429. One pending or failed for 14 days is released (its hostname deleted), not a proven one
  the plan turned off; a workspace with the take-over TXT record `_helvetly-verify.<host>` (an HMAC of workspace and
  host under `SECRET_KEY`) takes over a name another holds without proof; a deleted workspace keeps it for 30 days. A
  daily cleanup deletes the zone's hostnames of names the app had that no domain holds.
  `portalscope` resolves an active domain's Host first (cache of 15 s, at most 10 000 hosts, uncached lookups rate
  limited per client address, `Forget` on change, the plan checked): pages at the root, only
  `/api/v1/public/portal/…` and the health checks as API, never the platform. Any other foreign host (not ours, not
  loopback) gets 404 for everything but the health checks. `/w/<slug>/` pages 302 to the active domain, and
  `CanonicalURL` returns it. Cookies stay host-only and named per workspace.
- **Financial records**: issuing and payments check closed periods and write the hash-chained `financial_events`
  log in the same transaction; a database trigger refuses edits. Signatures keep their own append-only trail.
- **Approvals** (`internal/approvals`, Business feature `document_approvals`): an optional approval before a draft is
  issued, per document type (`invoice` for every invoice kind without its own, `credit_note`, `debit_note`,
  `corrected`; quotes, expenses and payroll take the same shape later). Owners and admins keep approver groups and a
  policy per type: on/off, an optional minimum total (in the document's currency) and rules that must all hold
  (at least N approvals from a group, or from anyone who can read the documents). Approvals are matched to rule slots so
  one person counts once; nobody who wrote the draft (`approval_authors`: created or changed it) and not the submitter
  approves it; the rules are a snapshot taken at submit; a decision names the `request_id` it saw (`409
  approval_changed` otherwise). The document stays
  `draft`; its latest request (`approval_requests`, one `pending|approved` at a time, decisions in
  `approval_decisions`) gives `approval_state`. The document package calls approvals in its own transaction with the
  row locked: `Gate` before issuing (`409 approval_required`), `Reset` after any edit (the request ends, submit again;
  a change of the seller, IBAN or Revolut account in the invoice settings ends every open request, `ResetAll`),
  `Forget` on delete; an instalment plan from a draft needs its approval too. No policy, or no feature after a downgrade: nothing is gated. Not gated: a void's
  credit note, plan instalments (the plan itself needs the draft's approval) and invoices imported as issued
  elsewhere (`IssueImported`). Steps go to the audit log (`approval.*`, configuration
  `approvals.*`), never as money events; `approval.requested|approved|rejected` notify. Approving is session-only:
  the operations are not public API operations or MCP tools, and an API token only reads `approval_state`.
- **Workspace deletion** is soft: `workspaces.deleted_at`, members, sessions and open invitations end, and a
  `workspace_deletions` row keeps the members so whoever deleted it can restore it for 30 days. A job
  (`dataexport.RunBackups`) stores the owner's whole export plus `deletion.json` as a ZIP at
  `workspaces/<id>/backups/<deletion>.zip`, under the records' retention; the records themselves stay.
- **Employees** (`internal/employees`, `internal/employment`): own staff, never users, on the Business plan (feature
  `employees`; after a downgrade the owner still reads and exports, nobody writes). Two HR areas, `employees` and
  `payroll` (read = View, write = Edit), never reached by a `*` resource; owners hold both, admins `permissions.AdminHR`
  (payroll view) until the owner sets their own list, and only an owner changes anyone's HR access. Sealed fields need
  payroll edit and every reveal is audited. HR files are documents with `hr_private` and never pass `store.Document`,
  lists, shares or signed links; nothing HR is a public operation, an MCP tool or a Heidi answer; the owner's workspace
  export carries it in `employees/`; the audit log gets HR events with empty payloads. Jurisdiction rules are data
  (`employment/rules.json`), never a calculation.
- **Plan usage**: a monthly limit counts through `store.ConsumeUsage` in the write's transaction, or
  `ReserveUsage` before an external effect and `SettleUsage` after it (`usage_events`: one row per operation id, its
  UTC month fixed at admission); state limits count what exists. Both are admitted by `billing.AllowResource`.
  Storage counts each workspace object once in `stored_objects`: `ReserveObject` before every `files.Put` of a
  workspace's object (admitted for new growth, counted only for records the business keeps), the real size once
  storage answers, released only after a confirmed delete, reconciled by a job. Downloads are not counted: they go
  through `storage.Serve` (a `MEDIA_URL` link, a presigned URL or, with `S3_PROXY_DOWNLOADS`, the API). Business
  email carries its `Workspace` and counts its recipients through `mail.Metered` (one message's attachments are
  capped by `max_email_attachment_bytes`); sign-in, security and invitation email never does.
- **Optional integrations**: Stripe billing (`internal/billing`, off without `STRIPE_SECRET_KEY`), the AI model
  (`internal/aimodel`, off without `OPENAI_API_KEY`, gated by each user's approval in each workspace
  and a monthly token budget per pool: Heidi's chat (`ai_tokens_per_month`) and the automation pool of AI import
  and document filing (`ai_automation_tokens_per_month`), never one for the other; each call reserves its tokens
  and rate-card cost first, one call in flight per workspace and pool, see `ai_calls`; a call whose usage is never
  reported (timeout, lost answer, a process that died) is charged its whole reservation and may be asked once more,
  never blocking the month).
- **Swiss UID register** (`internal/uidregister`): the client form's company lookup and the "UID verified" mark
  (`clients.verified_uid`, `uid_verified_at`, set when a client is saved) call the federal public SOAP service
  (`UID_REGISTER_URL`, the production endpoint by default, `off` = none) through the API only, at most 15 calls a
  minute per instance (the service allows 20) with a 10-minute cache; unreachable means "unavailable", never a
  refused save. Session-only: not a public API operation, MCP tool or Heidi answer.

## 4. Where code goes (DRY)

- A UI component, hook or style used by both apps → `packages/ui`. Used by one app → that app's
  `src/components`. Do not copy a component between apps; move it to `packages/ui`.
- Add shadcn components from the app you are working in, e.g.
  `pnpm --filter @helvetly/platform dlx shadcn@latest add dialog`; the `ui` alias in
  `components.json` places them in `packages/ui`.
- Import shared code as `@helvetly/ui/components/<name>`, `@helvetly/ui/lib/utils`. App-local code
  as `@/...`.
- A dependency version used by more than one workspace lives in the `catalog` in
  `pnpm-workspace.yaml` and is referenced as `"catalog:"`.
- Shared tool config lives in exactly one place: TS in `packages/typescript-config`, tests in
  `packages/vitest-config`, lint in `.oxlintrc.json`, format in `.oxfmtrc.json` (both root, never
  per workspace).

## 5. Toolchain

- Node 26 (`.nvmrc`), **pnpm 12 only** (`packageManager`), Turborepo, TypeScript 7.
- Go 1.27 (`apps/api/go.mod`). Go is formatted by `gofmt` and checked by `go vet`.
- Next.js 16 changed many APIs: read the guides in `node_modules/next/dist/docs/` before relying
  on older knowledge.
- Next.js 16, React 19, Tailwind CSS 4, shadcn/ui (`radix-nova` style), Vitest 5 + Testing Library.
- Lint: oxlint; a warning fails the gate like an error (`--deny-warnings`). `oxc/no-map-spread` is off: React state
  is never changed in place, so a changed copy inside `map` is the correct update, not waste. Format: oxfmt (imports, `package.json` and Tailwind classes are sorted by it).

## 6. Commands

```bash
pnpm install
cp .env.example .env     # once
pnpm infra:up            # postgres, MaxIOFS (S3) + bucket, mailpit, stripe-cli listener
pnpm dev                 # api :3333, platform :8000, web :8001, portal :8002
pnpm dev:tunnel          # the same on public https hostnames of your own Cloudflare tunnel (scripts/dev-tunnel.sh)
pnpm build               # web, platform, portal, then the api binary at apps/api/bin/helvetly
pnpm check               # format:check, lint, typecheck, test, build: the full gate
pnpm format              # fix formatting
pnpm --filter <package> <script>   # one workspace, e.g. pnpm --filter @helvetly/api test
```

Local services (all bound to 127.0.0.1, ports set in `.env`): Postgres `5433`, S3 API `9300`,
MaxIOFS console `9301` (`admin` / `admin`), Mailpit SMTP `1025` and inbox `8026`. `stripe` needs `STRIPE_SECRET_KEY` (test mode) and
exits immediately without it; `docker compose logs stripe` prints the webhook signing secret.
`pnpm --filter @helvetly/api dev` loads the root `.env`. Go tests need Postgres: each test gets
its own database, cloned from a template migrated once per set of migrations (`helvetly_template_<hash>`),
on the server of `HELVETLY_TEST_DATABASE_URL` (default: the compose database), dropped afterwards.

## 7. Quality gate

`pnpm check` must pass before a change is finished. CI (`.github/workflows/ci.yml`) selects checks
by PR scope after a quick gate; drafts run only that gate. Ready-for-review, manual, merge-group
and push-to-`main` runs select the full suite; `CI required` is the one required check.
Selected tests run in parallel jobs (unit and Storybook tests once, through `pnpm test:coverage`;
E2E specs sharded with `HELVETLY_E2E_SHARD`). The build job uploads the `helvetly` binary as an
artifact. A step added to `check` goes into a CI job too. Rules:

- Fix the cause, never silence it: no `any`, no unchecked `as`, no `oxlint-disable`,
  no `@ts-expect-error`, no skipped tests, no lowered thresholds.
- New logic gets a test next to it: `*.test.ts(x)` in `src/` for TS, `*_test.go` for Go
  (table-driven, `httptest` for handlers).
- A test that was red before your change: report it, do not delete or skip it.

### UI, browser coverage and uploads

- Shared controls use `packages/ui` variants, sizes and semantic tokens. The same action role has
  the same appearance across screens; do not override button height, radius or colours per page
  when a shared variant already represents that role. Review keyboard focus, mobile and dark mode.
- Focus never changes the layout: no ring, hint or font change may move a box, and fields one types into are
  at least 16 px on phones (`globals.css`; Safari zooms in on smaller ones). `e2e/visual/focus-layout.spec.ts`
  checks every story at desktop and phone width in the visual suite.
- Frontend behaviour is verified with Storybook stories and `play` interactions in Chromium,
  including relevant loading, empty, error, permission, validation and pending-write states.
  Keep pure unit/API tests; Storybook does not replace real end-to-end integration tests.
- Real E2E tests use the Go API,
  a disposable PostgreSQL schema and a disposable local S3 bucket with MSW disabled. Cover retry,
  concurrent submissions, navigation/refresh, authentication, roles and workspace isolation.
- `pnpm check` also builds Storybook and runs browser stories and E2E. Install Chromium once with
  `pnpm --filter @helvetly/e2e exec playwright install chromium`; start local Postgres and S3 first (`pnpm infra:up`,
  for the Go tests). E2E starts its own disposable Postgres and S3 from `compose.e2e.yml` (`pnpm e2e:down` removes them). `pnpm test:coverage`
  measures unit and browser-story coverage together. Report actual gaps; do not equate a passing
  suite or a high line percentage with exhaustive coverage.
- `pnpm check` runs pinned official KoSIT validation of synthetic XRechnung XML through
  `pnpm test:einvoice` (Docker, curl, unzip, shasum; no host JRE). Tools are downloaded and hash-checked,
  while validation itself has no network access. Keep the supported/unsupported profile boundaries
  and historical-data limits explicit in `scripts/validate-einvoice.sh`.
- Every user-upload entry point checks SHA-256 computed from the actual bytes before adding a new
  stored file, with a server-side concurrency guard scoped to the workspace. A changed filename or
  MIME header does not make different content. Check same-batch, repeated and simultaneous uploads,
  cross-entry-point duplicates, tenant boundaries and legacy files without hashes. Preserve deliberate
  document copies, historical financial records and references; never deduplicate across tenants.

## 8. Code style

- Small, single-purpose modules and functions; names that make comments unnecessary. Comment only
  the _why_.
- No speculative abstractions, options or "for later" code. Three similar lines beat a premature
  helper; the third copy across files is the signal to extract.
- Validate at trust boundaries (HTTP input, env, third-party responses); trust internal calls.
- Errors: Go returns wrapped errors (`fmt.Errorf("...: %w", err)`) and handles them once at the
  edge; TS throws `Error` with context and handles it at the UI boundary.
- Keep diffs scoped to one concern; no drive-by refactors.

## 9. Secrets and environment

- `.env` is ignored; `.env.example` is the tracked list of every setting. A new setting goes into
  `.env.example`, then into the app's config layer (`apps/api/internal/config` for Go).
- Never print a secret into a log, commit, PR description or chat reply.
- The API validates its settings at startup and refuses to start on a bad one: `DATABASE_URL`,
  `PUBLIC_URL` (platform origin: Google redirect, passkey RP ID), `PORTAL_URL` (the portal's origin, another host), `DOCS_URL` (the docs' origin, whose API playground gets CORS on the public catalogue, bearer only; default `http://localhost:8003` next to a local `PUBLIC_URL`, else off), `MEDIA_URL` (optional origin on another host than both; when set, downloads redirect to signed `/api/media/{token}` links there, ahead of presigning and `S3_PROXY_DOWNLOADS`; https unless local), `SECRET_KEY` (base64, 32 bytes;
  empty only with `AUTH_DEV_SIGNIN`), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (both or neither),
  `SMTP_*` and `MAIL_FROM` (email sign-in needs `SMTP_HOST` or `AUTH_DEV_SIGNIN`), `SESSION_TTL`,
  `COOKIE_SECURE`, `TRUSTED_PROXY_CIDRS` (CIDRs of reverse proxies whose `X-Forwarded-For` is believed; empty = the TCP peer; `cloudflare` adds Cloudflare's edge ranges, and `CF-IPCountry` is believed only from them, for the billing currency), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`/`S3_SECRET_KEY` (required), `S3_ADDRESSING` (path or virtual), `S3_OBJECT_LOCK_DAYS`/`S3_OBJECT_LOCK_MODE` (0 = protection off; > 0 requires a bucket with Object Lock or the API refuses to start), `S3_PROXY_DOWNLOADS` (default false: downloads redirect to presigned S3 URLs; true streams them through the API, for a bucket the browser cannot reach, such as localhost behind `pnpm dev:tunnel`, which sets it), `KSEF_API_URL` (https, optional; empty = no KSeF API). `OPENAI_MODEL` (a model with a rate card in `aimodel.Cards`) and `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`/`CUSTOM_DOMAIN_TARGET` (custom portal domains through Cloudflare for SaaS: all three or none; the target is the zone's proxied fallback origin, normally `PORTAL_URL`'s host; `CLOUDFLARE_API_URL` and `HELVETLY_E2E_FAKE_DOMAINS` only for tests). `OPENAI_FALLBACK_MODEL` (optional, empty = none; another model with a rate card, asked once when `OPENAI_MODEL` stays overloaded or rate limited after its retries, reserved and priced at its own card). With `STRIPE_SECRET_KEY`: `STRIPE_WEBHOOK_SECRET` (one `whsec_…`, or the new and old separated by commas only while rotating the secret; the endpoint's API version does not matter, since handlers read objects again). `AUTH_DEV_SIGNIN` is never set in production. On a public (non-localhost) host the API refuses a plain-http
  `PUBLIC_URL`/`PORTAL_URL` and `COOKIE_SECURE=false`; database dials time out after 10 s unless the URL sets
  `connect_timeout`.

## 9a. Operations

- `GET /api/health` answers while the process runs; `GET /api/ready` also pings the database (503 when down).
- Background loops run under a supervisor in `cmd/helvetly/jobs.go` (a panic restarts the loop after a minute);
  SIGTERM drains requests, then waits for ticks in flight within the 15 s budget.
- Self-hosting: README, "Self-hosting" (image contract, settings, releases, PostgreSQL, object storage).

## 10. Git

[CONTRIBUTING.md](CONTRIBUTING.md) is the source of truth for branches, commits, pull requests and validation.
Conventional Commits, short kebab-case branches, `main` only through merged pull requests, no AI attribution in
commits or pull requests.
