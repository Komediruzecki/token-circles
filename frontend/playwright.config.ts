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
  // Two retries on CI, none locally. One retry covers a single dropped fetch. The second exists
  // for the wrangler crash: the Worker is supervised and comes back within a few seconds (see the
  // webServer command below), but a spec caught in that gap fails, and its immediate retry can
  // land in the same gap before the restart finishes. A third attempt clears that residual.
  // Locally, retries only hide the flake you are trying to see.
  retries: process.env.CI ? 2 : 0,
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
  // A backstop, no longer the main defence. The webServer command below now supervises wrangler
  // and restarts it within seconds of the crash that used to end a shard, so "one death fails
  // every remaining spec" is gone — the case this guarded against on 2026-08-25, when a workerd
  // death a minute into shard 3 left it failing 120 specs against a dead proxy for 22 minutes.
  // What remains is the ordinary one: ten genuine failures already means something is broken, and
  // stopping there beats grinding through the rest. Kept for that, not for the crash.
  maxFailures: process.env.CI ? 10 : undefined,
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
      //
      // Not `wrangler dev` directly: it crashes a minute or two into a run and nothing here would
      // restart it, which turned one death into a whole failed shard. serve-worker.mjs supervises
      // it — same babysitter the tour gate uses — and brings it back within seconds. It runs from
      // frontend/ (its imports live there); the migrate step stays in the worker via `-C`.
      command: `pnpm -C ../worker run d1:migrate:local && node scripts/serve-worker.mjs`,
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
