/**
 * SubscriptionCatalogModal — direction B of the entry system: pick your
 * subscriptions from a shelf instead of filling a form ten times. Multi-select
 * tokens from the seed catalog, quick-pick a plan tier or type a custom price,
 * and add them all in one batch. Each token reuses the app's brand marks via
 * `matchBrand`, so a subscription arrives looking the way it will in the list.
 *
 * Prices are held as raw text while editing (so "0", an empty field, and
 * trailing decimals all type cleanly) and parsed to a number only when the
 * total is shown or the batch is created.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { apiPost, showToast } from '../core/api'
import { paletteColor } from '../core/brandPalette'
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
  const n = parseFloat((text || '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function SubscriptionCatalogModal(props: SubscriptionCatalogModalProps) {
  const [search, setSearch] = createSignal('')
  // name -> raw price text (key present == selected)
  const [selected, setSelected] = createSignal<Record<string, string>>({})
  const [submitting, setSubmitting] = createSignal(false)

  const isSelected = (name: string) => Object.prototype.hasOwnProperty.call(selected(), name)
  const priceText = (name: string) => selected()[name] ?? ''

  const toggle = (item: CatalogItem) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (Object.prototype.hasOwnProperty.call(next, item.name)) delete next[item.name]
      else next[item.name] = String(item.price)
      return next
    })
  }
  const setPriceText = (name: string, raw: string) => {
    // Keep only digits and one decimal separator, but never fight the user
    // mid-type (allow "", "0", "10." …). Coercion to a number happens later.
    const cleaned = raw.replace(/[^\d.,]/g, '')
    setSelected((prev) => ({ ...prev, [name]: cleaned }))
  }
  const pickPlan = (item: CatalogItem, price: number) => {
    setSelected((prev) => ({ ...prev, [item.name]: String(price) }))
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
  const total = createMemo(() => chosen().reduce((s, name) => s + priceOf(selected()[name]), 0))

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
    setSubmitting(true)
    const due = todayIso()
    let ok = 0
    try {
      for (const name of chosen()) {
        const item = CATALOG_ITEMS.find((i) => i.name === name)
        try {
          await apiPost('/api/bills', {
            name,
            amount: priceOf(selected()[name]),
            dueDate: due,
            category_id: item ? resolveCategoryId(item) : undefined,
            frequency: 'monthly',
            type: 'subscription',
          })
          ok += 1
        } catch (err) {
          console.error('Failed to add subscription', name, err)
        }
      }
      if (ok > 0) {
        showToast(`${ok} subscription${ok === 1 ? '' : 's'} added`, 'success')
        props.onAdded()
      }
      if (ok < chosen().length) showToast('Some subscriptions could not be added', 'error')
      setSelected({})
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
    // Tier label follows the picked plan when one matches the current price.
    const activeTier = () => {
      if (!isSelected(item.name)) return item.tier
      const p = priceOf(priceText(item.name))
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
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                onInput={(e) => {
                  setPriceText(item.name, e.currentTarget.value)
                }}
                aria-label={`${item.name} price`}
              />
            </span>
          </Show>
          <span class={styles.check} aria-hidden="true">
            ✓
          </span>
        </div>

        <Show when={item.plans && item.plans.length > 0}>
          <div class={styles.plans}>
            <For each={item.plans}>
              {(pl) => {
                const active = () =>
                  isSelected(item.name) &&
                  Math.abs(priceOf(priceText(item.name)) - pl.price) < 0.005
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
