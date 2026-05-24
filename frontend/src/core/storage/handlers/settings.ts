/**
 * Settings handlers — IndexedDB-backed implementations
 */
import { getStorageMode, setStorageMode } from '../storageFactory'
import { adapter, json, ok } from './helpers'
import type { StorageMode } from '../storageFactory'

export async function settingsGet(): Promise<Response> {
  const settings = await adapter.getSettings()
  return json(settings)
}

export async function settingsUpdate(body: unknown): Promise<Response> {
  if (body && typeof body === 'object') {
    await adapter.updateSettings(body as Record<string, unknown>)
    return ok()
  }
  return json({ error: 'Invalid settings body' }, 400)
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
