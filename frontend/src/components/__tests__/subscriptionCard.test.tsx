/**
 * SubscriptionCard behavior that the redesign must hold:
 *
 * - A subscription already paid this period offers NO "mark paid" action — the old card kept the
 *   button clickable after paying, and the second click could only ever 409 into an error toast.
 * - Secondary actions (Pause/Resume, Edit, Delete) live under one overflow menu, and Delete asks
 *   for a danger-styled confirmation before calling back.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { showConfirm as ShowConfirm } from '../../core/confirmStore'
import type { SubscriptionCardBill } from '../SubscriptionCard'

const sub = (over: Partial<SubscriptionCardBill> = {}): SubscriptionCardBill => ({
  id: 11,
  name: 'Netflix',
  amount: 13.8,
  due_date: '2026-09-10',
  frequency: 'monthly',
  is_active: 1,
  paid: false,
  category_name: 'Streaming',
  ...over,
})

vi.mock('../../core/api', () => ({
  formatCurrency: (n: number) => `€${n}`,
}))
const showConfirmSpy = vi.fn<typeof ShowConfirm>(() => Promise.resolve(true))
vi.mock('../../core/confirmStore', async (importOriginal) => ({
  ...(await importOriginal<{ showConfirm: typeof ShowConfirm }>()),
  showConfirm: (...args: Parameters<typeof ShowConfirm>) => showConfirmSpy(...args),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined
const onMarkPaid = vi.fn()
const onPause = vi.fn()
const onDelete = vi.fn()
const onEdit = vi.fn()

beforeEach(() => {
  onMarkPaid.mockClear()
  onPause.mockClear()
  onDelete.mockClear()
  onEdit.mockClear()
  showConfirmSpy.mockClear()
  showConfirmSpy.mockResolvedValue(true)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
})

async function mount(bill: SubscriptionCardBill, markingPaid: Set<number> = new Set()) {
  const { default: SubscriptionCard } = await import('../SubscriptionCard')
  dispose = render(
    () => (
      <SubscriptionCard
        subscription={bill}
        onMarkPaid={onMarkPaid}
        onPause={onPause}
        onDelete={onDelete}
        onEdit={onEdit}
        markingPaid={() => markingPaid}
      />
    ),
    host
  )
  await flush()
}

const markPaidBtn = () => host.querySelector<HTMLButtonElement>('[data-test-id="sub-mark-paid"]')
const menuBtn = () => host.querySelector<HTMLButtonElement>('[data-test-id="sub-menu-btn"]')
// The menu is portalled to <body> so card overflow/backdrop-filter cannot clip it.
const menu = () => document.querySelector('[data-test-id="overflow-menu"]')
const menuItem = (label: string) =>
  [...(menu()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label)

describe('mark paid', () => {
  it('offers the action for an unpaid subscription and forwards the id', async () => {
    await mount(sub())
    expect(markPaidBtn()).not.toBeNull()
    markPaidBtn()!.click()
    expect(onMarkPaid).toHaveBeenCalledWith(11)
  })

  it('offers NO mark-paid action once paid this period, and badges it instead', async () => {
    await mount(sub({ paid: true }))
    expect(markPaidBtn(), 'a paid sub must not offer the action that can only 409').toBeNull()
    expect(host.textContent).toContain('Paid')
  })

  it('disables the action while the request is in flight', async () => {
    await mount(sub(), new Set([11]))
    expect(markPaidBtn()!.disabled).toBe(true)
  })
})

describe('the overflow menu', () => {
  it('holds Pause, Edit and Delete for an active subscription', async () => {
    await mount(sub())
    expect(menu(), 'closed until opened').toBeNull()
    menuBtn()!.click()
    await flush()
    expect(menuItem('Pause')).toBeDefined()
    expect(menuItem('Edit')).toBeDefined()
    expect(menuItem('Delete')).toBeDefined()

    menuItem('Edit')!.click()
    await flush()
    expect(onEdit).toHaveBeenCalledWith(11)
    expect(menu(), 'selecting closes the menu').toBeNull()
  })

  it('offers Resume instead of Pause when paused', async () => {
    await mount(sub({ is_active: 0 }))
    menuBtn()!.click()
    await flush()
    expect(menuItem('Resume')).toBeDefined()
    expect(menuItem('Pause')).toBeUndefined()
    menuItem('Resume')!.click()
    expect(onPause).toHaveBeenCalledWith(11)
  })

  it('confirms with danger styling before deleting, and does nothing when refused', async () => {
    await mount(sub())
    menuBtn()!.click()
    await flush()
    menuItem('Delete')!.click()
    await flush()
    expect(showConfirmSpy).toHaveBeenCalledTimes(1)
    expect(showConfirmSpy.mock.calls[0]![1]).toMatchObject({ danger: true })
    expect(onDelete).toHaveBeenCalledWith(11)

    showConfirmSpy.mockResolvedValue(false)
    menuBtn()!.click()
    await flush()
    menuItem('Delete')!.click()
    await flush()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and on a click outside', async () => {
    await mount(sub())
    menuBtn()!.click()
    await flush()
    expect(menu()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(menu()).toBeNull()

    menuBtn()!.click()
    await flush()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(menu()).toBeNull()
  })
})
