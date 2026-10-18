/**
 * The Accounts dialog's form, written down once: its values, the check it runs before sending,
 * the create or update call, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/accountSchema.ts), so a blank name is caught here,
 * in the same words, before anything is sent. A balance is read as the dialog always read it, with
 * a comma or a dot for the cents.
 *
 * The base currency is not a field: the dialog shows it and sends it. When the profile's is
 * another one, the runtimes answer 409 with a sentence that says where to change it, and the kit
 * puts that sentence in the dialog's notice.
 *
 * An edit checks only what it changes, as the runtimes do: an account saved under older rules (a
 * name over 100 characters) can still have its bank changed.
 *
 * A credit card and a Giro account also show a limit and a yearly interest rate (an overdraft's,
 * on a Giro account). Another type sends neither, and the runtimes clear both when an edit gives
 * the account that type.
 */
import {
  ACCOUNT_MESSAGES,
  checkAccountCreate,
  checkAccountEdit,
  storedAccountType,
  takesCreditLine,
} from '../../../shared/accountSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, getLocalCurrency, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import type { FieldErrors } from '../../../shared/refusal'
import type { Form } from '../components/form'

export interface AccountFormValues {
  name: string
  type: string
  bank_name: string
  /** A new account's only: an edit corrects the current balance instead. */
  starting_balance: string
  starting_date: string
  /** The current balance, as typed. */
  balance: string
  /** A credit card's limit, or a Giro account's overdraft limit, as typed. */
  credit_limit: string
  /** The yearly interest rate on money owed, in percent, as typed. */
  credit_rate: string
}

/** An account as the page holds one, to open it for editing. */
export interface EditableAccount {
  id: number
  name: string
  type: string
  bank_name?: string | null
  balance: number
  starting_balance?: number | null
  starting_date?: string | null
  credit_limit?: number | null
  credit_rate?: number | null
}

export interface AccountFormOptions {
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
}

export type AccountForm = Form<AccountFormValues> & {
  /** Fill the form for a new account, or with `account` to edit it. */
  open: (account?: EditableAccount | null) => void
}

const BLANK: AccountFormValues = {
  name: '',
  type: 'giro',
  bank_name: '',
  starting_balance: '',
  starting_date: '',
  balance: '',
  credit_limit: '',
  credit_rate: '',
}

const cents = (amount: number) => Math.round(amount * 100) / 100

/** A request body, and what is wrong with a balance it could not read. */
interface Built {
  body: Record<string, unknown>
  fields: FieldErrors
}

/**
 * The limit and the rate, for a type that takes them, read as the balances are (a comma or a dot
 * for the decimals). A blank one is none. Another type sends neither.
 */
function creditLine(values: AccountFormValues, fields: FieldErrors): Record<string, unknown> {
  if (!takesCreditLine(values.type)) return {}
  const read = (text: string, field: 'credit_limit' | 'credit_rate', message: string) => {
    if (!text.trim()) return null
    const number = parseDecimalInput(text)
    if (number === null) fields[field] = message
    return number ?? undefined
  }
  return {
    credit_limit: read(values.credit_limit, 'credit_limit', ACCOUNT_MESSAGES.creditLimit),
    credit_rate: read(values.credit_rate, 'credit_rate', ACCOUNT_MESSAGES.creditRate),
  }
}

/**
 * A new account's body. A blank current balance is 0, and a blank starting balance is the current
 * one: a new account has no transactions, so the two are the same, and the runtimes store the
 * starting balance as both.
 */
function createBody(values: AccountFormValues): Built {
  const fields: FieldErrors = {}
  const balance = values.balance.trim() ? parseDecimalInput(values.balance) : 0
  const starting = values.starting_balance.trim()
    ? parseDecimalInput(values.starting_balance)
    : balance
  if (balance === null) fields.balance = ACCOUNT_MESSAGES.balance
  if (values.starting_balance.trim() && starting === null) {
    fields.starting_balance = ACCOUNT_MESSAGES.startingBalance
  }
  return {
    body: {
      name: values.name,
      type: values.type,
      bank_name: values.bank_name,
      balance: balance ?? undefined,
      currency: getLocalCurrency(),
      starting_balance: starting ?? undefined,
      starting_date: values.starting_date || null,
      ...creditLine(values, fields),
    },
    fields,
  }
}

/**
 * An edit's body. The current balance is derived (the starting balance and the ledger), so a
 * correction to it shifts the starting balance by the same amount and sends the two together:
 * the fix survives a recompute, and later transactions apply on top of it.
 */
function editBody(values: AccountFormValues, account: EditableAccount): Built {
  const fields: FieldErrors = {}
  const body: Record<string, unknown> = {
    name: values.name,
    type: values.type,
    bank_name: values.bank_name,
    currency: getLocalCurrency(),
    starting_date: values.starting_date || null,
    ...creditLine(values, fields),
  }
  const current = parseDecimalInput(values.balance)
  if (current === null) {
    fields.balance = ACCOUNT_MESSAGES.balance
  } else {
    const desired = cents(current)
    const held = account.balance ?? 0
    if (Math.abs(desired - held) > 0.005) {
      const ledger = held - (account.starting_balance ?? 0)
      body.starting_balance = cents(desired - ledger)
      body.balance = desired
    }
  }
  return { body, fields }
}

export function createAccountForm(options: AccountFormOptions): AccountForm {
  /** The account an edit opened, which its check compares against. Null for a new one. */
  let editing: EditableAccount | null = null

  const build = (values: AccountFormValues): Built =>
    editing ? editBody(values, editing) : createBody(values)

  const form = createForm<AccountFormValues>({
    initial: BLANK,
    check: (values) => {
      const { body, fields } = build(values)
      const rules = fieldErrorsOf(
        editing ? checkAccountEdit(body, editing) : checkAccountCreate(body)
      )
      // A balance the dialog could not read is said in its words, not as the blank it became.
      return { ...rules, ...fields }
    },
    send: async (values) => {
      const { body } = build(values)
      const name = values.name.trim()
      if (editing) {
        await apiPut(`/api/accounts/${editing.id}`, body)
        showToast(`Saved your changes to "${name}".`, 'success')
        return
      }
      await apiPost('/api/accounts', body)
      showToast(`Added "${name}" to your accounts.`, 'success')
    },
    // The toast above says the save happened even when it lands after the dialog was closed and
    // opened again. Closing waits for `saved`, which runs only while this is still the dialog that
    // sent.
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the account. Try again.",
  })

  const open = (account?: EditableAccount | null) => {
    editing = account ?? null
    form.reset(
      account
        ? {
            name: account.name,
            // A type v4 renamed opens as the one that replaced it, which the edit's check reads as
            // the same type; any other is kept as it is (the dialog shows it as a plain account).
            type: storedAccountType(account.type),
            bank_name: account.bank_name || '',
            starting_balance: String(account.starting_balance ?? ''),
            starting_date: account.starting_date || '',
            // The current balance: correcting it adjusts the starting balance (editBody).
            balance: String(account.balance ?? ''),
            credit_limit: String(account.credit_limit ?? ''),
            credit_rate: String(account.credit_rate ?? ''),
          }
        : BLANK
    )
  }

  return Object.assign(form, { open })
}
