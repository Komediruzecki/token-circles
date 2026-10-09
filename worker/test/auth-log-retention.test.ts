/**
 * Sign-in history is kept for 90 days. The Worker's daily scheduled run deletes anything older.
 */
import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import { AUTH_LOG_RETENTION_DAYS, sweepAuthLogs } from '../src/authlog';

/** The Worker's own scheduled handler, run for the daily cron. */
async function runDailyCron(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(
    createScheduledController({ cron: '0 8 * * *', scheduledTime: Date.now() }),
    env as unknown as Env,
    ctx
  );
  await waitOnExecutionContext(ctx);
}

/** One auth_logs row, `daysAgo` days old. */
const insertRow = (email: string, daysAgo: number) =>
  env.DB.prepare(
    `INSERT INTO auth_logs (event, outcome, reason, email, ip, user_agent, created_at)
     VALUES ('login', 'denied', 'bad_credentials', ?, '192.0.2.1', 'test', datetime('now', ?))`
  )
    .bind(email, `-${daysAgo} days`)
    .run();

const emails = async () =>
  (
    await env.DB.prepare('SELECT email FROM auth_logs ORDER BY email').all<{ email: string }>()
  ).results.map((r) => r.email);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM auth_logs').run();
});

describe('sign-in history retention', () => {
  it('is 90 days', () => {
    expect(AUTH_LOG_RETENTION_DAYS).toBe(90);
  });

  it('the daily scheduled run keeps a row from 89 days ago and deletes one from 91', async () => {
    await insertRow('kept@example.com', 89);
    await insertRow('gone@example.com', 91);

    await runDailyCron();

    expect(await emails()).toEqual(['kept@example.com']);
  });

  it('deletes in bounded batches and stops at the cap, leaving the rest for the next run', async () => {
    for (let i = 0; i < 5; i++) await insertRow(`old${i}@example.com`, 120);
    await insertRow('kept@example.com', 1);

    await sweepAuthLogs(env, { batchSize: 2, maxBatches: 2 });
    expect(await emails()).toHaveLength(2);

    await sweepAuthLogs(env, { batchSize: 2, maxBatches: 2 });
    expect(await emails()).toEqual(['kept@example.com']);
  });
});
