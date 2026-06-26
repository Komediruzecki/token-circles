import { defineConfig, devices } from '@playwright/test'
import os from 'os'

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
    baseURL: 'http://127.0.0.1:3800',
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
    command: 'npm run dev',
    url: 'http://127.0.0.1:3800',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    // The e2e backend runs on :3847 (started + seeded in CI). Pin the vite dev proxy there,
    // regardless of the local-dev default (the Cloudflare worker on :8787).
    env: { API_PROXY_TARGET: 'http://127.0.0.1:3847' },
  },
})
