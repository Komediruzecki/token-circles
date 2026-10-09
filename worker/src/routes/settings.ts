import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { checkSettingsUpdate, checkStorageMode } from '../../../shared/settingsSchema';
import { accept } from '../http';
import * as db from '../db';
import { setProfileBaseCurrency } from '../base-currency';

// Port of backend/routes/settings.js — key/value settings per profile.
export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get('/api/settings', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all<{ key: string; value: string; profile_id: number | null }>(
    c.env.DB,
    `SELECT key, value, profile_id
       FROM settings
      WHERE profile_id = ? OR profile_id IS NULL
      ORDER BY CASE WHEN profile_id IS NULL THEN 0 ELSE 1 END`,
    pid
  );
  const settings: Record<string, any> = { currency: 'EUR', locale: 'en-US' };
  for (const r of rows) settings[r.key] = r.value;
  settings.preferences = {
    theme: settings.theme || 'light',
    notifications: settings.notifications !== undefined ? settings.notifications : true,
  };
  c.header('Cache-Control', 'no-cache');
  return c.json(settings);
});

// The settings this route stores, checked by the rules local-first runs too
// (shared/settingsSchema.ts): a key another route owns is refused there, a value is checked before
// anything is written, and a refused write stores none of the body.
settingsRoutes.put('/api/settings', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const settings = accept(checkSettingsUpdate(await c.req.json().catch(() => null)));
  if (settings.currency !== undefined) {
    settings.currency = await setProfileBaseCurrency(c.env.DB, pid, settings.currency);
  }
  for (const [k, v] of Object.entries(settings)) {
    await db.run(
      c.env.DB,
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)',
      k,
      String(v),
      pid
    );
  }
  return c.json({ ok: true });
});

// Storage-mode endpoints the frontend Settings page calls. The worker IS the
// self-hosted (D1/SQLite) backend and the active mode actually lives client-side
// (localStorage 'finance_storage_mode'), so GET reports self-hosted and POST just
// acknowledges the switch, which Settings then makes itself. Public — touches no user data.
// Local-first answers both the same way (shared/settingsSchema.ts, checkStorageMode).
settingsRoutes.get('/api/storage-mode', (c) => c.json({ mode: 'self-hosted' }));
settingsRoutes.post('/api/storage-mode', async (c) => {
  const { mode } = accept(checkStorageMode(await c.req.json().catch(() => null)));
  return c.json({ ok: true, mode });
});
// The Express server's name for the same switch. Nothing in the app sends it any more; it answers
// as POST /api/storage-mode does.
settingsRoutes.post('/api/settings/set-storage', requireAuth, async (c) => {
  const { mode } = accept(checkStorageMode(await c.req.json().catch(() => null)));
  return c.json({ ok: true, mode });
});
