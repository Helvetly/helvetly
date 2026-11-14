#!/usr/bin/env bash
# Tests the download step of scripts/validate-einvoice.sh offline: curl is replaced on PATH by a stub that records
# its arguments and answers like a server would, so the cache and SHA-256 rules run for real.
set -uo pipefail

script="$(dirname -- "${BASH_SOURCE[0]}")/validate-einvoice.sh"
download_function="$(sed -n '/^download() {$/,/^}$/p' "$script")"
[[ -n "$download_function" ]] || { echo 'the validator script must define its download function' >&2; exit 1; }

artifact='synthetic pinned KoSIT artifact'
digest="$(printf '%s\n' "$artifact" | shasum -a 256 | cut -d ' ' -f 1)"
failures=0
check() { # name, condition...
  local name="$1"
  shift
  if "$@"; then
    printf 'ok - %s\n' "$name"
  else
    printf 'not ok - %s\n' "$name"
    failures=$((failures + 1))
  fi
}

# Fresh audit and cache directories and a curl stub; $1 is its answer: ok, fail (curl's HTTP error) or tampered.
fixture() {
  root="$(mktemp -d "${TMPDIR:-/tmp}/helvetly-kosit-download-test.XXXXXX")"
  mkdir "$root/audit" "$root/cache"
  output="$root/audit/validator.jar"
  cached="$root/cache/$digest-validator.jar"
  mkdir "$root/bin"
  cat >"$root/bin/curl" <<STUB
#!/usr/bin/env bash
printf '%s\\n' "\$*" >>'$root/requests'
while ((\$#)); do [[ "\$1" == --output ]] && out="\$2"; shift; done
case '$1' in
  ok) printf '%s\\n' '$artifact' >"\$out" ;;
  tampered) printf 'tampered artifact\\n' >"\$out" ;;
  fail) exit 22 ;;
esac
STUB
  chmod +x "$root/bin/curl"
}

# Runs the real download function in a subshell with errexit, as the script does; sets $status.
download() {
  (
    set -euo pipefail
    export audit_dir="$root/audit" tool_cache="$root/cache" PATH="$root/bin:$PATH"
    eval "$download_function"
    download validator.jar "$digest" 'https://example.test/validator.jar'
  ) >/dev/null 2>&1
  status=$?
}
requests() { [[ -f "$root/requests" ]] && wc -l <"$root/requests" | tr -d ' ' || echo 0; }
cached_files() { ls -A "$root/cache"; }

fixture ok
download
check 'a download succeeds' test "$status" -eq 0
check 'over HTTPS only, with retries on every error' grep -q -- "--proto =https .*--retry 3 --retry-all-errors" "$root/requests"
check 'one request' test "$(requests)" -eq 1
check 'the verified bytes are the output' test "$(cat "$output")" == "$artifact"
check 'the verified bytes are cached' test "$(cat "$cached")" == "$artifact"
check 'the cache holds only that file' test "$(cached_files)" == "$digest-validator.jar"
rm -rf "$root"

fixture fail
download
check 'a failed download fails with curl status 22' test "$status" -eq 22
check 'a failed download is not cached' test -z "$(cached_files)"
rm -rf "$root"

fixture tampered
download
check 'a wrong SHA-256 fails' test "$status" -eq 1
check 'a wrong SHA-256 is fetched once' test "$(requests)" -eq 1
check 'a wrong SHA-256 is not cached' test -z "$(cached_files)"
rm -rf "$root"

fixture fail
printf '%s\n' "$artifact" >"$cached"
download
check 'a verified cache entry is reused' test "$status" -eq 0
check 'a verified cache entry needs no request' test "$(requests)" -eq 0
check 'a verified cache entry is the output' test "$(cat "$output")" == "$artifact"
rm -rf "$root"

fixture ok
printf 'tampered cached artifact\n' >"$cached"
download
check 'a corrupted cache entry fails' test "$status" -eq 1
check 'a corrupted cache entry is not refetched' test "$(requests)" -eq 0
rm -rf "$root"

exit $((failures > 0))
