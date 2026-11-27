#!/usr/bin/env bash
set -euo pipefail

guard="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/check-migrations.sh"
tmp_root="${TMPDIR:-/tmp}/helvetly"
mkdir -p "$tmp_root"
tmp=$(mktemp -d "$tmp_root/check-migrations.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false
export GIT_CONFIG_KEY_1=core.hooksPath GIT_CONFIG_VALUE_1=/dev/null

dir=apps/api/internal/store/migrations
git init -q -b main "$tmp/origin"
cd "$tmp/origin"
mkdir -p "$dir"
touch "$dir/00092_original.sql"
git add .
git commit -qm 'Initial migration'
base_sha=$(git rev-parse HEAD)
git switch -qc feature
touch "$dir/00095_new.sql"
git add .
git commit -qm 'Add migration'
git clone -q --depth=1 -b feature "file://$tmp/origin" "$tmp/feature"
git switch -q main
touch "$dir/00094_new_on_main.sql"
git add .
git commit -qm 'Advance main after the PR checkout'
cd "$tmp/feature"

expect_failure() {
  local expected=$1 output
  shift
  if output=$(bash "$guard" "$@" 2>&1) || [[ $output != *"$expected"* ]]; then
    printf 'Expected failure containing %s\nReceived: %s\n' "$expected" "$output" >&2
    exit 1
  fi
}

bash "$guard" refs/heads/main "$base_sha"
touch "$dir/95_duplicate.sql"
expect_failure 'Migration version 00095 is used by 00095_new.sql and 95_duplicate.sql.' main "$base_sha"
rm "$dir/95_duplicate.sql"

git mv "$dir/00095_new.sql" "$dir/00093_x.sql"
expect_failure 'Migration 00093_x.sql must be numbered above 00094 (highest on main). Rename it to 00095_x.sql and update test pins.' main "$base_sha"
git restore --staged --worktree -- "$dir"

printf 'edited\n' > "$dir/00092_original.sql"
expect_failure 'Migration 00092_original.sql is already merged. Restore the original file and add a new migration instead.' main "$base_sha"
rm "$dir/00092_original.sql"
expect_failure 'Migration 00092_original.sql is already merged.' main "$base_sha"
git restore -- "$dir/00092_original.sql"

bash "$guard"
touch "$dir/00094_collision.sql"
expect_failure 'Migration 00094_collision.sql must be numbered above 00094 (highest on main). Rename it to 00096_collision.sql and update test pins.'
printf 'ok - migration guard checks live base, immutable migrations, and numeric versions\n'
