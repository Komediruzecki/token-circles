// Get version from package.json if available
try {
  const pkg = require(`${import.meta.dirname || '.'}/package.json`);
  const CACHE_NAME = `finance-manager-${pkg.version || '0.0.1'}`;
} catch {
  const CACHE_NAME = 'finance-manager-v1';
}

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/dist/assets/index.js',
  '/dist/assets/index.js.map',
  '/css/base.css',
  '/css/components.css',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching static assets')
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Failed to cache some assets:', err)
      })
    })
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return
  }

  // Handle API requests - network only (no caching)
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline - API not available' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
    return
  }

  // Handle static assets - cache first, then network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Update cache in background
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const contentType = response.headers.get('content-type');
              // Only cache JS and CSS files for /dist/assets, /css, and /templates
              if (contentType && (contentType.includes('javascript') || contentType.includes('css'))) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, response.clone())
                })
              }
            }
          })
          .catch(() => {})
        return cachedResponse
      }

      return fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const contentType = response.headers.get('content-type');
            // Only cache JS and CSS files for /dist/assets, /css, and /templates
            if (contentType && (contentType.includes('javascript') || contentType.includes('css'))) {
              const responseClone = response.clone()
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone)
              })
            }
          }
          return response
        })
        .catch(() => {
          // Fallback to index.html for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html')
          }
          return new Response('Offline', { status: 503 })
        })
    })
  )
})

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
