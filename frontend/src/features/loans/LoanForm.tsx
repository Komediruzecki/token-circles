/**
 * Add a loan or edit one: its name, amount, rate, term, first due date and rate periods. Saving
 * goes through apiFetch, which bumps the `loans` data version, so the page reloads its list on its
 * own: nothing here reloads anything by hand.
 *
 * The form is `createLoanForm` (loanForm.ts) on the form kit: a refused save is said under the
 * field it is about, a rate period's under the field of its row, and what belongs to no field in
 * the notice at the top.
 */
import { createEffect, Index, on, onCleanup, onMount, Show } from 'solid-js'
import { Field, FormNotice, SubmitButton } from '../../components/form'
import { apiGet } from '../../core/api'
import { createLoanForm } from './loanForm'
import pageStyles from './LoanForm.module.css'
import styles from './Loans.module.css'
import type { LoanRow, StoredLoan } from './loanData'

interface Props {
  /** The loan being edited, or null to add one. */
  loan: LoanRow | null
  /** Open with the rate periods in view: from the Extra payments tab's "Edit rates". */
  focusRates?: boolean
  onClose: () => void
}

export default function LoanForm(props: Props) {
  const form = createLoanForm({
    onSaved: () => {
      props.onClose()
    },
  })
  let ratesRef: HTMLDivElement | undefined

  // Fill the form from the loan being edited, at once: it is typed into straight away. Its rate
  // periods come with a local-first row; in cloud mode they come from the loan's own read, which
  // then fills in the periods alone, so nothing typed meanwhile is overwritten.
  createEffect(
    on(
      () => props.loan,
      async (loan) => {
        if (!loan) {
          form.open(null)
          return
        }
        const known = loan.listed.rate_periods
        form.open({
          id: loan.id,
          name: loan.name,
          principal: loan.principal,
          interest_rate: loan.interest_rate,
          term_months: loan.term_months,
          start_date: loan.start_date,
          rate_periods: known,
        })
        if (props.focusRates) queueMicrotask(() => ratesRef?.scrollIntoView({ block: 'center' }))
        if (known) return
        try {
          const read = await apiGet<StoredLoan>(`/api/loans/${loan.id}`)
          if (props.loan?.id !== loan.id) return
          form.periodsRead(read.rate_periods ?? [])
        } catch {
          if (props.loan?.id === loan.id) form.periodsFailed()
        }
      }
    )
  )

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })

  return (
    <div
      data-test-id="loans-modal"
      class={pageStyles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-form-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={pageStyles.modal}>
        <div class={pageStyles.modalHeader}>
          <h3 class={pageStyles.modalTitle} id="loan-form-title">
            {props.loan ? `Edit ${props.loan.name}` : 'Add a loan'}
          </h3>
          <button
            type="button"
            class={pageStyles.modalClose}
            aria-label="Close"
            onClick={() => {
              props.onClose()
            }}
          >
            <svg
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form class={pageStyles.modalBody} {...form.attrs}>
          <FormNotice form={form} testId="loans-form-notice" />
          <Field
            form={form}
            name="name"
            label="Name"
            class={pageStyles.formGroup}
            labelClass={pageStyles.formLabel}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                class={pageStyles.formControl}
                placeholder="e.g., Auto Loan, Student Loan"
                value={form.values.name}
                onInput={(e) => form.set('name', e.currentTarget.value)}
                autofocus
                required
              />
            )}
          </Field>
          <Field
            form={form}
            name="principal"
            label="Amount borrowed"
            class={pageStyles.formGroup}
            labelClass={pageStyles.formLabel}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputmode="decimal"
                class={pageStyles.formControl}
                placeholder="15000.00"
                value={form.values.principal}
                onInput={(e) => form.set('principal', e.currentTarget.value)}
                required
              />
            )}
          </Field>
          <Field
            form={form}
            name="interest_rate"
            label="Interest rate (%)"
            class={pageStyles.formGroup}
            labelClass={pageStyles.formLabel}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputmode="decimal"
                class={pageStyles.formControl}
                placeholder="5.5"
                value={form.values.interest_rate}
                onInput={(e) => form.set('interest_rate', e.currentTarget.value)}
                required
              />
            )}
          </Field>
          <Field
            form={form}
            name="term_months"
            label="Term (months)"
            class={pageStyles.formGroup}
            labelClass={pageStyles.formLabel}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputmode="numeric"
                class={pageStyles.formControl}
                data-test-id="loans-form-term"
                placeholder="60"
                value={form.values.term_months}
                onInput={(e) => form.set('term_months', e.currentTarget.value)}
                required
              />
            )}
          </Field>
          <Field
            form={form}
            name="start_date"
            label="First payment due"
            class={pageStyles.formGroup}
            labelClass={pageStyles.formLabel}
          >
            {(control) => (
              <input
                {...control}
                data-test-id="loans-form-start-date"
                type="date"
                class={pageStyles.formControl}
                value={form.values.start_date}
                onInput={(e) => form.set('start_date', e.currentTarget.value)}
                required
              />
            )}
          </Field>

          <div class={pageStyles.formGroup} ref={ratesRef}>
            <span class={pageStyles.formLabel}>Rate periods</span>
            <p class={pageStyles.periodsHint}>
              A different rate for some of the payments, such as a fixed rate that ends. Leave the
              last payment empty to keep the rate to the end.
            </p>
            <Show when={form.periods() !== 'ready'}>
              <p class={pageStyles.periodsHint} data-test-id="loans-form-periods-pending">
                {form.periods() === 'loading'
                  ? "Loading this loan's rate periods."
                  : "This loan's rate periods did not load. Saving keeps them as they are."}
              </p>
            </Show>
            <div class={pageStyles.periods}>
              <Index each={form.values.rate_periods}>
                {(period, i) => (
                  <div class={pageStyles.period} data-test-id="loans-form-rate-period">
                    <Field
                      form={form}
                      name={`rate_periods.${i}.rate`}
                      label="Rate (%)"
                      class={pageStyles.periodField}
                      labelClass={pageStyles.periodLabel}
                    >
                      {(control) => (
                        <input
                          {...control}
                          type="text"
                          inputmode="decimal"
                          class={styles.input}
                          placeholder="Rate %"
                          value={period().rate}
                          onInput={(e) => {
                            form.setPeriod(i, 'rate', e.currentTarget.value)
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      form={form}
                      name={`rate_periods.${i}.start_month`}
                      label="From payment"
                      class={pageStyles.periodField}
                      labelClass={pageStyles.periodLabel}
                    >
                      {(control) => (
                        <input
                          {...control}
                          type="text"
                          inputmode="numeric"
                          class={styles.input}
                          placeholder="1"
                          value={period().start_month}
                          onInput={(e) => {
                            form.setPeriod(i, 'start_month', e.currentTarget.value)
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      form={form}
                      name={`rate_periods.${i}.end_month`}
                      label="To payment"
                      class={pageStyles.periodField}
                      labelClass={pageStyles.periodLabel}
                    >
                      {(control) => (
                        <input
                          {...control}
                          type="text"
                          inputmode="numeric"
                          class={styles.input}
                          placeholder="end"
                          value={period().end_month}
                          onInput={(e) => {
                            form.setPeriod(i, 'end_month', e.currentTarget.value)
                          }}
                        />
                      )}
                    </Field>
                    <button
                      type="button"
                      class={`${styles.buttonQuiet} ${pageStyles.periodRemove}`}
                      aria-label="Remove this rate period"
                      onClick={() => {
                        form.removePeriod(i)
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </Index>
            </div>
            <button
              type="button"
              class={styles.button}
              disabled={form.periods() !== 'ready'}
              onClick={() => {
                form.addPeriod()
              }}
            >
              Add a rate period
            </button>
          </div>

          <div class={pageStyles.modalFooter}>
            <button
              type="button"
              class={styles.button}
              onClick={() => {
                props.onClose()
              }}
            >
              Cancel
            </button>
            <SubmitButton
              class={styles.buttonPrimary}
              busy={form.submitting()}
              busyLabel={props.loan ? undefined : 'Adding…'}
            >
              {props.loan ? 'Save changes' : 'Add loan'}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Whether a form is open, and for which loan. */
export interface FormState {
  loan: LoanRow | null
  focusRates?: boolean
}

export function FormHost(props: { state: FormState | null; onClose: () => void }) {
  return (
    <Show when={props.state} keyed>
      {(state) => (
        <LoanForm loan={state.loan} focusRates={state.focusRates} onClose={props.onClose} />
      )}
    </Show>
  )
}
