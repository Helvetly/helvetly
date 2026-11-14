#!/usr/bin/env bash
# Runs the visual suite inside the pinned Playwright image (same Chromium, fonts and Linux rendering on a Mac
# and in CI). Needs Docker and built Storybooks (`pnpm build:storybook`). Extra arguments go to
# `playwright test`, e.g. `--update-snapshots` to rewrite the baselines (look at every changed PNG).
# The report with expected/actual/diff images lands in e2e/visual/playwright-report.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
image="mcr.microsoft.com/playwright:v$(node -p "require('$root/e2e/node_modules/@playwright/test/package.json').version")-noble"
tty=-i
[[ -t 1 ]] && tty=-it
exec docker run --rm "$tty" --platform linux/amd64 --ipc=host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI="${CI:-}" \
  -v "$root:$root" -w "$root/e2e/visual" "$image" \
  node "$root/e2e/node_modules/@playwright/test/cli.js" test "$@"
