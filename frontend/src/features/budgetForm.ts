/**
 * Setting a category's budget for a month, written down once: the Budgets page's Allocate dialog,
 * its Set Budget dialog on a category card, and the Set Budget dialog on the Categories page.
 *
 * Each sets the month's one budget for the category (POST /api/budgets/allocate, which changes the
 * month's budget when it has one). The two Set Budget dialogs used to add a budget on every save
 * (POST /api/budgets), so a category set twice had two budgets that month, and the Budgets page's
 * Allocate sent no month, so a budget allocated while another month was on screen landed on this
 * one.
 *
 * The check is the one both runtimes run (shared/budgetSchema.ts): an amount of zero or more, to
 * the cent, read with a comma or a dot for the cents. A refused save is said under the field;
 * "Failed to allocate budget" and "Failed to set budget" in a toast said nothing about which.
 */
import { checkAllocation } from '../../../shared/budgetSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, formatCurrency, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import type { Form } from '../components/form'

export interface BudgetFormValues {
  /** The category's id. */
  category_id: string
  amount: string
}

export type BudgetForm = Form<BudgetFormValues> & {
  /** Fill the form for `categoryId`, with the month's budget for it when there is one. */
  open: (categoryId: number, amount?: number | null) => void
}

export interface BudgetFormOptions {
  /** The month the budget is for, YYYY-MM. */
  month: () => string
  /** The category's name, for the toast that says what was set. */
  nameOf: (categoryId: number) => string | undefined
  /** After a save: close the dialog. */
  onSaved: () => void
}

/**
 * The amount as typed: a number when it reads as one, the text when it does not, so the rules say
 * what is wrong with it, and null when it is blank.
 */
function amountOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/** The body the dialogs send: a monthly budget, for one category. */
export function budgetBody(values: BudgetFormValues): Record<string, unknown> {
  return {
    category_id: values.category_id ? Number(values.category_id) : null,
    amount: amountOf(values.amount),
    period: 'monthly',
  }
}

/** "October 2026", from "2026-10". */
export function monthName(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return new Date(year!, mon! - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function createBudgetForm(options: BudgetFormOptions): BudgetForm {
  const form = createForm<BudgetFormValues>({
    initial: { category_id: '', amount: '' },
    check: (values) => fieldErrorsOf(checkAllocation(budgetBody(values))),
    send: async (values) => {
      const body = budgetBody(values)
      const month = options.month()
      await apiPost(`/api/budgets/allocate?month=${encodeURIComponent(month)}`, body)
      const name = options.nameOf(Number(values.category_id)) ?? 'the category'
      showToast(
        `Set the ${name} budget for ${monthName(month)} to ${formatCurrency(Number(body.amount))}.`,
        'success'
      )
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the budget. Try again.",
  })

  const open = (categoryId: number, amount?: number | null) => {
    form.reset({
      category_id: String(categoryId),
      amount: amount ? String(amount) : '',
    })
  }

  return Object.assign(form, { open })
}
