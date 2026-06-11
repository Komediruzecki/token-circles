# Build stage
FROM node:20-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy only package files first to leverage Docker cache
COPY package*.json ./
RUN npm ci --omit=dev

# Production stage
FROM node:20-slim

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3847

WORKDIR /app

# 1. Create necessary directories and set ownership to the existing 'node' user
# We use the built-in 'node' user (UID 1000) to avoid the GID conflict
RUN mkdir -p db assets && chown -R node:node /app

# 2. Copy production node_modules from builder
# We use --chown=node:node so the app can actually read/execute these
COPY --from=builder --chown=node:node /build/node_modules ./node_modules

# 3. Copy application source with correct ownership
# NOTE: The frontend must be pre-built before building the Docker image.
# Run `cd frontend && npm install && npm run build` first.
# This creates frontend/dist/ which is served by the backend.
COPY --chown=node:node backend/ ./backend/
COPY --chown=node:node frontend/ ./frontend/

# 4. Switch to the non-root user for security
USER node

# Expose the application port
EXPOSE 3847

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT}/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "backend/index.js"]
