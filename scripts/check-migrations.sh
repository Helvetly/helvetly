#!/usr/bin/env bash
set -euo pipefail

base=${1:-main}
base=${base#refs/heads/}
comparison=${2:-}
dir=apps/api/internal/store/migrations
sql=":(glob)$dir/*.sql"
cd "$(git rev-parse --show-toplevel)"

fail() { printf '%s\n' "$*" >&2; exit 1; }

version_of() {
  local prefix=${1%%_*}
  [[ $1 == *_*.sql && $prefix =~ ^[+]?[0-9]+$ ]] || fail "Invalid migration filename: $1"
  prefix=${prefix#+}
  version=$((10#$prefix))
  [[ $version -gt 0 && $prefix =~ ^0*$version$ ]] || fail "Invalid migration version: $1"
}

seen=()
for path in "$dir"/*.sql; do
  [[ -e $path || -L $path ]] || continue
  file=${path##*/}
  version_of "$file"
  if [[ -n ${seen[$version]:-} ]]; then
    fail "$(printf 'Migration version %05d is used by %s and %s.' "$version" "${seen[$version]}" "$file")"
  fi
  seen[version]=$file
done

# CI knows the base of its checked-out merge tree; locally git needs the branch history.
if [[ -n $comparison ]]; then
  git fetch --no-tags --depth=1 origin "refs/heads/$base"
  latest=$(git rev-parse FETCH_HEAD)
  if ! git cat-file -e "$comparison^{commit}" 2>/dev/null; then
    git fetch --no-tags --depth=1 origin "$comparison"
  fi
else
  if [[ $(git rev-parse --is-shallow-repository) == true ]]; then
    git fetch --no-tags --unshallow origin
  fi
  git fetch --no-tags origin "refs/heads/$base"
  latest=$(git rev-parse FETCH_HEAD)
  comparison=$(git merge-base HEAD "$latest") || fail "No common ancestor with $base. Rebase your branch onto $base."
fi

git diff --no-renames --diff-filter=DMT --name-only -z "$comparison" -- "$sql" |
  while IFS= read -r -d '' path; do
    fail "Migration ${path##*/} is already merged. Restore the original file and add a new migration instead."
  done

highest=$(git ls-tree --name-only -z "$latest:$dir" | (
  highest=0
  while IFS= read -r -d '' file; do
    [[ $file == *.sql ]] || continue
    version_of "$file"
    if ((version > highest)); then highest=$version; fi
  done
  printf '%s\n' "$highest"
))

{
  git diff --no-renames --diff-filter=A --name-only -z "$comparison" -- "$sql" || exit 1
  git ls-files --others --exclude-standard -z -- "$sql"
} | while IFS= read -r -d '' path; do
  file=${path##*/}
  version_of "$file"
  if ((version <= highest)); then
    next=$highest
    while :; do
      next=$((next + 1))
      ((next > highest)) || fail "No migration version is available above $highest on $base."
      [[ -z ${seen[$next]:-} ]] && break
    done
    fail "$(printf 'Migration %s must be numbered above %05d (highest on %s). Rename it to %05d_%s and update test pins.' \
      "$file" "$highest" "$base" "$next" "${file#*_}")"
  fi
done
