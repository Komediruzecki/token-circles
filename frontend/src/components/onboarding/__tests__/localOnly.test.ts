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
  accountHoldsData,
  classifyLocalProfiles,
  examplesChoiceNote,
  LOCAL_DATABASE,
  localOnlyQuestion,
  readLocalWorkspace,
  stopFirstWeekMails,
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
  /** The confirm as it reads: the title, then each line. */
  const said = (found: LocalWorkspace, empty: boolean) => {
    const { title, lines } = localOnlyQuestion(found, empty)
    return [title, ...lines].join(' ')
  }
  const ALL: LocalWorkspace[] = [
    { kind: 'none' },
    { kind: 'examples' },
    { kind: 'own', names: ['A'], ids: [4] },
    { kind: 'unknown' },
  ]

  // Asked of a signed-in account (3 Nov review A3): the account stays, and the switch turns its
  // first-week mails off first, so the question says so. It used to say "no account is needed".
  // On a phone it was one six-line paragraph (review D5): the question is now the dialog's
  // heading, and two short lines say the rest.
  it('asks in a heading, and says in two short lines what happens, over nothing', () => {
    expect(localOnlyQuestion({ kind: 'none' }, true)).toEqual({
      title: 'Keep your data in this browser only?',
      lines: [
        'Nothing syncs to the cloud, and Settings can switch back.',
        'Your account stays empty and sends no first-week mails.',
      ],
    })
  })

  it('keeps every line short, and the title the same, whatever the browser holds', () => {
    for (const found of ALL) {
      for (const empty of [true, false]) {
        const { title, lines } = localOnlyQuestion(found, empty)
        expect(title, found.kind).toBe('Keep your data in this browser only?')
        expect(lines.length, found.kind).toBeLessThanOrEqual(3)
        for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(120)
      }
    }
  })

  it('calls the account empty only when it is, and says it stays as it is otherwise', () => {
    for (const found of ALL) {
      const fresh = said(found, true)
      expect(fresh, found.kind).toContain(
        ' Nothing syncs to the cloud, and Settings can switch back. Your account stays empty and sends no first-week mails.'
      )
      const kept = said(found, false)
      expect(kept, found.kind).toContain(
        ' Nothing syncs to the cloud, and Settings can switch back. Your account stays as it is and sends no first-week mails.'
      )
      expect(kept, found.kind).not.toContain('empty')
      for (const text of [fresh, kept]) {
        expect(text, found.kind).not.toContain('no account is needed')
        expect(text, found.kind).not.toContain('never leaves')
      }
    }
  })

  it('over the examples, says setup comes next and the examples can go', () => {
    const { lines } = localOnlyQuestion({ kind: 'examples' }, true)
    expect(lines[0]).toBe(
      "This browser has the demo's example profiles. Next you name a space of your own and choose whether they stay."
    )
    expect(lines.join(' ')).not.toContain('carry on')
  })

  it("over a workspace of the person's own, names what is carried on with", () => {
    expect(localOnlyQuestion({ kind: 'own', names: ['Our flat'], ids: [4] }, true).lines[0]).toBe(
      'This browser already has a local workspace with your profile "Our flat". You carry on with it.'
    )
    expect(said({ kind: 'own', names: ['A', 'B'], ids: [4, 5] }, true)).toContain(
      'with your profiles "A" and "B".'
    )
    expect(
      said({ kind: 'own', names: ['A', 'B', 'C', 'D', 'E'], ids: [4, 5, 6, 7, 8] }, true)
    ).toContain('with your profiles "A", "B", "C" and 2 more.')
  })

  it('where it could not tell, says only what is true either way', () => {
    expect(localOnlyQuestion({ kind: 'unknown' }, true).lines[0]).toBe(
      'If this browser already has a local workspace, you carry on with that one.'
    )
  })

  it('no question uses an em dash', () => {
    for (const found of ALL) {
      for (const empty of [true, false]) {
        expect(said(found, empty)).not.toMatch(/—/)
      }
    }
  })
})

// The switch leaves a signed-in account's data on the Worker and opens a local workspace that
// shows none of it, so setup offers it only over an account that holds nothing (3 Nov, round 2).
describe('whether the account holds anything the switch would leave behind', () => {
  const empty = { transaction_count: 0, account_count: 0, budget_count: 0 }

  it('holds nothing with every profile empty, or no profile listed', () => {
    expect(accountHoldsData([empty])).toBe(false)
    expect(accountHoldsData([empty, { ...empty }])).toBe(false)
    expect(accountHoldsData([])).toBe(false)
    expect(accountHoldsData([{}])).toBe(false)
  })

  it('holds data with an account, a transaction or a budget in any profile', () => {
    expect(accountHoldsData([{ ...empty, account_count: 1 }])).toBe(true)
    expect(accountHoldsData([{ ...empty, transaction_count: 3 }])).toBe(true)
    expect(accountHoldsData([{ ...empty, budget_count: 1 }])).toBe(true)
    expect(accountHoldsData([empty, { ...empty, transaction_count: 40 }])).toBe(true)
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

describe('turning the first-week mails off before the switch', () => {
  const ok = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }))

  it("sends the account's switch off, and says whether the Worker took it", async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = []
    const answered = await stopFirstWeekMails((url, init) => {
      sent.push({ url, init })
      return ok()
    })
    expect(answered).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('/api/notifications/settings')
    expect(sent[0].init?.method).toBe('PUT')
    expect(JSON.parse(sent[0].init?.body as string)).toEqual({ weekOneMails: false })
  })

  it('answers false, and never throws, when the request fails or is refused', async () => {
    expect(await stopFirstWeekMails(() => Promise.reject(new TypeError('Failed to fetch')))).toBe(
      false
    )
    expect(
      await stopFirstWeekMails(() => Promise.resolve(new Response('{}', { status: 500 })))
    ).toBe(false)
  })

  it('stops waiting for an answer that does not come', async () => {
    let aborted = false
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    const started = Date.now()
    expect(await stopFirstWeekMails(hanging, 30)).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(aborted).toBe(true)
  })
})
