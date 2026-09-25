/**
 * dataVersions — one version counter per entity, bumped automatically by every successful
 * mutation, in both storage modes.
 *
 * WHY THIS EXISTS. Since keep-alive page mounting (#317) every visited page stays mounted and
 * keeps the copy of the data it fetched on first mount. Nothing told a mounted page that another
 * page had changed that data, so the app grew one counter per reported bug: `profileVersion` for
 * profile switches, then `tagsVersion` after a tag created on the Tags page left the bulk-tag
 * modal on Transactions saying "No tags yet". Every entity that never got a bug report never got
 * a counter — which is why a category created on the Categories page still does not reach the
 * Transactions page's add-transaction form without a browser reload.
 *
 * The pattern was right; doing it by hand, once per incident, was the problem. This generalises
 * it: a counter per entity, created on demand, and bumped from ONE place — `apiFetch`, the single
 * function every API call in the app passes through (typed client, raw helpers, cloud and local
 * alike). A new POST route therefore invalidates its readers without the person who wrote it
 * knowing this file exists, and it behaves identically in serverless mode because the local
 * router sits behind the same choke point.
 *
 * Consumers read `entityVersion('categories')` inside the reactive tracking function they already
 * pass to `refetchOnActive` / `gatedSource` (core/pageVisibility.ts), so a hidden page still
 * defers its refetch until it is shown. This file adds the missing edge to the reactive graph; it
 * does not change when anyone acts on it.
 *
 * NOT a cache. Reads still go to the network/IndexedDB every time, exactly as before. Request
 * de-duplication and scope-keyed caching are the next step, and they attach at the same seam.
 */
import { batch, createSignal } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'

/**
 * Entity names are the first path segment of the API route that owns them, so the mapping from a
 * mutated URL to the entity it invalidates needs no table.
 *
 * This union is the canonical list, for reference and for a call site that wants the name checked
 * (`const tag: EntityTag = 'categories'`). The functions below take a plain `string` on purpose:
 * `tagsForPath` derives names from whatever URL it is handed, so a route added next week
 * invalidates its readers without anyone editing this file.
 */
export type EntityTag =
  | 'accounts'
  | 'analytics'
  | 'bills'
  | 'budgets'
  | 'categories'
  | 'counterparties'
  | 'dashboard'
  | 'housing'
  | 'import'
  | 'loans'
  | 'portfolio'
  | 'profiles'
  | 'recurring'
  | 'reports'
  | 'retirement'
  | 'retirement-goals'
  | 'savings-goals'
  | 'settings'
  | 'tags'
  | 'transactions'

const slots = new Map<string, [Accessor<number>, Setter<number>]>()

function slot(tag: string): [Accessor<number>, Setter<number>] {
  let existing = slots.get(tag)
  if (!existing) {
    // Module-level signal, deliberately outside any root: these outlive every component, the same
    // way appStore's store does. They are never disposed, and there is one per entity, so there is
    // nothing to leak.
    existing = createSignal(0) as [Accessor<number>, Setter<number>]
    slots.set(tag, existing)
  }
  return existing
}

/**
 * Reactive read. Call inside a tracking scope — typically the `track` argument of
 * `refetchOnActive`, or the source of a `gatedSource` — to refetch when this entity changes.
 */
export function entityVersion(tag: string): number {
  return slot(tag)[0]()
}

/** Bump one entity's counter. Called by `apiFetch`; call it directly only from a test. */
export function invalidateEntity(tag: string): void {
  slot(tag)[1]((n) => n + 1)
}

/**
 * Writes that change more than the entity in their own URL.
 *
 * A transaction write moves every derived view: the dashboard's totals, the analytics charts, the
 * spent-per-budget figures, the reports. Those are separate endpoints, so nothing in the path
 * would otherwise tell their readers to refetch — this is the table that says so. Keep it small
 * and keep it honest: an entry here costs a refetch on every write to the source entity.
 *
 * Entries are followed transitively, so list only the direct effect. A write that creates
 * transactions says `transactions` and inherits everything a transaction write moves; copying the
 * transaction entry by hand is how marking a bill paid came to skip the budgets and the reports.
 */
const ALSO_INVALIDATES: Record<string, readonly string[]> = {
  transactions: ['dashboard', 'analytics', 'budgets', 'reports', 'accounts'],
  // Recurring rows materialise into transactions.
  recurring: ['transactions'],
  // Marking a bill paid writes a transaction, and the dashboard lists the upcoming bills.
  bills: ['transactions', 'dashboard'],
  // Renaming or deleting a category re-labels transactions and re-buckets every derived view.
  categories: ['dashboard', 'analytics', 'budgets', 'reports'],
  // Budget allocation changes what the dashboard's budget card reports.
  budgets: ['dashboard'],
  // Imports create transactions in bulk, and may create accounts and categories on the way. The
  // routes are `/api/import/*`, singular: keyed `imports`, this entry matched no URL at all.
  import: ['transactions', 'accounts', 'categories'],
}

/**
 * Writes that move another entity where the rest of their own entity's writes do not, so the
 * per-entity table above cannot carry them. Undoing an import — the DELETE on its log — deletes
 * the transactions it created and recomputes the balances; recording a log, the POST every import
 * ends with, touches only the log.
 */
const WRITES_THAT_ALSO_MOVE: readonly { path: RegExp; moves: string }[] = [
  { path: /^\/api\/import-logs\/[^/?]+/, moves: 'transactions' },
]

/**
 * Lookups that are sent as POST because they take a body. They change nothing on the server, so
 * a successful one invalidates nothing — and it must not: each is called from a page that follows
 * the entity its URL names, so counting a price quote as a portfolio write reloaded the holdings
 * after every quote refresh. `/api/import/execute` is the import route that writes; the upload
 * and sheet routes only parse a file for the preview.
 */
const READS_SENT_AS_POST: readonly RegExp[] = [
  /^\/api\/portfolio\/prices(?:[/?]|$)/,
  /^\/api\/loans\/[^/?]+\/calculate(?:[/?]|$)/,
  /^\/api\/tags\/rules\/preview(?:[/?]|$)/,
  /^\/api\/import\/(?:upload|googlesheet)(?:[/?]|$)/,
]

/**
 * Map an app-API path to the entity names a successful write to it invalidates.
 *
 * `/api/categories`, `/api/categories/5`, `/api/categories/5/merge` and `/api/categories?x=1` all
 * resolve to `categories`. Anything that is not an `/api/<name>` path resolves to nothing, so an
 * unexpected URL is inert rather than invalidating the world. The path's own entity comes first,
 * and each name appears once however many routes through the table reach it.
 */
export function tagsForPath(path: string): string[] {
  if (READS_SENT_AS_POST.some((read) => read.test(path))) return []
  const match = /^\/api\/([a-zA-Z][a-zA-Z0-9-]*)/.exec(path)
  if (!match) return []
  const tags: string[] = []
  const reach = (tag: string) => {
    if (tags.includes(tag)) return
    tags.push(tag)
    for (const next of ALSO_INVALIDATES[tag] ?? []) reach(next)
  }
  reach(match[1])
  for (const write of WRITES_THAT_ALSO_MOVE) if (write.path.test(path)) reach(write.moves)
  return tags
}

/**
 * The single hook `apiFetch` calls after every request it completes.
 *
 * Only a successful non-GET invalidates: a GET changes nothing, and a rejected write (a 400 from
 * a validation guard, a 401 from an expired session) left the server's state alone, so refetching
 * would be pure waste. HEAD and OPTIONS are treated as reads for the same reason.
 */
export function invalidateForRequest(path: string, method: string | undefined, ok: boolean): void {
  if (!ok) return
  const verb = (method ?? 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return
  // One write is one reactive update, however many counters it bumps. A category write bumps
  // `categories` and `budgets` together; a page that tracks both would otherwise see two separate
  // changes and refetch everything twice for one save.
  batch(() => {
    for (const tag of tagsForPath(path)) invalidateEntity(tag)
  })
}

/**
 * Bump every counter that something is actually tracking.
 *
 * Used by resume revalidation (core/dataRevalidation.ts) when the app comes back from the
 * background: at that point any entity could have been changed by another device, another tab or
 * the scheduled importer, and the client has no way to know which. Bumping all of them is correct
 * rather than wasteful — a slot exists only because a consumer called `entityVersion` for it, and
 * `pageVisibility` defers every hidden page, so this costs one refetch on the visible page and
 * nothing at all until the others are next shown.
 */
export function invalidateAllEntities(): void {
  // One update for all of them: Budgets tracks both `categories` and `budgets`, and would
  // otherwise refetch once per counter on every resume.
  batch(() => {
    for (const [, setVersion] of slots.values()) setVersion((n) => n + 1)
  })
}

/** The entity names currently being tracked. Test and diagnostic use. */
export function trackedEntities(): string[] {
  return [...slots.keys()]
}

/** Test-only: forget every counter so one test's bumps cannot leak into the next. */
export function __resetDataVersionsForTest(): void {
  slots.clear()
}
