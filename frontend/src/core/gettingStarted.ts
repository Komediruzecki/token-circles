/**
 * The Getting started card's record: whether this account has the card, and whether it is hidden.
 *
 * Signed in, the record is the account's (`getting_started` in /api/account/state, accountState.ts),
 * so hiding the card hides it on every device. Local-first keeps it in this browser, under
 * `finance_getting_started:local`, and never calls the route.
 *
 * The record is made when the setup wizard is finished or skipped for the first time
 * (onboardingStore.ts). An account that decided before the card existed has none, and sees no card.
 */
import { createRoot, createSignal } from 'solid-js'
import { readGettingStartedRecord, UNREADABLE } from '../../../shared/accountState'
import {
  accountState,
  accountStateOwner,
  isServerAccount,
  readAccountState,
  writeAccountState,
} from './accountState'
import { LOCAL_ONBOARDING_OWNER } from './onboardingFlag'
import type { GettingStartedRecord } from '../../../shared/accountStateKeys'

/** Where local-first keeps the record. */
export const LOCAL_GETTING_STARTED_KEY = 'finance_getting_started:local'

/** Local-first's record as last written here; undefined until something is written. */
const local = createRoot(() => {
  const [record, setRecord] = createSignal<GettingStartedRecord | null | undefined>(undefined)
  return { record, setRecord }
})

function readLocal(): GettingStartedRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_GETTING_STARTED_KEY)
    return raw === null ? null : readGettingStartedRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeLocal(record: GettingStartedRecord): void {
  try {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify(record))
  } catch {
    // Non-fatal: the card shows for this session only.
  }
  local.setRecord(record)
}

/** The current owner's record, or null when there is none or it is not known. Reactive. */
export function gettingStartedRecord(): GettingStartedRecord | null {
  const of = accountStateOwner()
  if (isServerAccount(of)) {
    const card = accountState()?.getting_started ?? null
    return card === UNREADABLE ? null : card
  }
  if (of !== LOCAL_ONBOARDING_OWNER) return null
  const written = local.record()
  return written === undefined ? readLocal() : written
}

/** Signed in, read the account's state if it has not been read yet (one request per account). */
export function loadGettingStarted(): Promise<unknown> {
  return readAccountState()
}

let writing: Promise<unknown> = Promise.resolve()

/** Resolves once the last write of the record has settled (tests await this). */
export function gettingStartedSettled(): Promise<unknown> {
  return writing
}

/**
 * Make the record, with the card shown, for `of` when it has none: on the wizard's first finish or
 * skip. Signed in, only when the account's state is known and holds no record (an unreadable one is
 * not none), so a card hidden on another device is never shown again on the strength of a read that
 * failed; and the Worker keeps a hidden card hidden, for a copy read before another device hid it
 * (shared/accountState.ts).
 */
export function beginGettingStarted(of: string | null): void {
  if (isServerAccount(of)) {
    const state = accountState()
    if (state === null || state.getting_started !== null) return
    writing = writeAccountState('getting_started', { hidden: false }).catch(() => {
      // No card this time; nothing else depends on it.
    })
    return
  }
  if (of === LOCAL_ONBOARDING_OWNER && readLocal() === null) writeLocal({ hidden: false })
}

/**
 * Hide the card for good: for the account on every device, or in this browser. Nothing is sent
 * over a record this build cannot read.
 */
export function hideGettingStarted(): void {
  const of = accountStateOwner()
  if (isServerAccount(of)) {
    if (accountState()?.getting_started === UNREADABLE) return
    writing = writeAccountState('getting_started', { hidden: true }).catch(() => {
      // Still shown; Hide can be pressed again.
    })
    return
  }
  if (of === LOCAL_ONBOARDING_OWNER) writeLocal({ hidden: true })
}

/** Test-only: forget what this module wrote, as a fresh page load does. */
export function __resetGettingStartedForTest(): void {
  local.setRecord(undefined)
  writing = Promise.resolve()
}
