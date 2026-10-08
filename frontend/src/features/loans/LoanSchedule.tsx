/**
 * Month by month: the loan's schedule as planned, one row per payment, with a CSV download. The
 * rows come from the shared engine on the page, the same schedule the calculate route returns.
 */
import { createMemo, For, Show } from 'solid-js'
import { getLocalCurrency } from '../../core/api'
import styles from './Loans.module.css'
import type { ScheduleRow } from '../../../../shared/loanSchedule'
import type { Formats } from './loanCopy'

interface Props {
  rows: ScheduleRow[]
  loanName: string
  /** The month from which the loan is never repaid: the rows stop before it. */
  neverPaysOffFrom: number | null
  formats: Formats
}

const amount = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * A YYYY-MM-DD due date as written, e.g. "Feb 28, 2026". `new Date('2026-02-28')` is midnight UTC,
 * so it is formatted in UTC: in the local zone it would read Feb 27 anywhere west of Greenwich.
 */
export function dayLabel(date: string): string {
  const d = new Date(date)
  if (!date || Number.isNaN(d.getTime())) return '–'
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** The schedule as CSV, in the columns the export has always had. */
export function scheduleCsv(rows: readonly ScheduleRow[]): string {
  const headers = [
    'Month',
    'Date',
    'Payment',
    'Principal',
    'Interest',
    'Balance',
    'Rate',
    'Prepayment',
    'Note',
  ]
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = rows.map((r) =>
    [
      r.month,
      r.date,
      r.payment.toFixed(2),
      r.principal.toFixed(2),
      r.interest.toFixed(2),
      r.balance.toFixed(2),
      r.rate.toFixed(3),
      r.prepayment ? r.prepayment.toFixed(2) : '0',
      r.note || '',
    ]
      .map(escape)
      .join(',')
  )
  return [headers.map(escape).join(','), ...lines].join('\n')
}

function download(rows: readonly ScheduleRow[], loanName: string) {
  const blob = new Blob([scheduleCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${loanName.replace(/\s+/g, '_')}_amortization.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function LoanSchedule(props: Props) {
  const totalInterest = createMemo(() => props.rows.reduce((sum, r) => sum + r.interest, 0))
  const hasNotes = createMemo(() => props.rows.some((r) => r.note))
  const last = () => props.rows[props.rows.length - 1]

  return (
    <div class={styles.section}>
      <div class={styles.scheduleHead}>
        <p class={styles.hint} data-test-id="loans-schedule-summary">
          <Show when={last()} fallback="This loan has no payments to show.">
            {(row) => (
              <>
                {props.rows.length === 1 ? '1 payment' : `${props.rows.length} payments`}
                {row().date ? `, the last on ${dayLabel(row().date)}` : ''}. Interest in all:{' '}
                {props.formats.money(totalInterest())}. Amounts in {getLocalCurrency()}.
              </>
            )}
          </Show>
        </p>
        <button
          type="button"
          class={styles.button}
          data-test-id="loans-schedule-export"
          disabled={props.rows.length === 0}
          onClick={() => {
            download(props.rows, props.loanName)
          }}
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download CSV
        </button>
      </div>

      <Show when={props.neverPaysOffFrom !== null}>
        <p class={styles.notice}>
          From payment {props.neverPaysOffFrom} the installment no longer covers the interest, so
          this loan is never repaid. The table stops there.
        </p>
      </Show>

      <Show when={props.rows.length > 0}>
        <div
          class={styles.tableWrap}
          tabIndex={0}
          aria-label={`Schedule for ${props.loanName}`}
          role="region"
        >
          <table class={styles.table} data-test-id="loans-schedule-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col" class={styles.text}>
                  Due
                </th>
                <th scope="col">Installment</th>
                <th scope="col">Interest</th>
                <th scope="col">Principal</th>
                <th scope="col">Extra</th>
                <th scope="col">Balance</th>
                <th scope="col">Rate</th>
                <Show when={hasNotes()}>
                  <th scope="col" class={styles.text}>
                    Note
                  </th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows}>
                {(row, i) => {
                  const rateChanged = i() > 0 && props.rows[i() - 1].rate !== row.rate
                  return (
                    <tr
                      class={row.month % 12 === 0 ? styles.yearEnd : undefined}
                      data-test-id="loans-schedule-row"
                    >
                      <td>{row.month}</td>
                      <td class={styles.text}>{dayLabel(row.date)}</td>
                      <td>{amount.format(row.payment)}</td>
                      <td>{amount.format(row.interest)}</td>
                      <td>{amount.format(row.principal)}</td>
                      <td class={row.prepayment > 0 ? styles.extraCell : undefined}>
                        {row.prepayment > 0 ? amount.format(row.prepayment) : '–'}
                      </td>
                      <td>{amount.format(row.balance)}</td>
                      <td class={rateChanged ? styles.rateChange : undefined}>{row.rate}%</td>
                      <Show when={hasNotes()}>
                        <td class={styles.text}>{row.note}</td>
                      </Show>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  )
}
