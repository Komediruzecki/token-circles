import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

// Runs the real Worker (src/index.ts) in workerd via Miniflare, against a local D1 built from
// worker/migrations/. On the vitest-4 line, pool-workers integrates as a Vite plugin
// (cloudflareTest) rather than test.pool/poolOptions. `readD1Migrations` parses the .sql files;
// they're handed to the test runtime as the TEST_MIGRATIONS binding and applied once in
// test/apply-migrations.ts.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL('./migrations', import.meta.url))
  );
  return {
    plugins: [
      cloudflareTest({
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // JWT_SECRET is normally a wrangler secret (.dev.vars); supply a throwaway one for tests
          // so requireAuth + issueSessionCookie work end-to-end.
          bindings: {
            JWT_SECRET: 'test-jwt-secret-not-for-prod',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      // Vitest's default is 5s, which assumes a pure unit test. Nothing here is one: every file
      // boots its own workerd and applies the migrations, and the auth tests additionally run
      // PBKDF2 at 100_000 iterations per login (auth.ts) — twenty of them in the lockout test
      // that signs in, fails nine times, and does it again.
      //
      // That test takes ~274ms locally and timed out at 5s on CI on 2026-08-25, on a commit whose
      // two earlier runs passed. An 18x stall is not a slow runner, it is contention: the CI run
      // reported 112s of setup against 90s of wall clock, so files are booting workerd in
      // parallel and a CPU-bound test scheduled into a burst of those startups gets starved of
      // its 4 shared vCPUs.
      //
      // 20s is ~70x the real cost of the slowest test, so a genuine hang still fails — it just
      // fails on being hung rather than on having been unlucky.
      testTimeout: 20_000,
    },
  };
});
