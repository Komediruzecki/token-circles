/**
 * Extra payments: the ones saved on the loan, a form to add one, and the loan's rate periods.
 * Saved extra payments always finish the loan sooner; paying less each month is something
 * Compare shows, not something saved yet.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { addCalendarMonths } from '../../../../shared/loanSchedule'
import ConfirmButton from '../../components/ConfirmButton'
import NumberField from '../../components/NumberField'
import styles from './Loans.module.css'
import { dayLabel } from './LoanSchedule'
import type { Formats } from './loanCopy'
import type { SavedExtra, StoredRatePeriod } from './loanData'

interface Props {
  loanName: string
  startDate: string
  baseRate: number
  extras: SavedExtra[]
  ratePeriods: StoredRatePeriod[]
  /** The months an extra payment can go with: up to the loan's last payment as it stands. */
  lastMonth: number
  /** The month of the next payment, which a new extra payment goes with unless changed. */
  nextMonth: number
  canWrite: boolean
  ownerName: string
  compareHref: string
  formats: Formats
  onAdd: (extra: { month: number; amount: number; note: string }) => Promise<boolean>
  onDelete: (extra: SavedExtra) => Promise<void>
  onEditRates: () => void
}

export default function LoanExtras(props: Props) {
  const [month, setMonth] = createSignal(props.nextMonth)
  const [amount, setAmount] = createSignal<number | null>(null)
  const [note, setNote] = createSignal('')
  const [saving, setSaving] = createSignal(false)

  const dateOf = (m: number) => addCalendarMonths(props.startDate, m - 1)
  const whenLabel = (m: number) => {
    const date = dateOf(m)
    return date ? `Payment ${m}, ${dayLabel(date)}` : `Payment ${m}`
  }
  const months = createMemo(() =>
    Array.from({ length: Math.max(1, props.lastMonth) }, (_, i) => i + 1)
  )
  const periods = createMemo(() =>
    [...props.ratePeriods].sort((x, y) => x.start_month - y.start_month)
  )
  const periodLabel = (p: StoredRatePeriod) => {
    const start = p.start_month
    const end = p.end_month || null
    const from = dateOf(start)
    const span = end ? `Payments ${start} to ${end}` : `From payment ${start}`
    return from ? `${span} (from ${dayLabel(from)})` : span
  }

  const submit = async (e: Event) => {
    e.preventDefault()
    const value = amount()
    if (value === null || value <= 0 || saving()) return
    setSaving(true)
    const ok = await props.onAdd({
      month: month(),
      amount: Math.round(value * 100) / 100,
      note: note().trim(),
    })
    setSaving(false)
    if (ok) {
      setAmount(null)
      setNote('')
    }
  }

  return (
    <div class={styles.panel} data-test-id="loans-extras">
      <section class={styles.section} aria-labelledby="loan-extras-title">
        <h2 class={styles.sectionTitle} id="loan-extras-title">
          Extra payments
        </h2>
        <p class={styles.hint}>
          A saved extra payment finishes the loan sooner: the installment stays the same and the
          last payment comes earlier. To see what paying less each month would do instead, open{' '}
          <a class={styles.link} href={props.compareHref}>
            Compare
          </a>
          .
        </p>

        <Show
          when={props.extras.length > 0}
          fallback={
            <p class={styles.hint} data-test-id="loans-extras-empty">
              No extra payments saved on this loan.
            </p>
          }
        >
          <ul class={styles.list} data-test-id="loans-extras-list">
            <For each={props.extras}>
              {(extra) => (
                <li class={styles.listItem} data-test-id="loans-extra-item">
                  <span class={styles.listWhen}>
                    {whenLabel(extra.month)}
                    <Show when={extra.note}>
                      <small>{extra.note}</small>
                    </Show>
                  </span>
                  <span class={styles.listAmount}>{props.formats.money(extra.amount)}</span>
                  <Show when={props.canWrite} fallback={<span />}>
                    <span data-test-id="loans-extra-delete">
                      <ConfirmButton
                        class={styles.buttonQuiet}
                        aria-label={`Remove the extra payment with payment ${extra.month}`}
                        message={`Remove the extra payment of ${props.formats.money(extra.amount)} with payment ${extra.month}?`}
                        confirmText="Remove"
                        onConfirm={() => props.onDelete(extra)}
                        label={
                          <svg
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        }
                      />
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show
          when={props.canWrite}
          fallback={
            <p class={styles.notice}>
              This loan belongs to {props.ownerName}. Switch to {props.ownerName} to add or remove
              extra payments.
            </p>
          }
        >
          <form class={styles.form} onSubmit={submit} data-test-id="loans-extra-form">
            <label class={styles.field}>
              When
              <select
                class={styles.select}
                data-test-id="loans-extra-month"
                value={String(month())}
                onChange={(e) => setMonth(Number(e.currentTarget.value))}
              >
                <For each={months()}>
                  {(m) => <option value={String(m)}>{whenLabel(m)}</option>}
                </For>
              </select>
            </label>
            <label class={styles.field}>
              Amount
              <NumberField<null>
                class={styles.input}
                testId="loans-extra-amount"
                step="0.01"
                min="0.01"
                placeholder="1000.00"
                required
                value={amount()}
                emptyValue={null}
                onChange={setAmount}
              />
            </label>
            <label class={styles.field}>
              Note (optional)
              <input
                class={styles.input}
                type="text"
                data-test-id="loans-extra-note"
                placeholder="Bonus, gift, savings"
                value={note()}
                onInput={(e) => setNote(e.currentTarget.value)}
              />
            </label>
            <button
              type="submit"
              class={styles.buttonPrimary}
              data-test-id="loans-extra-add"
              disabled={saving()}
            >
              Add extra payment
            </button>
          </form>
        </Show>
      </section>

      <section class={styles.section} aria-labelledby="loan-rates-title">
        <h2 class={styles.sectionTitle} id="loan-rates-title">
          Rates
        </h2>
        <p class={styles.hint}>
          The loan's own rate is {props.baseRate}%. A rate period charges its own rate for the
          payments it covers, and the installment is worked out again from there.
        </p>
        <Show when={periods().length > 0}>
          <ul class={styles.list} data-test-id="loans-rates">
            <For each={periods()}>
              {(p) => (
                <li class={styles.listItem} data-test-id="loans-rate-period">
                  <span class={styles.listWhen}>{periodLabel(p)}</span>
                  <span class={styles.listAmount}>{p.rate}%</span>
                  <span />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={props.canWrite}>
          <button
            type="button"
            class={styles.button}
            style={{ 'justify-self': 'start' }}
            data-test-id="loans-edit-rates"
            onClick={() => {
              props.onEditRates()
            }}
          >
            Edit rates
          </button>
        </Show>
      </section>
    </div>
  )
}
