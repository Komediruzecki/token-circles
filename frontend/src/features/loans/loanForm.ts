/**
 * The Loans dialog's form, written down once: its values, the body it sends, the check it runs
 * before sending, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/loanSchema.ts), so a missing name, an amount it
 * cannot read or a rate period past the loan's last payment is caught here, in the same words,
 * before anything is sent, and a field the runtime refuses is marked the same way. Every refused
 * save used to say "The loan was not saved. Check your connection and try again." in a toast,
 * whatever was wrong, with nothing in the dialog marked; a rate period with no first payment was
 * dropped from the save without a word, and an empty rate was sent as 0 %.
 *
 * Every number is typed as text and sent as a number when it reads as one (a comma or a dot for
 * the decimals), or as the text when it does not, so the rules say what is wrong with it. A rate
 * period's field is named `rate_periods.<index>.<field>`, as the runtimes name it in a refusal.
 *
 * An edit checks only what it changes, as the runtimes do: a loan saved under older rules (a name
 * over 100 characters, an amount with three decimals) can still be renamed.
 */
import { createSignal } from 'solid-js'
import { checkLoanCreate, checkLoanEdit } from '../../../../shared/loanSchema'
import { fieldErrorsOf } from '../../../../shared/refusal'
import { createForm } from '../../components/form'
import { apiPost, apiPut, showToast } from '../../core/api'
import { parseDecimalInput } from '../../core/decimalInput'
import type { Form } from '../../components/form'
import type { StoredRatePeriod } from './loanData'

export interface RatePeriodValues {
  rate: string
  start_month: string
  /** Blank for the end of the loan. */
  end_month: string
}

export interface LoanFormValues {
  name: string
  principal: string
  interest_rate: string
  term_months: string
  /** The first payment's due date, YYYY-MM-DD. */
  start_date: string
  rate_periods: RatePeriodValues[]
}

/** A loan as the page holds one, to open it for editing. */
export interface EditableLoan {
  id: number
  name: string
  principal: number
  interest_rate: number
  term_months: number
  start_date: string
  /** Its rate periods when the page has them; in cloud mode the loan's own read brings them. */
  rate_periods?: StoredRatePeriod[]
}

/** Whether the form holds the loan's own rate periods, so a save can send them. */
export type PeriodsState = 'ready' | 'loading' | 'failed'

export type LoanForm = Form<LoanFormValues> & {
  /** Fill the form for a new loan, or with `loan` to edit it. */
  open: (loan?: EditableLoan | null) => void
  /** The rate periods of the loan being edited arrived from its own read. */
  periodsRead: (periods: StoredRatePeriod[]) => void
  /** They could not be read: a save leaves them as they are. */
  periodsFailed: () => void
  periods: () => PeriodsState
  /** A new rate period's row, after the others. */
  addPeriod: () => void
  /** Change one field of the rate period in row `index`. */
  setPeriod: (index: number, field: keyof RatePeriodValues, text: string) => void
  removePeriod: (index: number) => void
}

export const BLANK_LOAN: LoanFormValues = {
  name: '',
  principal: '',
  interest_rate: '',
  term_months: '',
  start_date: '',
  rate_periods: [],
}

/**
 * A number as typed: a number when it reads as one, the text when it does not, so the rules say
 * what is wrong with it, and null when it is blank.
 */
export function numberOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/**
 * What the dialog sends. The rate periods go only when the form holds the loan's own: an edit
 * without them keeps the stored ones, where an empty list would delete them.
 */
export function loanBody(values: LoanFormValues, withPeriods = true): Record<string, unknown> {
  return {
    name: values.name,
    principal: numberOf(values.principal),
    interest_rate: numberOf(values.interest_rate),
    term_months: numberOf(values.term_months),
    start_date: values.start_date,
    ...(withPeriods
      ? {
          rate_periods: values.rate_periods.map((period) => ({
            rate: numberOf(period.rate),
            start_month: numberOf(period.start_month),
            end_month: numberOf(period.end_month),
          })),
        }
      : {}),
  }
}

/** A stored rate period as the form shows it. An end of 0, as older versions stored it, is none. */
export function periodValues(period: StoredRatePeriod): RatePeriodValues {
  return {
    rate: String(period.rate),
    start_month: String(period.start_month),
    end_month: period.end_month ? String(period.end_month) : '',
  }
}

export interface LoanFormOptions {
  /** After a save: close the dialog. */
  onSaved: () => void
}

export function createLoanForm(options: LoanFormOptions): LoanForm {
  /** The loan an edit opened, which its check compares against. Null for a new one. */
  let editing: EditableLoan | null = null
  const [periods, setPeriods] = createSignal<PeriodsState>('ready')

  const form = createForm<LoanFormValues>({
    initial: BLANK_LOAN,
    check: (values) => {
      const body = loanBody(values, periods() === 'ready')
      return fieldErrorsOf(editing ? checkLoanEdit(body, editing) : checkLoanCreate(body))
    },
    send: async (values) => {
      const body = loanBody(values, periods() === 'ready')
      const name = values.name.trim()
      if (editing) {
        await apiPut(`/api/loans/${editing.id}`, body)
        showToast(`Saved your changes to "${name}".`, 'success')
        return
      }
      await apiPost('/api/loans', body)
      showToast(`Added "${name}" to your loans.`, 'success')
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the loan. Try again.",
  })

  const open = (loan?: EditableLoan | null) => {
    editing = loan ? { ...loan } : null
    setPeriods(!loan || loan.rate_periods ? 'ready' : 'loading')
    form.reset(
      loan
        ? {
            name: loan.name,
            principal: String(loan.principal),
            interest_rate: String(loan.interest_rate),
            term_months: String(loan.term_months),
            // A date input shows a day, and older rows can carry a time after it.
            start_date: (loan.start_date ?? '').slice(0, 10),
            rate_periods: (loan.rate_periods ?? []).map(periodValues),
          }
        : BLANK_LOAN
    )
  }

  const periodsRead = (stored: StoredRatePeriod[]) => {
    if (!editing) return
    editing = { ...editing, rate_periods: stored }
    setPeriods('ready')
    form.set('rate_periods', stored.map(periodValues))
  }

  const setPeriod = (index: number, field: keyof RatePeriodValues, text: string) => {
    form.set(
      'rate_periods',
      form.values.rate_periods.map((period, i) =>
        i === index ? { ...period, [field]: text } : period
      )
    )
  }

  return Object.assign(form, {
    open,
    periodsRead,
    periodsFailed: () => setPeriods('failed'),
    periods,
    // A new period starts at the loan's own rate, from the first payment, as it always has.
    addPeriod: () =>
      form.set('rate_periods', [
        ...form.values.rate_periods,
        { rate: form.values.interest_rate, start_month: '1', end_month: '' },
      ]),
    setPeriod,
    removePeriod: (index: number) =>
      form.set(
        'rate_periods',
        form.values.rate_periods.filter((_, i) => i !== index)
      ),
  })
}
