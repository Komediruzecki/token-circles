// Service Worker for Finance Manager
// Uses traditional fetch API without import.meta (ES5 compatible)
// Versioned for cache invalidation - reads from package.json version
const CACHE_VERSION = '1.1.0';
const CACHE_NAME = `finance-manager-v${CACHE_VERSION}`;

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
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('Failed to cache some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Handle API requests - network only (no caching)
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({ error: 'Offline - API not available' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  // Handle static assets - cache first, then network
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Update cache in background
        fetch(event.request)
          .then(function(response) {
            if (response.ok) {
              const contentType = response.headers.get('content-type');
              // Only cache JS and CSS files
              if (contentType && (contentType.includes('javascript') || contentType.includes('css'))) {
                caches.open(CACHE_NAME).then(function(cache) {
                  cache.put(event.request, response.clone());
                });
              }
            }
          })
          .catch(function() {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then(function(response) {
          // Cache successful responses
          if (response.ok) {
            const contentType = response.headers.get('content-type');
            // Only cache JS and CSS files
            if (contentType && (contentType.includes('javascript') || contentType.includes('css'))) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, responseClone);
              });
            }
          }
          return response;
        })
        .catch(function() {
          // Fallback to index.html for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});