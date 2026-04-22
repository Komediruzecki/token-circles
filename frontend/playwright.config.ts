import { defineConfig, devices } from '@playwright/test'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  timeout: 30000,
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3800',
    trace: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Skip web server since it's already running
  // webServer: undefined,
})