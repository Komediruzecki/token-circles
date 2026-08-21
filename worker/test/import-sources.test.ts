import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Saved import origins — "Connected Sources" (migration 0020, routes/import-sources.ts). A row
// here is a standing instruction: the daily cron re-imports whatever the saved URL points at,
// into the saved profile, using the saved column mapping. So the things worth pinning are the
// ones that would let a source act on the wrong data — profile scoping, the kind/schedule enums
// that gate which sources the cron picks up, and partial updates not silently dropping a mapping.
//
// The serverless (IndexedDB) twin of this file is
// frontend/src/core/storage/__tests__/importSources.handler.test.ts — the two runtimes present
// the same contract, so the assertions deliberately mirror each other.

interface ApiSource {
  id: number;
  profile_id: number;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  mapping: Record<string, string> | null;
  category_types: Record<string, string> | null;
  default_account_id: number | null;
  schedule: string;
  last_synced_at: string | null;
  last_cursor: string | null;
  created_at: string;
  updated_at: string;
}

const USER_ID = 950;
const PROFILE_ID = 9500;
const SECOND_PROFILE_ID = 9501;
const OTHER_USER_ID = 951;
const OTHER_PROFILE_ID = 9502;

let cookie = '';
let otherCookie = '';

beforeEach(async () => {
  for (const t of ['import_sources', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sources@example.com', 'password', 1)"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE_ID,
      USER_ID
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household')").bind(
      SECOND_PROFILE_ID,
      USER_ID
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'othersources@example.com', 'password', 1)"
    ).bind(OTHER_USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Theirs')").bind(
      OTHER_PROFILE_ID,
      OTHER_USER_ID
    ),
  ]);
  cookie = (await issueSessionCookie(USER_ID, 'password', env)).split(';')[0];
  otherCookie = (await issueSessionCookie(OTHER_USER_ID, 'password', env)).split(';')[0];
});

const auth = (c = cookie, profileId: number = PROFILE_ID) => ({
  Cookie: c,
  'Content-Type': 'application/json',
  'X-Profile-Id': String(profileId),
});

const create = (body: unknown, c = cookie, profileId: number = PROFILE_ID) =>
  SELF.fetch('https://example.com/api/import-sources', {
    method: 'POST',
    headers: auth(c, profileId),
    body: JSON.stringify(body),
  });

const update = (id: number, body: unknown, c = cookie, profileId: number = PROFILE_ID) =>
  SELF.fetch(`https://example.com/api/import-sources/${id}`, {
    method: 'PUT',
    headers: auth(c, profileId),
    body: JSON.stringify(body),
  });

const remove = (id: number, c = cookie, profileId: number = PROFILE_ID) =>
  SELF.fetch(`https://example.com/api/import-sources/${id}`, {
    method: 'DELETE',
    headers: auth(c, profileId),
  });

const list = async (c = cookie, headers: Record<string, string> = {}): Promise<ApiSource[]> => {
  const res = await SELF.fetch('https://example.com/api/import-sources', {
    headers: { Cookie: c, 'X-Profile-Id': String(PROFILE_ID), ...headers },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ApiSource[];
};

const SHEET = {
  kind: 'google_sheet',
  label: 'Budget 2026',
  config: {
    url: 'https://docs.google.com/spreadsheets/d/ABC/edit#gid=7',
    sheetName: 'transactions',
  },
  mapping: { date: 'Date', amount: 'Amount', description: 'Memo' },
  category_types: { 'Erste Giro': 'account' },
  schedule: 'daily',
};

describe('import sources — CRUD', () => {
  it('saves a sheet and reads it back with its JSON columns parsed', async () => {
    const res = await create(SHEET);
    expect(res.status).toBe(201);
    const created = (await res.json()) as ApiSource;

    expect(created.id).toBeGreaterThan(0);
    expect(created.profile_id).toBe(PROFILE_ID);
    expect(created.kind).toBe('google_sheet');
    expect(created.label).toBe('Budget 2026');
    expect(created.schedule).toBe('daily');
    // config/mapping/category_types live in TEXT columns; the client must never see the raw JSON.
    expect(created.config).toEqual(SHEET.config);
    expect(created.mapping).toEqual(SHEET.mapping);
    expect(created.category_types).toEqual(SHEET.category_types);
    expect(created.last_synced_at).toBeNull();

    expect(await list()).toEqual([created]);
  });

  it('fills in defaults for a bare create', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    const created = (await res.json()) as ApiSource;
    // Defaults matter: `schedule` decides whether the cron will act on this row, and a create
    // that silently defaulted to 'daily' would start importing without the user asking.
    expect(created.kind).toBe('google_sheet');
    expect(created.schedule).toBe('manual');
    expect(created.label).toBe('');
    expect(created.config).toEqual({});
    expect(created.mapping).toBeNull();
  });

  it('lists newest first', async () => {
    await create({ ...SHEET, label: 'first' });
    await create({ ...SHEET, label: 'second' });
    expect((await list()).map((s) => s.label)).toEqual(['second', 'first']);
  });

  it('updates only the fields the body carries', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource;

    const res = await update(created.id, { label: 'Renamed', schedule: 'manual' });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ApiSource;

    expect(updated.label).toBe('Renamed');
    expect(updated.schedule).toBe('manual');
    // A rename must not cost the user their column mapping — re-mapping a 12-column sheet by
    // hand is the most tedious thing in the app.
    expect(updated.mapping).toEqual(SHEET.mapping);
    expect(updated.category_types).toEqual(SHEET.category_types);
    expect(updated.config).toEqual(SHEET.config);
    expect(updated.updated_at >= created.updated_at).toBe(true);
  });

  it('clears mapping and category_types when the body sends null', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource;
    const updated = (await (
      await update(created.id, { mapping: null, category_types: null })
    ).json()) as ApiSource;
    expect(updated.mapping).toBeNull();
    expect(updated.category_types).toBeNull();
  });

  it('records the sync stamp the client writes back after a manual re-import', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource;
    const updated = (await (
      await update(created.id, {
        last_synced_at: '2026-07-01T09:00:00.000Z',
        last_cursor: 'row-42',
      })
    ).json()) as ApiSource;
    expect(updated.last_synced_at).toBe('2026-07-01T09:00:00.000Z');
    expect(updated.last_cursor).toBe('row-42');
  });

  it('deletes an owned source', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource;
    expect((await remove(created.id)).status).toBe(200);
    expect(await list()).toHaveLength(0);
    // Deleting the same row twice is a 404, not a silent success.
    expect((await remove(created.id)).status).toBe(404);
  });
});

describe('import sources — validation', () => {
  it('rejects a kind outside the known set', async () => {
    const res = await create({ ...SHEET, kind: 'ftp_drop' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Invalid kind');
    expect(await list()).toHaveLength(0);
  });

  it('rejects a schedule outside the known set', async () => {
    // The cron selects on schedule = 'daily'; a typo like 'Daily' would create a source that
    // silently never runs.
    const res = await create({ ...SHEET, schedule: 'hourly' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Invalid schedule');
  });

  it('rejects an invalid enum on update without touching the row', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource;
    expect((await update(created.id, { schedule: 'weekly' })).status).toBe(400);
    expect((await update(created.id, { kind: 'ftp_drop' })).status).toBe(400);
    const after = (await list())[0];
    expect(after.schedule).toBe('daily');
    expect(after.kind).toBe('google_sheet');
  });

  it('clamps an overlong label and coerces a non-object config', async () => {
    const created = (await (
      await create({ ...SHEET, label: 'x'.repeat(500), config: 'not-an-object' })
    ).json()) as ApiSource;
    expect(created.label).toHaveLength(200);
    expect(created.config).toEqual({});
  });

  it('nulls a default_account_id that is not a finite number, and floors one that is', async () => {
    const bad = (await (
      await create({ ...SHEET, default_account_id: 'seven' })
    ).json()) as ApiSource;
    expect(bad.default_account_id).toBeNull();
    const good = (await (await create({ ...SHEET, default_account_id: 12.9 })).json()) as ApiSource;
    expect(good.default_account_id).toBe(12);
  });

  it('rejects a non-numeric id', async () => {
    expect((await update(NaN as unknown as number, { label: 'x' })).status).toBe(400);
    expect(
      (
        await SELF.fetch('https://example.com/api/import-sources/not-a-number', {
          method: 'DELETE',
          headers: auth(),
        })
      ).status
    ).toBe(400);
  });

  it('survives a body that is not JSON at all', async () => {
    const res = await SELF.fetch('https://example.com/api/import-sources', {
      method: 'POST',
      headers: auth(),
      body: '}{',
    });
    // Malformed JSON falls back to an empty body → a defaulted row, never a 500.
    expect(res.status).toBe(201);
  });
});

describe('import sources — ownership', () => {
  it('requires a session', async () => {
    const res = await SELF.fetch('https://example.com/api/import-sources');
    expect(res.status).toBe(401);
  });

  it("never lists, updates or deletes another user's source", async () => {
    const theirs = (await (
      await create({ ...SHEET, label: 'Theirs' }, otherCookie, OTHER_PROFILE_ID)
    ).json()) as ApiSource;
    expect(theirs.profile_id).toBe(OTHER_PROFILE_ID);

    expect(await list()).toHaveLength(0);
    expect((await update(theirs.id, { label: 'hijacked' })).status).toBe(404);
    expect((await remove(theirs.id)).status).toBe(404);

    // Still intact for its owner.
    const stillTheirs = await list(otherCookie, { 'X-Profile-Id': String(OTHER_PROFILE_ID) });
    expect(stillTheirs.map((s) => s.label)).toEqual(['Theirs']);
  });

  it('refuses to create a source in a profile the user does not own', async () => {
    const res = await create(SHEET, cookie, OTHER_PROFILE_ID);
    expect(res.status).toBe(403);
    expect(await list(otherCookie, { 'X-Profile-Id': String(OTHER_PROFILE_ID) })).toHaveLength(0);
  });

  it('lists across the selected profiles, and only those', async () => {
    await create({ ...SHEET, label: 'main' }, cookie, PROFILE_ID);
    await create({ ...SHEET, label: 'household' }, cookie, SECOND_PROFILE_ID);
    await create({ ...SHEET, label: 'theirs' }, otherCookie, OTHER_PROFILE_ID);

    const both = await list(cookie, {
      'X-Profile-Ids': JSON.stringify([PROFILE_ID, SECOND_PROFILE_ID]),
    });
    expect(both.map((s) => s.label).sort()).toEqual(['household', 'main']);

    // Naming a profile the user doesn't own must not widen the read.
    const spoofed = await list(cookie, {
      'X-Profile-Ids': JSON.stringify([PROFILE_ID, OTHER_PROFILE_ID]),
    });
    expect(spoofed.map((s) => s.label)).toEqual(['main']);
  });

  it('cannot move a source into another profile through an update', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource;
    const updated = (await (
      await update(created.id, { profile_id: OTHER_PROFILE_ID, label: 'moved' })
    ).json()) as ApiSource;
    // profile_id is not a writable field — the daily cron imports into whatever profile this
    // says, so letting a body set it would be a way to write into someone else's books.
    expect(updated.profile_id).toBe(PROFILE_ID);
    expect(updated.label).toBe('moved');
  });

  it('drops sources with the profile they belong to', async () => {
    const created = (await (
      await create({ ...SHEET, label: 'household' }, cookie, SECOND_PROFILE_ID)
    ).json()) as ApiSource;
    const present = () =>
      env.DB.prepare('SELECT id FROM import_sources WHERE id = ?').bind(created.id).first();
    expect(await present()).not.toBeNull();

    await env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(SECOND_PROFILE_ID).run();

    // ON DELETE CASCADE (migration 0020). Without it, deleting a profile would leave a source
    // behind that the daily cron keeps importing into a profile_id nothing owns any more.
    expect(await present()).toBeNull();
  });
});
