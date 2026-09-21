/**
 * "Which profiles does a read cover" must be decided in exactly one place.
 *
 * WHY THIS GUARD EXISTS. `X-Profile-Id` says which profile a write lands in; the household set
 * says which profiles a read covers. When they disagree, everything the user creates is filed
 * where no read looks — the row exists (a duplicate name is still rejected) but appears nowhere,
 * and a browser reload cannot help because both values are persisted in localStorage.
 *
 * The invariant (the active profile is always covered) lives in `householdProfileIds`. It only
 * protects callers that go through it, and the logic had been copied four times:
 *
 *   - `Settings.tsx` built the headers by hand for analytics distinct-years
 *   - `clientPdfReports.ts` built them by hand for client-side PDFs
 *   - `IndexedDBAdapter.getCurrentProfileIds` reimplemented it for local-first mode, where it
 *     backs ~30 handlers — the whole serverless read path
 *
 * Each reproduced the bug independently of the fix. This test fails if a fifth copy appears.
 *
 * NOT flagged: building an `X-Profile-Ids` header from a set you were handed — the account's full
 * profile list for a backup export, or an explicit user selection where `X-Profile-Id` is taken
 * from that same set. Those are self-consistent by construction; the bug is specifically reading
 * the *stored selection* to scope a request whose write profile comes from somewhere else.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const SELECTION_KEY = "getItem('selectedProfileIds')"

/** The one module allowed to turn the stored selection into a request scope. */
const OWNER = join('core', 'apiProfileScope.ts')

/**
 * Files that read the stored selection for something other than scoping a read: populating the
 * checkbox UI, or rewriting the key when a profile is created or deleted. These decide what the
 * user sees in a control or repair the stored value; they do not decide what a query returns.
 */
const NOT_SCOPING_A_READ = [
  join('App.tsx'), // getSelectedProfileIds — populates the dropdown's checkboxes
  join('features', 'Settings.tsx'), // the household checkbox list
  join('core', 'storage', 'handlers', 'profiles.ts'), // prunes the key when a profile is deleted
]

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      sourceFiles(full, acc)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) acc.push(full)
  }
  return acc
}

describe('the household read scope has a single source', () => {
  it('no new file reads the stored selection to scope a read', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith(OWNER))
      .filter((file) => {
        const rel = file.slice(SRC.length + 1)
        if (NOT_SCOPING_A_READ.some((allowed) => rel === allowed)) return false
        return readFileSync(file, 'utf8').includes(SELECTION_KEY)
      })
      .map((file) => file.slice(SRC.length + 1))

    expect(offenders).toEqual([])
  })

  it('the local-first adapter shares the implementation rather than copying it', () => {
    // idb.ts backs the entire serverless read path through ~30 handlers. A private reimplementation
    // there means server mode and local mode can disagree about what the household is — and it did.
    const idb = readFileSync(join(SRC, 'core', 'storage', 'idb.ts'), 'utf8')

    expect(idb).toContain('householdProfileIds')
    expect(idb).not.toContain(SELECTION_KEY)
  })

  it('the guard can actually detect a copy', () => {
    // A self-test, so a probe string that silently stops matching cannot make this suite pass by
    // finding nothing anywhere.
    expect(`const stored = localStorage.getItem('selectedProfileIds')`).toContain(SELECTION_KEY)
    expect(`const ids = householdProfileIds()`).not.toContain(SELECTION_KEY)
  })
})
