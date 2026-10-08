/**
 * The Transactions form, written down once: its values, the check it runs before it sends, the
 * body it sends, and the words it says. The page (features/Transactions.tsx) builds the form
 * from these with the kit and owns what is only the page's: the tags, the receipt, the dialog.
 *
 * The check is the one both runtimes run (shared/transactionSchema.ts), so an amount of zero or a
 * transfer to the account the money comes from is caught here, in the words either runtime would
 * answer with, before anything is sent. The form asks for more than the runtimes do, as it always
 * has: a description and a date, and for income and expenses a category and an account. Imports,
 * the MCP tools and API clients send rows without them, so the runtimes take them; a person
 * adding one by hand is asked.
 *
 * An edit checks only what it changes, against the row it opened (decision 2), as the runtimes do:
 * a row an import stored with an amount of three decimals can still have its description changed.
 */
import { fieldErrorsOf } from '../../../shared/refusal'
import { checkTransactionCreate, checkTransactionEdit } from '../../../shared/transactionSchema'
import { getLocalCurrency } from '../core/api'
import { localToday } from '../utils/period'
import type { FieldErrors } from '../../../shared/refusal'
import type { TransactionDefaults } from '../../../shared/transactionSchema'
import type { Transaction, TransactionType } from '../types/models'

/** What the form holds, under the names the body and a refusal's `fields` use. */
export interface TransactionFormValues {
  type: TransactionType
  description: string
  /** As typed: a refusal of it quotes no number the person did not write. */
  amount: string
  currency: string
  date: string
  category_id: number | null
  transfer_account_id: number | null
  account_id: number | null
  beneficiary: string
  payor: string
  amount_local: string
  exchange_rate: string
  notes: string
  /** Not shown: kept from the row an edit or a copy opened with, and sent back as it came. */
  means_of_payment: string
}

/** The words of the rules the form adds to the runtimes', and of its own failures. */
export const TRANSACTION_FORM_MESSAGES = {
  description: 'Describe it in a few words, like Weekly groceries.',
  date: 'Enter the date it happened.',
  category: 'Choose a category from the list.',
  accountExpense: 'Choose the account the money came out of.',
  accountIncome: 'Choose the account the money went into.',
  failure: "Couldn't save the transaction. Try again.",
  cash: "Couldn't create the Cash account. Try again.",
} as const

/** What a blank date or currency means in the browser: today here, and the base currency. */
export function transactionDefaults(): TransactionDefaults {
  return { today: localToday(), currency: getLocalCurrency() }
}

/** A new entry: an expense, today, in the base currency, from `account_id`. */
export function blankTransaction(account_id: number | null): TransactionFormValues {
  return {
    type: 'expense',
    description: '',
    amount: '',
    currency: getLocalCurrency(),
    date: localToday(),
    category_id: null,
    transfer_account_id: null,
    account_id,
    beneficiary: '',
    payor: '',
    amount_local: '',
    exchange_rate: '1',
    notes: '',
    means_of_payment: '',
  }
}

/**
 * A stored row's values, to edit it or to copy it. The exchange rate is the row's own: the form
 * sends it back, and '1' overwrote a foreign row's rate on every save. The local amount starts
 * blank and is left out of the body while it is: an edit of the amount moves it at the row's rate.
 */
export function transactionValues(row: Transaction): TransactionFormValues {
  return {
    type: row.type,
    description: row.description,
    amount: String(row.amount),
    currency: row.currency || getLocalCurrency(),
    date: row.date,
    category_id: row.category_id || null,
    transfer_account_id: row.transfer_account_id || null,
    account_id: row.account_id || null,
    beneficiary: row.beneficiary || '',
    payor: row.payor || '',
    amount_local: '',
    exchange_rate: String(row.exchange_rate ?? 1),
    notes: row.notes || '',
    means_of_payment: row.means_of_payment || '',
  }
}

/** A number as typed, or undefined for a blank one. Not parseFloat: "12abc" is not 12. */
function typed(text: string): number | undefined {
  return text.trim() === '' ? undefined : Number(text.trim())
}

/**
 * The body for these values: every field the form shows, so an edit can clear one. A blank local
 * amount or exchange rate is left out rather than sent blank: the edit form opens with no local
 * amount, and sent blank it would clear the row's. A category goes only with income and expenses,
 * a destination only with a transfer.
 */
export function transactionBody(values: TransactionFormValues): Record<string, unknown> {
  const transfer = values.type === 'transfer'
  return {
    type: values.type,
    description: values.description.trim(),
    amount: typed(values.amount),
    currency: values.currency || getLocalCurrency(),
    date: values.date,
    category_id: transfer ? null : values.category_id,
    transfer_account_id: transfer ? (values.transfer_account_id ?? undefined) : undefined,
    account_id: values.account_id ?? undefined,
    beneficiary: values.beneficiary,
    payor: values.payor,
    amount_local: typed(values.amount_local),
    exchange_rate: typed(values.exchange_rate),
    notes: values.notes,
    means_of_payment: values.means_of_payment || undefined,
  }
}

/**
 * What is wrong with these values, field by field: the runtimes' rules on the body they would get,
 * and the form's own. `opened` is the row an edit opened, or null for a new entry.
 */
export function checkTransactionForm(
  values: TransactionFormValues,
  opened: Transaction | null
): FieldErrors {
  const body = transactionBody(values)
  const defaults = transactionDefaults()
  const fields: FieldErrors = {
    ...fieldErrorsOf(
      opened ? checkTransactionEdit(body, opened, defaults) : checkTransactionCreate(body, defaults)
    ),
  }
  const M = TRANSACTION_FORM_MESSAGES
  if (!values.description.trim()) fields.description = M.description
  if (!values.date.trim()) fields.date = M.date
  if (values.type !== 'transfer') {
    if (values.category_id === null) fields.category_id = M.category
    if (values.account_id === null) {
      fields.account_id = values.type === 'income' ? M.accountIncome : M.accountExpense
    }
  }
  return fields
}

/** The toast after a save, naming the transaction as it was saved. */
export function savedMessage(description: string, editing: boolean): string {
  const name = description.trim()
  return editing ? `Saved your changes to "${name}".` : `Added "${name}" to your transactions.`
}
