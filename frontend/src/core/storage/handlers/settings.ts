/**
 * Settings handlers — IndexedDB-backed implementations
 */
import { checkSettingsUpdate } from '../../../../../shared/settingsSchema'
import { BaseCurrencyConflictError, setBaseCurrency } from '../baseCurrency'
import { getStorageMode, setStorageMode } from '../storageFactory'
import { adapter, json, ok, refuse } from './helpers'
import type { StorageMode } from '../storageFactory'

export async function settingsGet(): Promise<Response> {
  const settings = await adapter.getSettings()
  return json(settings)
}

/**
 * The settings of one write, checked by the rules the Worker runs (shared/settingsSchema.ts): a key
 * another route owns is refused there, every value is checked before any is stored, and a locked
 * base currency is refused at the currency in the Worker's words.
 */
export async function settingsUpdate(body: unknown): Promise<Response> {
  const checked = checkSettingsUpdate(body)
  if (!checked.ok) return refuse(checked.fields)
  const settings: Record<string, unknown> = { ...checked.value }
  if (settings.currency !== undefined) {
    try {
      settings.currency = await setBaseCurrency(settings.currency)
      settings.primary_currency = settings.currency
    } catch (error) {
      if (error instanceof BaseCurrencyConflictError) {
        return json({ error: error.message, fields: { currency: error.message } }, 409)
      }
      throw error
    }
  }
  await adapter.updateSettings(settings)
  return ok()
}

export async function storageModeGet(): Promise<Response> {
  return json({ mode: getStorageMode() })
}

export async function storageModeSet(body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'mode' in body) {
    const mode = (body as Record<string, unknown>).mode as StorageMode
    setStorageMode(mode)
    return ok({ mode })
  }
  return json({ error: 'Mode required' }, 400)
}
