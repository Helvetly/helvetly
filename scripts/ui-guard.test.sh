#!/usr/bin/env bash
# Tests scripts/ui-guard.sh on a throwaway tree: what it counts, what it skips and the baseline ratchet.
set -uo pipefail
guard="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/ui-guard.sh"

failures=0
assert_eq() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then
    printf 'ok - %s\n' "$1"
  else
    printf 'not ok - %s\n  expected: %q\n  actual:   %q\n' "$1" "$2" "$3"
    failures=$((failures + 1))
  fi
}

tree="$(mktemp -d)"
trap 'rm -rf "$tree"' EXIT
mkdir -p "$tree/scripts" "$tree/apps/platform/src" "$tree/apps/portal/src" "$tree/packages/ui/src"
run() { UI_GUARD_ROOT="$tree" bash "$guard" "$@" 2>&1; }

cat >"$tree/apps/platform/src/a.tsx" <<'EOF'
<p className="text-emerald-600 dark:bg-amber-500/15 bg-[#f6f3e4] text-[13px] shadow-[0_1px_#000]" style={{ color: '#fff' }} />
// tokens are fine: text-success bg-warning-surface text-body-sm; so is issue #123 and text-[1.2em]
EOF
cat >"$tree/apps/portal/src/b.stories.tsx" <<'EOF'
<p className="text-rose-500 bg-[#fff]" />
EOF

run --update >/dev/null
assert_eq 'counts per rule and file, skips stories' \
  "$(printf '3 hex apps/platform/src/a.tsx\n2 palette apps/platform/src/a.tsx\n1 shadow apps/platform/src/a.tsx\n1 text-px apps/platform/src/a.tsx')" \
  "$(cat "$tree/scripts/ui-guard-baseline.txt")"

run >/dev/null
assert_eq 'passes at the baseline' 0 "$?"

echo '<p className="text-sky-500" />' >"$tree/packages/ui/src/c.tsx"
out="$(run)"
assert_eq 'fails on a new file with a palette class' 1 "$?"
assert_eq 'names the new occurrence' yes "$([[ "$out" == *'palette packages/ui/src/c.tsx'*'0 → 1'* ]] && echo yes || echo no)"
rm "$tree/packages/ui/src/c.tsx"

printf '%s\n' "import { Skeleton } from '@helvetly/ui/components/skeleton'" '<Skeleton className="h-4" />' \
  '<span className="animate-pulse rounded bg-muted" />' >"$tree/apps/portal/src/d.tsx"
out="$(run)"
assert_eq 'fails on a skeleton or a pulse placeholder' 1 "$?"
assert_eq 'names both' yes "$([[ "$out" == *'pulse apps/portal/src/d.tsx'*'skeleton apps/portal/src/d.tsx'*'0 → 2'* ]] && echo yes || echo no)"
rm "$tree/apps/portal/src/d.tsx"

echo '<input className="h-8 rounded-md border border-input bg-card" />' >"$tree/apps/portal/src/f.tsx"
out="$(run)"
assert_eq 'fails on a hand-made field box' 1 "$?"
assert_eq 'names it' yes "$([[ "$out" == *'field apps/portal/src/f.tsx'*'0 → 1'* ]] && echo yes || echo no)"
rm "$tree/apps/portal/src/f.tsx"

echo '<p className="text-[11px]" />' >>"$tree/apps/platform/src/a.tsx"
run >/dev/null
assert_eq 'fails when a file gains one' 1 "$?"
run --update >/dev/null

echo '<p className="rounded-[6px] rounded-tl-[3px] hover:shadow-elevation-2 hover:shadow-[0_0_1px_#000]" />' >"$tree/packages/ui/src/e.tsx"
out="$(run)"
assert_eq 'fails on arbitrary radii and shadowed hovers' 1 "$?"
assert_eq 'counts both radii, both hovers and not the hover shadow as a plain one' yes \
  "$([[ "$out" == *'hover-shadow packages/ui/src/e.tsx'*'0 → 2'* && "$out" == *'radius packages/ui/src/e.tsx'*'0 → 2'* && "$out" != *'	shadow packages/ui/src/e.tsx'* ]] && echo yes || echo no)"
rm "$tree/packages/ui/src/e.tsx"

printf '<p className="text-success" />\n' >"$tree/apps/platform/src/a.tsx"
out="$(run)"
assert_eq 'fails until a lower count is locked in' 1 "$?"
assert_eq 'says how to lock it in' yes "$([[ "$out" == *'--update'* ]] && echo yes || echo no)"
run --update >/dev/null
run >/dev/null
assert_eq 'passes after --update' 0 "$?"
assert_eq 'clean files leave no baseline lines' '' "$(cat "$tree/scripts/ui-guard-baseline.txt")"

if ((failures)); then
  printf '%d failed\n' "$failures"
  exit 1
fi
