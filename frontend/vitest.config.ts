import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  // Solid JSX transform so tests can import .tsx modules (components, brand icons).
  plugins: [solid()],
  // Build-identity constants (vite.config.ts `define`) for modules that read them
  // (core/appVersion). Values are stable fakes so decision logic is deterministic.
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __GIT_SHA__: JSON.stringify('testsha'),
  },
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
  test: {
    environment: 'jsdom',
    // Process CSS so `?raw` imports of stylesheets return their source. Under the default
    // (css: false) vitest short-circuits every CSS import to empty content, which makes a
    // `?raw` import silently resolve to '' and any test asserting on stylesheet source pass
    // vacuously (vitest#10788). cssModuleHygiene.test.ts depends on this.
    css: true,
    globals: true,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
