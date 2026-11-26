/**
 * SubscriptionScan — review UI over the subscription auto-detection engine.
 * Scans the profile's transactions for catalogue/brand charges ("Netflix",
 * "Google One", "Claude", ...) and proposes them as subscriptions with the
 * detected price and cadence, each row editable and individually selectable.
 * Regular payments to a payee with no such name (features/recurringPayments.ts) are proposed as
 * "Regular payment to {payee}", and added under the payee's name, in the category their charges
 * are filed under: as a bill for a home, a loan or a child, else as a subscription.
 *
 * Two faces of the same panel:
 *   - `SubscriptionScanPanel`: embeddable (onboarding wizard step, modal body).
 *   - `SubscriptionScanModal`: overlay wrapper for the Bills and Import pages.
 *
 * The panel is a form-kit form (components/form): each row's price is a field, named by the
 * row, and checked by the rules both runtimes run for a bill (shared/billSchema.ts). A price they
 * refuse is said under its row, in their words, with focus on it, and nothing is sent; one the
 * runtime refuses is marked there too, while the rest are added. A refusal no price can fix is said
 * in the notice, naming the subscription. Both used to be a toast, with nothing marked, and the
 * price field dropped any letter typed into it.
 *
 * While it adds, the form is busy (`aria-busy`) and nothing on it is disabled: a disabled control
 * drops the focus to the page, and Enter in a price used to leave a keyboard user there. A tick or
 * a Rescan is `aria-disabled` and does nothing until the add is done, as the Add button does.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
} from 'solid-js'
import { BILL_MESSAGES, BILL_NAME_MAX, checkBillCreate } from '../../../shared/billSchema'
import { BANK_IMPORT_HASH } from '../../../shared/importRoute'
import { apiGet, apiPost, getLocalCurrency, listRows, showToast } from '../core/api'
import { ApiError } from '../core/apiError'
import { activeProfileId } from '../core/apiProfileScope'
import { parseDecimalInput } from '../core/decimalInput'
import { monthlyEquivalent } from '../core/subscriptionMath'
import { matchBrand } from '../features/subscriptionBrands'
import {
  detectSubscriptions,
  recentForScan,
  worthTracking,
} from '../features/subscriptionDetection'
import { dayText } from '../utils/dayText'
import { dialogFocusWhile } from '../utils/dialogFocus'
import { createForm, FormNotice, SubmitButton } from './form'
import { OrbitSpinner } from './OrbitSpinner'
import { refusedMessages } from './refusedSubscriptions'
import styles from './SubscriptionScan.module.css'
import type { JSX } from 'solid-js'
import type { KindedCategory } from '../../../shared/guidance/kinds'
import type { FieldErrors } from '../../../shared/refusal'
import type {
  DetectableTransaction,
  DetectedFrequency,
  DetectedSubscription,
} from '../features/subscriptionDetection'
import type { RefusedSubscription } from './refusedSubscriptions'

interface BillRow {
  name: string
  type?: string | null
}

interface CategoryRow extends KindedCategory {
  id: number
  name: string
  type: string
  /** Both runtimes answer it; a row without one is taken as the current profile's. */
  profile_id?: number | null
}

interface ChargeRow extends DetectableTransaction {
  /** Both runtimes answer it; a row without one is taken as the current profile's. */
  profile_id?: number | null
}

/**
 * The rows of the profile the scan adds to, the active one. With the data kept in this browser, a
 * household's lists answer every chosen profile's rows; the Worker answers the scan this profile's.
 */
function ofActiveProfile<Row extends { profile_id?: number | null }>(rows: readonly Row[]): Row[] {
  const profile = activeProfileId()
  return rows.filter(
    (r) => r.profile_id === null || r.profile_id === undefined || r.profile_id === profile
  )
}

export interface SubscriptionScanPanelProps {
  /** Panel scans when this turns true (and on explicit rescan). */
  active: () => boolean
  /** Fired after subscriptions were created, with how many. */
  onAdded?: (count: number) => void
  /** Extra hint under the empty state (e.g. "Import transactions first"). */
  emptyHint?: string
  /**
   * With no transactions at all there is nothing to scan, and the panel says so. Given this, it
   * also offers "Import a statement" (the Import page's bank tab), and calls it as the link is
   * followed so the host can close. The setup wizard leaves it out: its own import came first.
   */
  onImport?: () => void
  /**
   * Hand the host the panel's selection state and its add action.
   *
   * The onboarding wizard has one primary button per step, and this panel used to be the step
   * where that stopped being true: its own "Add 3" sat mid-panel while the wizard's "Continue"
   * sat in the footer, and Continue did NOT add — so the required order was add, wait, then
   * continue, with nothing saying so. Exposing the state lets the wizard fold both into its one
   * footer button ("Add 3 & continue"); passing `hideAddButton` removes the in-panel duplicate.
   */
  expose?: (api: {
    chosenCount: () => number
    submitting: () => boolean
    /** Adds the selection; resolves with how many were actually created. */
    addSelected: () => Promise<number>
    /** How many the scan found, once it has run: null before then and while it runs. */
    found: () => number | null
    /** How many rows on show have a price and period to change: none while it scans. */
    adjustable: () => number
  }) => void
  /** Hide the panel's own Add button (the host renders the action itself). */
  hideAddButton?: boolean
  /** Hide Rescan: the setup wizard scans once, right after an import. */
  hideRescan?: boolean
  /**
   * Say nothing in a toast when subscriptions are added: the host's next screen says it (the
   * setup wizard's summary). A toast there sat over the wizard's header and its Back and Close.
   */
  quiet?: boolean
}

interface RowState {
  included: boolean
  frequency: DetectedFrequency
}

/** A row's price as typed: a number when it reads as one, the text when it does not, or null. */
function amountOf(text: string | undefined): number | string | null {
  const raw = (text ?? '').trim()
  if (raw === '') return null
  return parseDecimalInput(raw) ?? raw
}

/** The details of a bill a row has a control for: its price and its billing period. */
const SHOWN = new Set(['amount', 'frequency'])

/**
 * What the scan says when the runtime refuses a detail it has no control for. The runtime's words
 * ask for that control ("Choose a category from the list, or leave it blank."), which a row does
 * not have, so the scan says what failed and what to do next: Bills has every detail. A refused
 * price is marked at its row, and a refused period keeps the runtime's words.
 */
function insteadOf(fields: FieldErrors): RefusedSubscription['instead'] {
  if (fields.category_id) {
    return (it) =>
      `The scan chose a category this profile doesn't have. Add ${it} from Bills and pick one there.`
  }
  if (fields.name === BILL_MESSAGES.nameLength) {
    return (it) =>
      `A name longer than ${BILL_NAME_MAX} characters can't be kept. Add ${it} from Bills with a shorter one.`
  }
  if (fields.due_date) {
    return (it) =>
      `The scan couldn't tell when the next payment is due. Add ${it} from Bills and pick the date.`
  }
  if (Object.keys(fields).some((field) => !SHOWN.has(field))) {
    return (it) =>
      `A detail the scan doesn't show was refused. Add ${it} from Bills, where every detail can be changed.`
  }
  return undefined
}

export function SubscriptionScanPanel(props: SubscriptionScanPanelProps) {
  const [scanning, setScanning] = createSignal(false)
  const [scanned, setScanned] = createSignal(false)
  /** The last scan read no transactions at all, as opposed to none that recur. */
  const [nothingToScan, setNothingToScan] = createSignal(false)
  const [detected, setDetected] = createSignal<DetectedSubscription[]>([])
  const [rows, setRows] = createSignal<Record<string, RowState>>({})
  const [categories, setCategories] = createSignal<CategoryRow[]>([])
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
      // Only this profile's charges: what the scan finds becomes this profile's bill.
      const txns = ofActiveProfile(listRows<ChargeRow>(txnsRes))
      const bills = listRows<BillRow>(billsRes)
      const cats = listRows<CategoryRow>(catsRes)
      setCategories(cats)
      setNothingToScan(txns.length === 0)
      const found = detectSubscriptions(recentForScan(txns, Date.now()), bills, {
        categories: cats,
      })
      setDetected(found)
      const next: Record<string, RowState> = {}
      const prices: Record<string, string> = {}
      for (const d of found) {
        next[d.key] = {
          included: worthTracking(d),
          frequency: d.frequency,
        }
        // As money is written: 4.50, never 4.5.
        prices[d.key] = d.amount.toFixed(2)
      }
      setRows(next)
      form.reset(prices)
      setAdded(new Set<string>())
    } catch (err) {
      console.error('Subscription scan failed:', err)
      setNothingToScan(false)
      setDetected([])
      setRows({})
      form.reset({})
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

  const row = (key: string): RowState => rows()[key] ?? { included: false, frequency: 'monthly' }
  const patchRow = (key: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [key]: { ...row(key), ...patch } }))
  }

  const priceOf = (text: string | undefined): number => {
    const amount = amountOf(text)
    return typeof amount === 'number' ? amount : 0
  }

  const selectable = createMemo(() =>
    detected().filter((d) => !d.alreadyTracked && !added().has(d.key))
  )
  const tracked = createMemo(() => detected().filter((d) => d.alreadyTracked || added().has(d.key)))
  const chosen = createMemo(() => selectable().filter((d) => row(d.key).included))
  const monthlyTotal = createMemo(() =>
    chosen().reduce((sum, d) => {
      const r = row(d.key)
      return sum + monthlyEquivalent(priceOf(form.values[d.key]), r.frequency)
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

  /**
   * The categories a row's bill can be filed under: those of the profile it goes to, the one the
   * add writes to. With the data kept in this browser, a household's scan reads every chosen
   * profile's categories, and both runtimes refuse a bill on another profile's.
   */
  const ownCategories = () => ofActiveProfile(categories())

  const named = (cats: readonly CategoryRow[], name: string) =>
    cats.find((c) => c.name.toLowerCase() === name.toLowerCase())

  /**
   * The category a row's bill is filed under, always one of its own profile's. A named find takes
   * the first of its hints that profile has. A regular payment keeps the category its charges are
   * filed under, or where that is another profile's, its own of the same name and type, or none.
   */
  const categoryOf = (d: DetectedSubscription): number | undefined => {
    const own = ownCategories()
    if (d.matchedVia === 'recurring') {
      if (d.categoryId === undefined || own.some((c) => c.id === d.categoryId)) return d.categoryId
      const theirs = categories().find((c) => c.id === d.categoryId)
      if (!theirs) return undefined
      return named(
        own.filter((c) => c.type === theirs.type),
        theirs.name
      )?.id
    }
    const expense = own.filter((c) => c.type === 'expense')
    for (const hint of [...d.categoryHints, matchBrand(d.name).defaultCategory]) {
      const hit = named(expense, hint)
      if (hit) return hit.id
    }
    return undefined
  }

  /** The bill a row adds. A regular payment keeps the category its charges are filed under. */
  const billOf = (d: DetectedSubscription, price: string | undefined) => ({
    name: d.name,
    amount: amountOf(price),
    dueDate: d.suggestedDueDate,
    category_id: categoryOf(d),
    frequency: row(d.key).frequency,
    type: d.billType,
  })

  /** How many the last add created, for the host's `addSelected`. */
  let lastAdded = 0

  const form = createForm<Record<string, string>>({
    initial: {},
    check: (values) => {
      const fields: FieldErrors = {}
      for (const d of chosen()) {
        const checked = checkBillCreate(billOf(d, values[d.key]))
        if (!checked.ok && checked.fields.amount) fields[d.key] = checked.fields.amount
      }
      return fields
    },
    send: async (values) => {
      lastAdded = 0
      const refused: Array<RefusedSubscription & { key: string; fields: FieldErrors }> = []
      for (const d of chosen()) {
        try {
          await apiPost('/api/bills', billOf(d, values[d.key]))
          lastAdded += 1
          setAdded((prev) => new Set(prev).add(d.key))
        } catch (err) {
          console.error('Failed to add subscription', d.name, err)
          refused.push({
            key: d.key,
            name: d.name,
            error: err,
            fields: err instanceof ApiError ? err.fields : {},
          })
        }
      }
      if (lastAdded > 0) {
        if (!props.quiet) {
          showToast(`${lastAdded} subscription${lastAdded === 1 ? '' : 's'} added`, 'success')
        }
        props.onAdded?.(lastAdded)
      }
      if (refused.length === 0) return

      // A price the runtime refused is marked under its row; anything else goes in the notice,
      // under a name no field has, naming the subscriptions it is about.
      const marks: FieldErrors = {}
      const elsewhere: RefusedSubscription[] = []
      for (const { key, name, error, fields } of refused) {
        if (fields.amount) marks[key] = fields.amount
        else elsewhere.push({ name, error, instead: insteadOf(fields) })
      }
      refusedMessages(elsewhere).forEach((message, index) => {
        marks[`refused:${String(index)}`] = message
      })
      throw new ApiError(400, Object.values(marks).join(' '), marks)
    },
    failure: "Couldn't add the subscriptions. Try again.",
  })

  /** Adds the chosen rows; resolves with how many were created. */
  const addSelected = async (): Promise<number> => {
    if (form.submitting() || chosen().length === 0) return 0
    lastAdded = 0
    await form.submit()
    return lastAdded
  }

  props.expose?.({
    chosenCount: () => chosen().length,
    submitting: form.submitting,
    addSelected,
    found: () => (scanned() && !scanning() ? detected().length : null),
    adjustable: () => (scanning() ? 0 : selectable().length),
  })

  const confidenceLabel: Record<DetectedSubscription['confidence'], string> = {
    high: 'High confidence',
    medium: 'Likely',
    low: 'Possible',
  }

  /**
   * A row's price input, registered with the form while it is on the page, as a `Field` registers
   * its control: the form moves focus to it and keeps its words out of the notice.
   */
  const Registered = (p: { name: string; id: string; children: JSX.Element }) => {
    // A row's key and input are fixed while it is on the page, so it registers once.
    onCleanup(form.register(p.name, p.id))
    return p.children
  }

  const detectedRow = (d: DetectedSubscription) => {
    const recurring = d.matchedVia === 'recurring'
    // A payee no name matched takes no brand's look, whatever words its name shares with one.
    const brand = matchBrand(recurring ? '' : d.name)
    const known = brand.displayName !== ''
    const isTracked = () => d.alreadyTracked || added().has(d.key)
    const priceId = `sub-scan-price-${createUniqueId()}`
    const errorId = `${priceId}-error`
    // A row left out is not added, so what was wrong with its price is not said.
    const problem = () => (!isTracked() && row(d.key).included ? form.error(d.key) : undefined)
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
            disabled={isTracked()}
            aria-disabled={form.submitting() ? 'true' : undefined}
            onClick={(e) => {
              // The add took the rows it was pressed on.
              if (form.submitting()) e.preventDefault()
            }}
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
            <span class={styles.name} data-test-id="sub-scan-name">
              {recurring ? `Regular payment to ${d.name}` : d.name}
              {/* The statement's own name for a catalogue match: "Gym membership (Example Gym)". */}
              <Show when={d.statementName}>
                {' '}
                <span class={styles.statementName} data-test-id="sub-scan-statement-name">
                  ({d.statementName})
                </span>
              </Show>
              <Show when={d.matchedPlan}>
                <span class={styles.plan}>{d.matchedPlan!.label}</span>
              </Show>
            </span>
            {/* "3 charges, last 15 Oct": a day as the import step before writes one. Each part
                keeps its words together, so a narrow row breaks between them. */}
            <span class={styles.meta} data-test-id="sub-scan-meta">
              <span class={styles.metaPart}>
                {d.occurrences} charge{d.occurrences === 1 ? '' : 's'},
              </span>{' '}
              <span class={styles.metaPart}>last {dayText(d.lastDate)}</span>
              {' · '}
              <span class={styles.metaPart}>
                {isTracked() ? 'Already tracked' : confidenceLabel[d.confidence]}
              </span>
            </span>
          </span>
        </label>
        <Show when={!isTracked()}>
          <span class={styles.controls}>
            <Registered name={d.key} id={priceId}>
              <span
                class={styles.priceWrap}
                classList={{ [styles.priceWrapError]: Boolean(problem()) }}
              >
                <input
                  id={priceId}
                  class={styles.price}
                  type="text"
                  inputmode="decimal"
                  data-test-id="sub-scan-price"
                  value={form.values[d.key] ?? ''}
                  onInput={(e) => {
                    form.set(d.key, e.currentTarget.value)
                  }}
                  aria-label={`${d.name} price`}
                  aria-invalid={problem() ? 'true' : undefined}
                  aria-describedby={problem() ? errorId : undefined}
                />
                <span class={styles.cur}>{d.currency || getLocalCurrency()}</span>
              </span>
            </Registered>
            <select
              class={styles.freq}
              data-test-id="sub-scan-frequency"
              value={row(d.key).frequency}
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
        <Show when={problem()}>
          <p id={errorId} class={styles.priceError} data-test-id="sub-scan-price-error">
            {problem()}
          </p>
        </Show>
      </div>
    )
  }

  return (
    <form class={styles.panel} {...form.attrs} data-test-id="subscription-scan">
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
              <Show
                when={!nothingToScan()}
                fallback={
                  <div class={styles.state} data-test-id="sub-scan-nothing">
                    <p>No transactions to scan yet.</p>
                    <p class={styles.hint}>
                      Import a statement and the scan finds the subscriptions in it.
                    </p>
                    <Show when={props.onImport}>
                      <a
                        class={styles.importLink}
                        href={BANK_IMPORT_HASH}
                        onClick={() => props.onImport?.()}
                        data-test-id="sub-scan-import"
                      >
                        Import a statement
                      </a>
                    </Show>
                  </div>
                }
              >
                <div class={styles.state} data-test-id="sub-scan-empty">
                  <p>No known subscriptions found in your recent transactions.</p>
                  <Show when={props.emptyHint}>
                    <p class={styles.hint}>{props.emptyHint}</p>
                  </Show>
                </div>
              </Show>
            </Show>
          }
        >
          {/* The rows, between the header and the actions: in the modal only they scroll, so the
              add stays in view however many the scan found. */}
          <div class={styles.scroll} data-test-id="sub-scan-scroll">
            <div class={styles.list}>
              <For each={selectable()}>{detectedRow}</For>
            </div>
            <Show when={tracked().length > 0}>
              <p class={styles.trackedLabel}>Already tracked</p>
              <div class={styles.list}>
                <For each={tracked()}>{detectedRow}</For>
              </div>
            </Show>
          </div>
          <div class={styles.footer} data-test-id="sub-scan-footer">
            {/* A failed add, directly above the buttons: at the end of the rows it was out of
                view under a long list, while the Add it answered stays pinned (review of 19 Nov). */}
            <FormNotice form={form} testId="sub-scan-notice" class={styles.footerNotice} />
            <div class={styles.footerRow}>
              <span class={styles.total}>
                <Show when={chosen().length > 0} fallback="Nothing selected">
                  {chosen().length} selected · <b>{money(monthlyTotal())}</b>/mo
                </Show>
              </span>
              <span class={styles.footerActions}>
                <Show when={!props.hideRescan}>
                  <button
                    class={styles.rescan}
                    type="button"
                    disabled={scanning()}
                    aria-disabled={form.submitting() ? 'true' : undefined}
                    onClick={() => {
                      // A rescan resets the rows under an add still on its way.
                      if (!form.submitting()) void scan()
                    }}
                  >
                    Rescan
                  </button>
                </Show>
                <Show when={!props.hideAddButton}>
                  <SubmitButton
                    class={styles.add}
                    data-test-id="sub-scan-add-btn"
                    busy={form.submitting()}
                    busyLabel="Adding…"
                    unchanged={chosen().length === 0}
                  >
                    {`Add ${chosen().length || ''}`.trim()}
                  </SubmitButton>
                </Show>
              </span>
            </div>
          </div>
        </Show>
      </Show>
    </form>
  )
}

export interface SubscriptionScanModalProps {
  isOpen: () => boolean
  onClose: () => void
  onAdded?: (count: number) => void
}

export function SubscriptionScanModal(props: SubscriptionScanModalProps) {
  // The line under the title asks to adjust a price or period, so it shows over rows that have
  // them: not over the empty state, the spinner or rows that are all tracked already.
  const [panel, setPanel] = createSignal<{ adjustable: () => number }>()

  // Stays on the page while shut, faded out: focus goes in each time it opens and back each time
  // it shuts.
  let modalRef: HTMLDivElement | undefined
  dialogFocusWhile(props.isOpen, () => modalRef, {
    onEscape: () => {
      props.onClose()
    },
  })
  return (
    <div
      class={styles.overlay}
      classList={{ [styles.open]: props.isOpen() }}
      // Faded out while shut but still on the page: inert then, out of the tab order and the
      // accessibility tree, as the Guided Orbit is.
      inert={!props.isOpen()}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        ref={modalRef}
        class={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Detected subscriptions"
        data-test-id="sub-scan-modal"
      >
        <div class={styles.head}>
          <div>
            <h2 class={styles.title}>Detected subscriptions</h2>
            <Show when={(panel()?.adjustable() ?? 0) > 0}>
              <p class={styles.sub}>Recurring charges we recognized · adjust price or period</p>
            </Show>
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
            expose={setPanel}
            onAdded={props.onAdded}
            emptyHint="Import transactions or add them manually, then rescan."
            onImport={props.onClose}
          />
        </div>
      </div>
    </div>
  )
}
