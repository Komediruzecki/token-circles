import { execSync } from 'child_process'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import bundleAnalyzer from 'vite-bundle-analyzer'
import { VitePWA } from 'vite-plugin-pwa'
import solidPlugin from 'vite-plugin-solid'
import { devtoolsPlugin as devtools } from 'solid-devtools/vite'
import fs from 'fs'

const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
const ANALYZE_BUNDLE = process.env.VITE_ANALYZE_BUNDLE === 'true'

// Single source of truth for the build identity, shared by the `define` constants and the
// version.json the app polls to detect a new deployment. Version comes from the release tag
// (GITHUB_REF_NAME on a tag deploy, else the nearest tag, else package.json); sha pins the commit.
const APP_VERSION = (() => {
  const ref = process.env.GITHUB_REF_NAME
  if (ref && /^v\d/.test(ref)) return ref.replace(/^v/, '')
  try {
    return execSync('git describe --tags --abbrev=0').toString().trim().replace(/^v/, '')
  } catch {
    return packageJson.version
  }
})()
const GIT_SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
})()

export default defineConfig(({ mode }) => {
  // Service worker / PWA only in the production build. The dev-domain build
  // (`vite build --mode dev`) and local `vite` ship NO service worker and actively
  // unregister any stale one, so the dev domain never serves cached/stale assets.
  const isProd = mode === 'production'
  return {
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __GIT_SHA__: JSON.stringify(GIT_SHA),
    },
    base: './',
    build: {
      emptyOutDir: true,
      outDir: 'dist',
      sourcemap: process.env.NODE_ENV !== 'production',
      target: 'esnext',
      // minify: 'esbuild',
      // rollupOptions: {
      //   input: resolve(__dirname, 'src/main.tsx'),
      //   output: {
      //     entryFileNames: 'assets/index.js',
      //     chunkFileNames: 'assets/[name]-[hash].js',
      //     assetFileNames: 'assets/[name]-[hash].[ext]',
      //   },
      // },
    },
    plugins: [
      solidPlugin(),
      ANALYZE_BUNDLE ? bundleAnalyzer() : undefined,
      ...(process.env.NODE_ENV !== 'production' ? [devtools({ targetOrigin: 'auto' })] : []),
      {
        name: 'sw-cleanup',
        transformIndexHtml(html) {
          if (isProd) {
            // Prod ships a service worker; unregister it only when the app version
            // changes (clean recovery from a bad/old SW state).
            const ver = packageJson.version
            return html.replace(
              '<head>',
              `<head><script>(function(){var k='fm-sw-ver',v='${ver}';if('serviceWorker' in navigator&&localStorage.getItem(k)!==v){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})});localStorage.setItem(k,v)}})()</script>`
            )
          }
          // Dev / non-prod: no service worker. Unregister any stale one and drop its
          // caches so the dev domain always serves fresh assets.
          return html.replace(
            '<head>',
            `<head><script>(function(){if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})})}if(window.caches&&caches.keys){caches.keys().then(function(k){k.forEach(function(n){caches.delete(n)})})}})()</script>`
          )
        },
      },
      {
        name: 'copy-export-html',
        writeBundle() {
          const exportFiles = ['export.html', 'export-monthly.html', 'chart.umd.min.js']
          for (const file of exportFiles) {
            const src = resolve(__dirname, file)
            const dest = resolve(__dirname, 'dist', file)
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, dest)
            }
          }
        },
      },
      {
        // Emit a tiny, never-cached version.json (served no-cache via _headers). The app polls
        // it to detect a new deployment and reload at a safe moment — see core/appVersion.ts.
        name: 'emit-version-json',
        apply: 'build',
        writeBundle() {
          const payload = JSON.stringify({
            version: APP_VERSION,
            gitSha: GIT_SHA,
            builtAt: new Date().toISOString(),
          })
          fs.writeFileSync(resolve(__dirname, 'dist', 'version.json'), payload)
        },
      },
      ...(isProd
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon-192.png', 'icon-512.png', 'icon-192.svg', 'icon-512.svg'],
              manifest: {
                name: 'Token Circles',
                short_name: 'Token Circles',
                description: 'Your money, in clear orbit',
                display: 'standalone',
                background_color: '#0a0e1c',
                theme_color: '#0a0e1c',
                version: Date.now().toString(),
                icons: [
                  {
                    src: 'icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                  },
                  {
                    src: 'icon-192.svg',
                    sizes: '192x192',
                    type: 'image/svg+xml',
                  },
                  {
                    src: 'icon-512.svg',
                    sizes: '512x512',
                    type: 'image/svg+xml',
                  },
                ],
              },
              workbox: {
                // Precache the offline shell (icons, self-hosted fonts, index.html). JS/CSS are
                // content-hashed and served NetworkFirst below, not precached.
                globPatterns: ['**/*.{html,ico,png,svg,woff2}'],
                // A new SW takes over immediately and old precaches are purged, so a deploy can't
                // leave a client pinned to a stale shell that references now-deleted chunks.
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                skipWaiting: true,
                // The SPA navigation fallback must NEVER apply to hashed assets, the API, the
                // version stamp, or the SW itself — those must resolve to real network responses
                // (a missing chunk has to fail as a 404, never as index.html).
                navigateFallbackDenylist: [
                  /^\/api\//,
                  /^\/assets\//,
                  /\/version\.json$/,
                  /\/sw\.js$/,
                ],
                runtimeCaching: [
                  {
                    // The version stamp is a freshness probe — always hit the network, never cache.
                    urlPattern: ({ url }) => url.pathname === '/version.json',
                    handler: 'NetworkOnly',
                  },
                  {
                    urlPattern: ({ request }) =>
                      request.destination === 'script' || request.destination === 'style',
                    handler: 'NetworkFirst',
                    options: {
                      // v4: a fresh cache name so a client carrying a pre-fix, poisoned v3 entry
                      // (a 200 text/html cached for a script) can never replay it after this ships.
                      cacheName: 'finance-manager-js-css-v4',
                      networkTimeoutSeconds: 10,
                      expiration: {
                        maxEntries: 30,
                        maxAgeSeconds: 5 * 60, // 5 minutes max
                      },
                      // Cache only a genuine 200 — never an opaque/error response.
                      cacheableResponse: {
                        statuses: [200],
                      },
                    },
                  },
                  {
                    urlPattern: ({ url }) => {
                      return (
                        url.origin === self.location.origin && !url.pathname.startsWith('/api/')
                      )
                    },
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'finance-manager-v4',
                      networkTimeoutSeconds: 10,
                      expiration: {
                        maxEntries: 60,
                        maxAgeSeconds: 1 * 24 * 60 * 60, // 1 day
                      },
                      cacheableResponse: {
                        statuses: [200],
                      },
                    },
                  },
                ],
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@/core': resolve(__dirname, 'src/core'),
        '@/features': resolve(__dirname, 'src/features'),
        '@/components': resolve(__dirname, 'src/components'),
        '@/stores': resolve(__dirname, 'src/stores'),
        '@/types': resolve(__dirname, 'src/types'),
        '@/lib': resolve(__dirname, 'src/lib'),
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
      },
    },
    // todo: was this used?
    // css: {
    //   postcss: './postcss.config.cjs',
    // },
    server: {
      host: '127.0.0.1',
      port: 3800,
      proxy: {
        // Local dev: same-origin /api proxied to a backend. Defaults to the Cloudflare worker
        // (`pnpm -C worker run dev`, wrangler's port 8787) — same-origin keeps the SameSite=Lax
        // session cookie working with no CORS. Set API_PROXY_TARGET to the legacy Node/SQLite
        // backend (http://127.0.0.1:3847); the Playwright e2e suite pins it to the seeded backend.
        '/api': {
          target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
