/**
 * SubscriptionCatalogModal — direction B of the entry system: pick your
 * subscriptions from a shelf instead of filling a form ten times. Multi-select
 * tokens from the seed catalog, quick-pick a plan tier or type a custom price,
 * and add them all in one batch. Each token reuses the app's brand marks via
 * `matchBrand`, so a subscription arrives looking the way it will in the list.
 *
 * Prices are held as raw text while editing (so "0", an empty field, and
 * trailing decimals all type cleanly), then checked when the checkmark or the
 * batch-add button commits them.
 *
 * The shelf is a form-kit form (components/form): each chosen subscription's price is a field,
 * named by the subscription, and checked by the rules both runtimes run for a bill
 * (shared/billSchema.ts). A price they refuse is said under its token, in their words, and focus
 * goes to it; one the runtime refuses is marked there too, and the rest of the batch is added. A
 * refusal no price can fix (another profile's category, being offline) is said in the notice,
 * naming the subscription. Price mistakes used to be a toast, "Fix the highlighted subscription
 * prices", and a refusal from the runtime a toast too, after the shelf had closed.
 */
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js'
import { checkBillCreate } from '../../../shared/billSchema'
import { apiPost, getLocalCurrency, showToast } from '../core/api'
import { ApiError } from '../core/apiError'
import { paletteColor } from '../core/brandPalette'
import { currencySymbol } from '../core/currencies'
import { parseDecimalInput } from '../core/decimalInput'
import { matchBrand } from '../features/subscriptionBrands'
import { CATALOG_ITEMS, SUBSCRIPTION_CATALOG } from '../features/subscriptionCatalog'
import { localToday } from '../utils/period'
import { createForm, FormNotice, SubmitButton } from './form'
import { refusedMessages } from './refusedSubscriptions'
import styles from './SubscriptionCatalogModal.module.css'
import type { JSX } from 'solid-js'
import type { FieldErrors } from '../../../shared/refusal'
import type { CatalogItem } from '../features/subscriptionCatalog'
import type { RefusedSubscription } from './refusedSubscriptions'

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
}

const todayIso = () => localToday()
const priceOf = (text: string): number => {
  return parseDecimalInput(text) ?? 0
}

/**
 * The amount a token's price text stands for: the catalog price when it is blank, a number when it
 * reads as one, and the text itself when it does not, so the bill rules say what is wrong with it.
 */
function amountOf(item: CatalogItem, text: string | undefined): number | string {
  const raw = (text ?? '').trim()
  if (raw === '') return item.price
  return parseDecimalInput(raw) ?? raw
}

/** What the bill rules say about a token's price, or undefined when it can be added. */
function priceProblem(item: CatalogItem, text: string | undefined): string | undefined {
  const checked = checkBillCreate({
    name: item.name,
    amount: amountOf(item, text),
    dueDate: todayIso(),
    frequency: 'monthly',
    type: 'subscription',
  })
  return checked.ok ? undefined : checked.fields.amount
}

export function SubscriptionCatalogModal(props: SubscriptionCatalogModalProps) {
  const [search, setSearch] = createSignal('')
  // `selected` holds each chosen subscription's committed price, in the order they were chosen;
  // the form holds exactly what is in each price input until the checkmark (or Add) applies it.
  const [selected, setSelected] = createSignal<Record<string, string>>({})

  const itemNamed = (name: string) => CATALOG_ITEMS.find((candidate) => candidate.name === name)

  const isSelected = (name: string) => Object.prototype.hasOwnProperty.call(selected(), name)
  const unselect = (name: string) => {
    setSelected((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const form = createForm<Record<string, string>, number>({
    initial: {},
    check: (values) => {
      const fields: FieldErrors = {}
      for (const name of Object.keys(selected())) {
        const item = itemNamed(name)
        const problem = item ? priceProblem(item, values[name]) : undefined
        if (problem) fields[name] = problem
      }
      return fields
    },
    send: async (values) => {
      const pending: Array<{ item: CatalogItem; amount: number }> = []
      for (const name of Object.keys(selected())) {
        const item = itemNamed(name)
        const amount = item ? amountOf(item, values[name]) : null
        if (item && typeof amount === 'number') pending.push({ item, amount })
      }
      // Clicking Add is also an explicit commit, so a valid draft is never ignored merely because
      // the user skipped the per-row checkmark.
      for (const { item, amount } of pending) commit(item, String(amount))

      const due = todayIso()
      let ok = 0
      const refused: Array<RefusedSubscription & { fields: FieldErrors }> = []
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
          unselect(item.name)
        } catch (err) {
          console.error('Failed to add subscription', item.name, err)
          refused.push({
            name: item.name,
            error: err,
            fields: err instanceof ApiError ? err.fields : {},
          })
        }
      }
      if (ok > 0) {
        showToast(`${ok} subscription${ok === 1 ? '' : 's'} added`, 'success')
      }
      if (refused.length === 0) return ok

      // A price the runtime refused is marked under its token; anything else goes in the notice,
      // under a name no field has, naming the subscriptions it is about.
      const marks: FieldErrors = {}
      const elsewhere: RefusedSubscription[] = []
      for (const { name, error, fields } of refused) {
        if (fields.amount) marks[name] = fields.amount
        else elsewhere.push({ name, error })
      }
      refusedMessages(elsewhere).forEach((message, index) => {
        marks[`refused:${String(index)}`] = message
      })
      throw new ApiError(400, Object.values(marks).join(' '), marks)
    },
    saved: () => {
      setSelected({})
      form.reset({})
      props.onClose()
    },
    failure: "Couldn't add the subscriptions. Try again.",
  })

  /** Make `price` the committed price of `item`, and what its input shows. */
  const commit = (item: CatalogItem, price: string) => {
    setSelected((prev) => ({ ...prev, [item.name]: price }))
    form.set(item.name, price)
  }

  const priceText = (name: string) => form.values[name] ?? selected()[name] ?? ''

  const toggle = (item: CatalogItem) => {
    if (isSelected(item.name)) {
      unselect(item.name)
      form.mark(item.name, undefined)
      return
    }
    commit(item, String(item.price))
  }
  const setPriceText = (name: string, raw: string) => {
    // Preserve the exact text so Solid never rewrites the input under the caret. Checking and
    // normalizing happen only when the value is applied or submitted.
    form.set(name, raw)
  }
  const pickPlan = (item: CatalogItem, price: number) => {
    commit(item, String(price))
    form.mark(item.name, undefined)
  }
  const applyPrice = (item: CatalogItem): boolean => {
    if (!isSelected(item.name)) return false
    const problem = priceProblem(item, priceText(item.name))
    form.mark(item.name, problem)
    if (problem) return false
    commit(item, String(amountOf(item, priceText(item.name))))
    return true
  }

  /**
   * A chosen token's price input, registered with the form while it is on the page, as a `Field`
   * registers its control: the form moves focus to it and keeps its words out of the notice. A
   * `Field` would put its own label and message inside the token's row.
   */
  const Registered = (p: { name: string; id: string; children: JSX.Element }) => {
    // A token's name and input are fixed while it is chosen, so it registers once.
    onCleanup(form.register(p.name, p.id))
    return p.children
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

  // Catalog prices are in the user's currency, and a bill added from here is saved in it.
  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: getLocalCurrency(),
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

  const token = (item: CatalogItem) => {
    const brand = matchBrand(item.name)
    const known = brand.displayName !== ''
    const idx = CATALOG_ITEMS.findIndex((i) => i.name === item.name)
    const tint = known ? brand.color : paletteColor(idx < 0 ? 0 : idx)
    const priceDirty = () => isSelected(item.name) && priceText(item.name) !== selected()[item.name]
    const priceId = `catalog-price-${createUniqueId()}`
    const errorId = `${priceId}-error`
    const problem = () => (isSelected(item.name) ? form.error(item.name) : undefined)
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
            <Registered name={item.name} id={priceId}>
              <span
                class={styles.priceEdit}
                classList={{ [styles.priceEditError]: Boolean(problem()) }}
                onClick={(e) => {
                  e.stopPropagation()
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                }}
              >
                <span class={styles.cur}>{currencySymbol(getLocalCurrency())}</span>
                <input
                  id={priceId}
                  class={styles.priceInput}
                  type="text"
                  inputmode="decimal"
                  value={priceText(item.name)}
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key !== 'Enter') return
                    // Enter applies this price; it does not add the batch.
                    e.preventDefault()
                    if (applyPrice(item)) e.currentTarget.blur()
                  }}
                  onInput={(e) => {
                    setPriceText(item.name, e.currentTarget.value)
                  }}
                  aria-label={`${item.name} price`}
                  aria-invalid={problem() ? 'true' : undefined}
                  aria-describedby={problem() ? errorId : undefined}
                />
              </span>
            </Registered>
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
              if (!isSelected(item.name)) toggle(item)
              else if (!applyPrice(item)) document.getElementById(priceId)?.focus()
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="m3 8.2 3.1 3.1L13 4.7" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>
        </div>
        <Show when={problem()}>
          <p id={errorId} class={styles.priceError}>
            {problem()}
          </p>
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

        <form class={styles.form} {...form.attrs} data-test-id="catalog-form">
          <div class={styles.searchRow}>
            <input
              class={styles.search}
              type="text"
              placeholder="Search services…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter searches; it does not add the batch.
                if (e.key === 'Enter') e.preventDefault()
              }}
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

          <div class={styles.noticeRow}>
            <FormNotice form={form} testId="catalog-notice" />
          </div>

          <div class={styles.footer}>
            <span class={styles.tot}>
              <Show when={chosen().length > 0} fallback="Nothing selected yet">
                {chosen().length} selected · <b>{money(total())}</b>/mo
              </Show>
            </span>
            <SubmitButton
              class={styles.add}
              busy={form.submitting()}
              busyLabel="Adding…"
              unchanged={chosen().length === 0}
            >
              {`Add ${chosen().length || ''}`.trim()}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SubscriptionCatalogModalDefault(props: SubscriptionCatalogModalProps) {
  return <SubscriptionCatalogModal {...props} />
}
