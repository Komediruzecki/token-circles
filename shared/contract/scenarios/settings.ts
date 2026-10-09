import { SETTINGS_MESSAGES } from '../../settingsSchema';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

async function settingsOf(api: ContractApi, expect: Expect): Promise<Json> {
  const reply = await api.get('/api/settings');
  expectOk(expect, reply, 'GET /api/settings');
  return reply.body;
}

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
