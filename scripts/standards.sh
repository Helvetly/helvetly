#!/usr/bin/env bash
# Reports pinned standards whose publisher has released a newer version. Pins are read from the files that use
# them, so there is no second list to keep in sync. Prints one tab-separated line per outdated standard:
# name, pinned, latest, where to read about it. Adopting a new version stays a deliberate pull request.
# Needs bash, curl, grep, sed, sort and jq (preinstalled on GitHub's ubuntu and macOS runners).
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
einvoice='scripts/validate-einvoice.sh'
version='[0-9]+(\.[0-9]+)+'

# One standard per line, tab-separated: name, pinned file, pin pattern, source kind (github or page),
# GitHub repository or page URL, and for a page the pattern of the versions it lists. Patterns are ERE
# with the version in the first group.
standards() {
  local t=$'\t'
  printf '%s\n' \
    "KoSIT Validator${t}$einvoice${t}itplr-kosit/validator/releases/download/([^/]+)/${t}github${t}itplr-kosit/validator" \
    "XRechnung validator configuration${t}$einvoice${t}validator-configuration-xrechnung/releases/download/([^/]+)/${t}github${t}itplr-kosit/validator-configuration-xrechnung" \
    "Peppol BIS validator configuration${t}$einvoice${t}validator-configuration-bis/releases/download/([^/]+)/${t}github${t}itplr-kosit/validator-configuration-bis" \
    "Swiss QR-bill implementation guidelines (SIX IG)${t}apps/api/internal/swissqr/swissqr.go${t}SIX IG ($version)${t}page${t}https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html${t}ig-qr-bill-v($version)-en\.pdf" \
    "eCH-0217 E-MWST (ESTV VAT return import)${t}apps/api/internal/vatreturn/testdata/ech0217/README.md${t}eCH-0217 Spezifikation E-MWST V($version)${t}page${t}https://www.ech.ch/de/ech/ech-0217${t}/ech/ech-0217/($version)" \
    "KSeF structured invoice FA (Poland)${t}apps/api/internal/einvoice/fa3.go${t}structured invoice \"FA \(([0-9]+)\)\"${t}page${t}https://api.github.com/repos/CIRFMF/ksef-docs/contents/faktury/schemy/FA${t}schemat_FA\(([0-9]+)\)_v"
}

# The first group of every match of an ERE, in order (the patterns contain no '#').
captures() { grep -oE -- "$2" <<<"$1" | sed -E "s#$2#\\1#"; }

# The pinned version in text (args: text, pattern, file), or an error naming what is missing: a pin that moved
# must not go unwatched.
pin_in() {
  local found
  found="$(captures "$1" "$2" | head -n 1 || true)"
  if [[ -z "$found" ]]; then
    printf 'no pin matching %s in %s\n' "$2" "$3" >&2
    return 1
  fi
  printf '%s\n' "$found"
}

# Every distinct version the pattern captures in text, oldest first, numerically part by part.
versions_in() {
  { captures "$1" "$2" || true; } | sort -u | sort -t . -k1,1n -k2,2n -k3,3n -k4,4n
}

# 1, 0 or -1, numerically part by part: 2.10 is newer than 2.9 and 2.4 equals 2.4.0.
compare_versions() {
  local -a x y
  IFS=. read -ra x <<<"$1"
  IFS=. read -ra y <<<"$2"
  local i n=$((${#x[@]} > ${#y[@]} ? ${#x[@]} : ${#y[@]}))
  for ((i = 0; i < n; i++)); do
    local a=$((10#${x[i]:-0})) b=$((10#${y[i]:-0}))
    if ((a != b)); then
      ((a > b)) && echo 1 || echo -1
      return
    fi
  done
  echo 0
}

# Body of a successful GET (args: what to name in errors, url, extra curl arguments).
get() {
  local name="$1" url="$2" out status
  shift 2
  out="$(curl --silent --show-error --location --max-time 60 --write-out '\n%{http_code}' "$@" "$url")"
  status="${out##*$'\n'}"
  if [[ "$status" != 2* ]]; then
    printf '%s: answered %s\n' "$name" "$status" >&2
    return 1
  fi
  printf '%s\n' "${out%$'\n'*}"
}

# The newest release tag of a GitHub repository; "latest" is the publisher's newest release by definition.
github_latest() {
  local -a auth=()
  [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(--header "Authorization: Bearer $GITHUB_TOKEN")
  get "$1: GitHub" "https://api.github.com/repos/$1/releases/latest" "${auth[@]+"${auth[@]}"}" | jq -er .tag_name
}

# The newest version a page lists (args: url, pattern).
page_latest() {
  local body latest
  body="$(get "$1" "$1")" || return 1
  latest="$(versions_in "$body" "$2" | tail -n 1)"
  if [[ -z "$latest" ]]; then
    printf '%s: no version found, the page layout may have changed\n' "$1" >&2
    return 1
  fi
  printf '%s\n' "$latest"
}

# The TSV line for one standard when it is outdated, nothing when it is current. Failures return explicitly:
# main calls this in a condition, where errexit does not apply.
check() {
  local name="$1" file="$2" pattern="$3" kind="$4" source="$5" page_pattern="${6:-}" pinned latest url
  pinned="$(pin_in "$(cat "$root/$file")" "$pattern" "$file")" || return 1
  if [[ "$kind" == github ]]; then
    latest="$(github_latest "$source")" || return 1
    url="https://github.com/$source/releases"
    [[ "$latest" != "$pinned" ]] || return 0
  else
    latest="$(page_latest "$source" "$page_pattern")" || return 1
    url="$source"
    [[ "$(compare_versions "$latest" "$pinned")" == 1 ]] || return 0
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$pinned" "$latest" "$url"
}

main() {
  local failed=0 name file pattern kind source page_pattern errors
  while IFS=$'\t' read -r name file pattern kind source page_pattern; do
    # Each standard is checked on its own: one failing source must not hide the others.
    if ! errors="$( (check "$name" "$file" "$pattern" "$kind" "$source" "$page_pattern") 2>&1 >&3)"; then
      failed=1
      printf '%s: %s\n' "$name" "${errors:-failed}" >&2
    fi
  done 3>&1 < <(standards)
  return "$failed"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi
