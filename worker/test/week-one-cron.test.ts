/**
 * The week-one mails go out from the Worker's own scheduled handler, on their own trigger
 * (WEEK_ONE_CRON, 08:30 UTC) and on no other: an invocation has a budget of D1 queries, and the
 * 08:00 run's reminders and sheet syncs spend from theirs. Both deployed environments declare the
 * trigger in wrangler.jsonc.
 */
import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import { WEEK_ONE_CRON } from '../src/weekOne';
import wranglerConfig from '../wrangler.jsonc?raw';

const ID = 97500;
const EMAIL = 'week-one-cron-97500@example.com';
const realFetch = globalThis.fetch;
let mailed: string[] = [];

async function remove(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminder_dedup WHERE user_id = ?').bind(ID),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(ID),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(ID),
  ]);
}

beforeEach(async () => {
  await remove();
  // A confirmed Free account two days into its first week, with nothing imported: due day 2.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan)
       VALUES (?, ?, 'password', 1, 1, 'free')`
    ).bind(ID, EMAIL),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Week one cron')").bind(
      ID,
      ID
    ),
    env.DB.prepare(
      "INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (?, 'welcome', datetime('now', '-2 days', '-1 hour'))"
    ).bind(ID),
  ]);
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      const to = String((JSON.parse(String(init?.body ?? '{}')) as { to: string }).to);
      if (to === EMAIL) mailed.push(to);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await remove();
});

/** The Worker's own scheduled handler, run for `cron`. */
async function fire(cron: string): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(
    createScheduledController({ cron, scheduledTime: Date.now() }),
    env as unknown as Env,
    ctx
  );
  await waitOnExecutionContext(ctx);
}

/** wrangler.jsonc as data: JSON once its comments and trailing commas are taken out. */
function wrangler(): { env: Record<string, { triggers?: { crons?: string[] } }> } {
  let json = '';
  let inString = false;
  for (let i = 0; i < wranglerConfig.length; i++) {
    const ch = wranglerConfig[i]!;
    if (inString) {
      json += ch;
      if (ch === '\\') json += wranglerConfig[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      json += ch;
    } else if (ch === '/' && wranglerConfig[i + 1] === '/') {
      while (i < wranglerConfig.length && wranglerConfig[i] !== '\n') i++;
      json += '\n';
    } else {
      json += ch;
    }
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'));
}

describe('the week-one trigger', () => {
  it('is 08:30 UTC every day', () => {
    expect(WEEK_ONE_CRON).toBe('30 8 * * *');
  });

  it('sends a due day-2 mail from the scheduled handler', async () => {
    await fire(WEEK_ONE_CRON);
    expect(mailed).toEqual([EMAIL]);
  });

  it('is the only trigger that does', async () => {
    for (const cron of ['0 8 * * *', '0 9 * * 1', '0 10 1,15 * *']) await fire(cron);
    expect(mailed).toEqual([]);
  });

  it('is declared for dev and for prod', () => {
    const config = wrangler();
    for (const name of ['dev', 'prod']) {
      expect(config.env[name]?.triggers?.crons, name).toContain(WEEK_ONE_CRON);
    }
  });
});
