/**
 * Extra payments: the ones saved on the loan, each changed or removed in place, a form to add one,
 * and the loan's rate periods. Saved extra payments always finish the loan sooner; paying less each
 * month is something Compare shows, not something saved yet.
 *
 * Adding one and changing one are `createExtraPaymentForm` (extraPaymentForm.ts) on the form kit:
 * a refused save is said under the field it is about, and what belongs to no field in the notice
 * above the fields. Saving goes through apiFetch, which bumps the `loans` data version, so the page
 * reloads the loan on its own.
 */
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { addCalendarMonths } from '../../../../shared/loanSchedule'
import ConfirmButton from '../../components/ConfirmButton'
import { Field, FormNotice, SubmitButton } from '../../components/form'
import { createExtraPaymentForm } from './extraPaymentForm'
import styles from './Loans.module.css'
import { dayLabel } from './LoanSchedule'
import type { ExtraPaymentForm } from './extraPaymentForm'
import type { Formats } from './loanCopy'
import type { SavedExtra, StoredRatePeriod } from './loanData'

interface Props {
  loanId: number
  loanName: string
  /** The loan's term: an extra payment goes with one of its payments. */
  termMonths: number
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
  onDelete: (extra: SavedExtra) => Promise<void>
  onEditRates: () => void
}

/** The test ids of one form's fields. */
interface FieldIds {
  month: string
  amount: string
  note: string
}

export default function LoanExtras(props: Props) {
  const loan = () => ({ id: props.loanId, name: props.loanName, term_months: props.termMonths })
  const money = (amount: number) => props.formats.money(amount)

  // After an add, the form starts over with the same payment picked, for the next one.
  const addForm = createExtraPaymentForm({
    mode: 'add',
    loan,
    money,
    onSaved: () => {
      addForm.start(Number(addForm.values.month))
    },
  })
  addForm.start(props.nextMonth)

  // The saved extra payment being changed in place, by its ref. The form's values live here rather
  // than in the row, so a list that reloads under the form keeps what was typed.
  const [editing, setEditing] = createSignal<number | null>(null)
  const editForm = createExtraPaymentForm({
    mode: 'change',
    loan,
    money,
    onSaved: () => {
      const ref = editing()
      if (ref !== null) stopEdit(ref)
    },
  })

  // A payment removed while its change is open, here or in another tab, closes the change. Left
  // open, it would wait on the id, and local-first gives a removed last payment's id to the next
  // payment added, which would then open holding the removed one's values.
  createEffect(() => {
    const ref = editing()
    if (ref !== null && !props.extras.some((extra) => extra.ref === ref)) setEditing(null)
  })
  let list: HTMLUListElement | undefined

  const dateOf = (m: number) => addCalendarMonths(props.startDate, m - 1)
  const whenLabel = (m: number) => {
    const date = dateOf(m)
    return date ? `Payment ${m}, ${dayLabel(date)}` : `Payment ${m}`
  }
  const monthsUpTo = (last: number) => Array.from({ length: Math.max(1, last) }, (_, i) => i + 1)
  const months = createMemo(() => monthsUpTo(props.lastMonth))
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

  const focusIn = (selector: string) => {
    queueMicrotask(() => list?.querySelector<HTMLElement>(selector)?.focus())
  }

  const startEdit = (extra: SavedExtra) => {
    editForm.open(extra)
    setEditing(extra.ref)
    focusIn('[data-test-id="loans-extra-edit-amount"]')
  }

  function stopEdit(ref: number) {
    setEditing(null)
    focusIn(`[data-test-id="loans-extra-edit"][data-ref="${ref}"]`)
  }

  /** The fields both forms have: the payment it goes with, the amount and a note. */
  const fields = (form: ExtraPaymentForm, offered: () => number[], ids: FieldIds) => (
    <>
      <Field form={form} name="month" label="When" class={styles.field}>
        {(control) => (
          <select
            {...control}
            class={styles.select}
            data-test-id={ids.month}
            value={form.values.month}
            onChange={(e) => form.set('month', e.currentTarget.value)}
          >
            <For each={offered()}>
              {(m) => (
                <option value={String(m)} selected={String(m) === form.values.month}>
                  {whenLabel(m)}
                </option>
              )}
            </For>
          </select>
        )}
      </Field>
      <Field form={form} name="amount" label="Amount" class={styles.field}>
        {(control) => (
          <input
            {...control}
            type="text"
            inputmode="decimal"
            class={styles.input}
            data-test-id={ids.amount}
            placeholder="1000.00"
            value={form.values.amount}
            onInput={(e) => form.set('amount', e.currentTarget.value)}
          />
        )}
      </Field>
      <Field form={form} name="note" label="Note (optional)" class={styles.field}>
        {(control) => (
          <input
            {...control}
            type="text"
            class={styles.input}
            data-test-id={ids.note}
            placeholder="Bonus, gift, savings"
            value={form.values.note}
            onInput={(e) => form.set('note', e.currentTarget.value)}
          />
        )}
      </Field>
    </>
  )

  const deleteButton = (extra: SavedExtra) => (
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
  )

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
          <ul class={styles.list} data-test-id="loans-extras-list" ref={list}>
            <For each={props.extras}>
              {(extra) => (
                <Show
                  when={editing() === extra.ref}
                  fallback={
                    <li class={styles.listItem} data-test-id="loans-extra-item">
                      <span class={styles.listWhen}>
                        {whenLabel(extra.month)}
                        <Show when={extra.note}>
                          <small>{extra.note}</small>
                        </Show>
                      </span>
                      <span class={styles.listAmount}>{props.formats.money(extra.amount)}</span>
                      <Show when={props.canWrite} fallback={<span />}>
                        <span class={styles.listActions}>
                          <button
                            type="button"
                            class={styles.buttonQuiet}
                            data-test-id="loans-extra-edit"
                            data-ref={extra.ref}
                            aria-label={`Change the extra payment with payment ${extra.month}`}
                            title="Change"
                            onClick={() => {
                              startEdit(extra)
                            }}
                          >
                            <svg
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          {deleteButton(extra)}
                        </span>
                      </Show>
                    </li>
                  }
                >
                  <li
                    class={`${styles.listItem} ${styles.listItemEditing}`}
                    data-test-id="loans-extra-item"
                  >
                    <form
                      class={styles.form}
                      data-test-id="loans-extra-edit-form"
                      aria-label={`Change the extra payment with payment ${extra.month}`}
                      {...editForm.attrs}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return
                        e.preventDefault()
                        stopEdit(extra.ref)
                      }}
                    >
                      <FormNotice form={editForm} testId="loans-extra-edit-notice" />
                      <div class={styles.formFields}>
                        {fields(
                          editForm,
                          () => monthsUpTo(Math.max(props.lastMonth, extra.month)),
                          {
                            month: 'loans-extra-edit-month',
                            amount: 'loans-extra-edit-amount',
                            note: 'loans-extra-edit-note',
                          }
                        )}
                        <div class={styles.formActions}>
                          <SubmitButton
                            class={styles.buttonPrimary}
                            data-test-id="loans-extra-save"
                            busy={editForm.submitting()}
                          >
                            Save
                          </SubmitButton>
                          <button
                            type="button"
                            class={styles.button}
                            data-test-id="loans-extra-cancel"
                            onClick={() => {
                              stopEdit(extra.ref)
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </form>
                  </li>
                </Show>
              )}
            </For>
          </ul>
        </Show>

        <Show
          when={props.canWrite}
          fallback={
            <p class={styles.notice}>
              This loan belongs to {props.ownerName}. Switch to {props.ownerName} to add, change or
              remove extra payments.
            </p>
          }
        >
          <form class={styles.form} data-test-id="loans-extra-form" {...addForm.attrs}>
            <FormNotice form={addForm} testId="loans-extra-notice" />
            <div class={styles.formFields}>
              {fields(addForm, months, {
                month: 'loans-extra-month',
                amount: 'loans-extra-amount',
                note: 'loans-extra-note',
              })}
              <div class={styles.formActions}>
                <SubmitButton
                  class={styles.buttonPrimary}
                  data-test-id="loans-extra-add"
                  busy={addForm.submitting()}
                  busyLabel="Adding…"
                >
                  Add extra payment
                </SubmitButton>
              </div>
            </div>
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
