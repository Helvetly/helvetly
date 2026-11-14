#!/usr/bin/env bash
# Tests scripts/standards.sh offline: pins, version parsing and comparison.
set -uo pipefail
# shellcheck source=scripts/standards.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/standards.sh"
set +e

failures=0
assert_eq() { # name, expected, actual
  if [[ "$2" == "$3" ]]; then
    printf 'ok - %s\n' "$1"
  else
    printf 'not ok - %s\n  expected: %q\n  actual:   %q\n' "$1" "$2" "$3"
    failures=$((failures + 1))
  fi
}

# Every pin is found in the file that uses it.
while IFS=$'\t' read -r name file pattern _; do
  pinned="$(pin_in "$(cat "$root/$file")" "$pattern" "$file")"
  assert_eq "pin found: $name" yes "$([[ "$pinned" =~ [^[:space:]] ]] && echo yes || echo no)"
done < <(standards)

# A missing pin is an error, not a silent pass.
error="$(pin_in 'nothing here' 'v([0-9]+)' x 2>&1 >/dev/null)"
assert_eq 'a missing pin fails' 1 "$?"
assert_eq 'a missing pin names itself' 'no pin matching v([0-9]+) in x' "$error"

# Versions compare by number, not by text.
assert_eq '2.10 is newer than 2.9' 1 "$(compare_versions 2.10 2.9)"
assert_eq '2.4 equals 2.4.0' 0 "$(compare_versions 2.4 2.4.0)"
assert_eq '2.3 is older than 2.4' -1 "$(compare_versions 2.3 2.4)"

# A page lists its versions oldest first, once each.
html='ig-qr-bill-v2.4-en.pdf ig-qr-bill-v2.2-en.pdf ig-qr-bill-v2.10-en.pdf ig-qr-bill-v2.4-en.pdf'
assert_eq 'SIX versions sorted and distinct' $'2.2\n2.4\n2.10' \
  "$(versions_in "$html" 'ig-qr-bill-v([0-9]+(\.[0-9]+)+)-en\.pdf')"

pattern_of() { standards | awk -F '\t' -v n="$1" -v c="$2" 'index($1, n) == 1 { print $c }'; }

# eCH-0217 versions are read from the page links and the pin from the fixtures README.
file="$(pattern_of eCH-0217 2)"
assert_eq 'eCH-0217 pin' 2.0.0 "$(pin_in "$(cat "$root/$file")" "$(pattern_of eCH-0217 3)" "$file")"
html='<a href="/de/ech/ech-0217/1.0">1.0</a><a href="/de/ech/ech-0217/2.0.0">2.0.0</a><a href="/de/ech/ech-0217/1.0.1">'
assert_eq 'eCH-0217 page versions' $'1.0\n1.0.1\n2.0.0' "$(versions_in "$html" "$(pattern_of eCH-0217 6)")"

# The KSeF FA structure is pinned in the generator and read from the official schema folder.
file="$(pattern_of KSeF 2)"
assert_eq 'KSeF FA pin' 3 "$(pin_in "$(cat "$root/$file")" "$(pattern_of KSeF 3)" "$file")"
listing='[{"name":"schemat_FA(2)_v1-0E.xsd"},{"name":"schemat_FA(3)_v1-0E.xsd"},{"name":"bazowe"}]'
assert_eq 'KSeF FA versions' $'2\n3' "$(versions_in "$listing" "$(pattern_of KSeF 6)")"

exit $((failures > 0))
