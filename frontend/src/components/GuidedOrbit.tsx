/**
 * GuidedOrbit — direction D of the entry system: a one-question-at-a-time
 * entry flow for touch and first-run. Big targets, smart defaults as one-tap
 * chips, and an orbit ring that fills as you go. Three steps — amount, then
 * category, then a confirm — reusing the same defaults as the command bar
 * (today, currency, last-used account). The gentle face of the same engine.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { api, getLocalCurrency, toast } from '../core/api'
import styles from './GuidedOrbit.module.css'
import type { Account, Category } from '../types/models'

export interface GuidedOrbitProps {
  isOpen: () => boolean
  onClose: () => void
  categories: () => Category[]
  onSave: (transaction: unknown) => void
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const lastAccountKey = () => `lastAccountId:${localStorage.getItem('currentProfileId') || '1'}`
const STEPS = 3
const R = 40
const CIRC = 2 * Math.PI * R

export function GuidedOrbit(props: GuidedOrbitProps) {
  const [step, setStep] = createSignal(1)
  const [amountStr, setAmountStr] = createSignal('')
  const [type, setType] = createSignal<'expense' | 'income'>('expense')
  const [categoryId, setCategoryId] = createSignal<number | null>(null)
  const [accounts, setAccounts] = createSignal<Account[]>([])
  const [accountIdx, setAccountIdx] = createSignal(0)
  const [note, setNote] = createSignal('')
  const [date, setDate] = createSignal(todayIso())
  const [submitting, setSubmitting] = createSignal(false)

  const amount = () => {
    const n = parseFloat(amountStr() || '0')
    return Number.isFinite(n) ? n : 0
  }
  const poolCats = createMemo(() => props.categories().filter((c) => c.type === type()))
  const category = () => props.categories().find((c) => c.id === categoryId()) || null
  const account = () => accounts()[accountIdx()] || null

  const reset = () => {
    setStep(1)
    setAmountStr('')
    setType('expense')
    setCategoryId(null)
    setNote('')
    setDate(todayIso())
  }

  const loadAccounts = async () => {
    try {
      const accs = await api.getAccounts()
      const list = Array.isArray(accs) ? accs : []
      setAccounts(list)
      const stored = parseInt(localStorage.getItem(lastAccountKey()) || '', 10)
      const i = list.findIndex((a) => a.id === stored)
      setAccountIdx(i >= 0 ? i : 0)
    } catch {
      setAccounts([])
      setAccountIdx(0)
    }
  }

  createEffect(() => {
    if (props.isOpen()) {
      reset()
      void loadAccounts()
    }
  })

  // keypad
  const press = (d: string) => {
    setAmountStr((s) => {
      if (d === '.' && s.includes('.')) return s
      if (d === '.' && s === '') return '0.'
      // limit to 2 decimals
      if (s.includes('.') && s.split('.')[1]?.length >= 2 && d !== '.') return s
      if (s === '0' && d !== '.') return d
      return (s + d).slice(0, 12)
    })
  }
  const backspace = () => setAmountStr((s) => s.slice(0, -1))

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: getLocalCurrency(),
      maximumFractionDigits: 2,
    }).format(n)

  const canNext = () => {
    if (step() === 1) return amount() > 0
    if (step() === 2) return categoryId() !== null
    return true
  }
  const next = () => {
    if (!canNext()) return
    if (step() < STEPS) setStep(step() + 1)
  }
  const back = () => {
    if (step() > 1) setStep(step() - 1)
    else props.onClose()
  }
  const pickCategory = (id: number) => {
    setCategoryId(id)
    setStep(3)
  }
  const cycleAccount = () => {
    if (accounts().length > 1) setAccountIdx((i) => (i + 1) % accounts().length)
  }

  const submit = async () => {
    if (submitting() || amount() <= 0 || categoryId() === null) return
    setSubmitting(true)
    const amt = amount()
    try {
      const tx = await api.createTransaction({
        description: note() || category()?.name || 'Quick entry',
        amount: amt,
        date: date(),
        beneficiary: '',
        payor: '',
        category_id: categoryId(),
        currency: getLocalCurrency(),
        amount_local: amt,
        exchange_rate: 1,
        type: type(),
        notes: '',
        account_id: account()?.id ?? null,
      })
      if (account()) localStorage.setItem(lastAccountKey(), String(account()!.id))
      props.onSave(tx)
      props.onClose()
    } catch (err) {
      console.error('Guided orbit create failed:', err)
      toast('Failed to save entry', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // Desktop keyboard support: this modal shows on desktop too, so typing digits
  // should go straight to the amount instead of forcing clicks on the on-screen
  // keypad. Active only while open; the confirm step's text/date inputs keep
  // their own typing. Escape closes.
  createEffect(() => {
    if (!props.isOpen()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onClose()
        return
      }
      const el = document.activeElement as HTMLElement | null
      const inField =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (step() === 1 && !inField) {
        if (e.key >= '0' && e.key <= '9') {
          e.preventDefault()
          press(e.key)
        } else if (e.key === '.' || e.key === ',') {
          e.preventDefault()
          press('.')
        } else if (e.key === 'Backspace') {
          e.preventDefault()
          backspace()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          next()
        }
      } else if (step() === 3 && e.key === 'Enter' && !inField) {
        e.preventDefault()
        void submit()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })

  const progress = () => (step() / STEPS) * CIRC
  const stepLabel = () => (step() === 1 ? 'HOW MUCH?' : step() === 2 ? 'CATEGORY' : 'CONFIRM')

  return (
    <div
      class={styles.overlay}
      classList={{ [styles.open]: props.isOpen() }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={styles.sheet} role="dialog" aria-modal="true" aria-label="Add transaction">
        <h2 class={styles.heading}>Add transaction</h2>
        <button class={styles.close} onClick={props.onClose} aria-label="Close" type="button">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* progress orbit */}
        <div class={styles.ringWrap}>
          <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
            <circle
              cx="48"
              cy="48"
              r={R}
              fill="none"
              stroke="var(--budget-bar-bg)"
              stroke-width="4"
              stroke-dasharray="2 7"
              stroke-linecap="round"
            />
            <circle
              cx="48"
              cy="48"
              r={R}
              fill="none"
              stroke="var(--primary)"
              stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray={`${progress()} ${CIRC}`}
              transform="rotate(-90 48 48)"
              class={styles.ringArc}
            />
          </svg>
          <div class={styles.ringCore}>
            <span class={styles.ringAmt}>{amount() > 0 ? money(amount()) : '—'}</span>
            <span class={styles.ringStep}>
              {stepLabel()} · {step()}/{STEPS}
            </span>
          </div>
        </div>

        {/* STEP 1 — amount */}
        <Show when={step() === 1}>
          <div class={styles.body}>
            <div class={styles.typeToggle}>
              <button
                type="button"
                classList={{ [styles.tOn]: type() === 'expense' }}
                onClick={() => setType('expense')}
              >
                Expense
              </button>
              <button
                type="button"
                classList={{ [styles.tOn]: type() === 'income' }}
                onClick={() => setType('income')}
              >
                Income
              </button>
            </div>
            <div class={styles.keypad}>
              <For each={['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']}>
                {(k) => (
                  <button
                    type="button"
                    class={styles.key}
                    onClick={() => {
                      if (k === '⌫') backspace()
                      else press(k)
                    }}
                    aria-label={k === '⌫' ? 'Delete' : k}
                  >
                    {k}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* STEP 2 — category */}
        <Show when={step() === 2}>
          <div class={styles.body}>
            <div class={styles.catGrid}>
              <For each={poolCats()}>
                {(c) => (
                  <button
                    type="button"
                    class={styles.catChip}
                    classList={{ [styles.catOn]: categoryId() === c.id }}
                    onClick={() => {
                      pickCategory(c.id)
                    }}
                  >
                    <span
                      class={styles.catDot}
                      style={{ background: c.color || 'var(--primary)' }}
                    />
                    <span class={styles.catName}>{c.name}</span>
                  </button>
                )}
              </For>
              <Show when={poolCats().length === 0}>
                <p class={styles.empty}>
                  No {type()} categories yet — add one from the Categories page.
                </p>
              </Show>
            </div>
          </div>
        </Show>

        {/* STEP 3 — confirm */}
        <Show when={step() === 3}>
          <div class={styles.body}>
            <div class={styles.summary}>
              <div class={styles.sumRow}>
                <span class={styles.sumK}>Category</span>
                <span class={styles.sumV}>
                  <span
                    class={styles.catDot}
                    style={{ background: category()?.color || 'var(--primary)' }}
                  />
                  {category()?.name}
                </span>
              </div>
              <button
                class={styles.sumRow}
                type="button"
                onClick={cycleAccount}
                disabled={accounts().length <= 1}
              >
                <span class={styles.sumK}>Account</span>
                <span class={styles.sumV}>
                  {account()?.name ?? 'None'}
                  <Show when={accounts().length > 1}>
                    <span class={styles.tapHint}>tap to change</span>
                  </Show>
                </span>
              </button>
              <div class={styles.sumRow}>
                <span class={styles.sumK}>Date</span>
                <input
                  class={styles.dateInput}
                  type="date"
                  value={date()}
                  onChange={(e) => setDate(e.currentTarget.value || todayIso())}
                />
              </div>
              <div class={styles.sumRow}>
                <span class={styles.sumK}>Note</span>
                <input
                  class={styles.noteInput}
                  type="text"
                  placeholder={category()?.name ?? 'optional'}
                  value={note()}
                  onInput={(e) => setNote(e.currentTarget.value)}
                />
              </div>
            </div>
            <button
              class={styles.addBtn}
              onClick={() => void submit()}
              disabled={submitting()}
              type="button"
            >
              {submitting() ? 'Adding…' : `Add ${money(amount())}`}
            </button>
          </div>
        </Show>

        {/* nav */}
        <div class={styles.nav}>
          <button class={styles.navBack} onClick={back} type="button">
            {step() === 1 ? 'Cancel' : 'Back'}
          </button>
          <Show when={step() < STEPS}>
            <button class={styles.navNext} onClick={next} disabled={!canNext()} type="button">
              Next
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default function GuidedOrbitDefault(props: GuidedOrbitProps) {
  return <GuidedOrbit {...props} />
}
