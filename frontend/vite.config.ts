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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __GIT_SHA__: JSON.stringify(
      (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'unknown' } })(),
    ),
  },
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    sourcemap: true,
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
    ...(process.env.NODE_ENV !== 'production'
      ? [devtools({ targetOrigin: 'auto' })]
      : []),
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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Finance Manager',
        short_name: 'Finance',
        description: 'Personal finance tracker',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#3b82f6',
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
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,ico,png,svg,woff2}'],
        // Don't precache JS/CSS - let Apache/Vite handle hashing
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' || request.destination === 'style',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'finance-manager-js-css-v2',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 5 * 60, // 5 minutes max
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/finance-manager\.clodhost\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'finance-manager-v2',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 1 * 24 * 60 * 60, // 1 day
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'finance-manager-fonts',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
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
    port: 3800,
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
})
