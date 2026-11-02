/**
 * "Keep my data in this browser only" says what the switch will carry on with: nothing, the demo's
 * example profiles, or profiles of the person's own. It used to say "This browser already has a
 * local workspace (from the demo, say). You carry on with that one" whenever a local database
 * existed, and then landed the person on Example Low Income's dashboard.
 *
 * What it says comes from a read of the local database made before the switch. That read must
 * change nothing: no seed, no upgrade, and no database made where there was none.
 *
 * Each case gets an IndexedDB of its own (fake-indexeddb's IDBFactory).
 */
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_PROFILE_NAMES } from '../../../core/demoMode'
import {
  classifyLocalProfiles,
  examplesChoiceNote,
  LOCAL_DATABASE,
  localOnlyQuestion,
  readLocalWorkspace,
} from '../localOnly'
import type { LocalWorkspace } from '../localOnly'

/** A local database at `version` with a profiles store holding `names`, ids from 1. */
async function localDatabase(factory: IDBFactory, names: string[], version = 13): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(LOCAL_DATABASE, version)
    open.onupgradeneeded = () => {
      const db = open.result
      const profiles = db.createObjectStore('profiles', { keyPath: 'id', autoIncrement: true })
      db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true })
      for (const name of names) profiles.add({ name, created_at: '2026-01-01' })
    }
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
    open.onerror = () => {
      reject(open.error ?? new Error('open failed'))
    }
  })
}

/** The local database as it is now: its version and its profile names. */
async function snapshot(factory: IDBFactory): Promise<{ version: number; names: string[] }> {
  return new Promise((resolve, reject) => {
    const open = factory.open(LOCAL_DATABASE)
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('profiles').objectStore('profiles').getAll()
      read.onsuccess = () => {
        db.close()
        resolve({
          version: db.version,
          names: (read.result as Array<{ name: string }>).map((p) => p.name),
        })
      }
    }
    open.onerror = () => {
      reject(open.error ?? new Error('open failed'))
    }
  })
}

describe('reading the local workspace before the switch', () => {
  it('finds nothing, and makes no database, where this browser has none', async () => {
    const factory = new IDBFactory()
    expect(await readLocalWorkspace(factory)).toEqual({ kind: 'none' })
    expect(await factory.databases()).toEqual([])
  })

  it('finds the example profiles, and leaves them, their version and every other store as they were', async () => {
    const factory = new IDBFactory()
    // An older build's database: a read that upgraded it would show here.
    await localDatabase(factory, [...EXAMPLE_PROFILE_NAMES], 9)
    expect(await readLocalWorkspace(factory)).toEqual({ kind: 'examples' })
    expect(await snapshot(factory)).toEqual({ version: 9, names: [...EXAMPLE_PROFILE_NAMES] })
  })

  it("finds the profiles of the person's own, oldest first, beside the examples", async () => {
    const factory = new IDBFactory()
    await localDatabase(factory, [...EXAMPLE_PROFILE_NAMES, 'Our flat', 'Side business'])
    expect(await readLocalWorkspace(factory)).toEqual({
      kind: 'own',
      names: ['Our flat', 'Side business'],
      // The examples are ids 1 to 3; the switch opens the app on the oldest of these.
      ids: [4, 5],
    })
  })

  it('finds nothing in a database with no profile', async () => {
    const factory = new IDBFactory()
    await localDatabase(factory, [])
    expect(await readLocalWorkspace(factory)).toEqual({ kind: 'none' })
  })

  it('says it could not tell where the browser will not list its databases', async () => {
    const factory = new IDBFactory()
    factory.databases = () => Promise.reject(new Error('not supported'))
    expect(await readLocalWorkspace(factory)).toEqual({ kind: 'unknown' })
  })

  it('makes no database when the one listed is gone by the time it is opened', async () => {
    const factory = new IDBFactory()
    const real = factory.databases.bind(factory)
    factory.databases = () => Promise.resolve([{ name: LOCAL_DATABASE, version: 13 }])
    expect(await readLocalWorkspace(factory)).toEqual({ kind: 'unknown' })
    expect(await real()).toEqual([])
  })

  it('sorts rows it cannot read as profiles out', () => {
    expect(classifyLocalProfiles([{ id: 1 }, { name: 'No id' }])).toEqual({ kind: 'none' })
  })
})

describe('what the switch asks', () => {
  it('promises a fresh start only where there is nothing', () => {
    const fresh = localOnlyQuestion({ kind: 'none' })
    expect(fresh).toBe(
      'Keep your data in this browser only? It never leaves this device and no account is needed. Settings can switch back.'
    )
  })

  it('over the examples, says setup comes next and the examples can go', () => {
    const text = localOnlyQuestion({ kind: 'examples' })
    expect(text).toContain('This browser has the example profiles from the demo.')
    expect(text).toContain(
      'Next you name a space of your own and choose whether the examples stay.'
    )
    expect(text).not.toContain('carry on')
  })

  it("over a workspace of the person's own, names what is carried on with", () => {
    expect(localOnlyQuestion({ kind: 'own', names: ['Our flat'], ids: [4] })).toBe(
      'Keep your data in this browser only? This browser already has a local workspace with your profile "Our flat". You carry on with it, and nothing syncs to the cloud. Settings can switch back.'
    )
    expect(localOnlyQuestion({ kind: 'own', names: ['A', 'B'], ids: [4, 5] })).toContain(
      'with your profiles "A" and "B".'
    )
    expect(
      localOnlyQuestion({ kind: 'own', names: ['A', 'B', 'C', 'D', 'E'], ids: [4, 5, 6, 7, 8] })
    ).toContain('with your profiles "A", "B", "C" and 2 more.')
  })

  it('where it could not tell, says only what is true either way', () => {
    const text = localOnlyQuestion({ kind: 'unknown' })
    expect(text).toContain(
      'If this browser already has a local workspace, you carry on with that one.'
    )
    expect(text).not.toContain('never leaves')
  })

  it('no question uses an em dash', () => {
    const cases: LocalWorkspace[] = [
      { kind: 'none' },
      { kind: 'examples' },
      { kind: 'own', names: ['A'], ids: [4] },
      { kind: 'unknown' },
    ]
    for (const found of cases) {
      expect(localOnlyQuestion(found)).not.toMatch(/—/)
    }
  })
})

describe('the choice over the examples', () => {
  it('says what goes, and what stays', () => {
    expect(examplesChoiceNote('remove', [...EXAMPLE_PROFILE_NAMES])).toBe(
      'Deletes Example Low Income, Example Mid Income and Example High Income and everything in them: accounts, transactions, bills and budgets.'
    )
    expect(examplesChoiceNote('keep', [...EXAMPLE_PROFILE_NAMES])).toBe(
      'They stay in the profile switcher, beside your new space.'
    )
    expect(examplesChoiceNote('remove', ['Example Mid Income'])).toContain('everything in it:')
  })
})
