# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
# The repo is a pnpm workspace with NO package-lock.json, and the backend's runtime
# deps live in backend/package.json — so the old `COPY package*.json` + `npm ci --omit=dev`
# had no lockfile to read and, even if it had, installed nothing (the root manifest declares
# zero runtime deps). Build with pnpm and emit a self-contained backend bundle instead.
FROM node:20-slim AS builder

# better-sqlite3 compiles a native addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /build

# Workspace manifests + lockfile + the vendored xlsx tarball (backend depends on
# "xlsx": "file:../vendor/xlsx-0.20.3.tgz").
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY vendor/ ./vendor/

# Install against the committed lockfile, then bundle just the backend into /out with a
# real (de-symlinked) production node_modules. `--legacy` keeps `deploy` working when the
# target dir is outside the workspace on pnpm 9/10.
RUN pnpm install --frozen-lockfile
COPY backend/ ./backend/
RUN pnpm --filter finance-manager-backend deploy --prod --legacy /out

# ── Production stage ───────────────────────────────────────────────────────────
FROM node:20-slim

ENV NODE_ENV=production
ENV PORT=3847

WORKDIR /app

# Writable app dirs (sqlite db + uploaded assets); own everything as the built-in node user.
RUN mkdir -p db assets && chown -R node:node /app

# Self-contained backend (source + node_modules) from the build stage, plus the pre-built
# frontend. NOTE: build the frontend first — `pnpm -C frontend install && pnpm -C frontend build`
# — so frontend/dist/ exists and is served by the backend.
COPY --from=builder --chown=node:node /out ./backend
COPY --chown=node:node frontend/ ./frontend/

USER node

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT}/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "backend/index.js"]
