/**
 * Where each statement setup reads goes by default (review of 19 Nov, finding 2). One rule for a
 * statement of bank B in currency C, over the whole setup:
 *
 * 1. an account the profile has, named for B, whose currency is C;
 * 2. else the main account, when its currency is C, it is named for no other bank, and B is the
 *    bank it takes: the bank it already received in this setup, or else the first bank of this
 *    setup whose statement fits it and has transactions in it (finding 13). The main account is
 *    the one setup's account step made; with none (setup opened again at the statement), the
 *    newest account in C named for no bank;
 * 3. else a new account "B C".
 *
 * A statement with no currency, and an account with none, count as the base currency. Every
 * statement imported earlier in this setup counts, in the wizard or on the Import page while setup
 * waited. A target picked by hand stays as it is, and one into the main account claims it for its
 * bank. The main account holds one bank's statements: a second bank's in it would add two banks'
 * money up in one balance.
 *
 * Pure, so the rule can be read and tested on its own; FirstImport runs it whenever the set of
 * files changes.
 */
import { accountNamesBank, listAdapters } from '../../core/bankImport'
import type { BankId } from '../../core/bankImport'
import type { SetupStatement } from '../../core/onboardingStore'

export interface TargetAccount {
  id: number
  name: string
  bank_name?: string | null
  currency?: string | null
}

export interface StatementToPlace {
  bankId: BankId
  /** The statement's currency, as read from it; null for none. */
  currency: string | null
  /** The target the person picked by hand, which stays; null when none was picked. */
  byHand: string | null
  /**
   * Read, and no transaction came out of it. It never takes the main account for its bank: an
   * empty export picked first would leave the next bank's statement a new account.
   */
  empty?: boolean
}

/** A currency code as compared, the base currency for none. */
export function currencyOrBase(code: string | null | undefined, base: string): string {
  const trimmed = (code ?? '').trim().toUpperCase()
  return trimmed || base.trim().toUpperCase()
}

/** The bank's name as the app lists it, or '' for none. */
function labelOf(bankId: BankId): string {
  return listAdapters().find((a) => a.id === bankId)?.label ?? ''
}

/** The new account a statement of `bankId` in `currency` gets: "Revolut EUR". */
export function newAccountName(bankId: BankId, currency: string): string {
  return [labelOf(bankId), currency].filter(Boolean).join(' ') || 'Imported account'
}

/** Whether an account is named for a bank other than `bankId` (YNAB names no bank account). */
function namedForAnotherBank(account: TargetAccount, bankId: BankId | null): boolean {
  return listAdapters().some(
    (adapter) =>
      adapter.id !== bankId && adapter.id !== 'ynab' && accountNamesBank(account, adapter.id)
  )
}

/**
 * The main account for a statement in `currency`: the one setup's account step made, when the
 * profile has it; else the newest account in that currency named for no bank (setup opened again
 * at the statement, or its account step skipped).
 */
export function mainAccountOf(
  made: string | null,
  accounts: readonly TargetAccount[],
  currency: string,
  base: string
): TargetAccount | null {
  const byName = made ? accounts.find((a) => a.name === made) : undefined
  if (byName) return byName
  const fits = accounts.filter(
    (a) => currencyOrBase(a.currency, base) === currency && !namedForAnotherBank(a, null)
  )
  return fits.reduce<TargetAccount | null>(
    (newest, a) => (newest === null || a.id > newest.id ? a : newest),
    null
  )
}

/** Each statement's target, in order: its hand-picked one, else the rule's. */
export function statementTargets(input: {
  statements: readonly StatementToPlace[]
  earlier: readonly SetupStatement[]
  accounts: readonly TargetAccount[]
  /** The account setup's account step made, if any. */
  made: string | null
  base: string
}): string[] {
  const { accounts, made, base } = input
  const currencyOf = (account: TargetAccount) => currencyOrBase(account.currency, base)
  // The bank each account takes as a main account: the first it received earlier in this setup,
  // then the first picked into it by hand, then the first whose statement fits it, below.
  const takes = new Map<string, BankId>()
  for (const s of input.earlier) if (!takes.has(s.account)) takes.set(s.account, s.bankId)
  for (const s of input.statements) {
    if (s.byHand !== null && !takes.has(s.byHand)) takes.set(s.byHand, s.bankId)
  }
  return input.statements.map((statement) => {
    if (statement.byHand !== null) return statement.byHand
    const bank = statement.bankId
    const currency = currencyOrBase(statement.currency, base)
    const own = accounts.find((a) => currencyOf(a) === currency && accountNamesBank(a, bank))
    if (own) return own.name
    const main = mainAccountOf(made, accounts, currency, base)
    const taken = main === null ? undefined : takes.get(main.name)
    const mainFits =
      main !== null &&
      currencyOf(main) === currency &&
      !namedForAnotherBank(main, bank) &&
      (taken === undefined ? statement.empty !== true : taken === bank)
    if (main !== null && mainFits) {
      takes.set(main.name, bank)
      return main.name
    }
    return newAccountName(bank, currency)
  })
}
