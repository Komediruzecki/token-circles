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

  scenario('the storage mode is read and switched', async (api, expect) => {
    const read = await api.get('/api/storage-mode');
    expectOk(expect, read, 'GET /api/storage-mode');
    // Settings' switch without moving data sends the mode it switches to, then reloads.
    const switched = await api.post('/api/storage-mode', { mode: 'self-hosted' });
    expectOk(expect, switched, 'POST /api/storage-mode');
    // Nothing in the app sends this one; it answers as the Express server did.
    const legacy = await api.post('/api/settings/set-storage', { mode: 'self-hosted' });
    expectOk(expect, legacy, 'POST /api/settings/set-storage');
    // DIFFERENCE storage-mode-answers
    if (api.runtime === 'worker') {
      expect(read.body).toEqual({ mode: 'self-hosted', type: 'sqlite' });
      expect(switched.body).toEqual({ ok: true });
      expect(legacy.body).toEqual({
        ok: true,
        message: 'SQLite storage configured. Please restart the application.',
      });
    } else {
      expect(read.body).toEqual({ mode: 'serverless' });
      expect(switched.body).toEqual({ ok: true, mode: 'self-hosted' });
      expect(legacy.body).toEqual({ ok: true, mode: 'self-hosted' });
      expect((await api.get('/api/storage-mode')).body).toEqual({ mode: 'self-hosted' });
    }
    // Back to where this browser was.
    expectOk(
      expect,
      await api.post('/api/storage-mode', { mode: read.body.mode }),
      'POST the mode back'
    );
  }),
];
