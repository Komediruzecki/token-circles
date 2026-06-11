# Self-Hosting Guide

Deploy Finance Manager on your own server with Docker, a reverse proxy, and automated backups.

## Prerequisites

- **Node.js 20+** (to build the frontend)
- **Docker Engine 20.10+** with Docker Compose v2 (`docker compose`)
- **A domain name** pointing to your server (for HTTPS)
- **A reverse proxy** (nginx or Caddy) for TLS termination

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/Komediruzecki/finance-manager.git
cd finance-manager

# 2. Build the frontend (required before Docker build)
cd frontend && npm install && npm run build && cd ..

# 3. Create your environment file
cp .env .env.local

# 4. Generate a session secret
openssl rand -hex 32

# 5. Edit .env.local with your settings (see Environment Variables below)

# 6. Build and start
docker compose --env-file .env.local up -d --build
```

The app will be available at `http://localhost:3847`. Verify with:

```bash
curl http://localhost:3847/api/health
```

## Environment Variables

Create a `.env.local` file with these settings:

```bash
# Required
SESSION_SECRET=your-generated-hex-secret-here

# Server
APP_PORT=3847
NODE_ENV=production
PORT=3847

# CORS — comma-separated origins including protocol
# Use your actual domain in production
ALLOWED_ORIGINS=https://finance.yourdomain.com,https://yourdomain.com

# Optional: SMTP for email notifications (budget alerts, bills, reports)
# If omitted, email features are silently disabled
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@yourdomain.com
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | **Yes** | — | Random string for session encryption. Server exits without it in production. Generate with `openssl rand -hex 32`. |
| `ALLOWED_ORIGINS` | No | `http://localhost:3847` | Comma-separated CORS origins. Set to your domain(s) with `https://` in production. |
| `APP_PORT` | No | `3847` | Host port mapped to the container. |
| `NODE_ENV` | No | `production` | Set to `production` for security hardening (Helmet, strict CORS, generic errors). |
| `PORT` | No | `3847` | Internal container port. Do not change. |
| `SMTP_HOST` | No | — | SMTP server for email notifications. |
| `SMTP_PORT` | No | `587` | SMTP port. |
| `SMTP_USER` | No | — | SMTP authentication username. |
| `SMTP_PASS` | No | — | SMTP authentication password. |
| `SMTP_FROM` | No | `noreply@localhost` | From address for outgoing emails. |

## Reverse Proxy (nginx)

Place Finance Manager behind nginx with TLS for production use.

### nginx Configuration

```nginx
server {
    listen 80;
    server_name finance.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name finance.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/finance.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/finance.yourdomain.com/privkey.pem;

    # Recommended SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Proxy to the Docker container
    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Increase timeouts for file uploads and PDF generation
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # Large uploads
        client_max_body_size 50M;
    }
}
```

### Obtain a TLS Certificate

```bash
# Using Certbot with Let's Encrypt
sudo certbot certonly --webroot -w /var/www/html -d finance.yourdomain.com

# Or using the nginx plugin
sudo certbot --nginx -d finance.yourdomain.com
```

### Update CORS After Configuring nginx

Once the proxy and TLS are set up, update `ALLOWED_ORIGINS` in your `.env.local`:

```bash
ALLOWED_ORIGINS=https://finance.yourdomain.com
```

Then restart:

```bash
docker compose up -d
```

## Database Backups

SQLite databases are single files, making backups simple. The database lives in the `fm-db-data` Docker volume at `/app/db/finance.db`.

### Manual Backup

```bash
# Copy the database file from the container
docker exec finance-manager cp /app/db/finance.db /app/assets/finance.db.backup
docker cp finance-manager:/app/assets/finance.db.backup ./backups/finance.db.$(date +%Y%m%d)
```

### Automated Backups with cron

Add a cron job to back up daily:

```bash
# Edit crontab
crontab -e

# Add this line (backup at 3 AM daily)
0 3 * * * docker exec finance-manager cp /app/db/finance.db /app/assets/finance.db.backup && docker cp finance-manager:/app/assets/finance.db.backup /opt/backups/finance-manager/finance.db.$(date +\%Y\%m\%d)
```

Keep backups from the last 30 days:

```bash
# Add a cleanup cron job (runs after backup)
0 4 * * * find /opt/backups/finance-manager/ -name 'finance.db.*' -mtime +30 -delete
```

### Backup Script

Create `/opt/scripts/backup-finance-manager.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/finance-manager"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker exec finance-manager sqlite3 /app/db/finance.db ".backup /tmp/fm-backup.db" && \
  docker cp finance-manager:/tmp/fm-backup.db "$BACKUP_DIR/finance.db.$TIMESTAMP" && \
  docker exec finance-manager rm /tmp/fm-backup.db

# Keep last 30 days
find "$BACKUP_DIR" -name 'finance.db.*' -mtime +30 -delete
echo "Backup complete: finance.db.$TIMESTAMP"
```

Make it executable and schedule it:

```bash
chmod +x /opt/scripts/backup-finance-manager.sh
# Add to crontab: 0 3 * * * /opt/scripts/backup-finance-manager.sh
```

### Restoring from Backup

```bash
# Stop the app
docker compose down

# Overwrite the database in the volume
docker run --rm \
  -v finance-manager_fm-db-data:/data \
  -v /opt/backups/finance-manager:/backup \
  alpine cp /backup/finance.db.20260611 /data/finance.db

# Start the app
docker compose up -d
```

## Upgrading

### Standard Upgrade

```bash
# Pull latest changes
git pull origin main

# Rebuild frontend
cd frontend && npm install && npm run build && cd ..

# Rebuild and restart the container
docker compose up -d --build
```

### Upgrade with Database Backup First

Always back up before upgrading:

```bash
# Backup the database
./backup-finance-manager.sh

# Pull and rebuild
git pull origin main
cd frontend && npm install && npm run build && cd ..
docker compose up -d --build

# Check health
curl http://localhost:3847/api/health
```

### Rolling Back

If an upgrade causes issues:

```bash
# Checkout the previous version
git checkout <previous-tag-or-commit>

# Rebuild from that version
cd frontend && npm install && npm run build && cd ..
docker compose up -d --build
```

If the database was modified by a migration, restore from your pre-upgrade backup (see Restoring from Backup above).

## Data Persistence

The Docker Compose setup uses two named volumes:

| Volume | Mount | Contents |
|--------|-------|----------|
| `fm-db-data` | `/app/db` | SQLite database (`finance.db`) and session store (`sessions.db`) |
| `fm-assets-data` | `/app/assets` | Uploaded files and receipts |

These volumes survive container restarts and rebuilds. Only `docker compose down -v` deletes them.

## Security Checklist

- [ ] Generate a strong `SESSION_SECRET` with `openssl rand -hex 32`
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` to your actual domain(s) with `https://`
- [ ] Enable TLS on your reverse proxy (use Let's Encrypt)
- [ ] Set up automated database backups
- [ ] Restrict server firewall to ports 80 and 443 only
- [ ] Keep the host OS and Docker Engine updated
- [ ] Monitor the health endpoint: `GET /api/health`

## Health Monitoring

The container includes a built-in health check that queries `/api/health` every 30 seconds:

```bash
# Check container health status
docker inspect finance-manager --format '{{.State.Health.Status}}'

# View health check history
docker inspect finance-manager --format '{{json .State.Health}}' | jq
```

For external monitoring (Uptime Robot, Healthchecks.io, etc.), point your monitor at:

```
https://finance.yourdomain.com/api/health
```

Expected response: `{"status":"ok","timestamp":"...","database":"connected"}`

## Troubleshooting

### Container exits immediately

Check logs and verify `SESSION_SECRET` is set:

```bash
docker compose logs app
```

### Database locked errors

SQLite uses WAL mode. Ensure only one container instance is running and do not access the database file directly while the container is active.

### Connection refused after Docker restart

Wait for the health check to pass (`docker inspect finance-manager --format '{{.State.Health.Status}}'`). The container has a 10-second start period.

### See also

- [docs/docker.md](docker.md) — detailed Docker operations reference
- [docs/apache-setup.md](apache-setup.md) — Apache reverse proxy setup (alternative to nginx)
