import { beforeEach, describe, expect, it } from 'vitest'

describe('storageFactory - storage mode detection', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.removeItem('finance_storage_mode')
  })

  it('getStorageMode returns a valid mode', async () => {
    const { getStorageMode } = await import('../storageFactory.js')
    const mode = getStorageMode()
    expect(['serverless', 'self-hosted']).toContain(mode)
  })

  it('setStorageMode sets serverless mode in localStorage', async () => {
    const { getStorageMode, setStorageMode } = await import('../storageFactory.js')
    setStorageMode('serverless')
    expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
    expect(getStorageMode()).toBe('serverless')
  })

  it('setStorageMode sets self-hosted mode in localStorage', async () => {
    const { getStorageMode, setStorageMode } = await import('../storageFactory.js')
    setStorageMode('self-hosted')
    expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
    expect(getStorageMode()).toBe('self-hosted')
  })

  it('getStorageMode uses localStorage value when set', async () => {
    // Set before importing so the module picks it up
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    const { getStorageMode } = await import('../storageFactory.js')
    expect(getStorageMode()).toBe('self-hosted')
  })

  it('resetAdapter does not throw', async () => {
    const { resetAdapter } = await import('../storageFactory.js')
    expect(() => {
      resetAdapter()
    }).not.toThrow()
  })
})
