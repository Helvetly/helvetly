# Contributing to Helvetly

This file is the source of truth for branches, commits, pull requests and validation. For
architecture, where code belongs and code style, read [AGENTS.md](AGENTS.md). For setup, read the
[README](README.md).

## Before you start

- For anything larger than a small fix, open an issue first so the approach can be agreed before you invest time.
- Work in a fork and open a pull request against `main`.
- By contributing you agree to the [Contributor License Agreement](#contributor-license-agreement).

- Keep a change to one concern. Do not mix refactors, renames or formatting of unrelated code
  into it.
- If the code and the docs disagree, the code wins: fix the docs in the same change.

## Branches

Short, lowercase kebab-case names that describe the change, with no ticket prefixes:

```txt
passkey-rename
invoice-pdf-export
ci-cache-turbo
```

`main` is protected and moves only through merged pull requests. Never push directly to it,
force-push it or rewrite its history. Other branches can be rebased and force-pushed freely.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```txt
<type>(<scope>): <imperative summary>
```

| Types            | `feat` `fix` `refactor` `perf` `docs` `test` `style` `chore` `build` `ci` `revert` |
| ---------------- | ---------------------------------------------------------------------------------- |
| Workspace scopes | `api` `platform` `web` `ui` `config` `infra` `deps` `ci` `docs`                    |
| Feature scopes   | `auth` `workspaces` `clients` `invoices` `expenses` `documents` `billing` `import` |

- Imperative mood (`add`, `fix`, `remove`), subject at most 72 characters, no trailing period.
- Add a body, wrapped at 72 characters, when the reason is not obvious from the diff. Always add
  one for migrations, reverts, breaking changes and security-sensitive changes.
- Breaking changes use `!`: `feat(api)!: rename the session endpoint`.
- No AI authorship metadata (no `Co-Authored-By` for tools, no "Generated with" lines).

Examples:

```txt
feat(auth): let people rename their passkeys
fix(platform): keep the next path after a Google sign-in error
test(api): cover email code cooldown across restarts
chore(deps): update next to 16.5
```

## Pull requests

- The title follows the commit format and names the main change.
- The description covers what changed, why, how it was validated, and any follow-ups,
  limitations or rollout notes.
- Call out database migrations and new or changed settings (`.env.example`), and say whether
  production needs them before the deploy.
- Only claim validation you actually ran.
- An API change must keep working with the platform build that is already deployed until the
  new one replaces it: add the new shape first, remove the old one in a later change.

## Validation

Start the local services (`pnpm infra:up`), then run the full gate from the repository root:

```bash
pnpm check    # format:check, lint, typecheck, test, build
```

CI (`.github/workflows/ci.yml`) selects checks by PR scope after a quick gate; drafts run quick checks only.
Ready-for-review and manual runs select the full suite. A merge group or a push to main selects checks by changed paths only after CI passes on its base commit. `CI required` must be green
before merging. CI needs no secrets, so it runs the same for pull requests from forks.

Also, depending on the change:

- **UI change:** look at it in the browser (`pnpm dev`) at desktop and phone widths, and in dark
  mode.
- **Screens for review:** `pnpm build:storybook && node scripts/screens.mjs <dir>` screenshots every
  "Pages/…" story (each screen in the real shell) at 1440 light, 1440 dark and 390 light.
- **Auth, sessions or request handling:** sign in end to end locally with an email code (read
  it in Mailpit at http://localhost:8026) and, if touched, a passkey.
- **Database schema:** add a new goose migration in `apps/api/internal/store/migrations` and start the API to check it.
  Keep merged migrations intact. Run `pnpm check:migrations` before merging. If `main` gained a
  migration since CI passed, rerun CI against the current base and renumber yours above it if needed.
- **API contract:** update the typed client in `apps/platform/src/lib/api.ts` in the same pull request, and
  `apps/api/internal/openapi/openapi.json` when the route is part of the public API (drift tests check both).

## Tests

- New logic gets a test next to it: `*.test.ts(x)` for TypeScript, `*_test.go` for Go
  (table-driven, `httptest` for handlers).
- Go tests run against real Postgres. Each test gets its own database, cloned from a migrated
  template on the server of `HELVETLY_TEST_DATABASE_URL` (default: the local compose database),
  dropped afterwards.
- A test that was already failing: report it, do not skip or delete it.
- Fix the cause, never silence a check: no `any`, no lint suppressions, no `@ts-expect-error`,
  no skipped tests.

## Dependencies

- Use pnpm only. A version used by more than one workspace goes in the `catalog` in
  `pnpm-workspace.yaml` and is referenced as `"catalog:"`.
- Do not add a dependency for something a few lines of code can do. In Go, prefer the standard
  library.
- Add shadcn components from an app (`pnpm --filter @helvetly/platform dlx shadcn@latest add
  <name>`); they land in `packages/ui`.

## Secrets

Real secrets never enter the repository. `.env` is ignored and `.env.example` lists every
setting with a safe local default. Never paste a secret into a commit, a pull request or an
issue.

## Contributor License Agreement

Helvetly is licensed under the GNU Affero General Public License v3.0 only. Before we can merge your first pull
request, you accept a Contributor License Agreement, based on the FSFE's Fiduciary License Agreement:

- contributing as an individual: the [Individual agreement (ICLA)](ICLA.md);
- contributing for a company or other legal entity: the [Entity agreement (CCLA)](CCLA.md), accepted by someone
  allowed to sign for it, with the people who contribute for it listed in a GitHub issue titled
  `CCLA: <company name>`.

The CLA check on your pull request asks you to post one comment:

```txt
I have read the CLA Document and I hereby sign the CLA
```

You do it once; it covers your later contributions too. The agreement keeps the project's rights in one place, and
in return promises that Helvetly and your contribution stay available under a free and open source license. Your
name stays in the history, and you keep the right to use your own contribution as you like.

Comments in the code sometimes cite design documents under `docs/` that the maintainers keep outside this
repository; the code and its tests are the reference here.
