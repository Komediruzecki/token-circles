/**
 * The Goals dialog's form and the "Add Funds" form on a goal's card, written down once: their
 * values, the check each runs before sending, the call, and the toast that says it worked.
 *
 * The checks are the ones both runtimes run (shared/goalSchema.ts), so a blank name or a target of
 * zero is caught here, in the same words, before anything is sent. Every refused save used to say
 * "Failed to save goal" or "Failed to add contribution" in a toast, with nothing in the dialog
 * marked.
 *
 * The date field is the goal's `deadline`, which is the name the runtimes refuse it under, so their
 * words land under it. The body still sends it as `target_date`, as the page always has: an older
 * Worker reads only that name.
 *
 * An edit checks only what it changes, as the runtimes do: a goal saved under older rules (a target
 * of zero, a name over 100 characters) can still be renamed.
 */
import { checkContribution, checkGoalCreate, checkGoalEdit } from '../../../shared/goalSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, formatCurrency, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import { localToday } from '../utils/period'
import type { Form } from '../components/form'

export interface GoalFormValues {
  name: string
  target_amount: string
  /** The target date, YYYY-MM-DD, or blank for none. Sent as `target_date`. */
  deadline: string
  monthly_contribution: string
  /** The linked category's id, or blank for a goal tracked by hand. */
  category_id: string
  tracking_start_date: string
}

/** A goal as the page holds one, to open it for editing. */
export interface EditableGoal {
  id: number
  name: string
  target_amount: number
  monthly_contribution: number
  target_date: string | null
  category_id?: number | null
  tracking_start_date?: string | null
}

export type GoalForm = Form<GoalFormValues> & {
  /** Fill the form for a new goal, or with `goal` to edit it. */
  open: (goal?: EditableGoal | null) => void
}

const BLANK: GoalFormValues = {
  name: '',
  target_amount: '',
  deadline: '',
  monthly_contribution: '',
  category_id: '',
  tracking_start_date: '',
}

/**
 * An amount as typed: a number when it reads as one (a comma or a dot for the cents), the text
 * when it does not, so the rules say what is wrong with it, and null when it is blank.
 */
function amountOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/** The body the page has always sent: the date as `target_date`, a category's start date. */
export function goalBody(values: GoalFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: values.name,
    target_amount: amountOf(values.target_amount),
    target_date: values.deadline,
    monthly_contribution: amountOf(values.monthly_contribution),
    category_id: values.category_id ? Number(values.category_id) : null,
  }
  // A category goal counts that category's transactions from this date on: today unless set.
  if (values.category_id) body.tracking_start_date = values.tracking_start_date || localToday()
  return body
}

export interface GoalFormOptions {
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
}

export function createGoalForm(options: GoalFormOptions): GoalForm {
  /** The goal an edit opened, which its check compares against. Null for a new one. */
  let editing: EditableGoal | null = null

  const form = createForm<GoalFormValues>({
    initial: BLANK,
    check: (values) => {
      const body = goalBody(values)
      return fieldErrorsOf(
        editing ? checkGoalEdit(body, editing) : checkGoalCreate(body, { today: localToday() })
      )
    },
    send: async (values) => {
      const body = goalBody(values)
      const name = values.name.trim()
      if (editing) {
        await apiPut(`/api/savings-goals/${editing.id}`, body)
        showToast(`Saved your changes to "${name}".`, 'success')
        return
      }
      await apiPost('/api/savings-goals', body)
      showToast(`Added "${name}" to your goals.`, 'success')
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the goal. Try again.",
  })

  const open = (goal?: EditableGoal | null) => {
    editing = goal ?? null
    form.reset(
      goal
        ? {
            name: goal.name,
            target_amount: String(goal.target_amount),
            deadline: goal.target_date ?? '',
            monthly_contribution: goal.monthly_contribution
              ? String(goal.monthly_contribution)
              : '',
            category_id: goal.category_id ? String(goal.category_id) : '',
            tracking_start_date: goal.tracking_start_date || '',
          }
        : BLANK
    )
  }

  return Object.assign(form, { open })
}

export interface ContributionFormValues {
  amount: string
}

/** The goal "Add Funds" is open on. */
export interface ContributionTarget {
  id: number
  name: string
}

export type ContributionForm = Form<ContributionFormValues> & {
  /** Open the form on `goal`'s card, empty. */
  open: (goal: ContributionTarget) => void
}

export interface ContributionFormOptions {
  /** After the money is added: close the form. */
  onSaved: () => void
}

export function createContributionForm(options: ContributionFormOptions): ContributionForm {
  let goal: ContributionTarget | null = null

  const form = createForm<ContributionFormValues>({
    initial: { amount: '' },
    check: (values) => fieldErrorsOf(checkContribution({ amount: amountOf(values.amount) })),
    send: async (values) => {
      if (!goal) return
      const amount = amountOf(values.amount)
      await apiPost(`/api/savings-goals/${goal.id}/contribute`, { amount })
      showToast(`Added ${formatCurrency(Number(amount))} to "${goal.name}".`, 'success')
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't add the money to the goal. Try again.",
  })

  const open = (target: ContributionTarget) => {
    goal = target
    form.reset({ amount: '' })
  }

  return Object.assign(form, { open })
}
