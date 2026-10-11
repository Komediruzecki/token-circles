/**
 * GET /api/account/state and PUT /api/account/state/:key (routes/account-state.ts): state that
 * follows the signed-in account, kept in user_state (migration 0034).
 *
 * Each route answers a session only, and only for the session's own account. Keys are an
 * allowlist, a value is checked by its key's rule and capped in size, and a refused write stores
 * nothing. The onboarding record only moves forward and is never changed once finished, even by
 * a write that read it before another tab finished it.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie, unconfirmedSessionCookie } from './helpers/session';
import { dbWithStep, realDb, withDb } from './helpers/racing-db';

const API = 'https://api.example.com';
const ME = 9900;
const OTHER = 9901;
const WAITING = 9902;

interface Onboarding {
  step: string | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: string | null;
}

let mine = '';
let theirs = '';

beforeEach(async () => {
  await env.DB.prepare(
    `DELETE FROM user_state WHERE user_id IN (${ME}, ${OTHER}, ${WAITING})`
  ).run();
  for (const [id, verified] of [
    [ME, 1],
    [OTHER, 1],
    [WAITING, 0],
  ] as const) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version)
       VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1)`
    )
      .bind(id, `state-${id}@example.com`)
      .run();
    await env.DB.prepare('UPDATE users SET email_verified = ? WHERE id = ?')
      .bind(verified, id)
      .run();
  }
  mine = (await sessionCookie(ME)).split(';')[0]!;
  theirs = (await sessionCookie(OTHER)).split(';')[0]!;
});

const read = (cookie: string | null) =>
  SELF.fetch(`${API}/api/account/state`, { headers: cookie ? { Cookie: cookie } : {} });

const write = (cookie: string | null, key: string, body: unknown) =>
  SELF.fetch(`${API}/api/account/state/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const stored = async (userId: number) =>
  (
    await env.DB.prepare('SELECT key, value FROM user_state WHERE user_id = ? ORDER BY key')
      .bind(userId)
      .all<{ key: string; value: string }>()
  ).results;

describe('who reaches the state', () => {
  it('answers 401 with no session, and stores nothing', async () => {
    expect((await read(null)).status).toBe(401);
    expect((await write(null, 'tours', { seen: ['dashboard'] })).status).toBe(401);
    expect(await stored(ME)).toEqual([]);
  });

  it('answers an account waiting for its confirm link 403, and stores nothing', async () => {
    const waiting = (await unconfirmedSessionCookie(WAITING)).split(';')[0]!;
    const got = await read(waiting);
    expect(got.status).toBe(403);
    expect(((await got.json()) as { code?: string }).code).toBe('EMAIL_UNCONFIRMED');
    expect((await write(waiting, 'onboarding', { step: 'space' })).status).toBe(403);
    expect(await stored(WAITING)).toEqual([]);
  });

  it("keeps each account to its own rows: another account's state is never read or written", async () => {
    expect((await write(mine, 'tours', { seen: ['dashboard', 'import'] })).status).toBe(200);
    expect((await write(mine, 'onboarding', { step: 'import' })).status).toBe(200);

    const theirState = (await (await read(theirs)).json()) as Record<string, unknown>;
    expect(theirState).toEqual({ onboarding: null, tours: null, getting_started: null });

    expect((await write(theirs, 'tours', { seen: ['loans'] })).status).toBe(200);
    const myState = (await (await read(mine)).json()) as { tours: { seen: string[] } };
    expect(myState.tours).toEqual({ seen: ['dashboard', 'import'] });
    expect((await stored(OTHER)).map((r) => r.key)).toEqual(['tours']);
  });
});

describe('what a write may store', () => {
  it('answers every key, null where nothing is stored', async () => {
    const got = await read(mine);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ onboarding: null, tours: null, getting_started: null });
  });

  it('answers 404 for a key that is not on the list, and stores nothing', async () => {
    for (const key of ['theme', 'onboarding_v2', 'TOURS', '__proto__']) {
      expect((await write(mine, key, { hidden: true })).status, key).toBe(404);
    }
    expect(await stored(ME)).toEqual([]);
  });

  it('refuses a value over the size cap, and stores nothing', async () => {
    // Each id is a valid slug; there are just too many of them for 1 KB.
    const seen = Array.from({ length: 80 }, (_, i) => `tour-number-${i}`);
    const res = await write(mine, 'tours', { seen });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields?: Record<string, string> }).fields).toHaveProperty(
      'value'
    );
    expect(await stored(ME)).toEqual([]);
  });

  it('refuses a value of the wrong shape, names the field, and stores nothing', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['onboarding', [], 'body'],
      ['onboarding', 'import', 'body'],
      ['onboarding', {}, 'onboarding'],
      ['onboarding', { step: 'nowhere' }, 'step'],
      ['onboarding', { outcome: 'existing' }, 'outcome'],
      ['onboarding', { outcome: 'done' }, 'outcome'],
      ['tours', { seen: 'dashboard' }, 'seen'],
      ['tours', { seen: ['Not A Tour'] }, 'seen'],
      ['tours', { seen: [], reset: 'yes' }, 'reset'],
      ['getting_started', { hidden: 'yes' }, 'hidden'],
      ['getting_started', {}, 'hidden'],
    ];
    for (const [key, body, field] of cases) {
      const res = await write(mine, key, body);
      expect(res.status, `${key} ${JSON.stringify(body)}`).toBe(400);
      const answer = (await res.json()) as { error: string; fields?: Record<string, string> };
      expect(answer.fields, `${key} ${JSON.stringify(body)}`).toHaveProperty(field);
    }
    expect(await stored(ME)).toEqual([]);
  });

  it('stores tours and the card, each id once, and replaces the list only on a reset', async () => {
    const tours = await write(mine, 'tours', { seen: ['dashboard', 'import', 'dashboard'] });
    expect(await tours.json()).toEqual({ tours: { seen: ['dashboard', 'import'] } });
    // A plain write adds; an empty one changes nothing.
    expect(await (await write(mine, 'tours', { seen: [] })).json()).toEqual({
      tours: { seen: ['dashboard', 'import'] },
    });
    expect(await (await write(mine, 'tours', { seen: [], reset: true })).json()).toEqual({
      tours: { seen: [] },
    });
    const card = await write(mine, 'getting_started', { hidden: true });
    expect(await card.json()).toEqual({ getting_started: { hidden: true } });
    expect(await (await read(mine)).json()).toEqual({
      onboarding: null,
      tours: { seen: [] },
      getting_started: { hidden: true },
    });
  });
});

describe('the tours finished', () => {
  const tours = async () =>
    ((await (await read(mine)).json()) as { tours: { seen: string[] } | null }).tours;

  it('adds what each device sends, so a tour finished elsewhere is kept', async () => {
    await write(mine, 'tours', { seen: ['dashboard'] });
    // A device holding a copy read before 'dashboard' finished 'loans'.
    const res = await write(mine, 'tours', { seen: ['loans'] });
    expect(await res.json()).toEqual({ tours: { seen: ['dashboard', 'loans'] } });
    expect(await tours()).toEqual({ seen: ['dashboard', 'loans'] });
  });

  it('starts over on a reset, and keeps the empty list as a row', async () => {
    await write(mine, 'tours', { seen: ['dashboard', 'loans'] });
    await write(mine, 'tours', { seen: [], reset: true });
    expect(await tours()).toEqual({ seen: [] });
    expect(await stored(ME)).toEqual([{ key: 'tours', value: '{"seen":[]}' }]);

    // A reset with tours in it stores those.
    await write(mine, 'tours', { seen: ['import'], reset: true });
    expect(await tours()).toEqual({ seen: ['import'] });
  });
});

describe('the Getting started card', () => {
  it('stays hidden: a later write of hidden false keeps it hidden', async () => {
    expect(await (await write(mine, 'getting_started', { hidden: false })).json()).toEqual({
      getting_started: { hidden: false },
    });
    await write(mine, 'getting_started', { hidden: true });

    // A tab that read the account before the card was hidden makes the record as its wizard ends.
    const late = await write(mine, 'getting_started', { hidden: false });
    expect(late.status).toBe(200);
    expect(await late.json()).toEqual({ getting_started: { hidden: true } });
    expect(await stored(ME)).toEqual([{ key: 'getting_started', value: '{"hidden":true}' }]);
  });
});

describe('the onboarding record', () => {
  const onboarding = async (cookie: string) =>
    ((await (await read(cookie)).json()) as { onboarding: Onboarding | null }).onboarding;

  it('stamps started_at on the first write, and keeps the furthest step', async () => {
    await write(mine, 'onboarding', { step: 'welcome' });
    const first = await onboarding(mine);
    expect(first).toMatchObject({ step: 'welcome', finished_at: null, outcome: null });
    expect(first!.started_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    await write(mine, 'onboarding', { step: 'import' });
    await write(mine, 'onboarding', { step: 'space' });
    const later = await onboarding(mine);
    expect(later).toMatchObject({ step: 'import', started_at: first!.started_at, outcome: null });
  });

  it('finishes once: the first outcome stays, whatever comes after', async () => {
    await write(mine, 'onboarding', { step: 'account' });
    const done = await write(mine, 'onboarding', { step: 'subscriptions', outcome: 'skipped' });
    const finished = ((await done.json()) as { onboarding: Onboarding }).onboarding;
    expect(finished).toMatchObject({ step: 'subscriptions', outcome: 'skipped' });
    expect(finished.finished_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // A relaunched wizard, or a stale tab, finishing again or moving the step.
    const again = await write(mine, 'onboarding', { step: 'done', outcome: 'completed' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { onboarding: Onboarding }).onboarding).toEqual(finished);
    await write(mine, 'onboarding', { step: 'done' });
    expect(await onboarding(mine)).toEqual(finished);
  });

  it('keeps a finish made by another tab after this write read the record', async () => {
    await write(mine, 'onboarding', { step: 'account' });
    const [{ value: before }] = await stored(ME);
    const elsewhere = JSON.stringify({
      ...(JSON.parse(before!) as Onboarding),
      step: 'done',
      finished_at: '2026-10-11 09:00:00',
      outcome: 'completed',
    });
    // Right after this request reads the row, another tab finishes the wizard.
    const racing = dbWithStep(realDb, /SELECT value FROM user_state/, () =>
      realDb
        .prepare("UPDATE user_state SET value = ? WHERE user_id = ? AND key = 'onboarding'")
        .bind(elsewhere, ME)
        .run()
    );
    const res = await withDb(racing.db, () => write(mine, 'onboarding', { step: 'import' }));
    expect(racing.ran()).toBe(true);
    expect(res.status).toBe(200);
    expect(await onboarding(mine)).toEqual(JSON.parse(elsewhere));
  });

  it('records a finish sent with no step, as a decision this browser kept from before', async () => {
    const res = await write(mine, 'onboarding', { outcome: 'completed' });
    expect(res.status).toBe(200);
    const record = await onboarding(mine);
    expect(record).toMatchObject({ step: null, outcome: 'completed' });
    expect(record!.finished_at).toBe(record!.started_at);
  });
});

describe('a value another build wrote', () => {
  const put = (key: string, value: string) =>
    env.DB.prepare('INSERT INTO user_state (user_id, key, value) VALUES (?, ?, ?)')
      .bind(ME, key, value)
      .run();
  const row = async (key: string) =>
    (
      await env.DB.prepare('SELECT value FROM user_state WHERE user_id = ? AND key = ?')
        .bind(ME, key)
        .first<{ value: string }>()
    )?.value;

  // A newer build added a step after this one, or this build is a rollback after it.
  const NEWER_FINISHED = JSON.stringify({
    step: 'essentials',
    started_at: '2026-10-01 10:00:00',
    finished_at: '2026-10-01 10:05:00',
    outcome: 'completed',
  });

  it('reads a finished record with a step this build does not know as finished', async () => {
    await put('onboarding', NEWER_FINISHED);
    const state = (await (await read(mine)).json()) as { onboarding: Onboarding | null };
    expect(state.onboarding).toEqual({
      step: null,
      started_at: '2026-10-01 10:00:00',
      finished_at: '2026-10-01 10:05:00',
      outcome: 'completed',
    });
  });

  it('leaves that record as it is when a step is written over it', async () => {
    await put('onboarding', NEWER_FINISHED);
    const res = await write(mine, 'onboarding', { step: 'welcome' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { onboarding: Onboarding }).onboarding.outcome).toBe('completed');
    expect(await row('onboarding')).toBe(NEWER_FINISHED);
  });

  it('moves an unfinished record with an unknown step on from the steps it knows', async () => {
    await put(
      'onboarding',
      JSON.stringify({
        step: 'essentials',
        started_at: '2026-10-01 10:00:00',
        finished_at: null,
        outcome: null,
      })
    );
    const res = await write(mine, 'onboarding', { step: 'import' });
    expect(res.status).toBe(200);
    expect(JSON.parse((await row('onboarding'))!)).toEqual({
      step: 'import',
      started_at: '2026-10-01 10:00:00',
      finished_at: null,
      outcome: null,
    });
  });

  it('keeps the tours it can read when one id is not well formed', async () => {
    const stored = JSON.stringify({
      seen: ['dashboard', 'a-tour-id-that-is-longer-than-forty-characters', 'import'],
    });
    await put('tours', stored);
    const state = (await (await read(mine)).json()) as { tours: { seen: string[] } | null };
    expect(state.tours).toEqual({ seen: ['dashboard', 'import'] });
  });

  it('never replaces a row it cannot read: the write is refused and the row left', async () => {
    const unreadable: Array<[string, string, unknown]> = [
      ['onboarding', '{"step":"welcome","started_at":"yesterday"}', { step: 'space' }],
      ['onboarding', 'not json', { outcome: 'completed' }],
      ['tours', '{"seen":"dashboard"}', { seen: ['loans'] }],
      ['getting_started', '{"hidden":"no"}', { hidden: true }],
    ];
    for (const [key, value, body] of unreadable) {
      await env.DB.prepare('DELETE FROM user_state WHERE user_id = ?').bind(ME).run();
      await put(key, value);
      const res = await write(mine, key, body);
      expect(res.status, `${key} ${value}`).toBe(409);
      expect(await row(key), `${key} ${value}`).toBe(value);
      const state = (await (await read(mine)).json()) as Record<string, unknown>;
      expect(state[key], `${key} ${value}`).toBeNull();
    }
  });
});
