import { defineConfig, devices } from '@playwright/test'
import {
  E2E_API_BASE,
  E2E_API_PORT,
  E2E_BASE,
  E2E_PORT,
  STORAGE_STATE,
} from './tests/e2e-constants'

/**
 * The manifest screenshots, re-shot on demand:
 *
 *   cd frontend && npm run pwa:shots
 *
 * Deliberately a SECOND config rather than a spec in the main suite. These write into
 * `public/`, they take a browser at two fixed viewports, and they are not assertions — running
 * them on every CI push would mean every run produced a dirty working tree.
 *
 * Everything else is shared with playwright.config.ts on purpose: the same two servers
 * (wrangler on a local D1, vite proxying /api at it), the same setup project, and therefore the
 * same seeded fixture account. A screenshot pipeline with its own idea of what the data looks
 * like drifts from the app the moment either side moves.
 */
export default defineConfig({
  timeout: 120000,
  fullyParallel: false,
  // Two viewports against one wrangler process, and the shots are ordered by the spec.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: E2E_BASE,
    headless: true,
    testIdAttribute: 'data-test-id',
    // Shot at 2x and downscaled by the encoder step in the spec: a browser at
    // deviceScaleFactor 2 renders text on the full hinting grid, and an exact 2:1 reduction
    // keeps that detail rather than asking the resampler to invent it.
    deviceScaleFactor: 2,
  },

  projects: [
    { name: 'setup', testDir: './tests', testMatch: /global\.setup\.ts/ },
    {
      name: 'shots',
      testDir: './tests-shots',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      command: `pnpm run d1:migrate:local && pnpm exec wrangler dev --port ${E2E_API_PORT}`,
      cwd: '../worker',
      url: `${E2E_API_BASE}/api/health`,
      reuseExistingServer: true,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
      url: E2E_BASE,
      reuseExistingServer: true,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { API_PROXY_TARGET: E2E_API_BASE },
    },
  ],
})
