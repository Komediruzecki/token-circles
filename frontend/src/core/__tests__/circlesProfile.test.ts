/**
 * The circles are worked out for the active profile, while the Dashboard around the savings gauge
 * and Your next step adds up every profile selected. With more than one selected, the two cards
 * name the profile they are about (review A6, fix A17).
 */
import { describe, expect, it } from 'vitest'
import { circlesProfileName } from '../circlesProfile'

const PROFILES = [
  { id: 1, name: 'Personal Profile' },
  { id: 2, name: 'Holiday house' },
  { id: 3, name: 'Side business' },
]

describe('the profile the circles name on the Dashboard', () => {
  it('is not named while the Dashboard shows that profile alone', () => {
    expect(circlesProfileName(2, [2], PROFILES)).toBeNull()
  })

  it('is named while the Dashboard adds up more than one profile', () => {
    expect(circlesProfileName(2, [2, 3], PROFILES)).toBe('Holiday house')
    expect(circlesProfileName(1, [1, 2, 3], PROFILES)).toBe('Personal Profile')
  })

  it('counts a profile listed twice once', () => {
    expect(circlesProfileName(2, [2, 2], PROFILES)).toBeNull()
  })

  it('names nothing for a profile it cannot find, or one without a name', () => {
    expect(circlesProfileName(9, [9, 2], PROFILES)).toBeNull()
    expect(circlesProfileName(4, [4, 2], [...PROFILES, { id: 4, name: '  ' }])).toBeNull()
  })
})
