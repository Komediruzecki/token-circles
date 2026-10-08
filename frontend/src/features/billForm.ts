/**
 * The Bills dialog's form, written down once: its values, the check it runs before sending, the
 * create or update call, and the toast that says it worked. A subscription card's Edit opens it
 * too.
 *
 * The check is the one both runtimes run (shared/billSchema.ts), so a blank name or an amount of
 * zero is caught here, in the same words, before anything is sent. A refused save used to say
 * "Failed to save bill" in a toast, with nothing in the dialog marked.
 *
 * The category is chosen by its id. The dialog's options used to carry the category's name, which
 * the save read as a number: no bill the dialog saved ever had a category, and an edit opened on
 * "No category" whatever the bill had.
 *
 * The due date is sent as `dueDate`, the name the Worker's API has always read. An amount is read
 * with a comma or a dot for the cents, as the Accounts dialog reads it.
 *
 * An edit checks only what it changes, as the runtimes do: a bill saved under older rules (an
 * amount of 0, a frequency no screen offers) can still be renamed.
 */
import { checkBillCreate, checkBillEdit } from '../../../shared/billSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import type { Form } from '../components/form'

export type BillKind = 'bill' | 'subscription'

export interface BillFormValues {
  name: string
  amount: string
  /** The first date the bill falls due, YYYY-MM-DD. */
  due_date: string
  /** The category's id, or blank for none. */
  category_id: string
  frequency: string
  type: BillKind
  autopay: boolean
}

/** A bill as the page holds one, to open it for editing. */
export interface EditableBill {
  id: number
  name: string
  amount: number
  due_date: string
  category_id?: number | null
  frequency: string
  type?: BillKind
  autopay: boolean | number
}

export type BillForm = Form<BillFormValues> & {
  /** Fill the form for a new bill of `kind`, or with `bill` to edit it. */
  open: (bill?: EditableBill | null, kind?: BillKind) => void
}

const blank = (kind: BillKind): BillFormValues => ({
  name: '',
  amount: '',
  due_date: '',
  category_id: '',
  frequency: 'monthly',
  type: kind,
  autopay: false,
})

/**
 * The amount as typed: a number when it reads as one, the text when it does not, so the rules say
 * what is wrong with it, and null when it is blank.
 */
function amountOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/** The body the dialog sends, for a new bill and an edit alike. */
export function billBody(values: BillFormValues): Record<string, unknown> {
  return {
    name: values.name,
    amount: amountOf(values.amount),
    dueDate: values.due_date,
    category_id: values.category_id ? Number(values.category_id) : null,
    frequency: values.frequency,
    autopay: values.autopay,
    type: values.type,
  }
}

export interface BillFormOptions {
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
}

export function createBillForm(options: BillFormOptions): BillForm {
  /** The bill an edit opened, which its check compares against. Null for a new one. */
  let editing: EditableBill | null = null

  const form = createForm<BillFormValues>({
    initial: blank('bill'),
    check: (values) => {
      const body = billBody(values)
      return fieldErrorsOf(editing ? checkBillEdit(body, editing) : checkBillCreate(body))
    },
    send: async (values) => {
      const body = billBody(values)
      const name = values.name.trim()
      if (editing) {
        await apiPut(`/api/bills/${editing.id}`, body)
        showToast(`Saved your changes to "${name}".`, 'success')
        return
      }
      await apiPost('/api/bills', body)
      const list = values.type === 'subscription' ? 'subscriptions' : 'bills'
      showToast(`Added "${name}" to your ${list}.`, 'success')
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the bill. Try again.",
  })

  const open = (bill?: EditableBill | null, kind: BillKind = 'bill') => {
    editing = bill ?? null
    form.reset(
      bill
        ? {
            name: bill.name,
            amount: String(bill.amount),
            due_date: bill.due_date ?? '',
            category_id: bill.category_id ? String(bill.category_id) : '',
            frequency: bill.frequency || 'monthly',
            type: bill.type === 'subscription' ? 'subscription' : 'bill',
            autopay: Boolean(bill.autopay),
          }
        : blank(kind)
    )
  }

  return Object.assign(form, { open })
}
