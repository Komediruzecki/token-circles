#!/bin/bash
# Auto-deploy script for Finance Manager

set -e

PROJECT_DIR="/tmp/finance-manager-2"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"
PUBLIC_DIR="/var/www/html/public"

echo "📦 Building frontend..."
cd "$FRONTEND_DIR"
npm run build

echo "🔧 Replacing service worker registration with cache-busting version..."
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

echo "🔄 Deploying to production..."
mkdir -p "$PUBLIC_DIR"
rm -rf "$PUBLIC_DIR/*"
cp -r "$FRONTEND_DIR/dist"/* "$PUBLIC_DIR/"

echo "🔒 Setting permissions..."
chown -R www-data:www-data "$PUBLIC_DIR"
chmod -R 755 "$PUBLIC_DIR"

echo "🔧 Restarting backend..."
if systemctl is-active --quiet finance-manager-backend; then
  systemctl restart finance-manager-backend
else
  # Fallback: find and kill old process, restart
  pkill -f "node.*backend/index.js" 2>/dev/null || true
  sleep 1
  cd "$BACKEND_DIR"
  nohup node index.js > /var/log/finance-manager-backend.log 2>&1 &
fi

echo "🔧 Reloading Apache..."
systemctl reload apache2

echo "✅ Deployment complete!"
echo "🌐 Frontend: http://localhost/"
echo "🌐 Backend:  http://localhost:3847/api"