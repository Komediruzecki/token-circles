#!/bin/bash
# Auto-deploy script for Finance Manager

set -e

FRONTEND_DIR="/tmp/finance-manager-2/frontend"
DEST_DIR="/var/www/finance-manager.clodhost.com/frontend"

echo "📦 Building frontend..."
cd "$FRONTEND_DIR"
npm run build

echo "🔄 Deploying to production..."
rm -rf "$DEST_DIR"
cp -r "$FRONTEND_DIR/dist" "$DEST_DIR"

echo "🔒 Setting permissions..."
chown -R www-data:www-data "$DEST_DIR"
chmod -R 755 "$DEST_DIR"

echo "✅ Deployment complete!"

# Optional: Notify if needed
# echo "🌐 Site should be live at https://finance-manager.clodhost.com"