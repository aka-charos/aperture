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
