/**
 * The Recurring section's "Add Recurring" and "Edit Recurring" form, written down once: its
 * values, the check it runs before sending, the calls, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/recurringSchema.ts), so a blank description, an
 * amount of zero, a day of the month that is not one or a transfer without its accounts is said
 * under its field, in the same words, before anything is sent. A refused save used to say what
 * the transaction rules or zod said, in a toast ("Transaction amount must be a positive number",
 * "Validation failed"), with nothing in the dialog marked, and a description or a next date left
 * blank was saved on the Worker.
 *
 * The amount is read with a comma or a dot for the cents, as the Bills dialog reads it, and the
 * day of the month is the text typed: the old number fields dropped letters before anything could
 * say so. An edit opens with the amount to the cent, so a rule stored with a sum's float error
 * (0.30000000000000004) opens as 0.3 and saves.
 *
 * An edit checks only what it changes, as the runtimes do: a rule an older version stored (no
 * description, a type or a frequency the form does not offer, another profile's account) opens
 * with that select blank and can still have its amount changed.
 */
import { createSignal } from 'solid-js'
import { toCents } from '../../../shared/money'
import { checkRecurringCreate, checkRecurringEdit } from '../../../shared/recurringSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { api, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import { localToday } from '../utils/period'
import type { Form } from '../components/form'
import type { RecurringTransaction } from '../types/models'

export interface RecurringFormValues {
  description: string
  amount: string
  /** expense, income or transfer, as the select's value. */
  type: string
  /** daily, weekly, monthly or yearly, as the select's value. */
  frequency: string
  day_of_month: string
  next_date: string
  /** An account's id as the select's value, or '' for none. */
  account_id: string
  /** A transfer's destination account's id, or ''. */
  transfer_account_id: string
  /** A category's id as the select's value, or '' for none. */
  category_id: string
  notes: string
}

/** A rule as the section lists it, to open it for editing. */
export type ListedRule = Pick<
  RecurringTransaction,
  | 'id'
  | 'description'
  | 'amount'
  | 'type'
  | 'frequency'
  | 'day_of_month'
  | 'next_date'
  | 'category_id'
  | 'account_id'
  | 'transfer_account_id'
  | 'notes'
>

export type RecurringForm = Form<RecurringFormValues> & {
  /** The rule being edited, or null while the form is closed or adding one. */
  editing: () => ListedRule | null
  /** Whether the dialog is open, for a new rule or an edit. */
  isOpen: () => boolean
  /** Open the dialog for a new rule, due today. */
  openNew: () => void
  /** Open the dialog on `rule`, with its values. */
  openEdit: (rule: ListedRule) => void
  /** Close it, sending nothing. */
  close: () => void
}

const blank = (): RecurringFormValues => ({
  description: '',
  amount: '',
  type: 'expense',
  frequency: 'monthly',
  day_of_month: '',
  next_date: localToday(),
  account_id: '',
  transfer_account_id: '',
  category_id: '',
  notes: '',
})

/**
 * A number field as typed: a number when it reads as one, the text when it does not, so the rules
 * say what is wrong with it, and null when it is blank.
 */
function numberOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/** A select's id, or null for its "none" option. */
const idOf = (value: string): number | null => (value ? Number(value) : null)

/** The body the dialog sends. Only a transfer goes to a second account. */
export function recurringBody(values: RecurringFormValues): Record<string, unknown> {
  return {
    description: values.description,
    amount: numberOf(values.amount),
    type: values.type,
    frequency: values.frequency,
    day_of_month: numberOf(values.day_of_month),
    next_date: values.next_date,
    category_id: idOf(values.category_id),
    account_id: idOf(values.account_id),
    transfer_account_id: values.type === 'transfer' ? idOf(values.transfer_account_id) : null,
    notes: values.notes.trim() || null,
  }
}

/** The rule as a toast names it. */
export function ruleName(description: string): string {
  const name = description.trim()
  return name ? `"${name}"` : 'the recurring transaction'
}

const text = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value)

export function createRecurringForm(): RecurringForm {
  const [editing, setEditing] = createSignal<ListedRule | null>(null)
  const [isOpen, setOpen] = createSignal(false)

  const form = createForm<RecurringFormValues>({
    initial: blank(),
    check: (values) => {
      const stored = editing()
      const body = recurringBody(values)
      return fieldErrorsOf(stored ? checkRecurringEdit(body, stored) : checkRecurringCreate(body))
    },
    send: async (values) => {
      const body = recurringBody(values) as Partial<RecurringTransaction>
      const stored = editing()
      if (stored) {
        await api.updateRecurring(stored.id, body)
        showToast(`Saved your changes to ${ruleName(values.description)}.`, 'success')
        return
      }
      await api.createRecurring(body as Parameters<typeof api.createRecurring>[0])
      showToast(`Added ${ruleName(values.description)} to your recurring transactions.`, 'success')
    },
    saved: () => {
      close()
    },
    failure: "Couldn't save the recurring transaction. Try again.",
  })

  const openNew = () => {
    setEditing(null)
    form.reset(blank())
    setOpen(true)
  }
  const openEdit = (rule: ListedRule) => {
    setEditing({ ...rule })
    form.reset({
      description: rule.description || '',
      // To the cent: a rule stored as 0.30000000000000004 (a sum with a float error) would open
      // as that text.
      amount: String(toCents(rule.amount)),
      type: rule.type,
      frequency: rule.frequency,
      day_of_month: text(rule.day_of_month),
      next_date: rule.next_date || localToday(),
      account_id: text(rule.account_id),
      transfer_account_id: text(rule.transfer_account_id),
      category_id: text(rule.category_id),
      notes: rule.notes || '',
    })
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setEditing(null)
    form.reset(blank())
  }

  return Object.assign(form, { editing, isOpen, openNew, openEdit, close })
}
