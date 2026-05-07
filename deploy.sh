#!/bin/bash
# Auto-deploy script for Finance Manager

set -e

PROJECT_DIR="/tmp/finance-manager"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"
LIVE_FRONTEND="/var/www/finance-manager.clodhost.com/frontend"
LIVE_BACKEND="/var/www/finance-manager.clodhost.com/backend"

echo "Building frontend..."
cd "$FRONTEND_DIR"
npm run build

echo "Replacing service worker registration with cache-busting version..."
cat > "$FRONTEND_DIR/dist/registerSW.js" << 'SWREG'
if('serviceWorker' in navigator){
  // Clear all old caches before registering new SW
  caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' });
  });
}
SWREG

echo "Deploying frontend to production..."
# Remove old hashed assets
rm -rf "$LIVE_FRONTEND/assets"
# Copy new dist contents to live frontend root (for Apache direct serving)
cp -r "$FRONTEND_DIR/dist"/* "$LIVE_FRONTEND/"
# Also ensure dist subdirectory exists with export templates (for Puppeteer/PDF rendering)
mkdir -p "$LIVE_FRONTEND/dist"
cp -r "$FRONTEND_DIR/dist"/* "$LIVE_FRONTEND/dist/"

echo "Syncing backend..."
rsync -a --exclude='node_modules' --exclude='db/finance.db' --exclude='db/sessions.db' --exclude='db/*.db-backup*' "$BACKEND_DIR/" "$LIVE_BACKEND/"

echo "Installing backend dependencies..."
cd "$LIVE_BACKEND"
npm install --omit=dev

echo "Setting permissions..."
chown -R www-data:www-data "$LIVE_FRONTEND" "$LIVE_BACKEND"
chmod -R 755 "$LIVE_FRONTEND" "$LIVE_BACKEND"

echo "Restarting backend..."
systemctl restart finance-manager.service

echo "Reloading Apache..."
systemctl reload apache2

echo "Deployment complete!"
echo "Site: https://finance-manager.clodhost.com/"
echo "API:  http://localhost:3847/api"
