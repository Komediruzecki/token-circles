/**
 * Getting started's place on Dashboard (design.md 2.1): Getting started while its record is shown
 * and less than a year is on file, Your next step otherwise, and nothing until both are known.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeCircle } from '../../../../../shared/guidance/circles'
import { ledgerRows, ledgerStatus } from '../../../../../shared/guidance/ledger'
import { nextStepOf } from '../../../../../shared/guidance/nextStep'
import { facts, words } from '../../../core/__tests__/guidanceFixtures'
import DashboardNextStep from '../DashboardNextStep'
import type { GuidanceFacts } from '../../../../../shared/guidance/facts'
import type { GuidanceView } from '../../../core/guidance'

const record = vi.hoisted(() => ({
  set: null as null | ((r: { hidden: boolean } | null) => void),
  setKnown: null as null | ((known: boolean) => void),
}))

vi.mock('../../../core/gettingStarted', async () => {
  const { createRoot, createSignal } = await import('solid-js')
  return createRoot(() => {
    const [value, setValue] = createSignal<{ hidden: boolean } | null>(null)
    const [known, setKnown] = createSignal(true)
    record.set = (r) => setValue(() => r)
    record.setKnown = setKnown
    return {
      gettingStartedRecord: value,
      gettingStartedKnown: known,
      loadGettingStarted: vi.fn(async () => null),
    }
  })
})
// The card itself has its own tests (GettingStarted.test.tsx); here only where it goes counts.
vi.mock('../../GettingStarted', () => ({
  GettingStartedCard: () => {
    const card = document.createElement('section')
    card.setAttribute('data-test-id', 'getting-started')
    return card
  },
}))
vi.mock('../../../core/achievementsStore', () => ({ refreshAchievements: vi.fn() }))
vi.mock('../../../core/guidance', () => ({ takeAnswers: vi.fn() }))
vi.mock('../../../core/guidanceAnswers', () => ({ saveAnswers: vi.fn() }))

/** The view the store would answer for `f`. */
function viewOf(f: GuidanceFacts): GuidanceView {
  const placement = placeCircle(f, { freeMoney: false })
  return {
    profileId: 1,
    snapshot: {} as never,
    inputs: { profileId: 1, answers: {}, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 },
    gate: false,
    region: { region: 'EU27', reason: 'fallback', via: null },
    facts: f,
    placement,
    rows: ledgerRows(placement, f, words),
    status: ledgerStatus(placement, f, words),
    next: nextStepOf({
      placement,
      facts: f,
      orientation: [
        {
          id: 'import-year',
          title: 'Import the rest of your year',
          reason: '7 of the last 13 months are tracked.',
          link: { hash: '#import', label: 'Import' },
        },
      ],
      words,
    }),
    words,
  }
}

const YEAR = facts()
const SEVEN_MONTHS = facts({ firm: false, monthsInYear: 7 })

let host: HTMLDivElement
let dispose: (() => void) | undefined
let setView: (view: GuidanceView | null) => void
beforeEach(() => {
  record.set!(null)
  record.setKnown!(true)
})
afterEach(() => {
  dispose?.()
  host?.remove()
})

async function mount(view: GuidanceView | null): Promise<HTMLDivElement> {
  const { createRoot, createSignal } = await import('solid-js')
  const [current, set] = createRoot(() => createSignal<GuidanceView | null>(view))
  setView = (next) => set(() => next)
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <DashboardNextStep view={current} />, host)
  return host
}

const shows = (c: HTMLElement) => ({
  gettingStarted: c.querySelector('[data-test-id="getting-started"]') !== null,
  nextStep: c.querySelector('[data-test-id="next-step-card"]') !== null,
})

describe("Getting started's place on Dashboard", () => {
  it('holds Getting started while it is shown and less than a year is on file', async () => {
    record.set!({ hidden: false })
    const c = await mount(viewOf(SEVEN_MONTHS))
    expect(shows(c)).toEqual({ gettingStarted: true, nextStep: false })
  })

  it('holds Your next step once a year is on file, with a way to all seven circles', async () => {
    record.set!({ hidden: false })
    const c = await mount(viewOf(YEAR))
    expect(shows(c)).toEqual({ gettingStarted: false, nextStep: true })
    const card = c.querySelector('[data-test-id="next-step-card"]')!
    expect(card.querySelector('h3')!.textContent).toBe('Your next step')
    const link = card.querySelector<HTMLAnchorElement>('[data-test-id="next-step-circles"]')!
    expect(link.textContent).toBe('See all seven circles')
    expect(link.getAttribute('href')).toBe('#progress')
  })

  it('holds Your next step once Getting started is hidden, or for an account without one', async () => {
    record.set!({ hidden: true })
    const hidden = await mount(viewOf(SEVEN_MONTHS))
    expect(shows(hidden)).toEqual({ gettingStarted: false, nextStep: true })
    expect(hidden.querySelector('[data-test-id="next-step-title"]')!.textContent).toBe(
      'Import the rest of your year'
    )
    dispose?.()
    host.remove()

    record.set!(null)
    const none = await mount(viewOf(SEVEN_MONTHS))
    expect(shows(none)).toEqual({ gettingStarted: false, nextStep: true })
  })

  it('brings Getting started back when the year lapses: nothing was written', async () => {
    record.set!({ hidden: false })
    const c = await mount(viewOf(YEAR))
    expect(shows(c).nextStep).toBe(true)
    setView(viewOf(SEVEN_MONTHS))
    expect(shows(c)).toEqual({ gettingStarted: true, nextStep: false })
  })

  it('shows nothing until the circles and the record are known', async () => {
    record.set!({ hidden: false })
    const c = await mount(null)
    expect(shows(c)).toEqual({ gettingStarted: false, nextStep: false })
    record.setKnown!(false)
    setView(viewOf(YEAR))
    expect(shows(c)).toEqual({ gettingStarted: false, nextStep: false })
    record.setKnown!(true)
    expect(shows(c)).toEqual({ gettingStarted: false, nextStep: true })
  })
})
