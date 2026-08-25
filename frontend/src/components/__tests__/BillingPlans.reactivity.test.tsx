/**
 * The grid has to follow the plan, not the plan at first paint.
 *
 * THE BUG. Inside `<For>` the tier card read `const mine = isCurrent(p.id)`. A `<For>` callback
 * runs ONCE per item, so that const froze at whatever the plan was on first render — and on
 * first render `/api/billing/status` has not answered, so it is 'free'. A real subscriber got
 * the green "Your plan" border on the Free card, an "Upgrade" button on the tier they were
 * already paying for, and a status line one paragraph above correctly saying they were on Basic.
 * Switching tabs "fixed" it, because that remounts the component and re-runs the callback.
 *
 * These tests mount with a SIGNAL and change it afterwards, which is the only way to catch it —
 * a static accessor renders correctly either way. Everything here fails against a plain const.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BillingPlans from '../BillingPlans'

const PLANS = {
  plans: [
    {
      id: 'free',
      name: 'Free',
      monthlyPriceUsd: 0,
      annualPriceUsd: 0,
      limits: { receiptsPerProfile: 0, remindersPerMonth: 0, profiles: 1 },
      features: {
        cloudSync: false,
        emailReminders: false,
        receipts: false,
        advancedReports: false,
      },
    },
    {
      id: 'basic',
      name: 'Basic',
      monthlyPriceUsd: 3,
      annualPriceUsd: 30,
      limits: { receiptsPerProfile: 50, remindersPerMonth: 20, profiles: 2 },
      features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: false },
    },
    {
      id: 'advanced',
      name: 'Advanced',
      monthlyPriceUsd: 6,
      annualPriceUsd: 60,
      limits: { receiptsPerProfile: null, remindersPerMonth: null, profiles: null },
      features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
    },
  ],
  notices: {},
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let setPlan: (p: string) => void
let setBusy: (k: string | null) => void

/** Mounts the grid the way Settings does: knowing nothing yet, and told the plan later. */
async function mount(opts: { comped?: boolean } = {}) {
  const [plan, setPlanSignal] = createSignal('free')
  const [busy, setBusySignal] = createSignal<string | null>(null)
  setPlan = setPlanSignal
  setBusy = setBusySignal
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <BillingPlans
        currentPlan={plan}
        configured={() => true}
        availablePlans={() => ['basic', 'advanced']}
        busyKey={busy}
        comped={() => opts.comped ?? false}
        onUpgrade={() => {}}
        onManage={() => {}}
      />
    ),
    host
  )
  await vi.waitFor(() => {
    expect(host.textContent).toContain('Advanced')
  })
}

/** The card wearing the green border and the "Your plan" badge. */
const currentCard = () => host.querySelector('[data-testid="plan-card-current"]')
/** Its tier name. Not the whole card: Basic's feature list mentions "Advanced reports". */
const currentCardName = () => currentCard()?.querySelector('div')?.textContent?.trim()
const cardFor = (name: string) =>
  [...host.querySelectorAll('div')].find(
    (d) => d.querySelector('div')?.textContent?.trim() === name
  )
const manageButton = () =>
  host.querySelector<HTMLButtonElement>('[data-testid="manage-subscription"]')
const buttonSaying = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

beforeEach(() => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(JSON.stringify(PLANS), { status: 200 }))
  )
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
})

describe('when the billing status lands after the grid has rendered', () => {
  it('moves the marker off Free and onto the plan they are on', async () => {
    await mount()
    // What the page looks like for the ~200ms before /api/billing/status answers.
    expect(currentCardName()).toBe('Free')

    setPlan('basic')

    expect(currentCardName()).toBe('Basic')
  })

  it('leaves exactly one card marked', async () => {
    await mount()

    setPlan('basic')

    // The screenshot that started this had two: Free's badge never left.
    expect(host.querySelectorAll('[data-testid="plan-card-current"]')).toHaveLength(1)
  })

  it('stops offering to sell them the plan they are already paying for', async () => {
    await mount()
    expect(buttonSaying('Upgrade')).toBeDefined()

    setPlan('basic')

    // Basic now offers Manage; only Advanced is still for sale.
    expect(manageButton()).not.toBeNull()
    expect(cardFor('Basic')?.textContent).toContain('Manage subscription')
    expect(cardFor('Basic')?.textContent).not.toContain('Upgrade')
  })

  it('gives the Free card its "Free forever" line back', async () => {
    await mount()
    expect(host.textContent).toContain('Free forever')

    setPlan('advanced')

    // Free is nobody's current plan any more, so it has no CTA at all.
    expect(cardFor('Free')?.textContent).not.toContain('Free forever')
  })

  it('repoints the border, not only the badge', async () => {
    await mount()

    setPlan('advanced')

    expect(cardFor('Advanced')?.getAttribute('style')).toContain('2px')
    expect(cardFor('Free')?.getAttribute('style')).toContain('1px')
  })

  it('keeps up across a second change, not just the first', async () => {
    await mount()

    setPlan('advanced')
    setPlan('basic')

    expect(currentCardName()).toBe('Basic')
  })

  it('follows a drop back to Free when a subscription ends', async () => {
    await mount()
    setPlan('advanced')

    setPlan('free')

    expect(currentCardName()).toBe('Free')
    expect(manageButton()).toBeNull()
  })

  it('maps the legacy premium value onto Advanced reactively too', async () => {
    await mount()

    setPlan('premium')

    expect(currentCardName()).toBe('Advanced')
  })

  it('relabels the other cards for the direction they are now in', async () => {
    await mount()
    setPlan('advanced')

    // From Advanced, Basic is a step DOWN — and said "Upgrade" for as long as `mine` was frozen.
    expect(cardFor('Basic')?.textContent).toContain('Downgrade')

    setPlan('basic')

    expect(cardFor('Advanced')?.textContent).toContain('Upgrade')
  })
})

describe('what the button says while it works', () => {
  it('says Redirecting for a first purchase, which really does leave the page', async () => {
    await mount()

    setBusy('basic')

    expect(buttonSaying('Redirecting…')).toBeDefined()
  })

  it('says Switching for a subscriber, who is not going anywhere', async () => {
    // A tier change is an update to the subscription that already exists — the fix that stops a
    // second one being created. Nothing redirects, so "Redirecting…" would be a plain lie.
    await mount()
    setPlan('basic')

    setBusy('advanced')

    expect(buttonSaying('Switching…')).toBeDefined()
    expect(buttonSaying('Redirecting…')).toBeUndefined()
  })

  it('goes inert for a busy key no card owns, without labelling anything', async () => {
    // Settings holds the grid like this while it waits for the webhook after a checkout return.
    // Until that lands the account still looks unsubscribed to /api/billing/checkout, so a click
    // in this window would open a SECOND Checkout Session — the duplicate bug through the front
    // door. Nothing should be clickable, and nothing should claim to be mid-anything.
    await mount()

    setBusy('confirming')

    const ctas = [...host.querySelectorAll('button')].filter((b) =>
      ['Upgrade', 'Downgrade', 'Manage subscription'].includes(b.textContent?.trim() ?? '')
    )
    expect(ctas.length).toBeGreaterThan(0)
    expect(ctas.every((b) => b.disabled)).toBe(true)
    expect(buttonSaying('Redirecting…')).toBeUndefined()
    expect(buttonSaying('Switching…')).toBeUndefined()
  })

  it('freezes Manage too, so a subscriber cannot start a second thing mid-wait', async () => {
    await mount()
    setPlan('basic')

    setBusy('confirming')

    expect(manageButton()!.disabled).toBe(true)
  })

  it('says Redirecting for a comped account, which has no subscription to move', async () => {
    await mount({ comped: true })
    setPlan('advanced')

    setBusy('basic')

    expect(buttonSaying('Redirecting…')).toBeDefined()
  })
})
