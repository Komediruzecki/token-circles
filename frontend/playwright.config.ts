import { defineConfig, devices } from '@playwright/test'
import os from 'os'
import {
  E2E_API_BASE,
  E2E_API_PORT,
  E2E_BASE,
  E2E_PORT,
  STORAGE_STATE,
} from './tests/e2e-constants'

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * The suite drives the REAL built app against the REAL API — the Cloudflare Worker, run locally by
 * wrangler against a local D1. It used to point at the Express server under `backend/`, which was
 * the last thing keeping that retired runtime in the tree, and which meant 35 spec files were
 * exercising an implementation nothing ships.
 *
 * Two servers, in order: wrangler on :8787, then vite on :3800 with its /api proxy pinned at it.
 * Then a setup project signs in once and saves the state every spec starts from.
 */
export default defineConfig({
  timeout: 60000,
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  // One retry on CI only. A single dropped fetch should not sink a 44-test run, and locally a
  // retry hides the flake you are trying to see.
  retries: process.env.CI ? 1 : 0,
  // Capped, not one-per-CPU. Every worker drives the same local D1 through one wrangler process,
  // and a machine with a lot of cores turned that into enough contention that pages timed out
  // waiting for their first fetch — which reads as "the goals list is empty", not as "slow".
  //
  // CI gets ONE. A GitHub runner is 4 vCPU / 16 GB and has to hold vite, wrangler's workerd and
  // one headless Chromium per worker at the same time; at four, workerd was killed outright
  // twenty seconds in (`wrangler dev` printed an empty error and exited), after which every
  // remaining spec failed on a 502 from the vite proxy. Nothing restarts it mid-run, so one
  // crash costs the whole suite — which makes the serial run the cheaper trade.
  workers: process.env.CI ? 1 : Math.min(4, os.cpus().length),
  reporter: 'list',
  use: {
    baseURL: E2E_BASE,
    trace: 'retain-on-failure',
    headless: true,
    testIdAttribute: 'data-test-id',
  },

  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      // Local D1 and R2 under worker/.wrangler — no network, no Cloudflare account. Migrations
      // are applied first because a fresh checkout has an empty database and every route 500s
      // against one. JWT_SECRET comes from worker/.dev.vars.
      command: `pnpm run d1:migrate:local && pnpm exec wrangler dev --port ${E2E_API_PORT}`,
      cwd: '../worker',
      url: `${E2E_API_BASE}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
      url: E2E_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { API_PROXY_TARGET: E2E_API_BASE },
    },
  ],
})
