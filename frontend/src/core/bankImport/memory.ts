/**
 * Bank statement import — remembered target-account choices.
 *
 * When the user picks which app account a statement imports into, we persist that
 * choice keyed by the statement's signature (bank + IBAN/last-4/filename) so the
 * next matching statement auto-routes to the same account. Stored in
 * localStorage, scoped per profile. Keep it dependency-free so the pure core can
 * stay pure — this is the only module here that touches browser storage.
 */
import { statementSignature } from './accountResolver'
import type { BankId, StatementMeta } from './types'

const KEY = 'bankImportAccountMemory'

function storeKey(): string {
  const profile = localStorage.getItem('currentProfileId') || '1'
  return `${KEY}:${profile}`
}

/** Load the { signature → account name } map for the current profile. */
export function loadBankImportMemory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(storeKey())
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Remember that this statement's account is `accountName` for next time. */
export function rememberBankImportChoice(
  bankId: BankId,
  meta: StatementMeta,
  filename: string,
  accountName: string
): void {
  if (!accountName) return
  const mem = loadBankImportMemory()
  mem[statementSignature(bankId, meta, filename)] = accountName
  try {
    localStorage.setItem(storeKey(), JSON.stringify(mem))
  } catch {
    /* ignore quota / disabled storage */
  }
}
