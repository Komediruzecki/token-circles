/**
 * The Portfolio page's "Add Holding" and "Edit Holding" form, written down once: its values, the
 * check it runs before sending, the calls, and the toast that says it worked.
 *
 * The check is the one both runtimes run (shared/holdingSchema.ts), so a blank ticker, shares of
 * zero or a price that is not a number is said under its field, in the same words, before anything
 * is sent. A refused save used to say "Please fill all required fields" or "Failed to save holding"
 * in a toast, with nothing in the dialog marked.
 *
 * A buy of a ticker already held can be merged into that holding at the average price. The merged
 * shares and price are worked out here, rounded (toHoldingPrecision), and the runtime checks them
 * as an edit of that holding: a refusal of the merge is marked at the field it names.
 *
 * Shares and the price are read with a comma or a dot for the decimals, as the Housing and Bills
 * dialogs read an amount. An edit opens with them to fifteen significant digits, written out: a
 * holding stored with a sum's float error (0.30000000000000004 shares) opens as 0.3, and one stored
 * with more decimals than a merge keeps (1.123456789123 shares) opens, and is sent back, as stored.
 */
import { createSignal } from 'solid-js'
import {
  checkHoldingCreate,
  checkHoldingEdit,
  toHoldingPrecision,
} from '../../../shared/holdingSchema'
import { fieldErrorsOf } from '../../../shared/refusal'
import { createForm } from '../components/form'
import { apiPost, apiPut, formatCurrency, showToast } from '../core/api'
import { showConfirm } from '../core/confirmStore'
import { parseDecimalInput } from '../core/decimalInput'
import type { HoldingInput } from '../../../shared/holdingSchema'
import type { Form } from '../components/form'
import type { PortfolioHolding } from '../types/models'

export interface HoldingFormValues {
  ticker: string
  shares: string
  purchase_price: string
  purchase_date: string
  notes: string
}

/** A holding as the page lists it, to open it for editing or merge a buy into it. */
export type HeldHolding = Pick<
  PortfolioHolding,
  'id' | 'ticker' | 'shares' | 'purchase_price' | 'purchase_date' | 'notes'
>

export type HoldingForm = Form<HoldingFormValues> & {
  /** The holding being edited, or null while the form is closed or adding one. */
  editing: () => HeldHolding | null
  /** Whether the dialog is open, for a new holding or an edit. */
  isOpen: () => boolean
  /** Open the dialog for a new holding. */
  openNew: () => void
  /** Open the dialog on `holding`, with its values. */
  openEdit: (holding: HeldHolding) => void
  /** Close it, sending nothing. */
  close: () => void
}

export interface HoldingFormOptions {
  /** The holdings on the page: a buy of a ticker among them is offered as a merge. */
  holdings: () => readonly HeldHolding[]
}

const BLANK: HoldingFormValues = {
  ticker: '',
  shares: '',
  purchase_price: '',
  purchase_date: '',
  notes: '',
}

/**
 * A number field as typed: a number when it reads as one, the text when it does not, so the rules
 * say what is wrong with it, and null when it is blank.
 */
function numberOf(text: string): number | string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseDecimalInput(trimmed) ?? trimmed
}

/** The body the dialog sends. */
export function holdingBody(values: HoldingFormValues): Record<string, unknown> {
  return {
    ticker: values.ticker.trim().toUpperCase(),
    shares: numberOf(values.shares),
    purchase_price: numberOf(values.purchase_price),
    purchase_date: values.purchase_date,
    notes: values.notes,
  }
}

/**
 * Shares or a price as a field shows it: to fifteen significant digits, which drops the error
 * floating point leaves on a sum and keeps every digit that was stored, so an edit that leaves the
 * field alone sends the stored value back. Written out, because the field cannot read "1e-7".
 */
const SHOWN = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
const shown = (value: number): string => SHOWN.format(value)

/** What merging `buy` into `held` makes of it: the shares added up, at the average price paid. */
export function mergedHolding(
  held: HeldHolding,
  buy: HoldingInput
): Pick<HoldingInput, 'shares' | 'purchase_price' | 'purchase_date'> {
  const shares = held.shares + buy.shares
  const cost = held.purchase_price * held.shares + buy.purchase_price * buy.shares
  return {
    shares: toHoldingPrecision(shares),
    purchase_price: toHoldingPrecision(cost / shares),
    // The earliest purchase date across the merged buys.
    purchase_date:
      held.purchase_date && held.purchase_date < buy.purchase_date
        ? held.purchase_date
        : buy.purchase_date,
  }
}

export function createHoldingForm(options: HoldingFormOptions): HoldingForm {
  const [editing, setEditing] = createSignal<HeldHolding | null>(null)
  const [isOpen, setOpen] = createSignal(false)

  /** Offer to merge `buy` into `held`; true when it was merged. */
  const merge = async (held: HeldHolding, buy: HoldingInput): Promise<boolean> => {
    const merged = mergedHolding(held, buy)
    const was = toHoldingPrecision(held.shares)
    const accepted = await showConfirm(
      `You already hold ${was} share${was === 1 ? '' : 's'} of ${buy.ticker} at an average of ${formatCurrency(held.purchase_price)}. Merge this buy in? New position: ${merged.shares} shares at an average of ${formatCurrency(merged.purchase_price)}. Choose Cancel to add it as a separate holding.`
    )
    if (!accepted) return false
    await apiPut(`/api/portfolio/holdings/${held.id}`, merged)
    showToast(
      `Merged the buy into "${buy.ticker}": ${merged.shares} shares at an average of ${formatCurrency(merged.purchase_price)}.`,
      'success'
    )
    return true
  }

  const form = createForm<HoldingFormValues>({
    initial: BLANK,
    check: (values) => {
      const stored = editing()
      const body = holdingBody(values)
      return fieldErrorsOf(stored ? checkHoldingEdit(body, stored) : checkHoldingCreate(body))
    },
    send: async (values) => {
      const body = holdingBody(values)
      const stored = editing()
      if (stored) {
        await apiPut(`/api/portfolio/holdings/${stored.id}`, body)
        showToast(`Saved your changes to "${String(body.ticker)}".`, 'success')
        return
      }
      const buy = checkHoldingCreate(body)
      const held = buy.ok
        ? options.holdings().find((h) => h.ticker.toUpperCase() === buy.value.ticker)
        : undefined
      if (buy.ok && held && (await merge(held, buy.value))) return
      await apiPost('/api/portfolio/holdings', body)
      showToast(`Added "${String(body.ticker)}" to your portfolio.`, 'success')
    },
    saved: () => {
      close()
    },
    failure: "Couldn't save the holding. Try again.",
  })

  const openNew = () => {
    setEditing(null)
    form.reset(BLANK)
    setOpen(true)
  }
  const openEdit = (holding: HeldHolding) => {
    setEditing({ ...holding })
    form.reset({
      ticker: holding.ticker,
      shares: shown(holding.shares),
      purchase_price: shown(holding.purchase_price),
      purchase_date: holding.purchase_date,
      notes: holding.notes || '',
    })
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setEditing(null)
    form.reset(BLANK)
  }

  return Object.assign(form, { editing, isOpen, openNew, openEdit, close })
}
