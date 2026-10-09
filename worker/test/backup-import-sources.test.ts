/**
 * A backup carries the profiles' saved import sources, and a restore puts them back.
 *
 * Neither runtime wrote them to the file, so a restore lost every connected sheet. Now the file
 * carries them as GET /api/import-sources answers them (config, mapping and category types as
 * objects), and the restore:
 *
 * - puts each under its restored profile, with its default account moved to the restored copy,
 *   or none when the file does not carry that account;
 * - takes the JSON columns as objects or as text, as a file from either runtime has them;
 * - puts a source on a schedule our machines run (on open, daily) back on it only when the plan
 *   includes automated imports, and on manual otherwise, as the import-sources routes would;
 * - refuses a kind or a schedule there is no such thing as, before anything is staged.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER_ID = 6410;
const CURRENT = 64100;
const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-backup-test/pub?output=csv';
let cookie = '';

beforeEach(async () => {
  for (const t of ['import_sources', 'accounts', 'settings', 'rate_limits', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'sources-backup@example.com', 'password', 1, 'free')"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Current')").bind(
      CURRENT,
      USER_ID
    ),
    env.DB.prepare(
      "INSERT INTO import_sources (profile_id, kind, label, config, schedule) VALUES (?, 'google_sheet', 'Old sheet', '{}', 'manual')"
    ).bind(CURRENT),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function source(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    profile_id: 1,
    kind: 'google_sheet',
    label: 'Bank ledger',
    config: { url: SHEET, sheetName: 'Sheet1' },
    mapping: { date: 'Date', amount: 'Amount' },
    category_types: null,
    default_account_id: 3,
    schedule: 'manual',
    last_synced_at: '2026-02-01T08:00:00.000Z',
    last_cursor: null,
    ...over,
  };
}

function backup(sources: Record<string, unknown>[]): Record<string, unknown> {
  return {
    version: '3.0.0',
    profiles: [{ id: 1, name: 'Restored', created_at: '2026-01-01' }],
    accounts: [{ id: 3, profile_id: 1, name: 'Everyday', type: 'giro', currency: 'EUR' }],
    importSources: sources,
  };
}

function send(method: string, path: string, payload?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(CURRENT),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

interface SourceRow {
  profile_id: number;
  label: string;
  config: string;
  mapping: string | null;
  category_types: string | null;
  default_account_id: number | null;
  schedule: string;
  last_synced_at: string | null;
}

async function stored(): Promise<SourceRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.profile_id, s.label, s.config, s.mapping, s.category_types, s.default_account_id,
            s.schedule, s.last_synced_at
     FROM import_sources s JOIN profiles p ON p.id = s.profile_id
     WHERE p.user_id = ? ORDER BY s.id`
  )
    .bind(USER_ID)
    .all<SourceRow>();
  return results;
}

async function restoredIds(): Promise<{ profile: number; account: number }> {
  const profile = await env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?')
    .bind(USER_ID)
    .first<{ id: number }>();
  const account = await env.DB.prepare('SELECT id FROM accounts WHERE profile_id = ?')
    .bind(profile!.id)
    .first<{ id: number }>();
  return { profile: profile!.id, account: account!.id };
}

describe('a backup and its import sources', () => {
  it('carries each source as the list answers it', async () => {
    await env.DB.prepare(
      `INSERT INTO import_sources (profile_id, kind, label, config, mapping, schedule)
       VALUES (?, 'google_sheet', 'Bank ledger', ?, ?, 'manual')`
    )
      .bind(CURRENT, JSON.stringify({ url: SHEET }), JSON.stringify({ date: 'Date' }))
      .run();
    const res = await send('GET', '/api/export');
    expect(res.status).toBe(200);
    const file = (await res.json()) as { importSources: Record<string, unknown>[] };
    expect(file.importSources).toEqual([
      expect.objectContaining({ label: 'Old sheet', config: {}, mapping: null }),
      expect.objectContaining({
        profile_id: CURRENT,
        label: 'Bank ledger',
        config: { url: SHEET },
        mapping: { date: 'Date' },
        category_types: null,
        schedule: 'manual',
      }),
    ]);
  });

  it('restores a source under its profile, with its default account and its sync time', async () => {
    const res = await send('POST', '/api/import', backup([source()]));
    expect(res.status).toBe(200);
    const ids = await restoredIds();
    const [restored, ...rest] = await stored();
    expect(rest).toEqual([]);
    expect(restored).toEqual({
      profile_id: ids.profile,
      label: 'Bank ledger',
      config: JSON.stringify({ url: SHEET, sheetName: 'Sheet1' }),
      mapping: JSON.stringify({ date: 'Date', amount: 'Amount' }),
      category_types: null,
      default_account_id: ids.account,
      schedule: 'manual',
      last_synced_at: '2026-02-01T08:00:00.000Z',
    });
  });

  it('reads the JSON columns as text too, and drops a default account the file does not carry', async () => {
    const res = await send(
      'POST',
      '/api/import',
      backup([
        source({
          config: JSON.stringify({ url: SHEET }),
          mapping: JSON.stringify({ date: 'Date' }),
          default_account_id: 99,
        }),
      ])
    );
    expect(res.status).toBe(200);
    expect(await stored()).toEqual([
      expect.objectContaining({
        config: JSON.stringify({ url: SHEET }),
        mapping: JSON.stringify({ date: 'Date' }),
        default_account_id: null,
      }),
    ]);
  });

  it('puts a daily source back on manual when the plan has no automated imports', async () => {
    const res = await send('POST', '/api/import', backup([source({ schedule: 'daily' })]));
    expect(res.status).toBe(200);
    expect((await stored()).map((s) => s.schedule)).toEqual(['manual']);
  });

  it('keeps a daily source daily when the plan has automated imports', async () => {
    await env.DB.prepare("UPDATE users SET plan = 'advanced' WHERE id = ?").bind(USER_ID).run();
    const res = await send('POST', '/api/import', backup([source({ schedule: 'daily' })]));
    expect(res.status).toBe(200);
    expect((await stored()).map((s) => s.schedule)).toEqual(['daily']);
  });

  it('refuses a kind or a schedule there is no such thing as, and keeps what was there', async () => {
    for (const [over, words] of [
      [{ kind: 'ftp' }, 'importSources[0].kind "ftp" is not a source'],
      [{ schedule: 'hourly' }, 'importSources[0].schedule "hourly" is not a schedule'],
    ] as const) {
      const res = await send('POST', '/api/import', backup([source(over)]));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: words });
    }
    expect((await stored()).map((s) => s.label)).toEqual(['Old sheet']);
  });
});
