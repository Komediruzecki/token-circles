/**
 * What a connected source and a Google Sheet link refuse, and how they say it, on a real D1 with
 * an older source in place (shared/importSourceSchema.ts). The twin of the local-first test,
 * frontend/src/core/storage/__tests__/importSourceRefusals.test.ts.
 *
 * Before, a kind or a schedule there is no such thing as was "Invalid kind" or "Invalid schedule",
 * naming no field; a long name was cut to 200 characters, and a name or settings that were not
 * text or an object were stored empty, without a word; another profile's account was taken as the
 * default account; a sheet was saved with no link to fetch; and a link that was not a sheet's was
 * "Invalid Google Sheets URL or ID", or "URL is required", at no field.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_SOURCE_MESSAGES as M } from '../../shared/importSourceSchema';
import { sessionCookie } from './helpers/session';

const USER_ID = 6450;
const PROFILE = 64500;
const SIDE = 64501;
const MINE = 64510;
const THEIRS = 64511;
const OLD_SOURCE = 64520;
const SHEET = 'https://docs.google.com/spreadsheets/d/source-sheet/edit#gid=0';
let cookie = '';

beforeEach(async () => {
  for (const t of ['import_sources', 'accounts', 'rate_limits', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'import-sources@example.com', 'password', 1, 'free')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household'), (?, ?, 'Side')"
    ).bind(PROFILE, USER_ID, SIDE, USER_ID),
    env.DB.prepare(
      `INSERT INTO accounts (id, profile_id, name, type, currency, balance) VALUES
         (?, ?, 'Everyday', 'giro', 'EUR', 0), (?, ?, 'Theirs', 'giro', 'EUR', 0)`
    ).bind(MINE, PROFILE, THEIRS, SIDE),
    // Saved under the older rules: a sheet with no link, and another profile's account.
    env.DB.prepare(
      `INSERT INTO import_sources (id, profile_id, kind, label, config, default_account_id, schedule)
       VALUES (?, ?, 'google_sheet', 'Old ledger', '{}', ?, 'manual')`
    ).bind(OLD_SOURCE, PROFILE, THEIRS),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function send(method: string, path: string, payload?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function answer(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() };
}

async function stored(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, kind, label, config, default_account_id, schedule, last_synced_at FROM import_sources ORDER BY id'
  ).all();
  return results;
}

const sheet = (fields: Record<string, unknown> = {}) => ({
  kind: 'google_sheet',
  label: 'Bank ledger',
  config: { url: SHEET, sheetName: 'Sheet1' },
  schedule: 'manual',
  ...fields,
});

describe('a new source', () => {
  it('is refused at each field that cannot be stored, and nothing is saved', async () => {
    const before = await stored();
    const refused = async (fields: Record<string, unknown>) => {
      const { status, body } = await answer(
        await send('POST', '/api/import-sources', sheet(fields))
      );
      expect(status).toBe(400);
      return body.fields;
    };
    expect(await refused({ kind: 'dropbox', schedule: 'hourly', label: 'x'.repeat(201) })).toEqual({
      kind: M.kind,
      schedule: M.schedule,
      label: M.labelLength,
    });
    expect(await refused({ label: 42, config: 'sheet' })).toEqual({
      label: M.label,
      config: M.config,
    });
    expect(await refused({ config: {} })).toEqual({ 'config.url': M.url });
    expect(await refused({ default_account_id: THEIRS })).toEqual({
      default_account_id: M.account,
    });
    expect(await refused({ default_account_id: 'Everyday' })).toEqual({
      default_account_id: M.account,
    });
    // Refused for what it holds before the plan is asked about the schedule.
    expect(await refused({ schedule: 'daily', label: 7 })).toEqual({ label: M.label });
    expect(await stored()).toEqual(before);
  });

  it('is saved with its name trimmed and its own account', async () => {
    const { status, body } = await answer(
      await send(
        'POST',
        '/api/import-sources',
        sheet({ label: '  Bank ledger ', default_account_id: MINE })
      )
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({
      label: 'Bank ledger',
      default_account_id: MINE,
      config: { url: SHEET },
    });
  });
});

describe('a source saved under the older rules', () => {
  it('is renamed and stamped without its other fields being checked again', async () => {
    expect(
      (await send('PUT', `/api/import-sources/${OLD_SOURCE}`, { label: 'Ledger' })).status
    ).toBe(200);
    expect(
      (
        await send('PUT', `/api/import-sources/${OLD_SOURCE}`, {
          last_synced_at: '2026-10-08T09:30:00Z',
        })
      ).status
    ).toBe(200);
    expect(await stored()).toEqual([
      expect.objectContaining({
        id: OLD_SOURCE,
        label: 'Ledger',
        config: '{}',
        default_account_id: THEIRS,
        last_synced_at: '2026-10-08T09:30:00Z',
      }),
    ]);
  });

  it('is refused at a field an edit sends that cannot be stored, and is left as it was', async () => {
    const before = await stored();
    for (const [fields, refused] of [
      [{ default_account_id: THEIRS }, { default_account_id: M.account }],
      [{ config: { sheetName: 'Sheet2' } }, { 'config.url': M.url }],
      [{ kind: 'dropbox' }, { kind: M.kind }],
      [{ schedule: 'weekly' }, { schedule: M.schedule }],
    ] as const) {
      expect(await answer(await send('PUT', `/api/import-sources/${OLD_SOURCE}`, fields))).toEqual({
        status: 400,
        body: { error: Object.values(refused).join(' '), fields: refused },
      });
    }
    expect(await stored()).toEqual(before);
  });
});

describe('a Google Sheet link to fetch', () => {
  it('is refused at the link when it is not a sheet', async () => {
    for (const payload of [
      {},
      { url: '' },
      { url: 'https://example.com/not-a-sheet' },
      { url: 12 },
    ]) {
      expect(await answer(await send('POST', '/api/import/googlesheet', payload))).toEqual({
        status: 400,
        body: { error: M.url, fields: { url: M.url } },
      });
    }
  });
});
