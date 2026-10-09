/**
 * Settings handlers — IndexedDB-backed implementations
 */
import { checkSettingsUpdate, checkStorageMode } from '../../../../../shared/settingsSchema'
import { BaseCurrencyConflictError, setBaseCurrency } from '../baseCurrency'
import { getStorageMode } from '../storageFactory'
import { adapter, json, ok, refuse } from './helpers'

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

/**
 * Settings sends the mode it is about to switch to, then sets it in this browser itself. As on
 * the Worker, which cannot switch a browser, the answer acknowledges a mode there is such a thing
 * as and switches nothing (shared/settingsSchema.ts, checkStorageMode).
 */
export async function storageModeSet(body: unknown): Promise<Response> {
  const checked = checkStorageMode(body)
  if (!checked.ok) return refuse(checked.fields)
  return ok({ mode: checked.value.mode })
}
