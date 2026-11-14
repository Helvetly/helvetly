# The Helvetly image: the single `helvetly` binary (Go API with the platform and portal static exports embedded) on a
# distroless base. `.github/workflows/release.yml` builds and publishes it for a release tag; the README
# ("Self-hosting") describes how to run it.
#
#   docker build -t helvetly .
#
# Base images are pinned by digest; bump the tag and the digest together. Node and Go follow .nvmrc and
# apps/api/go.mod; pnpm follows `packageManager` in package.json.

# --- 1. Platform and portal: static exports ------------------------------------------------------------------------
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS web
# Node 26 does not ship Corepack; install the pnpm version package.json pins.
RUN npm install --global --no-fund --no-audit pnpm@12.16.1
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 CI=1
# Baked into the client bundles at build time (public URLs only, never a secret).
ARG NEXT_PUBLIC_DOCS_URL=https://docs.helvetly.com
ARG NEXT_PUBLIC_WEB_URL=https://helvetly.com
ENV NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
COPY . .
RUN pnpm install --frozen-lockfile --filter '@helvetly/platform...' --filter '@helvetly/portal...' \
  && pnpm --filter @helvetly/platform --filter @helvetly/portal build

# --- 2. The binary ---------------------------------------------------------------------------------------------------
FROM golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS api
WORKDIR /src/apps/api
ENV CGO_ENABLED=0 GOFLAGS=-mod=readonly GOTOOLCHAIN=local
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download && go mod verify
COPY apps/api/ ./
RUN rm -rf internal/platform/dist internal/platform/portal-dist
COPY --from=web /src/apps/platform/out internal/platform/dist
COPY --from=web /src/apps/portal/out internal/platform/portal-dist
RUN go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o /out/helvetly ./cmd/helvetly

# --- 3. Runtime: no shell, no package manager, uid 65532 -------------------------------------------------------------
FROM gcr.io/distroless/static-debian13:nonroot@sha256:aafe993665bf6200db38a02c11a9351e782a84b6a45e7f33b6695638c88e3931
ARG VERSION=dev
LABEL org.opencontainers.image.title="helvetly" \
  org.opencontainers.image.version="$VERSION" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=api /out/helvetly /usr/local/bin/helvetly
# The settings this release reads (names and safe defaults only), for a deployment's settings check.
COPY .env.example /usr/share/helvetly/env.example
COPY LICENSE NOTICE /usr/share/helvetly/
ENV HTTP_ADDR=:3333
EXPOSE 3333
USER nonroot:nonroot
# /api/ready also checks the database; the binary is its own probe (no curl in the image).
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 CMD ["/usr/local/bin/helvetly", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/helvetly"]
