#!/usr/bin/env bash
set -euo pipefail

api_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../apps/api" && pwd)"
artifact_root="${TMPDIR:-/tmp}/helvetly"
mkdir -p "$artifact_root"
audit_dir="$(mktemp -d "$artifact_root/kosit.XXXXXX")"
printf 'KoSIT artifacts and reports: %s\n' "$audit_dir"

# Every cached or downloaded artifact is verified before it is unpacked or executed.
umask 077
tool_cache="$artifact_root/einvoice-tools"
mkdir -p "$tool_cache"
download() {
  local name="$1" expected="$2" url="$3"
  local cached="$tool_cache/$expected-$name"
  if [[ -f "$cached" ]]; then
    cp "$cached" "$audit_dir/$name"
  else
    curl --proto '=https' --fail --location --silent --show-error \
      --retry 3 --retry-all-errors --retry-delay 1 --connect-timeout 15 --max-time 120 \
      "$url" --output "$audit_dir/$name"
  fi
  (cd "$audit_dir" && printf '%s  %s\n' "$expected" "$name" | shasum -a 256 --check)
  if [[ ! -f "$cached" ]]; then
    cp "$audit_dir/$name" "$cached.$$.tmp"
    mv "$cached.$$.tmp" "$cached"
  fi
}
# Official release digests: github.com/itplr-kosit/{validator,validator-configuration-xrechnung,validator-configuration-bis}/releases.
download validator.jar 799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9 \
  'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar'
download config.zip 2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8 \
  'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip'
download bis.zip 399395de5f6240a76ccc5751e4ee9dd329e37f5f7cfe4ee5c93188294ce8cd68 \
  'https://github.com/itplr-kosit/validator-configuration-bis/releases/download/release-3.0.21/validation-configuration-bis-3.0.21.zip'
# SchXslt compiles ANAF's CIUS-RO Schematron (kept in internal/einvoice/testdata/cius-ro); digest from Maven Central's .sha1
# cross-checked against the downloaded bytes on 2026-11-09.
download schxslt.jar cefb6c45441252675270bacc67a1ec4421ed1133f7fb8fee8f314ecfa6a0171a \
  'https://repo1.maven.org/maven2/name/dmaus/schxslt/cli/1.10.1/cli-1.10.1.jar'
unzip -q "$audit_dir/config.zip" -d "$audit_dir/config"
unzip -q "$audit_dir/bis.zip" -d "$audit_dir/bis"
mv "$audit_dir/validator.jar" "$audit_dir/config/validator.jar"
cp "$audit_dir/config/validator.jar" "$audit_dir/bis/validator.jar"
mkdir -p "$audit_dir/bin" "$audit_dir/reports"

# TestKoSIT calls java; this shim runs only its synthetic XML in an offline, read-only container.
# It runs as the host user: with --cap-drop ALL, root cannot read the umask 077 files (Linux CI).
cat > "$audit_dir/bin/java" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 9 || "$1" != '-jar' || "$3" != '-s' || "$5" != '-r' || "$7" != '-o' ]]; then
  printf 'Unexpected KoSIT invocation\n' >&2
  exit 2
fi
fixture_dir="$8"
profile_dir="$(dirname -- "$2")"
if [[ "$profile_dir" != "$HELVETLY_KOSIT_ROOT/config" && "$profile_dir" != "$HELVETLY_KOSIT_ROOT/bis" ]]; then
  printf 'Unknown official validator profile\n' >&2
  exit 2
fi
shift 8
report_dir="$HELVETLY_KOSIT_ROOT/reports/$(basename -- "$profile_dir")-$(basename -- "$fixture_dir")"
mkdir -p "$report_dir"
files=()
for file in "$@"; do
  if [[ "$(dirname -- "$file")" != "$fixture_dir" ]]; then
    printf 'KoSIT input is outside its synthetic fixture directory\n' >&2
    exit 2
  fi
  files+=("/fixtures/$(basename -- "$file")")
done
exec docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --memory 1g --cpus 2 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=$profile_dir,dst=/config,readonly" \
  --mount "type=bind,src=$fixture_dir,dst=/fixtures,readonly" \
  --mount "type=bind,src=$report_dir,dst=/output" \
  "$HELVETLY_KOSIT_IMAGE" java -Xmx512m -jar /config/validator.jar \
  -s /config/scenarios.xml -r /config -o /output "${files[@]}"
SHIM
chmod 700 "$audit_dir/bin/java"

mkdir -p "$audit_dir/schxslt"
mv "$audit_dir/schxslt.jar" "$audit_dir/schxslt/schxslt.jar"
unzip -q "$audit_dir/schxslt/schxslt.jar" 'xslt/*' -d "$audit_dir/schxslt"

# TestCIUSROSchematron calls this with its fixture and report directories: the rules are compiled once, then each
# XML file gets an SVRL report, offline and read-only like the KoSIT run.
cat > "$audit_dir/bin/cius-ro" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 ]]; then
  printf 'Usage: cius-ro <fixture-dir> <report-dir>\n' >&2
  exit 2
fi
exec docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --memory 2g --cpus 2 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=$HELVETLY_KOSIT_ROOT/schxslt,dst=/schxslt,readonly" \
  --mount "type=bind,src=$HELVETLY_CIUS_RO_RULES,dst=/rules,readonly" \
  --mount "type=bind,src=$1,dst=/fixtures,readonly" \
  --mount "type=bind,src=$2,dst=/output" \
  "$HELVETLY_KOSIT_IMAGE" sh -ec '
    saxon() { java -Xmx1g -cp /schxslt/schxslt.jar net.sf.saxon.Transform "$@"; }
    saxon -s:/rules/EN16931-CIUS_RO-UBL-validation.sch -xsl:/schxslt/xslt/2.0/pipeline-for-svrl.xsl -o:/tmp/cius-ro.xsl
    for f in /fixtures/*.xml; do saxon -s:"$f" -xsl:/tmp/cius-ro.xsl -o:"/output/$(basename "$f").svrl"; done'
SHIM
chmod 700 "$audit_dir/bin/cius-ro"

export HELVETLY_KOSIT_ROOT="$audit_dir"
export HELVETLY_KOSIT_IMAGE='eclipse-temurin@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a'
docker image inspect "$HELVETLY_KOSIT_IMAGE" >/dev/null 2>&1 || docker pull "$HELVETLY_KOSIT_IMAGE"
export PATH="$audit_dir/bin:$PATH"
export HELVETLY_TEST_KOSIT="$audit_dir/config/validator.jar"
export HELVETLY_TEST_PEPPOL_KOSIT="$audit_dir/bis/validator.jar"
export HELVETLY_TEST_CIUS_RO="$audit_dir/bin/cius-ro"
export HELVETLY_CIUS_RO_RULES="$api_dir/internal/einvoice/testdata/cius-ro"
cd "$api_dir"
go test -v ./internal/einvoice -run '^(TestKoSIT|TestPeppolKoSIT|TestCIUSROSchematron)$' -count=1
