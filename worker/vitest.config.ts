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
    },
  };
});
