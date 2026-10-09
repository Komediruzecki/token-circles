/**
 * The Extra payments tab's two forms, written down once: the one that adds an extra payment and
 * the one that changes a saved one in place. Their values, the body they send, the check each runs
 * before sending, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/loanSchema.ts), so an amount of zero, one it
 * cannot read or one with a third decimal is caught here, in the same words, and a field the
 * runtime refuses is marked the same way. A refused save used to be a toast, the runtime's first
 * sentence or "Couldn't save the extra payment. Try again.", with nothing in the form marked.
 *
 * A change checks only what it changes, as the runtimes do: an extra payment that goes with a
 * payment a since-shortened term has passed keeps its month while its amount changes.
 */
import { checkExtraPaymentCreate, checkExtraPaymentEdit } from '../../../../shared/loanSchema'
import { fieldErrorsOf } from '../../../../shared/refusal'
import { createForm } from '../../components/form'
import { apiPost, apiPut, showToast } from '../../core/api'
import { numberOf } from './loanForm'
import type { Form } from '../../components/form'
import type { SavedExtra } from './loanData'

export interface ExtraPaymentValues {
  /** The payment it goes with, counting the first as 1, from the form's list. */
  month: string
  amount: string
  note: string
}

/** The loan the forms write to, as the page has it now. */
export interface ExtraPaymentLoan {
  id: number
  name: string
  term_months: number
}

/** What the forms send. The runtimes trim the note. */
export function extraPaymentBody(values: ExtraPaymentValues): Record<string, unknown> {
  return {
    month: numberOf(values.month),
    amount: numberOf(values.amount),
    note: values.note,
  }
}

export type ExtraPaymentForm = Form<ExtraPaymentValues> & {
  /** Start a new extra payment with payment `month`. */
  start: (month: number) => void
  /** Change `extra`, which the form opens holding. */
  open: (extra: SavedExtra) => void
}

export interface ExtraPaymentFormOptions {
  /** 'add' saves a new extra payment; 'change' saves the one `open` was given. */
  mode: 'add' | 'change'
  loan: () => ExtraPaymentLoan
  /** An amount as the page shows money. */
  money: (amount: number) => string
  /** After a save. The add form starts over with the same payment; a change closes. */
  onSaved: () => void
}

export function createExtraPaymentForm(options: ExtraPaymentFormOptions): ExtraPaymentForm {
  /** The saved extra payment a change opened, which its check compares against. */
  let editing: SavedExtra | null = null

  const form = createForm<ExtraPaymentValues>({
    initial: { month: '1', amount: '', note: '' },
    check: (values) => {
      const body = extraPaymentBody(values)
      const term = options.loan().term_months
      return fieldErrorsOf(
        editing ? checkExtraPaymentEdit(body, editing, term) : checkExtraPaymentCreate(body, term)
      )
    },
    send: async (values) => {
      const loan = options.loan()
      const body = extraPaymentBody(values)
      if (editing) {
        await apiPut(`/api/loans/${loan.id}/prepayments/${editing.ref}`, body)
        showToast(
          `Saved your changes to the extra payment with payment ${values.month}.`,
          'success'
        )
        return
      }
      await apiPost(`/api/loans/${loan.id}/prepayments`, body)
      showToast(
        `Added ${options.money(Number(body.amount))} with payment ${values.month} to "${loan.name}".`,
        'success'
      )
    },
    saved: () => {
      options.onSaved()
    },
    failure:
      options.mode === 'change'
        ? "Couldn't update the extra payment. Try again."
        : "Couldn't save the extra payment. Try again.",
  })

  return Object.assign(form, {
    start: (month: number) => {
      editing = null
      form.reset({ month: String(month), amount: '', note: '' })
    },
    open: (extra: SavedExtra) => {
      editing = extra
      form.reset({ month: String(extra.month), amount: String(extra.amount), note: extra.note })
    },
  })
}
