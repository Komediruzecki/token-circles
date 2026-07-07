/**
 * Bank statement import — shared classification.
 *
 * Adapters parse their bank-specific format into a `RawTxn` (a signed amount, as
 * seen from the target account, plus text) and run it through `buildTxn`, which
 * applies the shared transfer + category logic to produce a `CanonicalTxn`.
 * Keeping this here means every bank gets identical transfer/category semantics.
 */
import { categorize } from './categoryRules'
import { isTransfer, resolveCounterpart } from './transferRules'
import type { CanonicalTxn, TransformContext } from './types'

export interface RawTxn {
  date: string
  /** Signed amount from the target account's view: negative = out, positive = in. */
  amount: number
  currency: string
  description: string
  /** Extra text (payee/counterparty) used for categorization + counterpart lookup. */
  counterparty?: string
  beneficiary?: string
  payor?: string
  notes?: string
  /** Force transfer regardless of keywords (e.g. Revolut Type = Topup/Transfer). */
  forceTransfer?: boolean
  /**
   * A signature of the ORIGINAL statement row (full timestamps, balance, fee, …),
   * used for within-batch duplicate detection. Two genuinely distinct same-day
   * transactions differ here (per-second time / balance), while the same
   * transaction appearing in two overlapping statements matches — unlike the
   * coarse canonical row, whose date is only yyyy-mm-dd.
   */
  dedupKey?: string
}

/** Scope the raw-row dedup signature to the statement's account. */
function dedupKeyOf(raw: RawTxn, ctx: TransformContext): string | undefined {
  return raw.dedupKey ? `${ctx.targetAccount}${raw.dedupKey}` : undefined
}

export function buildTxn(raw: RawTxn, ctx: TransformContext): CanonicalTxn {
  const text = [raw.description, raw.counterparty].filter(Boolean).join(' ')
  const looksTransfer = raw.forceTransfer === true || isTransfer(text, ctx.transferRules)

  if (looksTransfer) {
    const counterpart = resolveCounterpart(text, ctx.transferRules)
    if (counterpart && counterpart.toLowerCase() !== ctx.targetAccount.toLowerCase()) {
      // Two-sided transfer. Direction is taken from the amount's sign as seen from
      // the target account: negative → money leaves the target (target = source),
      // positive → money enters the target (target = destination). The app's
      // execute links means_of_payment → account_id (source) and the account-named
      // category → transfer_account_id (destination).
      const outbound = raw.amount < 0
      return {
        date: raw.date,
        type: 'Transfer',
        meansOfPayment: outbound ? ctx.targetAccount : counterpart,
        category: outbound ? counterpart : ctx.targetAccount,
        amount: Math.abs(raw.amount),
        currency: raw.currency,
        description: raw.description,
        beneficiary: raw.beneficiary,
        payor: raw.payor,
        notes: raw.notes,
        dedupKey: dedupKeyOf(raw, ctx),
      }
    }
    // Transfer suspected but the counterpart account is unknown. Import as signed
    // income/expense so the one account we do know stays balanced, and flag it in
    // notes for the user to reclassify.
    const note = [raw.notes, 'possible transfer — counterpart not resolved']
      .filter(Boolean)
      .join(' | ')
    return incomeExpense(raw, ctx, note)
  }

  return incomeExpense(raw, ctx, raw.notes)
}

function incomeExpense(raw: RawTxn, ctx: TransformContext, notes?: string): CanonicalTxn {
  const type: CanonicalTxn['type'] = raw.amount < 0 ? 'Expense' : 'Income'
  const category = categorize([raw.description, raw.counterparty], ctx.categoryRules)
  return {
    date: raw.date,
    type,
    meansOfPayment: ctx.targetAccount,
    category,
    amount: Math.abs(raw.amount),
    currency: raw.currency,
    description: raw.description,
    beneficiary: raw.beneficiary,
    payor: raw.payor,
    notes,
    dedupKey: dedupKeyOf(raw, ctx),
  }
}
