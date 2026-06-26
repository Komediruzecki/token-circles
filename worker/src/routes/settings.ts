import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/settings.js — key/value settings per profile.
export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.get('/api/settings', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const rows = await db.all<{ key: string; value: string }>(
    c.env.DB,
    'SELECT key, value FROM settings WHERE profile_id = ? OR profile_id IS NULL',
    pid
  )
  const settings: Record<string, any> = { currency: 'USD', locale: 'en-US' }
  for (const r of rows) settings[r.key] = r.value
  settings.preferences = {
    theme: settings.theme || 'light',
    notifications: settings.notifications !== undefined ? settings.notifications : true,
  }
  c.header('Cache-Control', 'no-cache')
  return c.json(settings)
})

settingsRoutes.put('/api/settings', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  if (b.currency && !/^[A-Z]{3}$/.test(b.currency)) {
    throw new HttpError(422, 'Invalid currency code. Must be 3-letter ISO 4217 code (e.g., USD, EUR).')
  }
  if (b.locale) {
    const localeRegex = /^[a-z]{2,3}(?:-[A-Z]{2,3}(?:-[A-Z0-9]+)*)?$/i
    if (!localeRegex.test(b.locale)) {
      throw new HttpError(422, 'Invalid locale code. Use valid BCP 47 language tags (e.g., en-US, fr-FR).')
    }
  }
  for (const [k, v] of Object.entries(b)) {
    await db.run(c.env.DB, 'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)', k, String(v), pid)
  }
  return c.json({ ok: true })
})

settingsRoutes.post('/api/settings/set-storage', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>
  const message =
    b.type === 'postgresql'
      ? 'PostgreSQL storage configured. Please restart the application.'
      : 'SQLite storage configured. Please restart the application.'
  return c.json({ ok: true, message })
})
