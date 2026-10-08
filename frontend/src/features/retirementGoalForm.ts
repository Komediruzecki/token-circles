/**
 * The Retirement page's goal dialog, written down once: its values, the body it sends, the check
 * it runs before sending, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/retirementGoalSchema.ts), so a missing name, an
 * age outside 18 to 100 or a return over 20 % is caught here, in the same words, before anything
 * is sent, and a field the runtime refuses is marked the same way. Every refused save used to say
 * "Failed to save retirement goal" in a toast, whatever was wrong, with nothing in the dialog
 * marked.
 *
 * The date field is the goal's `deadline`, the name the runtimes refuse it under, so their words
 * land under it. The body sends it as `target_date`, as the page always has.
 *
 * An edit checks only what it changes, as the runtimes do: a goal an older version stored under no
 * rules can still be renamed. The dialog opens on the values as stored, so what it sends back
 * unchanged is the same value.
 */
import { fieldErrorsOf } from '../../../shared/refusal'
import {
  checkRetirementGoalCreate,
  checkRetirementGoalEdit,
} from '../../../shared/retirementGoalSchema'
import { createForm } from '../components/form'
import { apiPost, apiPut, showToast } from '../core/api'
import { parseDecimalInput } from '../core/decimalInput'
import type { Form } from '../components/form'

export interface RetirementGoalValues {
  name: string
  target_amount: string
  current_amount: string
  /** The target date, YYYY-MM-DD, or blank for none. Sent as `target_date`. */
  deadline: string
  monthly_contribution: string
  expected_return_rate: string
  current_age: string
  retirement_age: string
}

/** A goal as the page holds one, to open it for editing: its values as stored. */
export interface EditableRetirementGoal {
  id: number
  name: string
  target_amount: number | null
  current_amount: number | null
  deadline: string | null
  monthly_contribution: number | null
  expected_return_rate: number | null
  current_age: number | null
  retirement_age: number | null
}

export type RetirementGoalForm = Form<RetirementGoalValues> & {
  /** Fill the form for a new goal, or with `goal` to edit it. */
  open: (goal?: EditableRetirementGoal | null) => void
}

const BLANK: RetirementGoalValues = {
  name: '',
  target_amount: '',
  current_amount: '',
  deadline: '',
  monthly_contribution: '',
  expected_return_rate: '',
  current_age: '',
  retirement_age: '',
}

/**
 * A number as typed: a number when it reads as one (a comma or a dot for the decimals), the text
 * when it does not, so the rules say what is wrong with it, and null when it is blank.
 */
function numberOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/** A stored value as the dialog shows it: blank for none. */
const shown = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value)

/** What the dialog sends: every field it shows, the date as `target_date`. */
export function retirementGoalBody(values: RetirementGoalValues): Record<string, unknown> {
  return {
    name: values.name,
    target_amount: numberOf(values.target_amount),
    current_amount: numberOf(values.current_amount),
    target_date: values.deadline,
    monthly_contribution: numberOf(values.monthly_contribution),
    expected_return_rate: numberOf(values.expected_return_rate),
    current_age: numberOf(values.current_age),
    retirement_age: numberOf(values.retirement_age),
  }
}

export interface RetirementGoalFormOptions {
  /** After a save: close the dialog. The form itself is reset by `open`. */
  onSaved: () => void
}

export function createRetirementGoalForm(options: RetirementGoalFormOptions): RetirementGoalForm {
  /** The goal an edit opened, which its check compares against. Null for a new one. */
  let editing: EditableRetirementGoal | null = null

  const form = createForm<RetirementGoalValues>({
    initial: BLANK,
    check: (values) => {
      const body = retirementGoalBody(values)
      return fieldErrorsOf(
        editing ? checkRetirementGoalEdit(body, editing) : checkRetirementGoalCreate(body)
      )
    },
    send: async (values) => {
      const body = retirementGoalBody(values)
      const name = values.name.trim()
      if (editing) {
        await apiPut(`/api/retirement-goals/${editing.id}`, body)
        showToast(`Saved your changes to "${name}".`, 'success')
        return
      }
      await apiPost('/api/retirement-goals', body)
      showToast(`Added "${name}" to your retirement goals.`, 'success')
    },
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save the retirement goal. Try again.",
  })

  const open = (goal?: EditableRetirementGoal | null) => {
    editing = goal ?? null
    form.reset(
      goal
        ? {
            name: goal.name,
            target_amount: shown(goal.target_amount),
            current_amount: shown(goal.current_amount),
            // A date input shows a day, and older rows can carry a time after it.
            deadline: (goal.deadline ?? '').slice(0, 10),
            monthly_contribution: shown(goal.monthly_contribution),
            expected_return_rate: shown(goal.expected_return_rate),
            current_age: shown(goal.current_age),
            retirement_age: shown(goal.retirement_age),
          }
        : BLANK
    )
  }

  return Object.assign(form, { open })
}
