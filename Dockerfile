# syntax=docker/dockerfile:1
# =============================================================================
# Rally API — Production Dockerfile
# =============================================================================
# Targets:
#   api       → HTTP API server          (default / most common)
#   worker    → Background job processor
#   migrator  → One-shot Drizzle migration runner (CI gate job)
#
# Build examples:
#   docker build --target api      -t rally-api:latest .
#   docker build --target worker   -t rally-worker:latest .
#   docker build --target migrator -t rally-migrator:latest .
#
# Performance notes:
#   - BuildKit cache mounts keep the pnpm store between builds (no re-download)
#   - deps   stage: ALL packages — needed to compile TypeScript
#   - prod-deps stage: only production packages — goes into the final image
#   - builder stage: compiles libs + apps into dist/
#   - api / worker / migrator stages: minimal runtime images
# =============================================================================

ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.21
ARG PNPM_VERSION=10.33.2

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 │ deps
# Install ALL packages (dev + prod) so the builder has everything it needs.
# The pnpm store is cached via BuildKit so subsequent builds skip downloads.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
ARG PNPM_VERSION

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm config set store-dir /root/.local/share/pnpm/store && \
    HUSKY=0 pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 │ prod-deps
# Install production-only packages — this slim node_modules goes into the
# final API and worker images.  Runs in parallel with the builder stage.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS prod-deps
ARG PNPM_VERSION

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm config set store-dir /root/.local/share/pnpm/store && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 │ builder
# Compile the full NestJS monorepo.  Uses the ALL-deps node_modules so the
# TypeScript compiler and NestJS CLI plugins are available.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder
ARG PNPM_VERSION

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Reuse installed packages — no re-install needed
COPY --from=deps /app/node_modules ./node_modules

# Copy full source (respects .dockerignore — no node_modules/dist/secrets)
COPY . .

# Compile API  →  dist/apps/api/
RUN pnpm build:api

# Compile Worker  →  dist/apps/worker/
# Worker tsconfig mirrors the API fix: libs included, no spec files
RUN pnpm build:worker

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4 │ api  (default production target)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS api

# Upgrade all Alpine packages to latest security patches within the pinned
# Alpine version. Ensures Trivy finds no CRITICAL/HIGH CVEs with available fixes.
RUN apk upgrade --no-cache \
    && apk add --no-cache tini \
    && rm -rf /var/cache/apk/*

# Runtime tunables — override via docker run -e or Kubernetes env
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV PORT=3000
ENV HOST=0.0.0.0

WORKDIR /app

# Production node_modules (no devDeps → smaller image)
COPY --from=prod-deps /app/node_modules ./node_modules

# Compiled output: libs are baked into dist/apps/api/ (single output tree)
COPY --from=builder /app/dist/apps/api ./dist/apps/api

# package.json needed by NestJS for version metadata
COPY --from=builder /app/package.json ./

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 nestjs \
    && chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

# tini reaps zombies and forwards signals properly (important for graceful shutdown)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/api/apps/api/src/main.js"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:${PORT}/v1/healthz || exit 1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 5 │ worker
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS worker

RUN apk upgrade --no-cache \
    && apk add --no-cache tini \
    && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist/apps/worker ./dist/apps/worker
COPY --from=builder   /app/package.json ./

RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 nestjs \
    && chown -R nestjs:nodejs /app

USER nestjs

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/worker/apps/worker/src/main.js"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 6 │ migrator
# One-shot container: runs Drizzle migrations then exits.
# Use as a CI gate job before deploying a new API version.
#
# Usage:
#   docker run --rm \
#     -e DATABASE_MIGRATION_URL="postgresql://..." \
#     rally-migrator:latest
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS migrator

RUN apk upgrade --no-cache \
    && apk add --no-cache tini \
    && rm -rf /var/cache/apk/*

ENV NODE_ENV=production

WORKDIR /app

# Migrator needs devDeps (tsx) + drizzle-orm + pg — reuse the full deps stage
COPY --from=deps /app/node_modules ./node_modules

# Migration script and raw SQL files
COPY --from=builder /app/db ./db
COPY --from=builder /app/package.json ./

RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 migrator \
    && chown -R migrator:nodejs /app

USER migrator

ENTRYPOINT ["/sbin/tini", "--"]
# tsx runs db/migrate.ts; __dirname resolves to /app/db so migrations/ is found
CMD ["node_modules/.bin/tsx", "db/migrate.ts"]
