# ===================================================================
# Aperture Dockerfile
# Multi-stage build: install deps, build packages, build web, build api
# ===================================================================

# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app

ENV HUSKY=0

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Copy package files for all workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ===================================================================
# Stage 2: Builder
FROM deps AS builder
WORKDIR /app

# Copy source code
COPY . .

# Build all workspaces; pnpm runs independent packages in parallel
RUN pnpm -r build

# ===================================================================
# Stage 3: Production dependencies only
FROM node:24-alpine AS prod-deps
WORKDIR /app

ENV HUSKY=0

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/

# Install only production dependencies (skip prepare/husky; rebuild native modules)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && \
    pnpm rebuild sharp

# ===================================================================
# Stage 3b: Bitwarden Secrets Manager CLI
#
# `bws` reads the operator's Bitwarden project when BWS_ACCESS_TOKEN and
# BWS_PROJECT_ID are set (packages/core/src/secrets/). The Node SDK
# (@bitwarden/sdk-napi) ships no musl build, so the CLI's static musl binary is
# what runs on Alpine.
#
# Pinned to a release and checked against the checksums Bitwarden publishes
# with it (bws-sha256-checksums-<version>.txt): a different file stops the
# build. Raising BWS_VERSION means replacing both sums from that release's file.
#
# Checked by hand for 2.1.0: both zips download from this address (one
# redirect, which curl -L follows), match the sums below, and hold a single
# file named `bws` at their root. curl rather than BusyBox wget because that
# is the client the download was checked with; it stays in this stage. The
# stage fails the build if anything differs, on purpose: an image that quietly
# shipped without the CLI would report every linked key as unavailable.
FROM alpine:3 AS bws
ARG BWS_VERSION=2.1.0
ARG BWS_SHA256_X86_64=f59ee150e42b82128d437087e9bac920053c6bfddcb960d20ce9386e5ac9bba6
ARG BWS_SHA256_AARCH64=eb0f1ae61d1c3b74244d2841233276e05c77e8be4da197ed90fc6248387005e1
RUN set -eu; \
    apk add --no-cache curl; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64) sum="$BWS_SHA256_X86_64" ;; \
      aarch64) sum="$BWS_SHA256_AARCH64" ;; \
      *) echo "No bws build for $arch"; exit 1 ;; \
    esac; \
    file="bws-${arch}-unknown-linux-musl-${BWS_VERSION}.zip"; \
    curl -fsSL --retry 3 --retry-delay 2 -o "/tmp/$file" \
      "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/$file"; \
    echo "$sum  /tmp/$file" | sha256sum -c -; \
    mkdir /out; \
    unzip -j "/tmp/$file" bws -d /out; \
    test -f /out/bws; \
    chmod 0755 /out/bws; \
    /out/bws --version

# ===================================================================
# Stage 4: Runtime
FROM node:24-alpine AS runner
WORKDIR /app

# Install dependencies:
# - fontconfig: Sharp SVG text rendering (needed for poster overlays)
# - postgresql18-client: pg_dump and pg_restore for database backup/restore
#
# The client major is PINNED to 18, ahead of the bundled pgvector:pg16 server,
# on purpose. Both rules below are from PostgreSQL's own source (pg_dump's
# minRemoteVersion/maxRemoteVersion and the archive's K_VERS):
#
#   - pg_dump accepts any server from 9.2 up to its OWN major, never a newer
#     one. An 18 client backs up a 16, 17 or 18 server.
#   - pg_restore reads archives from its own major and older. 17 and 18 write
#     archive 1.16, which a 16 client refuses ("unsupported version (1.16) in
#     file header"); every backup this fork has written came from a floating
#     client that was already 17 or 18, so pinning DOWN to 16 would make the
#     app unable to restore them.
#
# Pinned rather than the unpinned `postgresql-client`, which follows Alpine's
# newest major and so changed under the image without any commit. The Alpine
# release itself is NOT pinned (`node:24-alpine`), so Node security patches keep
# arriving: Docker stops rebuilding older Alpine variants. Packages exist per
# Alpine release (18 is in 3.23's and 3.24's main repository); if a future base
# drops postgresql18-client, `apk add` fails the build loudly rather than
# installing something else.
#
# Moving the database past 18 needs this line raised first, or backups stop,
# and the Alpine release must offer the new package. The server and client
# majors are also compared at startup (clientCompatibility.ts).
RUN apk add --no-cache fontconfig postgresql18-client

# The client tools must be the major pinned above, or the build stops here
# rather than shipping a different pg_dump than this file promises.
RUN for tool in pg_dump pg_restore psql; do \
      "$tool" --version | grep -q '(PostgreSQL) 18\.' || \
        { echo "$tool is not PostgreSQL 18: $("$tool" --version)"; exit 1; }; \
    done

# Bitwarden Secrets Manager CLI (stage 3b). Unused unless BWS_ACCESS_TOKEN is set.
COPY --from=bws --chown=root:root /out/bws /usr/local/bin/bws

# Add non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 aperture

# Install custom fonts (Oswald Bold for Top Picks posters)
COPY --chown=root:root packages/core/assets/fonts /usr/share/fonts/custom
RUN fc-cache -fv

# Copy production dependencies
COPY --from=prod-deps --chown=aperture:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=aperture:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps --chown=aperture:nodejs /app/packages/core/node_modules ./packages/core/node_modules

# Copy built packages
COPY --from=builder --chown=aperture:nodejs /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=aperture:nodejs /app/packages/core/package.json ./packages/core/

# Copy built API
COPY --from=builder --chown=aperture:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=aperture:nodejs /app/apps/api/package.json ./apps/api/

# Copy built web app
COPY --from=builder --chown=aperture:nodejs /app/apps/web/dist ./apps/web/dist

# Copy bundled library default images for media server sync
COPY --from=builder --chown=aperture:nodejs /app/apps/web/public/AI_MOVIE_PICKS.png ./assets/library-defaults/
COPY --from=builder --chown=aperture:nodejs /app/apps/web/public/AI_SERIES_PICKS.png ./assets/library-defaults/
COPY --from=builder --chown=aperture:nodejs /app/apps/web/public/TOP_10_MOVIES_THIS_WEEK.png ./assets/library-defaults/
COPY --from=builder --chown=aperture:nodejs /app/apps/web/public/TOP_10_SERIES_THIS_WEEKpng.png ./assets/library-defaults/
COPY --from=builder --chown=aperture:nodejs /app/apps/web/public/Shows_You_Watch.png ./assets/library-defaults/

# Copy migrations
COPY --from=builder --chown=aperture:nodejs /app/db ./db

# Copy workspace config
COPY --from=builder --chown=aperture:nodejs /app/package.json ./
COPY --from=builder --chown=aperture:nodejs /app/pnpm-workspace.yaml ./

# Create uploads directory with proper ownership before switching user
RUN mkdir -p /app/uploads && chown aperture:nodejs /app/uploads

# Set user
USER aperture

# Version identity, supplied by CI (see .github/workflows/docker-build.yml).
# APP_VERSION is the upstream lineage this fork tracks; APP_BUILD identifies the
# fork build ("mod.<commits>.g<shortsha>"). Left empty here on purpose: an image
# built by hand then reports the code fallbacks, which say "dev" rather than
# claiming to be a release. Declared AFTER the build stages so a version bump
# does not invalidate their layer cache.
ARG APP_VERSION=""
ARG APP_BUILD=""

# Environment
ENV NODE_ENV=production
ENV PORT=3456
ENV DOCKER_ENV=true
ENV APP_VERSION=${APP_VERSION}
ENV APP_BUILD=${APP_BUILD}

# Expose port
EXPOSE 3456

# Health check. A Node script rather than wget http://localhost: Alpine's BusyBox
# wget uses only the first address it resolves, which is ::1 wherever the container
# has an IPv6 loopback, and the server listens on IPv4 by default. The script works
# the address out from the same HOST and PORT the server uses, and is tested.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["node", "/app/apps/api/dist/healthcheck.js"]

# Start the server
CMD ["node", "apps/api/dist/index.js"]
