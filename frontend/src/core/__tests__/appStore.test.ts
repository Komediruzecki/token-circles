import { describe, expect, it } from 'vitest'
import {
  bumpProfileVersion,
  getCurrentProfile,
  getIsAuthenticated,
  getProfiles,
  getProfileVersion,
  setCurrentProfile,
  setIsAuthenticated,
  setProfiles,
} from '../appStore.js'

describe('appStore - profiles', () => {
  const sample = [
    { id: 1, name: 'Demo', created_at: '2023-01-01T00:00:00Z' },
    { id: 2, name: 'Personal', created_at: '2023-01-02T00:00:00Z' },
  ]

  it('starts with empty profiles', () => {
    expect(getProfiles()).toEqual([])
  })

  it('setProfiles replaces the array', () => {
    setProfiles(sample)
    const profiles = getProfiles()
    expect(profiles.length).toBe(2)
    expect(profiles[0].id).toBe(1)
    expect(profiles[1].id).toBe(2)
  })

  it('replaces same-id items with updated data', () => {
    setProfiles(sample)
    setProfiles([
      { id: 1, name: 'Renamed Demo', created_at: '2023-01-01T00:00:00Z' },
      { id: 2, name: 'Renamed Personal', created_at: '2023-01-02T00:00:00Z' },
    ])
    const second = getProfiles()
    expect(second.length).toBe(2)
    expect(second[0].name).toBe('Renamed Demo')
    expect(second[1].name).toBe('Renamed Personal')
    expect(second[0].id).toBe(1)
    expect(second[1].id).toBe(2)
  })

  it('replaces with fewer items (shrinks array)', () => {
    setProfiles(sample)
    expect(getProfiles().length).toBe(2)
    setProfiles([{ id: 1, name: 'Demo', created_at: '2023-01-01T00:00:00Z' }])
    expect(getProfiles().length).toBe(1)
    expect(getProfiles()[0].id).toBe(1)
  })

  it('replaces with more items (grows array)', () => {
    setProfiles(sample)
    expect(getProfiles().length).toBe(2)
    setProfiles([
      { id: 1, name: 'Demo', created_at: '2023-01-01T00:00:00Z' },
      { id: 2, name: 'Personal', created_at: '2023-01-02T00:00:00Z' },
      { id: 3, name: 'Work', created_at: '2023-01-03T00:00:00Z' },
    ])
    expect(getProfiles().length).toBe(3)
    expect(getProfiles()[2].id).toBe(3)
  })

  it('replaces with empty array', () => {
    setProfiles(sample)
    setProfiles([])
    expect(getProfiles()).toEqual([])
  })

  it('setProfiles with empty array on empty state', () => {
    setProfiles([])
    expect(getProfiles()).toEqual([])
  })
})

describe('appStore - currentProfile', () => {
  it('starts as null', () => {
    expect(getCurrentProfile()).toBeNull()
  })

  it('setCurrentProfile stores and retrieves a profile', () => {
    const profile = { id: 1, name: 'Test', created_at: '2023-01-01T00:00:00Z' }
    setCurrentProfile(profile)
    expect(getCurrentProfile()).toEqual(profile)
  })

  it('setCurrentProfile(null) clears it', () => {
    setCurrentProfile({ id: 1, name: 'Test', created_at: '2023-01-01T00:00:00Z' })
    setCurrentProfile(null)
    expect(getCurrentProfile()).toBeNull()
  })

  // Regression: the long-standing "a profile disappears from the dropdown after switching".
  // Root cause: currentProfile was set to the SAME object instance living in the profiles
  // array (aliasing), and Solid's setState shallow-MERGES object values — so the next
  // setCurrentProfile merged the new profile's fields into the old aliased object, i.e.
  // straight into profiles[i], turning it into a duplicate that the UI's dedup then dropped.
  it('switching current profile never mutates the profiles list (aliasing regression)', () => {
    setProfiles([
      { id: 1, name: 'Example Low Income', created_at: '2023-01-01T00:00:00Z' },
      { id: 2, name: 'Example Mid Income', created_at: '2023-01-01T00:00:00Z' },
      { id: 3, name: 'Example High Income', created_at: '2023-01-01T00:00:00Z' },
    ])
    // Like App.loadProfiles(autoSelect): current profile taken from the store's own array.
    setCurrentProfile(getProfiles()[1])
    // Like App.selectProfile: switch to another profile (caller even shallow-copies).
    setCurrentProfile({ ...getProfiles()[2] })

    expect(getProfiles().map((p) => p.name)).toEqual([
      'Example Low Income',
      'Example Mid Income',
      'Example High Income',
    ])
    expect(new Set(getProfiles().map((p) => p.id)).size).toBe(3)
    expect(getCurrentProfile()?.name).toBe('Example High Income')
  })

  it('switching back and forth repeatedly keeps the list intact', () => {
    setProfiles([
      { id: 1, name: 'A', created_at: 'x' },
      { id: 2, name: 'B', created_at: 'x' },
    ])
    for (let i = 0; i < 6; i++) {
      setCurrentProfile(getProfiles()[i % 2])
    }
    expect(getProfiles().map((p) => p.name)).toEqual(['A', 'B'])
    expect(getCurrentProfile()?.name).toBe('B')
  })
})

describe('appStore - profileVersion', () => {
  it('starts at 0', () => {
    expect(getProfileVersion()).toBe(0)
  })

  it('bumpProfileVersion increments', () => {
    const before = getProfileVersion()
    bumpProfileVersion()
    expect(getProfileVersion()).toBe(before + 1)
  })

  it('multiple bumps accumulate', () => {
    const before = getProfileVersion()
    bumpProfileVersion()
    bumpProfileVersion()
    bumpProfileVersion()
    expect(getProfileVersion()).toBe(before + 3)
  })
})

describe('appStore - auth', () => {
  it('starts as false', () => {
    expect(getIsAuthenticated()).toBe(false)
  })

  it('setIsAuthenticated changes state', () => {
    setIsAuthenticated(true)
    expect(getIsAuthenticated()).toBe(true)
    setIsAuthenticated(false)
    expect(getIsAuthenticated()).toBe(false)
  })
})
