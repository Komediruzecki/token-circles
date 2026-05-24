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
