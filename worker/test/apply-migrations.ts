import { applyD1Migrations, env } from 'cloudflare:test';

// Refuse to run in the wrong mode. The keyless run is the proof that a deployment with no master
// key behaves exactly as before, and a DATA_KEK_1 in worker/.dev.vars (which wrangler loads as a
// secret) would silently turn it into a keyed run proving nothing of the sort.
const expectKey = env.TEST_EXPECT_KEK === '1';
if (Boolean(env.DATA_KEK_1) !== expectKey) {
  throw new Error(
    `this run expects field encryption ${expectKey ? 'ON' : 'OFF'}, but DATA_KEK_1 is ${
      env.DATA_KEK_1 ? 'set' : 'unset'
    } — remove it from worker/.dev.vars, or run with TEST_DATA_KEK`
  );
}

// Build the D1 schema once before the suite (singleWorker + isolatedStorage:false share one DB).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
