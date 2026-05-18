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
    { id: 1, name: 'Demo', starting_balance: 0 },
    { id: 2, name: 'Personal', starting_balance: 100 },
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
      { id: 1, name: 'Renamed Demo', starting_balance: 0 },
      { id: 2, name: 'Renamed Personal', starting_balance: 100 },
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
    setProfiles([{ id: 1, name: 'Demo', starting_balance: 0 }])
    expect(getProfiles().length).toBe(1)
    expect(getProfiles()[0].id).toBe(1)
  })

  it('replaces with more items (grows array)', () => {
    setProfiles(sample)
    expect(getProfiles().length).toBe(2)
    setProfiles([
      { id: 1, name: 'Demo', starting_balance: 0 },
      { id: 2, name: 'Personal', starting_balance: 100 },
      { id: 3, name: 'Work', starting_balance: 500 },
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
    const profile = { id: 1, name: 'Test', starting_balance: 50 }
    setCurrentProfile(profile)
    expect(getCurrentProfile()).toEqual(profile)
  })

  it('setCurrentProfile(null) clears it', () => {
    setCurrentProfile({ id: 1, name: 'Test', starting_balance: 50 })
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
