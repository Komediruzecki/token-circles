/**
 * Add a loan or edit one: its name, amount, rate, term, first due date and rate periods. Saving
 * goes through apiFetch, which bumps the `loans` data version, so the page reloads its list on its
 * own: nothing here reloads anything by hand.
 */
import { createEffect, createSignal, Index, on, onCleanup, onMount, Show } from 'solid-js'
import NumberField from '../../components/NumberField'
import { apiGet, apiPost, apiPut, showToast } from '../../core/api'
import pageStyles from './LoanForm.module.css'
import styles from './Loans.module.css'
import type { LoanRow, StoredLoan } from './loanData'

interface RatePeriodDraft {
  /** Text, so a decimal comma can be typed. */
  rate: string
  start_month: number | null
  end_month: number | null
}

interface Draft {
  name: string
  principal: number | null
  interest_rate: string
  term_months: number | null
  start_date: string
  rate_periods: RatePeriodDraft[]
}

const EMPTY: Draft = {
  name: '',
  principal: null,
  interest_rate: '',
  term_months: null,
  start_date: '',
  rate_periods: [],
}

interface Props {
  /** The loan being edited, or null to add one. */
  loan: LoanRow | null
  /** Open with the rate periods in view: from the Extra payments tab's "Edit rates". */
  focusRates?: boolean
  onClose: () => void
}

const parseRate = (text: string) => Number.parseFloat(text.replace(',', '.')) || 0

const periodDraft = (p: { rate: number; start_month: number; end_month?: number | null }) => ({
  rate: String(p.rate),
  start_month: p.start_month,
  end_month: p.end_month || null,
})

export default function LoanForm(props: Props) {
  const [draft, setDraft] = createSignal<Draft>({ ...EMPTY })
  const [saving, setSaving] = createSignal(false)
  /** Whether the loan's rate periods are in the draft: 'loading' and 'failed' leave them out. */
  const [periods, setPeriods] = createSignal<'ready' | 'loading' | 'failed'>('ready')
  let ratesRef: HTMLDivElement | undefined

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const updatePeriod = (i: number, patch: Partial<RatePeriodDraft>) =>
    setDraft((d) => ({
      ...d,
      rate_periods: d.rate_periods.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }))

  // Fill the form from the loan being edited, at once: it is typed into straight away. Its rate
  // periods come with a local-first row; in cloud mode they come from the loan's own read, which
  // then fills in the periods alone, so nothing typed meanwhile is overwritten.
  createEffect(
    on(
      () => props.loan,
      async (loan) => {
        if (!loan) {
          setDraft({ ...EMPTY })
          setPeriods('ready')
          return
        }
        const known = loan.listed.rate_periods
        setDraft({
          name: loan.name,
          principal: loan.principal,
          interest_rate: String(loan.interest_rate),
          term_months: loan.term_months,
          start_date: (loan.start_date ?? '').slice(0, 10),
          rate_periods: (known ?? []).map(periodDraft),
        })
        setPeriods(known ? 'ready' : 'loading')
        if (props.focusRates) queueMicrotask(() => ratesRef?.scrollIntoView({ block: 'center' }))
        if (known) return
        try {
          const read = await apiGet<StoredLoan>(`/api/loans/${loan.id}`)
          if (props.loan?.id !== loan.id) return
          setDraft((d) => ({ ...d, rate_periods: (read.rate_periods ?? []).map(periodDraft) }))
          setPeriods('ready')
        } catch {
          if (props.loan?.id === loan.id) setPeriods('failed')
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

  const submit = async (e: Event) => {
    e.preventDefault()
    const d = draft()
    const body = {
      name: d.name.trim(),
      principal: d.principal ?? 0,
      interest_rate: parseRate(d.interest_rate),
      term_months: d.term_months ?? 0,
      start_date: d.start_date,
      // Left out until the loan's own periods are in the draft: an update without them keeps the
      // stored ones, where an empty list would delete them.
      ...(periods() === 'ready'
        ? {
            rate_periods: d.rate_periods
              .filter((p) => p.start_month !== null && p.start_month >= 1)
              .map((p) => ({
                rate: parseRate(p.rate),
                start_month: p.start_month,
                end_month: p.end_month,
              })),
          }
        : {}),
    }
    setSaving(true)
    try {
      if (props.loan) {
        await apiPut(`/api/loans/${props.loan.id}`, body)
        showToast('Loan saved', 'success')
      } else {
        await apiPost('/api/loans', body)
        showToast('Loan added', 'success')
      }
      props.onClose()
    } catch (err) {
      console.error('Failed to save loan:', err)
      showToast('The loan was not saved. Check your connection and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

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
        <form class={pageStyles.modalBody} onSubmit={submit}>
          <label class={pageStyles.formGroup}>
            <span class={pageStyles.formLabel}>Name</span>
            <input
              type="text"
              class={pageStyles.formControl}
              placeholder="e.g., Auto Loan, Student Loan"
              value={draft().name}
              onInput={(e) => update('name', e.currentTarget.value)}
              autofocus
              required
            />
          </label>
          <label class={pageStyles.formGroup}>
            <span class={pageStyles.formLabel}>Amount borrowed</span>
            <NumberField<null>
              class={pageStyles.formControl}
              step="0.01"
              min="0.01"
              placeholder="15000.00"
              required
              value={draft().principal}
              emptyValue={null}
              onChange={(v) => update('principal', v)}
            />
          </label>
          <label class={pageStyles.formGroup}>
            <span class={pageStyles.formLabel}>Interest rate (%)</span>
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              class={pageStyles.formControl}
              placeholder="5.5"
              value={draft().interest_rate}
              onInput={(e) => update('interest_rate', e.currentTarget.value)}
              required
            />
          </label>
          <label class={pageStyles.formGroup}>
            <span class={pageStyles.formLabel}>Term (months)</span>
            <NumberField<null>
              class={pageStyles.formControl}
              testId="loans-form-term"
              step="1"
              min="1"
              max="1200"
              placeholder="60"
              required
              value={draft().term_months}
              emptyValue={null}
              onChange={(v) => update('term_months', v)}
            />
          </label>
          <label class={pageStyles.formGroup}>
            <span class={pageStyles.formLabel}>First payment due</span>
            <input
              data-test-id="loans-form-start-date"
              type="date"
              class={pageStyles.formControl}
              value={draft().start_date}
              onInput={(e) => update('start_date', e.currentTarget.value)}
              required
            />
          </label>

          <div class={pageStyles.formGroup} ref={ratesRef}>
            <span class={pageStyles.formLabel}>Rate periods</span>
            <p class={styles.hint} style={{ 'font-size': '12px', margin: '0 0 8px' }}>
              A different rate for some of the payments, such as a fixed rate that ends. Leave the
              last month empty to keep the rate to the end.
            </p>
            <Show when={periods() !== 'ready'}>
              <p
                class={styles.hint}
                style={{ 'font-size': '12px', margin: '0 0 8px' }}
                data-test-id="loans-form-periods-pending"
              >
                {periods() === 'loading'
                  ? "Loading this loan's rate periods."
                  : "This loan's rate periods did not load. Saving keeps them as they are."}
              </p>
            </Show>
            <div style={{ display: 'grid', gap: '8px', 'margin-bottom': '8px' }}>
              <Index each={draft().rate_periods}>
                {(period, i) => (
                  <div
                    style={{
                      display: 'flex',
                      'flex-wrap': 'wrap',
                      'align-items': 'center',
                      gap: '8px',
                      'font-size': '14px',
                    }}
                    data-test-id="loans-form-rate-period"
                  >
                    <input
                      type="text"
                      inputmode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      class={styles.input}
                      style={{ width: '72px' }}
                      aria-label="Rate (%)"
                      placeholder="Rate %"
                      value={period().rate}
                      onInput={(e) => updatePeriod(i, { rate: e.currentTarget.value })}
                    />
                    <span>% from payment</span>
                    <NumberField<null>
                      class={styles.input}
                      ariaLabel="First payment at this rate"
                      step="1"
                      min="1"
                      placeholder="1"
                      value={period().start_month}
                      emptyValue={null}
                      onChange={(v) => updatePeriod(i, { start_month: v })}
                    />
                    <span>to</span>
                    <NumberField<null>
                      class={styles.input}
                      ariaLabel="Last payment at this rate, empty for the end"
                      step="1"
                      min="1"
                      placeholder="end"
                      value={period().end_month}
                      emptyValue={null}
                      onChange={(v) => updatePeriod(i, { end_month: v })}
                    />
                    <button
                      type="button"
                      class={styles.buttonQuiet}
                      aria-label="Remove this rate period"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          rate_periods: d.rate_periods.filter((_, j) => j !== i),
                        }))
                      }
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
              disabled={periods() !== 'ready'}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  rate_periods: [
                    ...d.rate_periods,
                    { rate: d.interest_rate, start_month: 1, end_month: null },
                  ],
                }))
              }
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
            <button type="submit" class={styles.buttonPrimary} disabled={saving()}>
              {props.loan ? 'Save changes' : 'Add loan'}
            </button>
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
