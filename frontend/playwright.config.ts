import { defineConfig, devices } from '@playwright/test'
import os from 'os'

// Default 3800 (what CI and the helpers expect). Override with E2E_PORT when
// another dev server already occupies 3800 locally — the helpers read the same
// variable, so the whole suite follows.
const PORT = Number(process.env.E2E_PORT || 3800)

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  timeout: 60000,
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  workers: os.cpus().length,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    headless: true,
    testIdAttribute: 'data-test-id',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    // The e2e backend runs on :3847 (started + seeded in CI). Pin the vite dev proxy there,
    // regardless of the local-dev default (the Cloudflare worker on :8787).
    env: { API_PROXY_TARGET: 'http://127.0.0.1:3847' },
  },
})
