/**
 * Auto Categorize — assign categories to the transactions that have none.
 *
 * Uncategorized rows come from imports (a gated category name imports with category_id null);
 * the app itself will not create one. So the person looking at this list is looking at rows they
 * did NOT type in, which is why every row carries its metadata — date, signed amount, account —
 * and not just a description. A bare description off someone's bank statement ("411111XXXXXX1111,
 * Revolut**3333* Dublin") identifies nothing.
 *
 * Two paths out of the list:
 *  - a mapping match suggests a category, staged with one click (or all at once);
 *  - no match: every row carries a category picker, so "no suggestion" is not "no way forward".
 *
 * Staging and applying are separate. The footer says "Apply N" and that is the only thing that
 * writes — an earlier version applied on the row click AND again from the footer, so the label
 * lied in both directions.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { api } from '../core/api'
import autoCategorizeModalStyles from './AutoCategorizeModal.module.css'
import type { CategoryMapping } from '../types/models'

export interface AutoCategorizeTransaction {
  id: number
  description: string
  date?: string
  amount?: number
  currency?: string
  type?: string
  account_id?: number | null
  transfer_account_id?: number | null
  means_of_payment?: string | null
}

export interface AutoCategorizeModalProps {
  isOpen: () => boolean
  onClose: () => void
  uncategorizedTransactions: () => AutoCategorizeTransaction[]
  /** Categories on offer for the manual pick, filtered to the row's type where known. */
  categories?: () => Array<{ id: number; name: string; type?: string }>
  /** Resolve an account id to its display name for the row's metadata line. */
  accountName?: (id: number) => string | undefined
  onApply: (transactionId: number, categoryId: number) => void | Promise<void>
  /** Fired once after a batch applies, so the host reloads once rather than per row. */
  onApplied?: () => void
}

export function AutoCategorizeModal(props: AutoCategorizeModalProps) {
  const [categoryMappings, setCategoryMappings] = createSignal<CategoryMapping[]>([])
  const [loading, setLoading] = createSignal(false)
  const [applying, setApplying] = createSignal(false)
  const [pendingUpdates, setPendingUpdates] = createSignal<Record<number, number>>({})
  createEffect(() => {
    if (props.isOpen()) {
      void loadCategoryMappings()
      setPendingUpdates({})
    }
  })

  const loadCategoryMappings = async () => {
    setLoading(true)
    try {
      const mappings = await api.getCategoryMappings()
      setCategoryMappings(mappings)
    } catch (error) {
      console.error('Failed to load category mappings:', error)
    } finally {
      setLoading(false)
    }
  }

  const findMatchingCategory = (description: string): CategoryMapping | null => {
    const desc = description.toLowerCase()
    for (const mapping of categoryMappings()) {
      if (mapping.pattern.toLowerCase() === desc) return mapping
    }
    return null
  }

  /** Stage a choice. Nothing is written until Apply. */
  const stage = (transactionId: number, categoryId: number | null) => {
    setPendingUpdates((prev) => {
      const next = { ...prev }
      if (categoryId === null) delete next[transactionId]
      else next[transactionId] = categoryId
      return next
    })
  }

  const stageAllMatches = () => {
    setPendingUpdates((prev) => {
      const next = { ...prev }
      for (const tx of uncategorized()) {
        if (tx.id in next) continue
        const match = findMatchingCategory(tx.description)
        if (match) next[tx.id] = match.category_id
      }
      return next
    })
  }

  const applyAll = async () => {
    setApplying(true)
    try {
      // Sequential on purpose: one failed write should stop before the next, and fifty parallel
      // PUTs against one profile is how optimistic-concurrency conflicts get manufactured.
      for (const [transactionId, categoryId] of Object.entries(pendingUpdates())) {
        await props.onApply(Number(transactionId), categoryId)
      }
      props.onApplied?.()
      props.onClose()
    } finally {
      setApplying(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose()
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  })

  const uncategorized = createMemo(() => props.uncategorizedTransactions())
  const matchCount = createMemo(
    () => uncategorized().filter((tx) => findMatchingCategory(tx.description)).length
  )
  const stagedCount = createMemo(() => Object.keys(pendingUpdates()).length)

  const money = (tx: AutoCategorizeTransaction) => {
    if (tx.amount === undefined || tx.amount === null) return null
    let formatted: string
    try {
      formatted = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: tx.currency || 'EUR',
        maximumFractionDigits: 2,
      }).format(Math.abs(tx.amount))
    } catch {
      formatted = Math.abs(tx.amount).toFixed(2)
    }
    return tx.type === 'expense' ? `−${formatted}` : formatted
  }

  /** "Erste Current" for a plain row; "Erste Current → Revolut" for a transfer. */
  const accountLine = (tx: AutoCategorizeTransaction) => {
    const name = (id?: number | null) =>
      id !== undefined && id !== null ? props.accountName?.(id) : undefined
    const from = name(tx.account_id) ?? tx.means_of_payment ?? undefined
    const to = name(tx.transfer_account_id)
    if (from && to) return `${from} → ${to}`
    return from ?? to ?? null
  }

  /** Categories a row can take: its own type's where the type is known, all otherwise. */
  const categoriesFor = (tx: AutoCategorizeTransaction) => {
    const all = props.categories?.() ?? []
    if (tx.type === 'income' || tx.type === 'expense') {
      const typed = all.filter((c) => c.type === tx.type)
      return typed.length > 0 ? typed : all
    }
    return all
  }

  return (
    <div
      class={autoCategorizeModalStyles.overlay}
      classList={{ [autoCategorizeModalStyles.isOpen]: props.isOpen() }}
    >
      <div class={autoCategorizeModalStyles.modal}>
        <div class={autoCategorizeModalStyles.header}>
          <h2 class={autoCategorizeModalStyles.title}>Auto Categorize</h2>
          <button
            class={autoCategorizeModalStyles.closeButton}
            onClick={props.onClose}
            disabled={applying()}
            type="button"
            aria-label="Close modal"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class={autoCategorizeModalStyles.content}>
          <div class={autoCategorizeModalStyles.stats}>
            <span class={autoCategorizeModalStyles.statItem} data-test-id="auto-cat-count">
              {uncategorized().length} uncategorized
            </span>
            <span class={autoCategorizeModalStyles.statItem}>{stagedCount()} selected</span>
            <Show when={matchCount() > 0}>
              <button
                class={autoCategorizeModalStyles.stageAllBtn}
                type="button"
                data-test-id="auto-cat-select-matches"
                disabled={applying()}
                onClick={stageAllMatches}
              >
                Select all {matchCount()} match{matchCount() === 1 ? '' : 'es'}
              </button>
            </Show>
          </div>

          {loading() ? (
            <div class={autoCategorizeModalStyles.loading}>Loading category suggestions...</div>
          ) : uncategorized().length === 0 ? (
            <div class={autoCategorizeModalStyles.empty}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>All transactions are categorized!</p>
            </div>
          ) : (
            <div class={autoCategorizeModalStyles.transactionList}>
              <For each={uncategorized()}>
                {(tx) => {
                  const matching = findMatchingCategory(tx.description)
                  const staged = () => pendingUpdates()[tx.id]
                  const isStaged = () => tx.id in pendingUpdates()

                  return (
                    <div
                      data-test-id="auto-cat-row"
                      class={`${autoCategorizeModalStyles.transactionItem} ${isStaged() ? autoCategorizeModalStyles.selected : ''}`}
                    >
                      <div class={autoCategorizeModalStyles.txInfo}>
                        <p class={autoCategorizeModalStyles.txDescription}>{tx.description}</p>
                        {/* The metadata that actually identifies an imported row: when, how
                            much, and which account it touched. */}
                        <p class={autoCategorizeModalStyles.txMeta} data-test-id="auto-cat-meta">
                          <Show when={tx.date}>
                            <span>{tx.date}</span>
                          </Show>
                          <Show when={money(tx)}>
                            <span
                              classList={{
                                [autoCategorizeModalStyles.metaExpense]: tx.type === 'expense',
                                [autoCategorizeModalStyles.metaIncome]: tx.type === 'income',
                              }}
                            >
                              {money(tx)}
                            </span>
                          </Show>
                          <Show when={accountLine(tx)}>
                            <span>{accountLine(tx)}</span>
                          </Show>
                        </p>
                        <div class={autoCategorizeModalStyles.rowAction}>
                          <Show
                            when={matching}
                            fallback={
                              /* No suggestion is not a dead end: pick one by hand. */
                              <select
                                class={autoCategorizeModalStyles.categorySelect}
                                data-test-id="auto-cat-manual-select"
                                disabled={applying()}
                                onChange={(e) => {
                                  const v = e.currentTarget.value
                                  stage(tx.id, v ? Number(v) : null)
                                }}
                              >
                                <option value="">Pick a category…</option>
                                <For each={categoriesFor(tx)}>
                                  {(c) => (
                                    <option value={c.id} selected={staged() === c.id}>
                                      {c.name}
                                    </option>
                                  )}
                                </For>
                              </select>
                            }
                          >
                            <span
                              class={`${autoCategorizeModalStyles.badge} ${autoCategorizeModalStyles.confidenceHigh}`}
                            >
                              {matching!.category_name}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <button
                        class={autoCategorizeModalStyles.selectBtn}
                        onClick={() => {
                          if (isStaged()) stage(tx.id, null)
                          else if (matching) stage(tx.id, matching.category_id)
                        }}
                        disabled={applying() || (!matching && !isStaged())}
                        type="button"
                        aria-label={
                          isStaged()
                            ? 'Remove from selection'
                            : matching
                              ? `Use ${matching.category_name}`
                              : 'Pick a category first'
                        }
                      >
                        {isStaged() ? (
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          '+'
                        )}
                      </button>
                    </div>
                  )
                }}
              </For>
            </div>
          )}
        </div>

        <div class={autoCategorizeModalStyles.footer}>
          <button
            class={autoCategorizeModalStyles.cancelButton}
            onClick={props.onClose}
            disabled={applying()}
            type="button"
          >
            Cancel
          </button>
          <button
            class={`${autoCategorizeModalStyles.applyButton} ${stagedCount() === 0 ? autoCategorizeModalStyles.disabled : ''}`}
            onClick={() => void applyAll()}
            disabled={applying() || stagedCount() === 0}
            data-test-id="auto-cat-apply"
            type="button"
          >
            {applying() ? (
              <span class={autoCategorizeModalStyles.spinner}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-dasharray="30"
                    stroke-dashoffset="60"
                  />
                </svg>
              </span>
            ) : (
              `Apply ${stagedCount()}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AutoCategorizeModalDefault(props: AutoCategorizeModalProps) {
  return <AutoCategorizeModal {...props} />
}
