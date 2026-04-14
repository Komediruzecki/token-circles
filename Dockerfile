# Build stage
FROM node:20-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package*.json ./
RUN npm ci --omit=dev

# Production stage
FROM node:20-slim

# Create non-root user for security
RUN groupadd --gid 1000 appgroup && \
    useradd --uid 1000 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy application source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Ensure directories exist and are writable
RUN mkdir -p db assets && chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose the application port
EXPOSE 3847

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3847

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT}/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "backend/index.js"]
