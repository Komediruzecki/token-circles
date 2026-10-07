/**
 * CommandBar — the Orbit Command Bar. A keyboard-first quick-entry surface:
 * type an entry in plain language ("coffee 4.50 food", "salary 3000 income"),
 * watch it parse into chips you can fix, and land it with Enter. Alt+Enter
 * lands it and keeps the bar open for the next one. It replaces the old
 * bare-bones Quick Add and reads its draft from the pure `parseEntry` core.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js'
import { api, getLocalCurrency, toast } from '../core/api'
import { parseEntry } from '../core/entry/parseEntry'
import styles from './CommandBar.module.css'
import type { QuickEntryList } from '../core/quickEntryLists'
import type { Account, Category } from '../types/models'

export interface CommandBarProps {
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

export function CommandBar(props: CommandBarProps) {
  let inputRef: HTMLInputElement | undefined
  const [input, setInput] = createSignal('')
  /** The account picked on its chip, if any. */
  const [accountPick, setAccountPick] = createSignal<number | null>(null)
  const [typeOverride, setTypeOverride] = createSignal<'income' | 'expense' | null>(null)
  const [categoryOverride, setCategoryOverride] = createSignal<number | 'auto'>('auto')
  const [dateOverride, setDateOverride] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)
  /** Enter was pressed before the lists were in: land it (keeping the bar open or not) once they are. */
  const [pendingSubmit, setPendingSubmit] = createSignal<boolean | null>(null)

  const parsed = createMemo(() =>
    parseEntry(input(), {
      categories: props.categories
        .items()
        .filter((c) => c.type === 'income' || c.type === 'expense')
        .map((c) => ({ id: c.id, name: c.name, type: c.type as 'income' | 'expense' })),
      today: todayIso(),
    })
  )

  const eType = (): 'income' | 'expense' => typeOverride() ?? parsed().type
  const poolCats = createMemo(() => props.categories.items().filter((c) => c.type === eType()))
  const eCategoryId = createMemo<number | null>(() => {
    const ov = categoryOverride()
    if (ov !== 'auto') return ov
    const pid = parsed().categoryId
    if (pid === null) return null
    return poolCats().some((c) => c.id === pid) ? pid : null
  })
  const eCategory = () => props.categories.items().find((c) => c.id === eCategoryId()) || null
  const eAmount = () => parsed().amount
  const eDate = () => dateOverride() ?? parsed().date
  const eDescription = () => parsed().description || eCategory()?.name || ''
  const accounts = () => props.accounts.items()
  /** Where the entry goes: the account picked here, else the last one used, else the first. */
  const accountId = createMemo<number | null>(() => {
    const list = accounts()
    const picked = accountPick()
    if (picked !== null && list.some((a) => a.id === picked)) return picked
    const stored = parseInt(localStorage.getItem(lastAccountKey()) || '', 10)
    if (Number.isFinite(stored) && list.some((a) => a.id === stored)) return stored
    return list.length ? list[0].id : null
  })
  const listsLoading = () =>
    props.categories.status() === 'loading' || props.accounts.status() === 'loading'
  const categoryPrompt = () => {
    const status = props.categories.status()
    if (status === 'loading') return 'loading categories'
    if (status === 'error') return "categories didn't load"
    return 'pick category'
  }
  const canSubmit = () => (eAmount() ?? 0) > 0 && eCategoryId() !== null && !listsLoading()

  const resetDraft = () => {
    setInput('')
    setTypeOverride(null)
    setCategoryOverride('auto')
    setDateOverride(null)
  }

  // Initialise on each open: the last-used account, a cleared draft, a focused input. The lists
  // themselves are App's, and are read again on open when anything changed.
  createEffect(() => {
    if (props.isOpen()) {
      setAccountPick(null)
      resetDraft()
      setTimeout(() => inputRef?.focus(), 60)
    } else {
      setPendingSubmit(null)
    }
  })

  const submit = async (keepOpen: boolean) => {
    if (submitting()) return
    if (listsLoading()) {
      setPendingSubmit(keepOpen)
      return
    }
    if (!canSubmit()) {
      const categoriesFailed = props.categories.status() === 'error'
      toast(
        (eAmount() ?? 0) <= 0
          ? 'Add an amount to land it'
          : categoriesFailed
            ? "Your categories didn't load. Use retry on the category chip."
            : 'Pick a category to land it',
        'error'
      )
      return
    }
    // The save files the entry under the active profile as it is now, and refuses a category or
    // account of any other. If the lists are no longer that profile's (it was switched in another
    // tab) or the category has gone, read again and ask for the category again instead.
    const categoriesCurrent = props.categories.isCurrent()
    const accountsCurrent = props.accounts.status() !== 'ready' || props.accounts.isCurrent()
    if (!categoriesCurrent || !eCategory() || !accountsCurrent) {
      if (!categoriesCurrent) props.categories.reload()
      if (!accountsCurrent) props.accounts.reload()
      setCategoryOverride('auto')
      toast("That category isn't in this profile anymore. Pick one again.", 'error')
      return
    }
    const amount = eAmount() as number
    setSubmitting(true)
    try {
      const tx = await api.createTransaction({
        description: eDescription() || 'Quick entry',
        amount,
        date: eDate(),
        beneficiary: '',
        payor: '',
        category_id: eCategoryId(),
        currency: getLocalCurrency(),
        amount_local: amount,
        exchange_rate: 1,
        type: eType(),
        notes: '',
        account_id: accountId(),
      })
      if (accountId() !== null) localStorage.setItem(lastAccountKey(), String(accountId()))
      props.onSave(tx)
      if (keepOpen) {
        resetDraft()
        inputRef?.focus()
      } else {
        props.onClose()
      }
    } catch (err) {
      console.error('Command bar create failed:', err)
      toast('Failed to save entry', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // The Enter that came before the lists: now they are in (or failed, which submit reports).
  createEffect(() => {
    const keepOpen = pendingSubmit()
    if (keepOpen === null || listsLoading()) return
    setPendingSubmit(null)
    untrack(() => void submit(keepOpen))
  })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit(e.altKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
    }
  }

  // Global Esc as a safety net even if focus escapes the input.
  onMount(() => {
    const onGlobal = (e: KeyboardEvent) => {
      if (props.isOpen() && e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onGlobal)
    onCleanup(() => {
      document.removeEventListener('keydown', onGlobal)
    })
  })

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: getLocalCurrency(),
      maximumFractionDigits: 2,
    }).format(n)

  return (
    <div
      class={styles.overlay}
      classList={{ [styles.open]: props.isOpen() }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={styles.bar} role="dialog" aria-modal="true" aria-label="Quick entry command bar">
        <div class={styles.inputRow}>
          <span class={styles.caret}>›</span>
          <input
            ref={inputRef}
            class={styles.input}
            value={input()}
            autocomplete="off"
            spellcheck={false}
            placeholder="Type an entry — e.g. “coffee 4.50 food”, “salary 3000 income”"
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            aria-label="Quick entry"
          />
          <Show when={submitting()}>
            <span class={styles.spin} aria-hidden="true" />
          </Show>
        </div>

        <div class={styles.chips}>
          {/* amount */}
          <span class={styles.chip} classList={{ [styles.ghost]: (eAmount() ?? 0) <= 0 }}>
            <span class={styles.k}>amount</span>
            {(eAmount() ?? 0) > 0 ? money(eAmount() as number) : 'add a number'}
          </span>

          {/* type toggle */}
          <span class={styles.toggle}>
            <button
              type="button"
              classList={{ [styles.on]: eType() === 'expense' }}
              onClick={() => {
                setTypeOverride('expense')
                setCategoryOverride('auto')
              }}
            >
              Expense
            </button>
            <button
              type="button"
              classList={{ [styles.on]: eType() === 'income' }}
              onClick={() => {
                setTypeOverride('income')
                setCategoryOverride('auto')
              }}
            >
              Income
            </button>
          </span>

          {/* category */}
          <span class={styles.chip} classList={{ [styles.ghost]: eCategoryId() === null }}>
            <span
              class={styles.swatch}
              style={{ background: eCategory()?.color || 'var(--budget-bar-bg)' }}
            />
            <select
              class={styles.select}
              value={eCategoryId() === null ? '' : String(eCategoryId())}
              onChange={(e) =>
                setCategoryOverride(e.currentTarget.value ? Number(e.currentTarget.value) : 'auto')
              }
              aria-label="Category"
            >
              <option value="">{categoryPrompt()}</option>
              <For each={poolCats()}>
                {(c) => (
                  <option value={String(c.id)} selected={c.id === eCategoryId()}>
                    {c.name}
                  </option>
                )}
              </For>
            </select>
            <Show when={props.categories.status() === 'error'}>
              <button
                type="button"
                class={styles.retry}
                onClick={() => {
                  props.categories.reload()
                }}
              >
                retry
              </button>
            </Show>
          </span>

          {/* account */}
          <Show when={accounts().length > 0}>
            <span class={styles.chip}>
              <span class={styles.k}>account</span>
              <select
                class={styles.select}
                value={accountId() === null ? '' : String(accountId())}
                onChange={(e) =>
                  setAccountPick(e.currentTarget.value ? Number(e.currentTarget.value) : null)
                }
                aria-label="Account"
              >
                <For each={accounts()}>
                  {(a) => (
                    <option value={String(a.id)} selected={a.id === accountId()}>
                      {a.name}
                    </option>
                  )}
                </For>
              </select>
            </span>
          </Show>

          {/* date */}
          <span class={styles.chip}>
            <span class={styles.k}>date</span>
            <input
              class={styles.date}
              type="date"
              value={eDate()}
              onChange={(e) => setDateOverride(e.currentTarget.value || null)}
              aria-label="Date"
            />
          </span>

          {/* description preview */}
          <Show when={eDescription()}>
            <span class={styles.chip}>
              <span class={styles.k}>note</span>
              {eDescription()}
            </span>
          </Show>

          <Show when={parsed().recurring}>
            <span
              class={styles.chip}
              title="Recurring entries live in the Recurring section for now"
            >
              <span
                class={styles.swatch}
                style={{ background: 'var(--accent-secondary, #c9a0ff)' }}
              />
              {parsed().recurring}
            </span>
          </Show>
        </div>

        <div class={styles.footer}>
          <span class={styles.hint}>
            <kbd class={styles.kbd}>↵</kbd> add
            <span class={styles.dot}>·</span>
            <kbd class={styles.kbd}>⌥↵</kbd> add &amp; keep going
            <span class={styles.dot}>·</span>
            <kbd class={styles.kbd}>esc</kbd> close
          </span>
          <button
            type="button"
            class={styles.add}
            disabled={!canSubmit() || submitting()}
            onClick={() => void submit(false)}
          >
            Add entry
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CommandBarDefault(props: CommandBarProps) {
  return <CommandBar {...props} />
}
