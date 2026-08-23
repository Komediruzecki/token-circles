/**
 * MonthPicker — a month/year control that does not make you hunt for a year.
 *
 * Replaces `<input type="month">`. The native control is a day-calendar with the days
 * taken out: Chromium renders a month grid and steps the year one click at a time, so
 * reaching a birth year is thirty-odd clicks, and Firefox has no picker at all. A month
 * value has no day in it, so it needs no calendar — two selects say the same thing, jump
 * to any year in one gesture, type-ahead ("1990"), and behave identically everywhere.
 *
 * The value is the same `YYYY-MM` string the native input produces, so callers and the
 * stored settings are unchanged.
 */
import { createMemo, For } from 'solid-js'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface MonthPickerProps {
  /** `YYYY-MM`, or null/'' for no selection. */
  value: string | null | undefined
  /** Emits `YYYY-MM`, or null once the control is cleared. */
  onChange: (value: string | null) => void
  /** Earliest selectable year. */
  fromYear: number
  /** Latest selectable year. */
  toYear: number
  /** Offer a blank option, for genuinely optional months (an open-ended period). */
  allowEmpty?: boolean
  /** Placeholder for the blank option. */
  emptyLabel?: string
  class?: string
  ariaLabel?: string
  testId?: string
  id?: string
  disabled?: boolean
}

/** Split `YYYY-MM` into parts, tolerating a half-typed or absent value. */
function parts(value: string | null | undefined): { year: number | null; month: number | null } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? '')
  if (!match) return { year: null, month: null }
  return { year: Number(match[1]), month: Number(match[2]) }
}

export default function MonthPicker(props: MonthPickerProps) {
  const years = createMemo(() => {
    const from = Math.min(props.fromYear, props.toYear)
    const to = Math.max(props.fromYear, props.toYear)
    const list: number[] = []
    // Newest first: every real use of this control — a birth year, a plan that starts
    // soon — is nearer the recent end than the far one.
    for (let y = to; y >= from; y--) list.push(y)
    return list
  })

  const current = createMemo(() => parts(props.value))

  /**
   * A month is only a value once both halves are chosen. Emitting a half-value would
   * write `2026-` into settings and read back as no month at all.
   */
  const emit = (year: number | null, month: number | null) => {
    if (year === null || month === null) {
      props.onChange(null)
      return
    }
    props.onChange(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`)
  }

  return (
    <span class={props.class} data-test-id={props.testId} role="group" aria-label={props.ariaLabel}>
      <select
        id={props.id}
        aria-label={props.ariaLabel ? `${props.ariaLabel} — month` : 'Month'}
        disabled={props.disabled}
        value={current().month === null ? '' : String(current().month)}
        onChange={(e) => {
          const raw = e.currentTarget.value
          if (raw === '') {
            emit(null, null)
            return
          }
          // Choosing a month first is the common order. Default the year rather than
          // discarding the choice and looking broken.
          emit(current().year ?? props.toYear, Number(raw))
        }}
      >
        <For each={props.allowEmpty || current().month === null ? [''] : []}>
          {() => <option value="">{props.emptyLabel ?? 'Month'}</option>}
        </For>
        <For each={MONTHS}>{(label, i) => <option value={String(i() + 1)}>{label}</option>}</For>
      </select>
      <select
        aria-label={props.ariaLabel ? `${props.ariaLabel} — year` : 'Year'}
        disabled={props.disabled}
        value={current().year === null ? '' : String(current().year)}
        onChange={(e) => {
          const raw = e.currentTarget.value
          if (raw === '') {
            emit(null, null)
            return
          }
          emit(Number(raw), current().month ?? 1)
        }}
      >
        <For each={props.allowEmpty || current().year === null ? [''] : []}>
          {() => <option value="">{props.emptyLabel ?? 'Year'}</option>}
        </For>
        <For each={years()}>{(year) => <option value={String(year)}>{year}</option>}</For>
      </select>
    </span>
  )
}
