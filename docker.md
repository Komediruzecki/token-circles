# Docker Deployment Guide

This guide covers building, running, and managing the finance-manager application with Docker.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+ (`docker compose` v2 syntax is used below)

---

## Quick Start

```bash
# Build and start the container
docker compose up -d

# Verify it's running
docker compose ps
```

The app will be available at **http://localhost:3847**.

---

## Configuration

### Environment Variables

| Variable    | Default | Description                          |
|-------------|---------|--------------------------------------|
| `APP_PORT`  | `3847`  | Host port to map the container port  |
| `NODE_ENV`  | `production` | Runtime mode                    |
| `PORT`      | `3847`  | Container internal port (do not change) |

Set these in a `.env` file in the project root:

```bash
APP_PORT=3847
```

---

## Common Operations

### Build the Image

```bash
# Build without cache
docker compose build --no-cache

# Build with progress output
docker compose build --progress=plain
```

### Rebuild After Code Changes

```bash
# Rebuild the image and restart containers
docker compose up -d --build

# Force a full rebuild (no cache)
docker compose up -d --build --no-cache
```

### Stop and Remove Containers

```bash
docker compose down
```

### Stop and Remove Everything (including volumes -- WARNING: deletes data)

```bash
docker compose down -v
```

### View Logs

```bash
# Stream logs
docker compose logs -f

# Follow logs for a specific service
docker compose logs -f app

# Show last 50 lines
docker compose logs --tail=50
```

### Restart the Application

```bash
docker compose restart app
```

---

## Data Persistence

The Docker setup uses named volumes to persist data across container restarts:

- **`fm-db-data`** -- mounts to `/app/db`, stores the SQLite database (`finance.db`)
- **`fm-assets-data`** -- mounts to `/app/assets`, stores uploaded files

These volumes exist independently of the container lifecycle. Removing the container with `docker compose down` (without `-v`) does **not** delete them.

### Verify Volume Exists

```bash
docker volume ls | grep fm-
```

### Inspect Volume Contents

```bash
# Check volume mount location on host
docker inspect finance-manager --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

### Backup the Database

```bash
# Copy from the volume to host
docker run --rm \
  -v finance-manager_clodhost-com_fm-db-data:/data \
  -v $(pwd)/db-backup:/backup \
  alpine cp /data/finance.db /backup/finance.db.$(date +%Y%m%d%H%M%S)

# Or back it up directly from the running container
docker exec finance-manager cp /app/db/finance.db /app/assets/finance.db.backup
docker cp finance-manager:/app/assets/finance.db.backup ./db-backup/
```

---

## Testing the API

### From the Host (curl)

```bash
# Check health endpoint (you may need to add this to your app)
curl http://localhost:3847/

# Get categories
curl http://localhost:3847/api/categories

# Get transactions
curl http://localhost:3847/api/transactions

# Add a transaction
curl -X POST http://localhost:3847/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test transaction",
    "amount": 100.50,
    "type": "expense",
    "category_id": 1,
    "date": "2026-04-14"
  }'

# Upload a file
curl -X POST http://localhost:3847/api/upload \
  -F "file=@/path/to/your/file.xlsx"

# Import from Excel
curl -X POST http://localhost:3847/api/import \
  -F "file=@/path/to/your/data.xlsx"
```

### From Inside the Container

```bash
# Open a shell in the running container
docker exec -it finance-manager /bin/bash

# Or run a single command
docker exec finance-manager node -e "console.log('Node works')"

# Test the server is responding
docker exec finance-manager wget -qO- http://localhost:3847/ | head -c 200
```

### With a Specific Profile ID

The app supports multi-profile. Pass the profile ID via header or query param:

```bash
curl http://localhost:3847/api/transactions \
  -H "X-Profile-ID: 1"

curl "http://localhost:3847/api/transactions?profile_id=2"
```

---

## Running with a Host Directory Mount

Instead of Docker named volumes, you can mount a host directory directly for the database:

```bash
# Create a data directory on the host
mkdir -p ~/finance-manager-data

# Run with host directory mount
docker run -d \
  --name finance-manager \
  -p 3847:3847 \
  -v ~/finance-manager-data:/app/db \
  -v ~/finance-manager-data:/app/assets \
  -e NODE_ENV=production \
  -e PORT=3847 \
  finance-manager:latest
```

Or modify `docker-compose.yml` to use a bind mount instead of a named volume:

```yaml
volumes:
  - ~/finance-manager-data:/app/db
  - ~/finance-manager-data:/app/assets
```

---

## Troubleshooting

### Container Exits Immediately

```bash
# Check the logs for errors
docker compose logs app

# Common cause: permissions on mounted volumes
# Fix: ensure the data directory is writable
chmod 777 ~/finance-manager-data
```

### Port Already in Use

```bash
# Check what is using port 3847
lsof -i :3847

# Use a different port via APP_PORT
APP_PORT=8080 docker compose up -d
```

### Database Locked Errors

SQLite uses WAL mode. If you see "database is locked":
- Ensure only one container instance is running
- Do not access the database file directly while the container is running
- Restart the container: `docker compose restart app`

### Build Fails -- better-sqlite3 Compilation

If the build fails on `better-sqlite3`, ensure build dependencies are installed in the Dockerfile (they are by default in this setup). If you are on an ARM64 host (Apple Silicon M-series), the pre-built binaries should be picked up automatically.

```bash
# Verify the image was built correctly
docker run --rm finance-manager:latest node -e "const db = require('better-sqlite3'); console.log('better-sqlite3 OK');"
```

### View Container Resource Usage

```bash
docker stats finance-manager
```

### Shell Access for Debugging

```bash
docker exec -it finance-manager /bin/bash
```

### Rebuilding from Scratch

```bash
docker compose down -v --rmi local
docker compose build --no-cache
docker compose up -d
```

---

## Production Considerations

For a production deployment, consider:

- **Do not run as root** -- the Dockerfile uses a non-root user (`appuser:1000`) by default
- **Use a reverse proxy** (nginx, Caddy) with TLS termination in front of the container
- **Regular backups** -- automate database backups via cron or a script
- **Monitoring** -- add the container to your monitoring system using the health check endpoint
- **Resource limits** -- add resource constraints to `docker-compose.yml`:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'
```
