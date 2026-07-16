/**
 * SubscriptionScan — review UI over the subscription auto-detection engine.
 * Scans the profile's transactions for catalogue/brand charges ("Netflix",
 * "Google One", "Claude", ...) and proposes them as subscriptions with the
 * detected price and cadence, each row editable and individually selectable.
 *
 * Two faces of the same panel:
 *   - `SubscriptionScanPanel`: embeddable (onboarding wizard step, modal body).
 *   - `SubscriptionScanModal`: overlay wrapper for the Bills and Import pages.
 */
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { apiGet, apiPost, getLocalCurrency, listRows, showToast } from '../core/api'
import { monthlyEquivalent } from '../core/subscriptionMath'
import { matchBrand } from '../features/subscriptionBrands'
import { detectSubscriptions } from '../features/subscriptionDetection'
import { OrbitSpinner } from './OrbitSpinner'
import styles from './SubscriptionScan.module.css'
import type {
  DetectableTransaction,
  DetectedFrequency,
  DetectedSubscription,
} from '../features/subscriptionDetection'

interface BillRow {
  name: string
  type?: string | null
}

interface CategoryRow {
  id: number
  name: string
  type: string
}

// Scan the recent past only: enough history for a yearly cadence to show up
// twice, without chewing through decades of imported data.
const SCAN_WINDOW_DAYS = 750

export interface SubscriptionScanPanelProps {
  /** Panel scans when this turns true (and on explicit rescan). */
  active: () => boolean
  /** Fired after subscriptions were created, with how many. */
  onAdded?: (count: number) => void
  /** Extra hint under the empty state (e.g. "Import transactions first"). */
  emptyHint?: string
}

interface RowState {
  included: boolean
  priceText: string
  frequency: DetectedFrequency
}

export function SubscriptionScanPanel(props: SubscriptionScanPanelProps) {
  const [scanning, setScanning] = createSignal(false)
  const [scanned, setScanned] = createSignal(false)
  const [detected, setDetected] = createSignal<DetectedSubscription[]>([])
  const [rows, setRows] = createSignal<Record<string, RowState>>({})
  const [categories, setCategories] = createSignal<CategoryRow[]>([])
  const [submitting, setSubmitting] = createSignal(false)
  const [added, setAdded] = createSignal<Set<string>>(new Set())

  const scan = async () => {
    setScanning(true)
    try {
      const [txnsRes, billsRes, catsRes] = await Promise.all([
        apiGet('/api/transactions'),
        apiGet('/api/bills'),
        apiGet('/api/categories'),
      ])
      // listRows, not Array.isArray: the server-mode /api/transactions response
      // is a { rows, total } envelope — a bare-array assumption scans nothing.
      const txns = listRows<DetectableTransaction>(txnsRes)
      const bills = listRows<BillRow>(billsRes)
      setCategories(listRows<CategoryRow>(catsRes))
      const cutoff = Date.now() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const recent = txns.filter((t) => {
        const ms = new Date(`${(t.date || '').slice(0, 10)}T00:00:00Z`).getTime()
        return Number.isFinite(ms) && ms >= cutoff
      })
      const found = detectSubscriptions(recent, bills)
      setDetected(found)
      const next: Record<string, RowState> = {}
      for (const d of found) {
        next[d.key] = {
          included: !d.alreadyTracked && d.confidence !== 'low',
          priceText: String(d.amount),
          frequency: d.frequency,
        }
      }
      setRows(next)
      setAdded(new Set<string>())
    } catch (err) {
      console.error('Subscription scan failed:', err)
      setDetected([])
      setRows({})
    } finally {
      setScanning(false)
      setScanned(true)
    }
  }

  // First activation triggers the scan; re-activations rescan so the panel
  // reflects transactions imported since the last look.
  createEffect(() => {
    if (props.active()) void scan()
  })

  const row = (key: string): RowState =>
    rows()[key] ?? { included: false, priceText: '', frequency: 'monthly' }
  const patchRow = (key: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [key]: { ...row(key), ...patch } }))
  }

  const priceOf = (text: string): number => {
    const n = parseFloat((text || '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }

  const selectable = createMemo(() =>
    detected().filter((d) => !d.alreadyTracked && !added().has(d.key))
  )
  const tracked = createMemo(() => detected().filter((d) => d.alreadyTracked || added().has(d.key)))
  const chosen = createMemo(() => selectable().filter((d) => row(d.key).included))
  const monthlyTotal = createMemo(() =>
    chosen().reduce((sum, d) => {
      const r = row(d.key)
      return sum + monthlyEquivalent(priceOf(r.priceText), r.frequency)
    }, 0)
  )

  const money = (n: number, currency?: string | null) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || getLocalCurrency(),
        maximumFractionDigits: 2,
      }).format(n)
    } catch {
      return n.toFixed(2)
    }
  }

  const resolveCategoryId = (d: DetectedSubscription): number | undefined => {
    const cats = categories().filter((c) => c.type === 'expense')
    const hints = [...d.categoryHints, matchBrand(d.name).defaultCategory]
    for (const hint of hints) {
      const hit = cats.find((c) => c.name.toLowerCase() === hint.toLowerCase())
      if (hit) return hit.id
    }
    return undefined
  }

  const addSelected = async () => {
    const picks = chosen()
    if (submitting() || picks.length === 0) return
    setSubmitting(true)
    let ok = 0
    try {
      for (const d of picks) {
        const r = row(d.key)
        try {
          await apiPost('/api/bills', {
            name: d.name,
            amount: priceOf(r.priceText),
            dueDate: d.suggestedDueDate,
            category_id: resolveCategoryId(d),
            frequency: r.frequency,
            type: 'subscription',
          })
          ok += 1
          setAdded((prev) => new Set(prev).add(d.key))
        } catch (err) {
          console.error('Failed to add subscription', d.name, err)
        }
      }
      if (ok > 0) {
        showToast(`${ok} subscription${ok === 1 ? '' : 's'} added`, 'success')
        props.onAdded?.(ok)
      }
      if (ok < picks.length) showToast('Some subscriptions could not be added', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const confidenceLabel: Record<DetectedSubscription['confidence'], string> = {
    high: 'High confidence',
    medium: 'Likely',
    low: 'Possible',
  }

  const detectedRow = (d: DetectedSubscription) => {
    const brand = matchBrand(d.name)
    const known = brand.displayName !== ''
    const isTracked = () => d.alreadyTracked || added().has(d.key)
    return (
      <div
        class={styles.row}
        classList={{
          [styles.rowOn]: !isTracked() && row(d.key).included,
          [styles.rowTracked]: isTracked(),
        }}
        data-test-id="sub-scan-row"
        data-name={d.name}
      >
        <label class={styles.rowMain}>
          <input
            type="checkbox"
            class={styles.check}
            data-test-id="sub-scan-row-checkbox"
            checked={!isTracked() && row(d.key).included}
            disabled={isTracked() || submitting()}
            onChange={(e) => {
              patchRow(d.key, { included: e.currentTarget.checked })
            }}
          />
          <span
            class={styles.badge}
            style={{
              color: brand.color,
              background: `color-mix(in oklab, ${brand.color} 14%, transparent)`,
            }}
          >
            <Show when={known} fallback={<b>{d.name.charAt(0)}</b>}>
              {brand.icon()}
            </Show>
          </span>
          <span class={styles.info}>
            <span class={styles.name}>
              {d.name}
              <Show when={d.matchedPlan}>
                <span class={styles.plan}>{d.matchedPlan!.label}</span>
              </Show>
            </span>
            <span class={styles.meta}>
              {d.occurrences} charge{d.occurrences === 1 ? '' : 's'} · last {d.lastDate} ·{' '}
              {isTracked() ? 'Already tracked' : confidenceLabel[d.confidence]}
            </span>
          </span>
        </label>
        <Show when={!isTracked()}>
          <span class={styles.controls}>
            <span class={styles.priceWrap}>
              <input
                class={styles.price}
                type="text"
                inputmode="decimal"
                data-test-id="sub-scan-price"
                value={row(d.key).priceText}
                disabled={submitting()}
                onInput={(e) => {
                  patchRow(d.key, { priceText: e.currentTarget.value.replace(/[^\d.,]/g, '') })
                }}
                aria-label={`${d.name} price`}
              />
              <span class={styles.cur}>{d.currency || getLocalCurrency()}</span>
            </span>
            <select
              class={styles.freq}
              data-test-id="sub-scan-frequency"
              value={row(d.key).frequency}
              disabled={submitting()}
              onChange={(e) => {
                patchRow(d.key, { frequency: e.currentTarget.value as DetectedFrequency })
              }}
              aria-label={`${d.name} billing period`}
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </span>
        </Show>
      </div>
    )
  }

  return (
    <div class={styles.panel} data-test-id="subscription-scan">
      <Show
        when={!scanning()}
        fallback={
          <div class={styles.state}>
            <OrbitSpinner size={56} label="Scanning your transactions…" />
          </div>
        }
      >
        <Show
          when={detected().length > 0}
          fallback={
            <Show when={scanned()}>
              <div class={styles.state} data-test-id="sub-scan-empty">
                <p>No known subscriptions found in your recent transactions.</p>
                <Show when={props.emptyHint}>
                  <p class={styles.hint}>{props.emptyHint}</p>
                </Show>
              </div>
            </Show>
          }
        >
          <div class={styles.list}>
            <For each={selectable()}>{detectedRow}</For>
          </div>
          <Show when={tracked().length > 0}>
            <p class={styles.trackedLabel}>Already tracked</p>
            <div class={styles.list}>
              <For each={tracked()}>{detectedRow}</For>
            </div>
          </Show>
          <div class={styles.footer}>
            <span class={styles.total}>
              <Show when={chosen().length > 0} fallback="Nothing selected">
                {chosen().length} selected · <b>{money(monthlyTotal())}</b>/mo
              </Show>
            </span>
            <span class={styles.footerActions}>
              <button
                class={styles.rescan}
                type="button"
                disabled={scanning() || submitting()}
                onClick={() => void scan()}
              >
                Rescan
              </button>
              <button
                class={styles.add}
                type="button"
                data-test-id="sub-scan-add-btn"
                disabled={chosen().length === 0 || submitting()}
                onClick={() => void addSelected()}
              >
                {submitting() ? 'Adding…' : `Add ${chosen().length || ''}`.trim()}
              </button>
            </span>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export interface SubscriptionScanModalProps {
  isOpen: () => boolean
  onClose: () => void
  onAdded?: (count: number) => void
}

export function SubscriptionScanModal(props: SubscriptionScanModalProps) {
  return (
    <div
      class={styles.overlay}
      classList={{ [styles.open]: props.isOpen() }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        class={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Detected subscriptions"
        data-test-id="sub-scan-modal"
      >
        <div class={styles.head}>
          <div>
            <h2 class={styles.title}>Detected subscriptions</h2>
            <p class={styles.sub}>Recurring charges we recognized · adjust price or period</p>
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
        <div class={styles.body}>
          <SubscriptionScanPanel
            active={props.isOpen}
            onAdded={props.onAdded}
            emptyHint="Import transactions or add them manually, then rescan."
          />
        </div>
      </div>
    </div>
  )
}
