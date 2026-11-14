#!/usr/bin/env bash
# Keeps colours and type on the design tokens: counts raw Tailwind palette classes (`emerald-600`),
# hard-coded hex colours (`bg-[#f6f3e4]`, `'#fff'`), arbitrary text sizes (`text-[13px]`), arbitrary
# radii (`rounded-[6px]`; use the radius scale) and shadows (`shadow-[…]`; use shadow-elevation-1/2),
# shadows on hover (`hover:shadow`; hovers stay calm), skeleton
# placeholders (`<Skeleton`) and pulses (`animate-pulse`; loading shows `Loader` instead) per file in
# the platform, the portal and packages/ui, and compares them with scripts/ui-guard-baseline.txt. A count
# above its baseline fails (use a token from globals.css instead); a count below it fails too, until
# `--update` writes the lower baseline, so the debt can only shrink. Stories and tests are not counted.
# Needs bash, grep, sort, uniq, awk and diff.
set -euo pipefail

root="${UI_GUARD_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
baseline="$root/scripts/ui-guard-baseline.txt"
dirs=(apps/platform/src apps/portal/src packages/ui/src)

# One rule per line, tab-separated: name and the ERE whose matches are counted.
rules() {
  local t=$'\t'
  printf '%s\n' \
    "palette${t}-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}" \
    "hex${t}[[_('\"]#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})([]'\")/_ ;,]|$)" \
    "text-px${t}text-\[[0-9.]+px\]" \
    "radius${t}rounded(-[trbl]{1,2})?-\[" \
    "shadow${t}(^|[^:])shadow-\[" \
    "hover-shadow${t}hover:shadow" \
    "skeleton${t}<Skeleton|components/skeleton" \
    "pulse${t}animate-pulse"
}

# "<count> <rule> <file>" per file with matches, sorted by rule and file.
counts() {
  local name pattern existing=() d
  for d in "${dirs[@]}"; do [[ -d "$root/$d" ]] && existing+=("$d"); done
  ((${#existing[@]})) || return 0
  while IFS=$'\t' read -r name pattern; do
    (cd "$root" && grep -rEoH --include='*.ts' --include='*.tsx' \
      --exclude='*.stories.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' -- "$pattern" "${existing[@]}" || true) |
      awk -F: -v rule="$name" '{ n[$1]++ } END { for (f in n) print n[f], rule, f }'
  done < <(rules)
}

current() { counts | sort -k2,2 -k3,3; }

main() {
  if [[ "${1:-}" == --update ]]; then
    current >"$baseline"
    printf 'ui-guard: baseline written to %s\n' "${baseline#"$root"/}"
    return 0
  fi
  [[ -f "$baseline" ]] || : >"$baseline"
  # Join baseline and current on rule+file; a missing side counts as 0.
  local report
  report="$(awk '
    FNR == NR { base[$2 " " $3] = $1; next }
    { now[$2 " " $3] = $1 }
    END {
      for (k in now) if (now[k] > base[k] + 0) printf "more\t%s\t%d → %d\n", k, base[k] + 0, now[k]
      for (k in base) if (now[k] + 0 < base[k]) printf "less\t%s\t%d → %d\n", k, base[k], now[k] + 0
    }' "$baseline" <(current) | sort)"
  [[ -z "$report" ]] && return 0
  if grep -q '^more' <<<"$report"; then
    printf 'ui-guard: new raw colours, text sizes or skeletons; use the tokens in packages/ui/src/styles/globals.css and Loader from packages/ui for loading\n' >&2
    grep '^more' <<<"$report" | cut -f2- >&2
  fi
  if grep -q '^less' <<<"$report"; then
    printf 'ui-guard: fewer than the baseline, lock it in with: bash scripts/ui-guard.sh --update\n' >&2
    grep '^less' <<<"$report" | cut -f2- >&2
  fi
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
