/**
 * SubscriptionCatalogModal — direction B of the entry system: pick your
 * subscriptions from a shelf instead of filling a form ten times. Multi-select
 * tokens from the seed catalog, quick-pick a plan tier or type a custom price,
 * and add them all in one batch. Each token reuses the app's brand marks via
 * `matchBrand`, so a subscription arrives looking the way it will in the list.
 *
 * Prices are held as raw text while editing (so "0", an empty field, and
 * trailing decimals all type cleanly), then validated when the checkmark or
 * batch-add button commits them.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { apiPost, showToast } from '../core/api'
import { paletteColor } from '../core/brandPalette'
import { parseDecimalInput } from '../core/decimalInput'
import { matchBrand } from '../features/subscriptionBrands'
import { CATALOG_ITEMS, SUBSCRIPTION_CATALOG } from '../features/subscriptionCatalog'
import styles from './SubscriptionCatalogModal.module.css'
import type { CatalogItem } from '../features/subscriptionCatalog'

/** Minimal category shape the catalog needs to resolve a category_id. */
export interface CatalogCategory {
  id: number
  name: string
  type: string
}

export interface SubscriptionCatalogModalProps {
  isOpen: () => boolean
  onClose: () => void
  categories: () => CatalogCategory[]
  onAdded: () => void
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const priceOf = (text: string): number => {
  return parseDecimalInput(text) ?? 0
}

export function SubscriptionCatalogModal(props: SubscriptionCatalogModalProps) {
  const [search, setSearch] = createSignal('')
  // `selected` holds committed prices; `draftPrices` preserves exactly what is
  // in each input until the user applies it with the checkmark.
  const [selected, setSelected] = createSignal<Record<string, string>>({})
  const [draftPrices, setDraftPrices] = createSignal<Record<string, string>>({})
  const [priceErrors, setPriceErrors] = createSignal<Record<string, string>>({})
  const [submitting, setSubmitting] = createSignal(false)

  const isSelected = (name: string) => Object.prototype.hasOwnProperty.call(selected(), name)
  const priceText = (name: string) => draftPrices()[name] ?? selected()[name] ?? ''
  const priceError = (name: string) => priceErrors()[name]
  const clearRecordValue = (
    setter: (update: (prev: Record<string, string>) => Record<string, string>) => void,
    name: string
  ) => {
    setter((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const toggle = (item: CatalogItem) => {
    if (isSelected(item.name)) {
      clearRecordValue(setSelected, item.name)
      clearRecordValue(setDraftPrices, item.name)
      clearRecordValue(setPriceErrors, item.name)
      return
    }
    const initialPrice = String(item.price)
    setSelected((prev) => ({ ...prev, [item.name]: initialPrice }))
    setDraftPrices((prev) => ({ ...prev, [item.name]: initialPrice }))
    clearRecordValue(setPriceErrors, item.name)
  }
  const setPriceText = (name: string, raw: string) => {
    // Preserve the exact text so Solid never rewrites the input under the caret.
    // Validation and normalization happen only when the value is applied/submitted.
    setDraftPrices((prev) => ({ ...prev, [name]: raw }))
    clearRecordValue(setPriceErrors, name)
  }
  const pickPlan = (item: CatalogItem, price: number) => {
    const text = String(price)
    setSelected((prev) => ({ ...prev, [item.name]: text }))
    setDraftPrices((prev) => ({ ...prev, [item.name]: text }))
    clearRecordValue(setPriceErrors, item.name)
  }
  const validatedPrice = (item: CatalogItem): number | null => {
    const raw = priceText(item.name).trim()
    const parsed = raw === '' ? item.price : parseDecimalInput(raw)
    return parsed !== null && parsed > 0 ? parsed : null
  }
  const applyPrice = (item: CatalogItem): boolean => {
    if (!isSelected(item.name)) return false
    const parsed = validatedPrice(item)
    if (parsed === null) {
      setPriceErrors((prev) => ({
        ...prev,
        [item.name]: 'Enter a positive price using a comma or dot for cents',
      }))
      return false
    }
    const normalized = String(parsed)
    setSelected((prev) => ({ ...prev, [item.name]: normalized }))
    setDraftPrices((prev) => ({ ...prev, [item.name]: normalized }))
    clearRecordValue(setPriceErrors, item.name)
    return true
  }

  const groups = createMemo(() => {
    const q = search().trim().toLowerCase()
    if (!q) return SUBSCRIPTION_CATALOG
    return SUBSCRIPTION_CATALOG.map((g) => ({
      label: g.label,
      items: g.items.filter((i) => i.name.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0)
  })

  const chosen = createMemo(() => Object.keys(selected()))
  const total = createMemo(() => chosen().reduce((sum, name) => sum + priceOf(selected()[name]), 0))

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2,
    }).format(n)

  const resolveCategoryId = (item: CatalogItem): number | undefined => {
    const cats = props.categories().filter((c) => c.type === 'expense')
    const brandCat = matchBrand(item.name).defaultCategory
    const hints = [...item.categoryHints, brandCat]
    for (const hint of hints) {
      const hit = cats.find((c) => c.name.toLowerCase() === hint.toLowerCase())
      if (hit) return hit.id
    }
    return undefined
  }

  const addAll = async () => {
    if (submitting() || chosen().length === 0) return

    const pending: Array<{ item: CatalogItem; amount: number }> = []
    const errors: Record<string, string> = {}
    for (const name of chosen()) {
      const item = CATALOG_ITEMS.find((candidate) => candidate.name === name)
      if (!item) continue
      const amount = validatedPrice(item)
      if (amount === null) {
        errors[name] = 'Enter a positive price using a comma or dot for cents'
      } else {
        pending.push({ item, amount })
      }
    }
    if (Object.keys(errors).length > 0) {
      setPriceErrors(errors)
      showToast('Fix the highlighted subscription prices', 'error')
      return
    }

    // Clicking Add is also an explicit commit, so a valid draft is never ignored
    // merely because the user skipped the per-row checkmark.
    setSelected((prev) => {
      const next = { ...prev }
      for (const { item, amount } of pending) next[item.name] = String(amount)
      return next
    })
    setDraftPrices((prev) => {
      const next = { ...prev }
      for (const { item, amount } of pending) next[item.name] = String(amount)
      return next
    })

    setSubmitting(true)
    const due = todayIso()
    let ok = 0
    try {
      for (const { item, amount } of pending) {
        try {
          await apiPost('/api/bills', {
            name: item.name,
            amount,
            dueDate: due,
            category_id: resolveCategoryId(item),
            frequency: 'monthly',
            type: 'subscription',
          })
          ok += 1
        } catch (err) {
          console.error('Failed to add subscription', item.name, err)
        }
      }
      if (ok > 0) {
        showToast(`${ok} subscription${ok === 1 ? '' : 's'} added`, 'success')
        props.onAdded()
      }
      if (ok < pending.length) showToast('Some subscriptions could not be added', 'error')
      setSelected({})
      setDraftPrices({})
      setPriceErrors({})
      props.onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const token = (item: CatalogItem) => {
    const brand = matchBrand(item.name)
    const known = brand.displayName !== ''
    const idx = CATALOG_ITEMS.findIndex((i) => i.name === item.name)
    const tint = known ? brand.color : paletteColor(idx < 0 ? 0 : idx)
    const priceDirty = () => isSelected(item.name) && priceText(item.name) !== selected()[item.name]
    // Tier label follows the committed plan; a custom draft becomes active only
    // after the checkmark (or Add) validates it.
    const activeTier = () => {
      if (!isSelected(item.name)) return item.tier
      const p = priceOf(selected()[item.name])
      const hit = item.plans?.find((pl) => Math.abs(pl.price - p) < 0.005)
      return hit?.label ?? item.tier
    }
    return (
      <div
        class={styles.tok}
        classList={{ [styles.on]: isSelected(item.name) }}
        style={{ '--tc': tint }}
      >
        <div
          class={styles.tokRow}
          role="button"
          tabindex="0"
          aria-pressed={isSelected(item.name)}
          onClick={() => {
            toggle(item)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle(item)
            }
          }}
        >
          <span
            class={styles.badge}
            style={{ color: tint, background: `color-mix(in oklab, ${tint} 16%, transparent)` }}
          >
            <Show when={known} fallback={<b>{item.name.charAt(0)}</b>}>
              {brand.icon()}
            </Show>
          </span>
          <span class={styles.info}>
            <span class={styles.name}>{item.name}</span>
            <Show when={activeTier()}>
              <span class={styles.tier}>{activeTier()}</span>
            </Show>
          </span>
          <Show
            when={isSelected(item.name)}
            fallback={<span class={styles.price}>{money(item.price)}</span>}
          >
            <span
              class={styles.priceEdit}
              classList={{ [styles.priceEditError]: Boolean(priceError(item.name)) }}
              onClick={(e) => {
                e.stopPropagation()
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
              }}
            >
              <span class={styles.cur}>€</span>
              <input
                class={styles.priceInput}
                type="text"
                inputmode="decimal"
                value={priceText(item.name)}
                onClick={(e) => {
                  e.stopPropagation()
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && applyPrice(item)) e.currentTarget.blur()
                }}
                onInput={(e) => {
                  setPriceText(item.name, e.currentTarget.value)
                }}
                aria-label={`${item.name} price`}
                aria-invalid={Boolean(priceError(item.name))}
              />
            </span>
          </Show>
          <button
            type="button"
            class={styles.check}
            classList={{
              [styles.checkDirty]: priceDirty(),
              [styles.checkApplied]: isSelected(item.name) && !priceDirty(),
            }}
            tabindex={isSelected(item.name) ? 0 : -1}
            aria-label={isSelected(item.name) ? `Apply ${item.name} price` : `Add ${item.name}`}
            onClick={(e) => {
              e.stopPropagation()
              if (isSelected(item.name)) applyPrice(item)
              else toggle(item)
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="m3 8.2 3.1 3.1L13 4.7" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>
        </div>
        <Show when={priceError(item.name)}>
          <span class={styles.priceError} role="alert">
            {priceError(item.name)}
          </span>
        </Show>

        <Show when={item.plans && item.plans.length > 0}>
          <div class={styles.plans}>
            <For each={item.plans}>
              {(pl) => {
                const active = () =>
                  isSelected(item.name) &&
                  Math.abs(priceOf(selected()[item.name]) - pl.price) < 0.005
                return (
                  <button
                    type="button"
                    class={styles.pill}
                    classList={{ [styles.pillOn]: active() }}
                    onClick={(e) => {
                      e.stopPropagation()
                      pickPlan(item, pl.price)
                    }}
                  >
                    {pl.label}
                    <span class={styles.pillPrice}>{money(pl.price)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    )
  }

  return (
    <div
      class={styles.overlay}
      classList={{ [styles.open]: props.isOpen() }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={styles.modal} role="dialog" aria-modal="true" aria-label="Subscription catalog">
        <div class={styles.head}>
          <div>
            <h2 class={styles.title}>Add subscriptions</h2>
            <p class={styles.sub}>Tap the ones you have · pick a plan or type your price</p>
          </div>
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
        </div>

        <div class={styles.searchRow}>
          <input
            class={styles.search}
            type="text"
            placeholder="Search services…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search the catalog"
          />
        </div>

        <div class={styles.body}>
          <For each={groups()}>
            {(g) => (
              <section class={styles.group}>
                <h3 class={styles.groupLabel}>{g.label}</h3>
                <div class={styles.tokens}>
                  <For each={g.items}>{(item) => token(item)}</For>
                </div>
              </section>
            )}
          </For>
          <Show when={groups().length === 0}>
            <p class={styles.empty}>
              No services match “{search()}”. You can still add it from the form.
            </p>
          </Show>
        </div>

        <div class={styles.footer}>
          <span class={styles.tot}>
            <Show when={chosen().length > 0} fallback="Nothing selected yet">
              {chosen().length} selected · <b>{money(total())}</b>/mo
            </Show>
          </span>
          <button
            class={styles.add}
            disabled={chosen().length === 0 || submitting()}
            onClick={() => void addAll()}
            type="button"
          >
            {submitting() ? 'Adding…' : `Add ${chosen().length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionCatalogModalDefault(props: SubscriptionCatalogModalProps) {
  return <SubscriptionCatalogModal {...props} />
}
