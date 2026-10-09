/**
 * The Housing page's "Add Housing Expense" form, written down once: its values, the check it runs
 * before sending, the call, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/housingSchema.ts), so a blank name, an amount of
 * zero or a due day that is not one is said under its field, in the same words, before anything
 * is sent. A refused save used to say "Failed to save housing expense" in a toast, with nothing
 * in the dialog marked, and the browser's own bubble said the rest in its words.
 *
 * The amount is read with a comma or a dot for the cents, as the Bills dialog reads it, and the
 * due day is the text typed: a day that is not a whole number from 1 to 31 is marked, where the
 * old field turned it into the 1st without a word.
 */
import { checkHousingCreate } from '../../../shared/housingSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import { localMonth } from '../utils/period'
import type { Form } from '../components/form'

export interface HousingFormValues {
  type: string
  property_name: string
  monthly_amount: string
  /** The month, 1 to 12, as the select's value. */
  due_month: string
  due_day: string
  autopay: boolean
  notes: string
}

export type HousingForm = Form<HousingFormValues> & {
  /** Fill the form for a new expense: rent, due on the 1st of this month. */
  open: () => void
}

/** This month on the person's calendar, 1 to 12. */
const thisMonth = (): number => Number(localMonth().slice(5, 7))

const blank = (): HousingFormValues => ({
  type: 'rent',
  property_name: '',
  monthly_amount: '',
  due_month: String(thisMonth()),
  due_day: '1',
  autopay: false,
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

/** The body the dialog sends. */
export function housingBody(values: HousingFormValues): Record<string, unknown> {
  return {
    type: values.type,
    property_name: values.property_name,
    monthly_amount: numberOf(values.monthly_amount),
    due_month: values.due_month ? Number(values.due_month) : null,
    due_day: numberOf(values.due_day),
    autopay: values.autopay,
    notes: values.notes,
  }
}

export interface HousingFormOptions {
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
}

export function createHousingForm(options: HousingFormOptions): HousingForm {
  const form = createForm<HousingFormValues>({
    initial: blank(),
    check: (values) =>
      fieldErrorsOf(checkHousingCreate(housingBody(values), { month: thisMonth() })),
    send: async (values) => {
      await apiPost('/api/housing', housingBody(values))
      showToast(`Added "${values.property_name.trim()}" to your housing costs.`, 'success')
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the housing expense. Try again.",
  })

  const open = () => {
    form.reset(blank())
  }

  return Object.assign(form, { open })
}
