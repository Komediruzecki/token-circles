import { ANSWERS_MAX_BYTES, ANSWERS_MESSAGES } from '../../guidance/answers';
import { SETTINGS_MESSAGES } from '../../settingsSchema';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

async function settingsOf(api: ContractApi, expect: Expect): Promise<Json> {
  const reply = await api.get('/api/settings');
  expectOk(expect, reply, 'GET /api/settings');
  return reply.body;
}

/**
 * Where a profile's guidance answers are kept (shared/guidance/answers.ts): the Worker's settings
 * are per profile, so under the plain key; local-first's serve the whole browser, so the key names
 * the profile, as the app's `answersKey` does.
 */
export function answersKeyOf(api: ContractApi): string {
  return api.runtime === 'worker' ? 'guidance' : `guidance:${api.profile}`;
}

/** A record as a newer build writes it: the answers this one reads, and a question it never asks. */
export const ANSWERS = JSON.stringify({
  region: 'HR',
  adults: 2,
  children: 0,
  tenure: 'own_outright',
});

/** The record the achievements store saves (core/achievements/records.ts, serializeRecords). */
const ACHIEVEMENTS = JSON.stringify({
  v: 1,
  unlocks: [{ id: 'first-budget', earnedOn: '2026-03-01', unlockedAt: '2026-03-01T09:30:00.000Z' }],
  dismissedAdvice: [],
});

export const settings = [
  scenario('settings are saved and read back', async (api, expect) => {
    // What the app reads back: the base currency, the onboarding state and the badges earned.
    const fresh = await settingsOf(api, expect);
    expect(fresh.currency).toBe('EUR');
    expect(fresh.onboarding).toBeUndefined();

    // Each write sends only its own keys (Settings, onboardingStore, achievementsStore).
    expectOk(expect, await api.put('/api/settings', { currency: 'USD' }), 'PUT the currency');
    expectOk(
      expect,
      await api.put('/api/settings', { onboarding: 'completed' }),
      'PUT the onboarding state'
    );
    expectOk(
      expect,
      await api.put('/api/settings', { achievements: ACHIEVEMENTS }),
      'PUT the badges'
    );
    expect(await settingsOf(api, expect)).toMatchObject({
      currency: 'USD',
      onboarding: 'completed',
      achievements: ACHIEVEMENTS,
    });

    // A later write changes what it sends, and nothing else.
    expectOk(
      expect,
      await api.put('/api/settings', { onboarding: 'skipped' }),
      'PUT the onboarding state again'
    );
    expect(await settingsOf(api, expect)).toMatchObject({
      currency: 'USD',
      onboarding: 'skipped',
      achievements: ACHIEVEMENTS,
    });
  }),

  scenario("one profile's settings, seen from another", async (api, expect) => {
    expectOk(
      expect,
      await api.put('/api/settings', { currency: 'USD', onboarding: 'completed' }),
      'PUT the settings'
    );
    const theirs = await settingsOf(api.other, expect);
    // DIFFERENCE settings-scope
    if (api.runtime === 'worker') {
      expect(theirs.currency).toBe('EUR');
      expect(theirs.onboarding).toBeUndefined();
    } else {
      expect(theirs).toMatchObject({ currency: 'USD', onboarding: 'completed' });
    }
  }),

  scenario(
    'the guidance answers are stored as sent, fields this build does not read and all',
    async (api, expect) => {
      const mine = answersKeyOf(api);
      const theirs = answersKeyOf(api.other);
      expectOk(expect, await api.put('/api/settings', { [mine]: ANSWERS }), 'PUT the answers');
      expectOk(
        expect,
        await api.other.put('/api/settings', { [theirs]: '{"region":"UK"}' }),
        "PUT the other profile's answers"
      );
      // Each profile reads its own record back, as it was sent.
      expect((await settingsOf(api, expect))[mine]).toBe(ANSWERS);
      expect((await settingsOf(api.other, expect))[theirs]).toBe('{"region":"UK"}');

      // The most a record holds is 4 KB.
      const shell = JSON.stringify({ region: 'DE', note: '' }).length;
      const full = JSON.stringify({ region: 'DE', note: 'a'.repeat(ANSWERS_MAX_BYTES - shell) });
      expect(new TextEncoder().encode(full).length).toBe(ANSWERS_MAX_BYTES);
      expectOk(expect, await api.put('/api/settings', { [mine]: full }), 'PUT 4 KB of answers');
      expect((await settingsOf(api, expect))[mine]).toBe(full);
    }
  ),

  scenario(
    'a guidance record that is not well formed is refused, and the one stored kept',
    async (api, expect) => {
      const key = answersKeyOf(api);
      expectOk(expect, await api.put('/api/settings', { [key]: ANSWERS }), 'PUT the answers');
      const refusals: [unknown, string][] = [
        ['{"region":"DE"', ANSWERS_MESSAGES.record],
        ['["DE"]', ANSWERS_MESSAGES.record],
        [{ region: 'DE' }, ANSWERS_MESSAGES.record],
        ['{"region":49}', ANSWERS_MESSAGES.region],
        ['{"adults":0}', ANSWERS_MESSAGES.adults],
        ['{"children":-1}', ANSWERS_MESSAGES.children],
        [JSON.stringify({ note: 'a'.repeat(ANSWERS_MAX_BYTES) }), ANSWERS_MESSAGES.size],
      ];
      for (const [raw, message] of refusals) {
        const reply = await api.put('/api/settings', { [key]: raw });
        expect(reply.status).toBe(400);
        expect(reply.body).toEqual({ error: message, fields: { [key]: message } });
      }
      expect((await settingsOf(api, expect))[key]).toBe(ANSWERS);
    }
  ),

  scenario('the storage mode is read, and a switch acknowledged', async (api, expect) => {
    const read = await api.get('/api/storage-mode');
    expectOk(expect, read, 'GET /api/storage-mode');
    // Each runtime names itself: the Worker is the cloud, local-first this browser.
    expect(read.body).toEqual({ mode: api.runtime === 'worker' ? 'self-hosted' : 'serverless' });
    // Settings' switch without moving data sends the mode it switches to, then sets it in the
    // browser itself and reloads. The answer acknowledges the mode and switches nothing. Nothing in
    // the app sends the Express server's name for it, which answers the same.
    for (const path of ['/api/storage-mode', '/api/settings/set-storage']) {
      const switched = await api.post(path, { mode: 'self-hosted' });
      expectOk(expect, switched, `POST ${path}`);
      expect(switched.body).toEqual({ ok: true, mode: 'self-hosted' });
      const refused = await api.post(path, { mode: 'cloud' });
      expect(refused.status).toBe(400);
      expect(refused.body).toEqual({
        error: SETTINGS_MESSAGES.mode,
        fields: { mode: SETTINGS_MESSAGES.mode },
      });
    }
    expect((await api.get('/api/storage-mode')).body).toEqual(read.body);
  }),
];
