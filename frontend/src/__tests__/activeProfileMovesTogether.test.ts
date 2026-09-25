/**
 * In App.tsx, moving where writes land and moving the profile the sidebar shows happen together.
 *
 * WHY THIS GUARD EXISTS. `currentProfileId` in localStorage decides where a write lands
 * (X-Profile-Id). `setCurrentProfile` decides which profile the sidebar shows as active, and
 * Settings > Household locks that same profile's box. Writing one without the other files new rows
 * under a profile the user is not looking at — the split-brain behind "I created it, it said
 * success, and it is nowhere" (#575).
 *
 * #575 fixed the dropdown's toggle. Closing the same dropdown by clicking outside it kept its own
 * copy of the code and still wrote only the storage key. Picking a profile, closing the dropdown
 * and clicking outside it now all go through one function; this test fails if any write of the key
 * in App.tsx is not followed by `setCurrentProfile`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..', 'App.tsx')

/** How far after the storage write the matching `setCurrentProfile` may appear. */
const WINDOW_LINES = 4

/** 1-based lines that write `currentProfileId` with no `setCurrentProfile` shortly after. */
export function unpairedWrites(source: string): number[] {
  const lines = source.split('\n')
  const offenders: number[] = []
  lines.forEach((line, i) => {
    if (!line.includes("setItem('currentProfileId'")) return
    const after = lines.slice(i, i + 1 + WINDOW_LINES).join('\n')
    if (!after.includes('setCurrentProfile(')) offenders.push(i + 1)
  })
  return offenders
}

describe('App.tsx moves the write target and the shown profile together', () => {
  it('every write of currentProfileId is followed by setCurrentProfile', () => {
    expect(unpairedWrites(readFileSync(APP, 'utf8'))).toEqual([])
  })

  it('the guard can actually detect the click-outside shape that shipped', () => {
    // A self-test, so a probe string that silently stops matching cannot make this pass by
    // finding nothing anywhere. `shipped` is the click-outside handler before this fix.
    const shipped = `
          const ids = selectedProfileIds()
          localStorage.setItem('selectedProfileIds', JSON.stringify(ids))
          if (ids.length > 0) {
            localStorage.setItem('currentProfileId', ids[0].toString())
          }
          setShowDropdown(false)
          bumpProfileVersion()
          // State is updated via bumpProfileVersion()`
    const fixed = `
      localStorage.setItem('currentProfileId', ids[0].toString())
      const active = profiles().find((p) => p.id === ids[0])
      if (active) setCurrentProfile({ ...active })`

    expect(unpairedWrites(shipped)).toEqual([5])
    expect(unpairedWrites(fixed)).toEqual([])
  })
})
