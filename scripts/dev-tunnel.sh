#!/usr/bin/env bash
# `pnpm dev` on public https addresses through a named Cloudflare tunnel (dev-app, dev-portal, dev-www, dev-docs and
# dev-api .example.com), for testing on a phone, Google sign-in or webhooks. TUNNEL is a cloudflared config whose
# ingress maps one hostname each to localhost:8000 (platform), :8002 (portal), :8001 (web), :8003 (docs) and
# optionally :3333 (API):
#
#   ingress:
#     - { hostname: dev-app.example.com, service: http://localhost:8000 }
#     - { hostname: dev-portal.example.com, service: http://localhost:8002 }
#     - { hostname: dev-www.example.com, service: http://localhost:8001 }
#     - { hostname: dev-docs.example.com, service: http://localhost:8003 }
#     - { hostname: dev-api.example.com, service: http://localhost:3333 }
#     - service: http_status:404
#
# A new hostname also needs its DNS record: cloudflared tunnel route dns <tunnel> dev-docs.example.com
#
# The platform is public meanwhile, so the dev sign-in (readable email codes) is off: codes go to Mailpit
# (http://localhost:8026) and the API needs a real SECRET_KEY in .env.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
config="${TUNNEL:-$HOME/.cloudflared/helvetly-dev.yml}"
[[ -f "$config" ]] || { echo "No tunnel config at $config (set TUNNEL=path/to/config.yml)" >&2; exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared is not installed (brew install cloudflared)" >&2; exit 1; }

# The hostname of the ingress rule whose service is on this local port.
host_for() { awk -v p="localhost:$1" '/hostname:/{h=$NF} /service:/ && index($0, p){print h; exit}' "$config" | tr -d '"'"'"; }
app="$(host_for 8000)" portal="$(host_for 8002)" www="$(host_for 8001)" docs="$(host_for 8003)" api="$(host_for 3333)"
[[ -n "$app" && -n "$portal" ]] || { echo "$config needs hostnames for localhost:8000 and localhost:8002" >&2; exit 1; }

if [[ -z "$(grep -E '^SECRET_KEY=.+' "$root/.env" 2>/dev/null || true)" ]]; then
  echo "Set SECRET_KEY in .env first (the dev sign-in and its fixed key are off on a public address):" >&2
  echo "  openssl rand -base64 32" >&2
  exit 1
fi

log="${TMPDIR:-/tmp}/helvetly-tunnel.log"
cloudflared tunnel --no-autoupdate --config "$config" run >"$log" 2>&1 &
tunnel=$!
trap 'kill "$tunnel" 2>/dev/null || true' EXIT INT TERM

echo "Platform: https://$app  Portal: https://$portal${www:+  Web: https://$www}${docs:+  Docs: https://$docs}${api:+  API: https://$api}  Tunnel log: $log"
cd "$root"
# S3_PROXY_DOWNLOADS: downloads stream through the API, since the browser cannot reach the localhost bucket.
# NEXT_PUBLIC_DOCS_URL: the platform's links to the docs; without a docs hostname they keep their default.
# DOCS_URL: the docs' API playground may call the API from that origin (CORS).
env PUBLIC_URL="https://$app" PORTAL_URL="https://$portal" AUTH_DEV_SIGNIN=false S3_PROXY_DOWNLOADS=true \
  NEXT_PUBLIC_PLATFORM_URL="https://$app" ${docs:+"NEXT_PUBLIC_DOCS_URL=https://$docs"} ${docs:+"DOCS_URL=https://$docs"} pnpm dev
