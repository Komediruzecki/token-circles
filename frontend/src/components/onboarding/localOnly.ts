/**
 * "Keep my data in this browser only", on the setup wizard's first screen of a signed-in account.
 *
 * The switch reloads into this browser's local workspace, which may already hold something: the
 * demo's example profiles, or profiles the person made on an earlier visit. What the confirm says
 * depends on which, so the workspace is read before the switch (readLocalWorkspace). The read
 * opens the local database as it is, at whatever version it has, reads the profile names and
 * closes it: it never seeds the examples, upgrades the database, or creates one that was not there.
 *
 * Over the examples, setup opens on the space step after the reload (onboardingStore.ts,
 * LOCAL_SETUP_PENDING_KEY), where the person names a space of their own and chooses whether the
 * examples stay (examplesChoiceNote).
 */
import { isExampleProfileName } from '../../core/demoMode'

/** The local database, as core/storage/idb.ts names it. */
export const LOCAL_DATABASE = 'finance-manager'

/** What this browser's local workspace holds, as far as the switch needs to know. */
export type LocalWorkspace =
  /** It could not be read: the browser lists no databases, or the read failed. */
  | { kind: 'unknown' }
  /** No local database, or one with no profile in it. */
  | { kind: 'none' }
  /** Only the demo's example profiles. */
  | { kind: 'examples' }
  /**
   * At least one profile of the person's own: their names and ids, oldest first. The switch opens
   * the app on the first id, not on an example beside it.
   */
  | { kind: 'own'; names: string[]; ids: number[] }

interface StoredProfile {
  id?: unknown
  name?: unknown
}

/** Sort the stored profiles into what the switch needs to know. */
export function classifyLocalProfiles(rows: readonly StoredProfile[]): LocalWorkspace {
  const named = rows
    .filter((p): p is { id: number; name: string } => typeof p.name === 'string')
    .filter((p) => typeof p.id === 'number')
    .sort((a, b) => a.id - b.id)
  if (named.length === 0) return { kind: 'none' }
  const own = named.filter((p) => !isExampleProfileName(p.name))
  if (own.length === 0) return { kind: 'examples' }
  return { kind: 'own', names: own.map((p) => p.name), ids: own.map((p) => p.id) }
}

/** Read the profiles of this browser's local workspace without changing anything in it. */
export async function readLocalWorkspace(
  factory: IDBFactory = window.indexedDB
): Promise<LocalWorkspace> {
  let listed: IDBDatabaseInfo[]
  try {
    listed = await factory.databases()
  } catch {
    return { kind: 'unknown' }
  }
  if (!listed.some((d) => d.name === LOCAL_DATABASE)) return { kind: 'none' }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      // No version: the database opens as it is, and no upgrade runs.
      request = factory.open(LOCAL_DATABASE)
    } catch {
      resolve({ kind: 'unknown' })
      return
    }
    // Only a database that is not there asks for an upgrade here: it went between the listing and
    // the open. Opening it would create an empty one, so the creation is called off.
    request.onupgradeneeded = () => {
      request.transaction?.abort()
    }
    request.onerror = () => {
      resolve({ kind: 'unknown' })
    }
    request.onsuccess = () => {
      const db = request.result
      const done = (found: LocalWorkspace) => {
        db.close()
        resolve(found)
      }
      try {
        if (!db.objectStoreNames.contains('profiles')) {
          done({ kind: 'none' })
          return
        }
        const read = db.transaction('profiles', 'readonly').objectStore('profiles').getAll()
        read.onsuccess = () => {
          done(classifyLocalProfiles(read.result as StoredProfile[]))
        }
        read.onerror = () => {
          done({ kind: 'unknown' })
        }
      } catch {
        done({ kind: 'unknown' })
      }
    }
  })
}

const quoted = (name: string) => `"${name}"`

/** "a", "a and b", "a, b and c". */
function joined(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The profiles of the person's own, named: three at most, then how many more. */
function ownProfiles(names: readonly string[]): string {
  if (names.length === 1) return `your profile ${quoted(names[0])}`
  if (names.length <= 3) return `your profiles ${joined(names.map(quoted))}`
  const more = names.length - 3
  return `your profiles ${names.slice(0, 3).map(quoted).join(', ')} and ${String(more)} more`
}

/** What the switch asks, for what this browser's local workspace holds. */
export function localOnlyQuestion(found: LocalWorkspace): string {
  switch (found.kind) {
    case 'none':
      return 'Keep your data in this browser only? It never leaves this device and no account is needed. Settings can switch back.'
    case 'examples':
      return 'Keep your data in this browser only? This browser has the example profiles from the demo. Next you name a space of your own and choose whether the examples stay. Nothing syncs to the cloud, and Settings can switch back.'
    case 'own':
      return `Keep your data in this browser only? This browser already has a local workspace with ${ownProfiles(found.names)}. You carry on with it, and nothing syncs to the cloud. Settings can switch back.`
    default:
      return 'Keep your data in this browser only? It stays on this device and nothing syncs to the cloud. If this browser already has a local workspace, you carry on with that one. Settings can switch back.'
  }
}

/** The legend of the choice on the space step, over the example profiles. */
export const EXAMPLES_CHOICE_LEGEND = 'The example profiles'

/** What each answer to the choice does, said under it. */
export function examplesChoiceNote(choice: 'remove' | 'keep', names: readonly string[]): string {
  const them = names.length === 1 ? 'it' : 'them'
  return choice === 'remove'
    ? `Deletes ${joined(names)} and everything in ${them}: accounts, transactions, bills and budgets.`
    : `${names.length === 1 ? 'It stays' : 'They stay'} in the profile switcher, beside your new space.`
}

/** Said when the space is saved and an example profile could not be removed. */
export const EXAMPLES_NOT_REMOVED =
  'Your space is saved, but the example profiles are still here. Remove them in Settings, under Exports, in the Danger Zone.'
