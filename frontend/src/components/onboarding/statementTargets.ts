/**
 * Where each statement setup reads goes by default (review of 19 Nov, finding 2). One rule for a
 * statement of bank B in the base currency, over the whole setup:
 *
 * 1. an account the profile has, named for B, in the base currency, that no other bank holds;
 * 2. else the main account, when it is in the base currency, it is named for no other bank, and B
 *    is the bank it takes: the bank it already received in this setup, or else the first bank of
 *    this setup whose statement fits it and has transactions in it (finding 13). The main account
 *    is the one setup's account step made; with none (setup opened again at the statement), the
 *    newest account in the base currency named for no bank;
 * 3. else a new account "B" and the base currency ("B 2" when another bank holds that name).
 *
 * A statement in another currency goes nowhere: balances are kept in the base currency, and
 * neither runtime makes an account in another one (a 409), so setup sets it aside for the Import
 * page and says why (round 3). It takes no account, new or found, and no main account from the
 * banks after it. A statement with no currency, and an account with none, count as the base. Every
 * statement imported earlier in this setup counts, in the wizard or on the Import page while setup
 * waited. A target picked by hand stays as it is, and claims its account for its bank (round 4).
 * An account holds one bank's statements: a second bank's in it would add two banks' money up in
 * one balance. So no default puts a second bank into an account another bank holds, by an
 * earlier statement or a pick by hand; only two picks by hand can.
 *
 * Pure, so the rule can be read and tested on its own; FirstImport runs it whenever the set of
 * files changes and at every pick by hand.
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

/** Whether a statement names a currency, and it is not the base: such a one is set aside. */
export function inOtherCurrency(code: string | null | undefined, base: string): boolean {
  const named = (code ?? '').trim().toUpperCase()
  return named !== '' && named !== base.trim().toUpperCase()
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

/** The new account a statement of `bankId` gets, `currency` being the base: "Revolut EUR". */
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
 * The main account: the one setup's account step made, when the profile has it; else the newest
 * account in the base currency named for no bank (setup opened again at the statement, or its
 * account step skipped).
 */
export function mainAccountOf(
  made: string | null,
  accounts: readonly TargetAccount[],
  base: string
): TargetAccount | null {
  const byName = made ? accounts.find((a) => a.name === made) : undefined
  if (byName) return byName
  const currency = currencyOrBase(null, base)
  const fits = accounts.filter(
    (a) => currencyOrBase(a.currency, base) === currency && !namedForAnotherBank(a, null)
  )
  return fits.reduce<TargetAccount | null>(
    (newest, a) => (newest === null || a.id > newest.id ? a : newest),
    null
  )
}

/**
 * Each statement's target, in order: its hand-picked one, else the rule's; null for a statement in
 * another currency, which setup sets aside.
 */
export function statementTargets(input: {
  statements: readonly StatementToPlace[]
  earlier: readonly SetupStatement[]
  accounts: readonly TargetAccount[]
  /** The account setup's account step made, if any. */
  made: string | null
  base: string
}): Array<string | null> {
  const { accounts, made, base } = input
  const currency = currencyOrBase(null, base)
  const currencyOf = (account: TargetAccount) => currencyOrBase(account.currency, base)
  // The bank that holds each account: the first it received earlier in this setup, then the first
  // picked into it by hand, then, for the main account, the first whose statement fits it, below.
  const takes = new Map<string, BankId>()
  for (const s of input.earlier) if (!takes.has(s.account)) takes.set(s.account, s.bankId)
  for (const s of input.statements) {
    if (inOtherCurrency(s.currency, base)) continue
    if (s.byHand !== null && !takes.has(s.byHand)) takes.set(s.byHand, s.bankId)
  }
  const heldByAnother = (name: string, bank: BankId) => {
    const holder = takes.get(name)
    return holder !== undefined && holder !== bank
  }
  /** A new account for `bank`, under a name no other bank holds. */
  const newAccount = (bank: BankId): string => {
    const name = newAccountName(bank, currency)
    if (!heldByAnother(name, bank)) return name
    let n = 2
    while (heldByAnother(`${name} ${n}`, bank)) n++
    return `${name} ${n}`
  }
  return input.statements.map((statement) => {
    if (inOtherCurrency(statement.currency, base)) return null
    if (statement.byHand !== null) return statement.byHand
    const bank = statement.bankId
    const own = accounts.find(
      (a) => currencyOf(a) === currency && accountNamesBank(a, bank) && !heldByAnother(a.name, bank)
    )
    if (own) return own.name
    const main = mainAccountOf(made, accounts, base)
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
    return newAccount(bank)
  })
}
