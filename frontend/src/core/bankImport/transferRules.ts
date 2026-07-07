/**
 * Bank statement import — transfer detection.
 *
 * Ports the Apps Script transfer logic: a movement is a transfer when it is an
 * account top-up / inter-account move rather than external income/expense. When
 * the counterpart account can be resolved (by keyword or card last-4), the
 * transform emits a single two-sided transfer (source → destination). When it
 * can't, the caller falls back to signed income/expense so balances stay correct
 * and the user reclassifies later.
 */
import type { TransferRuleSet } from './types'

/** True if `text` looks like an internal transfer under the given rules. */
export function isTransfer(text: string, rules: TransferRuleSet): boolean {
  const s = text.toLowerCase()
  if (rules.keywords.some((k) => k && s.includes(k.toLowerCase()))) return true
  // Mentioning one of the user's own accounts by name is a strong transfer signal.
  return rules.ownAccounts.some((a) => a && s.toLowerCase().includes(a.toLowerCase()))
}

/**
 * Resolve the counterpart (the *other* account) of a transfer from its text, or
 * null. Tries explicit counterpart signatures first (keyword or card last-4),
 * then any own-account name mentioned in the text.
 */
export function resolveCounterpart(text: string, rules: TransferRuleSet): string | null {
  const s = text.toLowerCase()
  // Rank matching signatures by specificity so order in the rules object doesn't
  // decide: a purely-numeric signature (a card last-4 / account fragment) is a more
  // specific identifier than a brand keyword, and within a group the longer wins.
  // So { revolut, 0418 } on "POS Revolut**0418*" resolves via 0418, not revolut.
  const matches: { account: string; numeric: boolean; len: number }[] = []
  for (const [signature, account] of Object.entries(rules.counterparts)) {
    const sig = signature.toLowerCase().trim()
    if (sig && s.includes(sig))
      matches.push({ account, numeric: /^\d+$/.test(sig), len: sig.length })
  }
  if (matches.length > 0) {
    matches.sort((a, b) => Number(b.numeric) - Number(a.numeric) || b.len - a.len)
    return matches[0].account
  }
  // Fall back to any own-account name mentioned in the text (longest wins).
  let best: string | null = null
  let bestLen = 0
  for (const account of rules.ownAccounts) {
    const a = account.toLowerCase().trim()
    if (a.length > bestLen && s.includes(a)) {
      best = account
      bestLen = a.length
    }
  }
  return best
}

/**
 * Default seed rules. `ownAccounts`/`counterparts` are placeholders the user
 * fills in with their real account names and card last-4 digits via the rules
 * editor; the keyword list covers the common transfer verbs seen in Revolut,
 * Erste and PBZ statements.
 */
export const DEFAULT_TRANSFER_RULES: TransferRuleSet = {
  ownAccounts: [],
  keywords: [
    'top-up',
    'topup',
    'top up',
    'transfer from',
    'transfer to',
    'to ibkr',
    'ibkr',
    'revolut',
  ],
  counterparts: {},
}
