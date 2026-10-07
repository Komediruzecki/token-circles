/**
 * GuidedOrbit — direction D of the entry system: a one-question-at-a-time
 * entry flow for touch and first-run. Big targets, smart defaults as one-tap
 * chips, and an orbit ring that fills as you go. Three steps — amount, then
 * category, then a confirm — reusing the same defaults as the command bar
 * (today, currency, last-used account). The gentle face of the same engine.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js'
import { api, getLocalCurrency, toast } from '../core/api'
import { isEditableTarget } from '../core/domFocus'
import { quickEntrySave } from '../core/quickEntryLists'
import styles from './GuidedOrbit.module.css'
import type { QuickEntryList } from '../core/quickEntryLists'
import type { Account, Category } from '../types/models'

export interface GuidedOrbitProps {
  isOpen: () => boolean
  onClose: () => void
  /** The active profile's categories, current when shown (App, core/quickEntryLists.ts). */
  categories: QuickEntryList<Category>
  /** The active profile's accounts, from the same place. */
  accounts: QuickEntryList<Account>
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
  /** The account tapped to on the confirm step, if any. */
  const [accountPick, setAccountPick] = createSignal<number | null>(null)
  const [note, setNote] = createSignal('')
  const [date, setDate] = createSignal(todayIso())
  const [submitting, setSubmitting] = createSignal(false)

  const amount = () => {
    const n = parseFloat(amountStr() || '0')
    return Number.isFinite(n) ? n : 0
  }
  const poolCats = createMemo(() => props.categories.items().filter((c) => c.type === type()))
  const category = () => props.categories.items().find((c) => c.id === categoryId()) || null
  const accounts = () => props.accounts.items()
  /** Where the entry goes: the account tapped to, else the last one used here, else the first. */
  const account = createMemo(() => {
    const list = accounts()
    const picked = list.find((a) => a.id === accountPick())
    if (picked) return picked
    const stored = parseInt(localStorage.getItem(lastAccountKey()) || '', 10)
    return list.find((a) => a.id === stored) ?? list[0] ?? null
  })
  /** Nothing is offered, and nothing can be added, until both lists are in for this profile. */
  const listsLoading = () =>
    props.categories.status() === 'loading' || props.accounts.status() === 'loading'

  const reset = () => {
    setStep(1)
    setAmountStr('')
    setType('expense')
    setCategoryId(null)
    setAccountPick(null)
    setNote('')
    setDate(todayIso())
  }

  createEffect(() => {
    if (props.isOpen()) reset()
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
    const list = accounts()
    if (list.length < 2) return
    const at = list.findIndex((a) => a.id === account()?.id)
    setAccountPick(list[(at + 1) % list.length].id)
  }

  const submit = async () => {
    if (submitting() || listsLoading() || amount() <= 0 || categoryId() === null) return
    // The save files the entry under the active profile as it is now, and refuses a category or
    // account of any other. If the lists are no longer that profile's (it was switched in another
    // tab) or the category has gone, read again and ask for the category again instead.
    const categoriesCurrent = props.categories.isCurrent()
    const accountsCurrent = props.accounts.status() !== 'ready' || props.accounts.isCurrent()
    if (!categoriesCurrent || !category() || !accountsCurrent) {
      if (!categoriesCurrent) props.categories.reload()
      if (!accountsCurrent) props.accounts.reload()
      setCategoryId(null)
      setStep(2)
      toast("That category isn't in this profile anymore. Pick one again.", 'error')
      return
    }
    setSubmitting(true)
    const amt = amount()
    try {
      // The save closes the orb: the lists read what it changed on the next open, not now.
      await quickEntrySave(async () => {
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
      })
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
      // Never hijack keyboard shortcuts (⌘K, Ctrl+digit tab-switch, …) — only
      // plain keystrokes drive the amount.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const inField = isEditableTarget(document.activeElement)
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
            <Switch>
              <Match when={props.categories.status() === 'loading'}>
                <p class={styles.empty} role="status" data-test-id="orbit-categories-loading">
                  Loading your categories…
                </p>
              </Match>
              <Match when={props.categories.status() === 'error'}>
                <div class={styles.empty} role="alert" data-test-id="orbit-categories-error">
                  Your categories didn't load.
                  <button
                    type="button"
                    class={styles.retry}
                    onClick={() => {
                      props.categories.reload()
                    }}
                  >
                    Try again
                  </button>
                </div>
              </Match>
              <Match when={props.categories.status() === 'ready'}>
                <div class={styles.catGrid}>
                  <For each={poolCats()}>
                    {(c) => (
                      <button
                        type="button"
                        class={styles.catChip}
                        classList={{ [styles.catOn]: categoryId() === c.id }}
                        data-test-id="orbit-category"
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
                    <p class={styles.empty} data-test-id="orbit-categories-empty">
                      No {type()} categories yet. Add one on the Categories page.
                    </p>
                  </Show>
                </div>
              </Match>
            </Switch>
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
                onClick={() => {
                  if (props.accounts.status() === 'error') props.accounts.reload()
                  else cycleAccount()
                }}
                disabled={props.accounts.status() !== 'error' && accounts().length <= 1}
              >
                <span class={styles.sumK}>Account</span>
                <span class={styles.sumV}>
                  <Switch fallback={account()?.name ?? 'None'}>
                    <Match when={props.accounts.status() === 'loading'}>Loading…</Match>
                    <Match when={props.accounts.status() === 'error'}>
                      Didn't load. Tap to try again
                    </Match>
                  </Switch>
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
              disabled={submitting() || listsLoading()}
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
