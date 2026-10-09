/**
 * The profile rules both runtimes run (shared/profileSchema.ts). The route and handler tests prove
 * each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  checkProfileCreate,
  checkProfileRename,
  clashingProfileName,
  distinctProfileNames,
  PROFILE_MESSAGES,
  PROFILE_NAME_MAX,
  profileNameTaken,
  renamesProfile,
  sameProfileName,
} from '../../../../shared/profileSchema'
import { refusalOf } from '../../../../shared/refusal'

const LONG = 'Holiday house '.repeat(10).trim()

describe('a new profile', () => {
  it('is its name, trimmed, and nothing else', () => {
    expect(checkProfileCreate({ name: '  Holiday house ', id: 9, user_id: 3 })).toEqual({
      ok: true,
      value: { name: 'Holiday house' },
    })
  })

  it('needs a name', () => {
    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: null },
      { name: 42 },
      null,
      [],
    ]) {
      expect(checkProfileCreate(body)).toEqual({
        ok: false,
        fields: { name: 'Give the profile a name.' },
      })
    }
  })

  it('takes a name of up to 100 characters, and refuses a longer one', () => {
    expect(checkProfileCreate({ name: 'x'.repeat(PROFILE_NAME_MAX) }).ok).toBe(true)
    expect(checkProfileCreate({ name: ` ${'x'.repeat(PROFILE_NAME_MAX)} ` }).ok).toBe(true)
    expect(checkProfileCreate({ name: 'x'.repeat(PROFILE_NAME_MAX + 1) })).toEqual({
      ok: false,
      fields: { name: 'Keep the name to 100 characters or fewer.' },
    })
  })

  it('answers the refusal both runtimes send', () => {
    const checked = checkProfileCreate({ name: ' ' })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields)).toEqual({
      error: 'Give the profile a name.',
      fields: { name: 'Give the profile a name.' },
    })
  })
})

describe('a rename', () => {
  it('checks a new name like a new profile', () => {
    expect(checkProfileRename({ name: ' Beach house ' }, { name: 'Holiday house' })).toEqual({
      ok: true,
      value: { name: 'Beach house' },
    })
    expect(checkProfileRename({ name: '' }, { name: 'Holiday house' })).toEqual({
      ok: false,
      fields: { name: PROFILE_MESSAGES.name },
    })
    expect(checkProfileRename({ name: 'x'.repeat(101) }, { name: 'Holiday house' })).toEqual({
      ok: false,
      fields: { name: PROFILE_MESSAGES.nameLength },
    })
  })

  it('needs a name, since a rename is its name', () => {
    expect(checkProfileRename({}, { name: 'Holiday house' })).toEqual({
      ok: false,
      fields: { name: PROFILE_MESSAGES.name },
    })
  })

  it('saves a name stored under older rules when it comes back unchanged, or only re-cased', () => {
    expect(checkProfileRename({ name: LONG }, { name: LONG })).toEqual({
      ok: true,
      value: { name: LONG },
    })
    expect(checkProfileRename({ name: LONG.toUpperCase() }, { name: `${LONG} ` })).toEqual({
      ok: true,
      value: { name: LONG.toUpperCase() },
    })
    // A real change to it is a new name, and the rules apply.
    expect(checkProfileRename({ name: `${LONG} 2` }, { name: LONG })).toEqual({
      ok: false,
      fields: { name: PROFILE_MESSAGES.nameLength },
    })
  })
})

describe('names that are the same', () => {
  it('ignore case and the space around them', () => {
    expect(sameProfileName('Holiday', ' holiday ')).toBe(true)
    expect(sameProfileName('Holiday', 'Holidays')).toBe(false)
    expect(renamesProfile('Holiday', 'HOLIDAY ')).toBe(false)
    expect(renamesProfile('Holiday', 'Beach')).toBe(true)
    expect(renamesProfile(undefined, 'Beach')).toBe(true)
  })

  it('find the profile that holds a name, leaving out the one being renamed', () => {
    const profiles = [
      { id: 1, name: 'Me' },
      { id: 2, name: 'Partner' },
      { id: 3, name: 'me' },
    ]
    expect(clashingProfileName(profiles, ' PARTNER ')).toBe('Partner')
    expect(clashingProfileName(profiles, 'Partner', 2)).toBeNull()
    expect(clashingProfileName(profiles, 'Holiday')).toBeNull()
    // Re-casing a twin clashes only with a profile of exactly that name.
    expect(clashingProfileName(profiles, 'Me', 3, true)).toBe('Me')
    expect(clashingProfileName(profiles, 'ME', 3, true)).toBeNull()
  })

  it('are refused in words that quote the name already there', () => {
    expect(profileNameTaken('Partner ')).toEqual({
      name: 'You already have a profile called "Partner". Choose another name.',
    })
  })
})

describe('the other words', () => {
  it('say how to keep a profile and what is missing', () => {
    expect(PROFILE_MESSAGES.onlyProfile).toBe(
      'This is your only profile. Create another one before you delete this one.'
    )
    expect(PROFILE_MESSAGES.notFound).toBe('Profile not found')
  })
})

describe('the names a restore gives the profiles in a backup', () => {
  it('keeps names that differ by more than case', () => {
    expect(distinctProfileNames(['Me', 'Partner', 'Side business'])).toEqual([
      'Me',
      'Partner',
      'Side business',
    ])
  })

  it('numbers a later name that differs only in case, past any number the file holds', () => {
    expect(distinctProfileNames(['Me', 'ME', 'Me (2)', ' me '])).toEqual([
      'Me',
      'ME (3)',
      'Me (2)',
      'me (4)',
    ])
  })

  it('leaves a blank name blank, for the restore to refuse', () => {
    expect(distinctProfileNames(['', 'Me', '  '])).toEqual(['', 'Me', '  '])
  })
})
