import { execSync } from 'child_process'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import bundleAnalyzer from 'vite-bundle-analyzer'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaManifest } from './src/pwaManifest'
import solidPlugin from 'vite-plugin-solid'
import { devtoolsPlugin as devtools } from 'solid-devtools/vite'
import fs from 'fs'

const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
const ANALYZE_BUNDLE = process.env.VITE_ANALYZE_BUNDLE === 'true'

// Single source of truth for the build identity, shared by the `define` constants and the
// version.json the app polls to detect a new deployment. Version comes from the release tag
// (GITHUB_REF_NAME on a tag deploy, else git describe, else package.json); sha pins the commit.
const APP_VERSION = (() => {
  const ref = process.env.GITHUB_REF_NAME
  if (ref && /^v\d/.test(ref)) return ref.replace(/^v/, '')
  try {
    // `git describe --tags` (NOT --abbrev=0): an exact tag checkout stamps the tag itself,
    // while any commit past the tag stamps e.g. `5.6.0-2-gf6ba930`. A non-tag build (dev
    // deploy, workflow_dispatch from main) therefore can never impersonate a release — with
    // --abbrev=0 a prod dispatch between a merged fix and its tag shipped NEWER code labeled
    // with the PREVIOUS release's version, which is exactly the "label says 5.6.0 but the
    // 5.6.1 fix works" skew observed in prod.
    return execSync('git describe --tags').toString().trim().replace(/^v/, '')
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

// One-time service-worker reset marker, stamped into index.html (see the sw-cleanup plugin).
// Bump ONLY when the SW caching strategy changes so incompatibly that already-installed
// workers must be dropped once (a normal sw.js update can't fix them). Do NOT tie this to the
// release version: unregistering on EVERY release tore down and re-registered the SW on the
// first load of each new version, racing the fresh registration — one ingredient of the
// multi-reload deploy transitions this epoch replaces.
//
// 'precache-shell-1' retires the generated Workbox worker. Its caches are named
// finance-manager-* and workbox-precache-*, which the new worker's activate() would never touch
// (it only deletes its own prefix), so they would sit in the quota forever — and its
// clientsClaim would let it seize a page the new worker is supposed to own.
const SW_CLEANUP_EPOCH = 'precache-shell-1'

export default defineConfig(({ command, mode }) => {
  // The worker ships with every BUILD, dev deploy included — not just production. It is what
  // makes the app installable at all (Chrome will not offer "Install app" without a service
  // worker that handles fetch), so gating it on production meant the install affordance could
  // only ever be tested in production. `vite dev` still ships none: there is no dist/sw.js to
  // register, and a stale one is actively removed below.
  const shipsServiceWorker = command === 'build'
  const isProd = mode === 'production'
  return {
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __GIT_SHA__: JSON.stringify(GIT_SHA),
      __SW_ENABLED__: JSON.stringify(shipsServiceWorker),
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
          if (shipsServiceWorker) {
            // A one-time reset, and nothing more: the app registers the worker itself (see
            // index.tsx). The unregisters are exposed as `window.__SW_CLEANUP__` so registration
            // can wait for them — an unregister that resolved AFTER a fresh register would
            // silently remove the worker that had just been installed, which is the race the
            // previous version of this script had built into it.
            return html.replace(
              '<head>',
              `<head><script>(function(){var k='fm-sw-ver',v='${SW_CLEANUP_EPOCH}';if(!('serviceWorker' in navigator)){return}try{if(localStorage.getItem(k)===v){return}}catch(e){}window.__SW_CLEANUP__=navigator.serviceWorker.getRegistrations().then(function(r){return Promise.all(r.map(function(x){return x.unregister()}))}).then(function(){return window.caches&&caches.keys?caches.keys().then(function(n){return Promise.all(n.map(function(c){return caches.delete(c)}))}):null}).catch(function(){}).then(function(){try{localStorage.setItem(k,v)}catch(e){}})})()</script>`
            )
          }
          // `vite dev`: no worker is built, so any registration on this origin is a leftover from
          // a build served from the same host. Remove it and its caches, or it answers for assets
          // this dev server is rebuilding on every save.
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
      ...(shipsServiceWorker
        ? [
            VitePWA({
              // `injectManifest`, not `generateSW`: the worker is src/sw.ts, hand-written over
              // @komediruzecki/pwa-kit's runtime, so every caching rule can be run against a fake
              // CacheStorage in a unit test instead of only against a real deploy. The generated
              // worker could only be read, never exercised.
              strategies: 'injectManifest',
              srcDir: 'src',
              filename: 'sw.ts',
              // The app registers the worker itself (src/index.tsx), after the one-time cleanup
              // above has settled — see the race that script's comment describes.
              injectRegister: null,
              includeAssets: ['icon-192.png', 'icon-512.png', 'icon-192.svg', 'icon-512.svg'],
              manifest: pwaManifest,
              injectManifest: {
                // Classic script rather than an ES module worker, so Firefox and older WebKit can
                // register it without `{ type: 'module' }`.
                rollupFormat: 'iife',
                // An allowlist of "safe to serve from cache": immutable hashed build output plus
                // the few small, stable files the shell needs. theme-init.js is not optional —
                // index.html loads it with a <script src>, and the worker refuses any shell whose
                // scripts it did not ship, so leaving it out would fail every install.
                //
                // Deliberately absent: icon-512.png and og-image.jpg, which are read by the OS
                // install sheet and by crawlers, never by the page, and neither goes through the
                // worker.
                globDirectory: 'dist',
                globPatterns: [
                  'assets/**/*.{js,css}',
                  'manifest.webmanifest',
                  'theme-init.js',
                  'favicon.svg',
                  'icon-192.png',
                  'icon-192.svg',
                ],
                globIgnores: [
                  '**/*.map',
                  'sw.js',
                  'workbox-*.js',
                  // Their own documents, with their own scripts — see STANDALONE_DOCUMENTS.
                  'export*.html',
                  'chart.umd.min.js',
                ],
                // Above the default 2 MB cap Workbox silently drops a file from the manifest,
                // which would mean the biggest chunk is the one asset never cached.
                maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
                // Hashed filenames are already their own revision.
                dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(?:js|css)$/,
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@pwa-kit': resolve(__dirname, '../packages/pwa-kit/src/index.ts'),
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
