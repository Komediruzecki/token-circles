/**
 * The circles on Progress: Your next step over the ledger, each row a link to its circle, the
 * circle's own view at `#progress/<n>` with focus moved in and back out, and the questions a step
 * asks, saved through `saveAnswers` and handed to the store at once.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeAnswers, readAnswers } from '../../../../shared/guidance/answers'
import { placeCircle } from '../../../../shared/guidance/circles'
import { ledgerRows, ledgerStatus } from '../../../../shared/guidance/ledger'
import { nextStepOf } from '../../../../shared/guidance/nextStep'
import { facts, words } from '../../core/__tests__/guidanceFixtures'
import type { JSX } from 'solid-js'
import type { AnswerChanges, Answers } from '../../../../shared/guidance/answers'
import type { GuidanceFacts, WindowCategory } from '../../../../shared/guidance/facts'
import type * as ApiModule from '../../core/api'
import type { GuidanceView } from '../../core/guidance'

const guidance = vi.hoisted(() => ({
  view: null as null | (() => unknown),
  set: null as null | ((v: unknown) => void),
}))
const saves = vi.hoisted(() => ({ fail: false, calls: [] as unknown[] }))

vi.mock('../../core/appStore', () => ({ setPage: vi.fn() }))
vi.mock('../../core/guidance', async () => {
  const { createRoot, createSignal } = await import('solid-js')
  return createRoot(() => {
    const [view, setView] = createSignal<unknown>(null)
    guidance.view = view
    guidance.set = (v) => setView(() => v)
    return { useGuidance: () => view, takeAnswers: vi.fn() }
  })
})
vi.mock('../../core/guidanceAnswers', () => ({
  saveAnswers: vi.fn(async (changes: unknown) => {
    saves.calls.push(changes)
    if (saves.fail) throw new Error('offline')
    return changes
  }),
}))
vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiPut: vi.fn(async () => ({})),
}))
vi.mock('../../core/achievementsStore', () => ({
  snapshot: () => null,
  unlocks: () => [],
  streak: () => 0,
  dismissedAdvice: () => [],
  dismissAdvice: vi.fn(),
  restoreAdvice: vi.fn(),
  refreshAchievements: vi.fn(async () => []),
}))

import { CircleAnswers } from '../../components/guidance/CircleAnswers'
import { refreshAchievements } from '../../core/achievementsStore'
import { apiPut } from '../../core/api'
import { takeAnswers } from '../../core/guidance'
import { openPrints } from '../../core/progressRoute'
import { settingsTab } from '../../core/settingsStore'
import { endSpotlight, startTour } from '../../core/spotlightStore'
import Progress from '../Progress'

/** The view the store would answer for `f`. */
function viewOf(f: GuidanceFacts, gate = false, answers: Answers = {}): GuidanceView {
  const placement = placeCircle(f, { freeMoney: gate })
  // The stored categories behind the window's, as the snapshot holds them.
  const categories = (f.windowCategories ?? []).map(({ id, name, type }) => ({ id, name, type }))
  return {
    profileId: 1,
    snapshot: { categories } as never,
    inputs: { profileId: 1, answers, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 },
    gate,
    region: { region: f.region as 'EU27', reason: 'fallback', via: null },
    facts: f,
    placement,
    rows: ledgerRows(placement, f, words),
    status: ledgerStatus(placement, f, words),
    next: nextStepOf({ placement, facts: f, orientation: null, words }),
    words,
  }
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  history.replaceState(null, '', '#progress')
  saves.fail = false
  saves.calls = []
  vi.mocked(takeAnswers).mockClear()
  vi.mocked(refreshAchievements).mockClear()
  vi.mocked(apiPut).mockClear()
  guidance.set!(null)
})
afterEach(() => {
  dispose?.()
  host?.remove()
})
const mount = (el: () => JSX.Element): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(el, host)
  return host
}
const q = (c: ParentNode, sel: string): HTMLElement => c.querySelector<HTMLElement>(sel)!

/** Go to `hash` as a link would, firing the hashchange the app listens for, with both addresses. */
function go(hash: string) {
  const oldURL = window.location.href
  history.pushState(null, '', hash)
  changed(oldURL)
}

/** The hashchange a browser fires once the address has moved on from `oldURL`. */
function changed(oldURL: string) {
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }))
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('before the circles are worked out', () => {
  it('keeps the next step and the seven rows in their places', () => {
    const c = mount(() => <Progress />)
    expect(q(c, '[data-tour="progress-next-step"]').textContent).toContain(
      'Working it out from your numbers.'
    )
    const rows = c.querySelectorAll('[data-tour="progress-circles"] [data-test-id="circle-row"]')
    expect([...rows].map((row) => row.getAttribute('href'))).toEqual([
      '#progress/1',
      '#progress/2',
      '#progress/3',
      '#progress/4',
      '#progress/5',
      '#progress/6',
      '#progress/7',
    ])
    expect(rows[0].textContent).toContain('Clear picture')
    expect(c.querySelector('[data-test-id="circles-status"]')).toBeNull()
  })
})

describe('the ledger', () => {
  it('lists every circle with its own figure, the current one lit', () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    expect(q(c, '[data-test-id="circles-status"]').textContent).toBe(
      "You're in the fourth circle: Solid ground.€2,000 to three months of essentials."
    )
    expect(q(c, '[data-test-id="progress-divider-circles"]').textContent).toContain('Circle 4 of 7')
    const rows = [...c.querySelectorAll('[data-circle-row]')]
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual([
      'reached',
      'reached',
      'reached',
      'current',
      'later',
      'later',
      'later',
    ])
    const fourth = q(rows[3], 'a') as HTMLAnchorElement
    expect(fourth.getAttribute('href')).toBe('#progress/4')
    expect(fourth.getAttribute('aria-label')).toBe(
      "Solid ground. You're here. 2 of 3 months put by."
    )
    // Said once: the circle's line says it, and the row's figure leaves it out while it is met.
    expect(fourth.textContent!.match(/no debt at 10% or more/gi)).toHaveLength(1)
    // The glyph is decoration: the link's name carries what it shows.
    expect(q(rows[3], 'svg').getAttribute('aria-hidden')).toBe('true')
    // The table's header is for the eye; a screen reader has each link's name.
    expect(q(c, '[data-test-id="circles-ledger"] li[aria-hidden="true"]').textContent).toBe(
      'CircleYour numbersWhere you are'
    )
    expect(c.textContent).toContain('It does not give financial advice.')
  })

  it('says when the figures appear, before three months are tracked', () => {
    guidance.set!(
      viewOf(
        facts({
          months: ['2026-09'],
          monthsInYear: 1,
          firm: false,
          averaged: false,
          sortedShare: null,
        })
      )
    )
    const c = mount(() => <Progress />)
    expect(q(c, '[data-test-id="circles-waiting"]').textContent).toBe(
      'Your figures appear once 3 months are tracked. One is so far.'
    )
  })

  it('never shows Infinity, a dash for a gap, or an em dash', () => {
    guidance.set!(viewOf(facts({ essentials: 0, cushionMonths: Infinity })))
    const c = mount(() => <Progress />)
    const text = c.textContent ?? ''
    expect(text).toContain('Nothing is marked as needed every month')
    expect(text).not.toContain('Infinity')
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('—')
  })
})

describe('Your next step', () => {
  it('names the step, why, how far along, and the page where it is done', () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    const card = q(c, '[data-tour="progress-next-step"] [data-test-id="next-step-card"]')
    expect(q(card, '[data-test-id="next-step-title"]').textContent).toBe(
      'Grow your cushion to three months'
    )
    expect(q(card, '[data-test-id="next-step-why"]').textContent).toBe(
      '€2,000 to go: €4,000 you can reach, against €2,000 needed a month.'
    )
    expect(q(card, '[data-test-id="next-step-circle"]').textContent).toBe('Solid ground')
    expect(q(card, '[data-test-id="next-step-meter"]').textContent).toContain('2 months3 months')
    const action = q(card, '[data-test-id="next-step-action"]') as HTMLAnchorElement
    expect(action.getAttribute('href')).toBe('#goals')
    expect(action.textContent).toBe('Open Goals')
    expect(q(card, '[data-test-id="next-step-then"]').textContent).toBe(
      'Then: grow your cushion to six months, and raise your savings rate by one point.'
    )
  })

  it('asks the card question, shows the choice at once, and hands the answer to the circles', async () => {
    const card = {
      kind: 'card' as const,
      id: 3,
      name: 'Visa',
      owed: 400,
      rate: null,
      payment: null,
      carried: null,
      expensive: null,
    }
    guidance.set!(viewOf(facts({ debts: [card] })))
    const c = mount(() => <Progress />)
    const step = q(c, '[data-test-id="next-step-card"]')
    expect(step.getAttribute('data-step')).toBe('no-expensive-debt')
    const choices = [
      ...step.querySelectorAll<HTMLLabelElement>('[data-test-id="next-step-choice"]'),
    ]
    expect(choices.map((choice) => choice.textContent)).toEqual(['No', 'Yes'])
    expect(step.textContent).toContain(
      'Asked once. You can change it in Settings, About this space.'
    )
    const no = q(choices[0], 'input') as HTMLInputElement
    no.click()
    expect(no.checked).toBe(true)
    await tick()
    expect(saves.calls).toEqual([{ carriesCardBalance: false }])
    expect(takeAnswers).toHaveBeenCalledWith(1, { carriesCardBalance: false })
  })

  it('says when an answer did not save, and lets it be given again', async () => {
    saves.fail = true
    guidance.set!(viewOf(facts({ yearlyBills: { count: 1, perYear: 600, perMonth: 50 } })))
    const c = mount(() => <Progress />)
    const choice = q(c, '[data-test-id="next-step-choice"] input') as HTMLInputElement
    choice.click()
    await tick()
    expect(q(c, '[data-test-id="next-step-problem"]').textContent).toBe(
      "Couldn't save your answer. Try again."
    )
    expect(choice.checked).toBe(false)
    expect(choice.disabled).toBe(false)
    expect(takeAnswers).not.toHaveBeenCalled()
  })

  it('asks for the own number as an amount, and refuses one that is not above 0', async () => {
    guidance.set!(viewOf(facts({ cushionMonths: 7, liquid: 14000, invested: 800000 })))
    const c = mount(() => <Progress />)
    const field = q(c, '[data-test-id="next-step-amount"]') as HTMLInputElement
    const form = field.closest('form')!
    form.requestSubmit()
    expect(c.textContent).toContain('Enter what a year would cost, above 0.')
    field.focus()
    field.value = '0'
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
    form.requestSubmit()
    await tick()
    expect(saves.calls).toEqual([])
    field.value = '40000'
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
    form.requestSubmit()
    await tick()
    expect(saves.calls).toEqual([{ enoughPerYear: { amount: 40000, currency: 'EUR' } }])
  })

  it('reads the accounts again when they did not load', () => {
    guidance.set!(viewOf(facts({ accountsKnown: false, liquid: null, cushionMonths: null })))
    const c = mount(() => <Progress />)
    const button = q(c, 'button[data-test-id="next-step-action"]') as HTMLButtonElement
    expect(button.textContent).toBe('Reload')
    button.click()
    expect(refreshAchievements).toHaveBeenCalledTimes(1)
  })
})

describe("a circle's own view", () => {
  it('opens in place of the list, moves focus to its heading, and goes back with Escape', async () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    go('#progress/4')
    const view = q(c, '[data-test-id="circle-view"]')
    expect(view.getAttribute('data-circle')).toBe('4')
    expect(q(view, 'h2').textContent).toBe('Solid ground')
    expect(document.activeElement).toBe(q(view, 'h2'))
    expect(view.textContent).toContain('Circle 4 of 7')
    expect(view.textContent).toContain("You're here")
    // The circle being worked on carries Your next step.
    expect(view.querySelector('[data-test-id="next-step-card"]')).not.toBeNull()
    expect(q(c, '[data-test-id="progress-list"]').hidden).toBe(true)

    const inView = window.location.href
    view.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(window.location.hash).toBe('#progress')
    changed(inView)
    await tick()
    expect(c.querySelector('[data-test-id="circle-view"]')).toBeNull()
    expect(q(c, '[data-test-id="progress-list"]').hidden).toBe(false)
    expect(document.activeElement).toBe(q(c, '[data-circle-row="4"] a'))
  })

  it('shows no next step in a circle that is not the current one', () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    go('#progress/6')
    const view = q(c, '[data-test-id="circle-view"]')
    expect(view.textContent).toContain('Later')
    expect(view.querySelector('[data-test-id="next-step-card"]')).toBeNull()
    q(view, '[data-test-id="circle-back"]').click()
    expect(window.location.hash).toBe('#progress')
  })

  it("takes the Progress tour back to the list from a circle's view, leaving focus alone", async () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    go('#progress/4')
    const heading = q(c, '[data-test-id="circle-view"] h2')
    expect(document.activeElement).toBe(heading)
    try {
      const inView = window.location.href
      startTour('progress')
      expect(window.location.hash).toBe('#progress')
      changed(inView)
      await tick()
      expect(c.querySelector('[data-test-id="circle-view"]')).toBeNull()
      expect(q(c, '[data-tour="progress-circles"]').closest('[hidden]')).toBeNull()
      // The row's link would take Enter from the tour, and open the circle again.
      expect(document.activeElement).not.toBe(q(c, '[data-circle-row="4"] a'))

      // While the tour points at the list, a circle opened under it closes again.
      go('#progress/2')
      expect(window.location.hash).toBe('#progress')
    } finally {
      endSpotlight()
    }
    go('#progress/2')
    expect(q(c, '[data-test-id="circle-view"]').getAttribute('data-circle')).toBe('2')
  })

  it('closes while another page is on screen, and the address says what opens on the way back', () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    go('#progress/2')
    go('#budgets')
    expect(c.querySelector('[data-test-id="circle-view"]')).toBeNull()
    // Back, as the browser's Back button goes: the circle's own address opens it again.
    go('#progress/2')
    expect(q(c, '[data-test-id="circle-view"]').getAttribute('data-circle')).toBe('2')
  })

  // Open circle 4, go to Dashboard, come back to Progress: the list, as it was, with focus and the
  // scroll left alone. Focus goes to a row only on the way back from that circle's own view.
  it('moves no focus coming back to the list from another page', async () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    go('#progress/4')
    go('#dashboard')
    const row = q(c, '[data-circle-row="4"] a')
    const focus = vi.spyOn(row, 'focus')
    go('#progress')
    await tick()
    expect(c.querySelector('[data-test-id="circle-view"]')).toBeNull()
    expect(q(c, '[data-test-id="progress-list"]').hidden).toBe(false)
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(row)
  })

  describe('opened from the prints', () => {
    /** jsdom has no scrollIntoView: each call is recorded by the id of what it scrolled to. */
    let scrolled: string[] = []
    beforeEach(() => {
      scrolled = []
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this.id)
      }
    })
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    })

    // At #progress/prints, open circle 3, then Back: the address names the prints again, but the
    // person is coming back to the list they left, as from #progress.
    it("comes back to that circle's row, not to the prints", async () => {
      history.replaceState(null, '', '#progress/prints')
      guidance.set!(viewOf(facts()))
      const c = mount(() => <Progress />)
      expect(scrolled).toEqual(['progress-sec-prints'])
      go('#progress/3')
      expect(q(c, '[data-test-id="circle-view"]').getAttribute('data-circle')).toBe('3')
      go('#progress/prints')
      await tick()
      expect(c.querySelector('[data-test-id="circle-view"]')).toBeNull()
      expect(document.activeElement).toBe(q(c, '[data-circle-row="3"] a'))
      expect(scrolled).toEqual(['progress-sec-prints'])
    })

    it("still goes to the prints when See my print asks for them from a circle's view", async () => {
      guidance.set!(viewOf(facts()))
      const c = mount(() => <Progress />)
      go('#progress/3')
      openPrints()
      // The address's own hashchange fires a task later.
      await tick()
      expect(window.location.hash).toBe('#progress/prints')
      expect(c.querySelector('[data-test-id="circle-view"]')).toBeNull()
      expect(scrolled).toEqual(['progress-sec-prints'])
      expect(document.activeElement).not.toBe(q(c, '[data-circle-row="3"] a'))
    })

    // See my print on another page: the app puts Progress up inside the hashchange it causes, too
    // late for the page to hear it. That ask is forgotten when the page mounts, so it cannot turn a
    // later Back from a circle into a scroll to the prints.
    it('forgets a See my print it was not there to hear', async () => {
      history.replaceState(null, '', '#dashboard')
      const heard = new Promise((resolve) => {
        window.addEventListener('hashchange', resolve, { once: true })
      })
      openPrints()
      await heard
      history.replaceState(null, '', '#progress/3')
      guidance.set!(viewOf(facts()))
      const c = mount(() => <Progress />)
      expect(q(c, '[data-test-id="circle-view"]').getAttribute('data-circle')).toBe('3')
      go('#progress/prints')
      await tick()
      expect(document.activeElement).toBe(q(c, '[data-circle-row="3"] a'))
      expect(scrolled).not.toContain('progress-sec-prints')
    })
  })
})

describe('what a circle checks, and the questions it asks', () => {
  /** A card whose entries cannot show whether its balance is carried. */
  const visa = {
    kind: 'card' as const,
    id: 3,
    name: 'Visa',
    owed: 400,
    rate: null,
    payment: null,
    carried: null,
    expensive: null,
  }
  const category = (over: Partial<WindowCategory>): WindowCategory => ({
    id: 11,
    name: 'Salary',
    type: 'income',
    perMonth: 2500,
    essential: false,
    via: null,
    ...over,
  })
  const open = (circle: number) => {
    const c = mount(() => <Progress />)
    go(`#progress/${circle}`)
    return q(c, '[data-test-id="circle-view"]')
  }
  const radios = (scope: ParentNode, testId: string) =>
    [...scope.querySelectorAll<HTMLLabelElement>(`[data-test-id="${testId}"]`)].map((label) => ({
      label: label.textContent,
      input: q(label, 'input') as HTMLInputElement,
    }))

  it("lists the checks in the method's order, each with its state and whether it is needed", () => {
    guidance.set!(viewOf(facts()))
    const view = open(4)
    expect(q(view, '#circle-checks-title').textContent).toBe('What Solid ground checks')
    expect(q(view, '[data-test-id="circle-checks-line"]').textContent).toBe(
      'It needs 2 of these, and 1 more is optional.'
    )
    const checks = [...view.querySelectorAll('[data-test-id="circle-check"]')]
    expect(
      checks.map((check) => [
        check.getAttribute('data-check'),
        check.getAttribute('data-state'),
        q(check, '[data-test-id="circle-check-state"]').textContent,
      ])
    ).toEqual([
      ['no-expensive-debt', 'met', 'Met'],
      ['solid-cushion', 'not-yet', 'Not yet'],
      ['full-cushion', 'not-yet', 'Not yet'],
    ])
    // What it needs: Your next step over it says the gap, the key figure the months.
    expect(q(checks[1], '[data-test-id="circle-check-detail"]').textContent).toBe(
      '€6,000 would be three months.'
    )
    expect(checks[1].textContent).toContain('Needed to reach Solid ground')
    expect(checks[2].textContent).not.toContain('Needed to reach')
    // The head says it once, in the circle's line, and not again under the key figure.
    const head = `${q(view, 'header').textContent} ${q(view, '[data-test-id="circle-view-key"]').textContent}`
    expect(head.match(/no debt at 10% or more/gi)).toHaveLength(1)
  })

  it('says what a check not known waits on', () => {
    guidance.set!(viewOf(facts({ accountsKnown: false, liquid: null, cushionMonths: null })))
    const view = open(3)
    const check = q(view, '[data-check="first-cushion"]')
    expect(check.getAttribute('data-state')).toBe('not-known')
    expect(q(check, '[data-test-id="circle-check-state"]').textContent).toBe('Not known yet')
    expect(q(check, '[data-test-id="circle-check-waiting"]').textContent).toBe(
      "Your accounts didn't load"
    )
  })

  it('shows the numbers behind the checks, and where the money in reach is', () => {
    guidance.set!(viewOf(facts({ liquidParts: { savings: 3000, current: 1000, cash: 0 } })))
    const view = open(3)
    expect(q(view, '[data-test-id="circle-numbers-lead"]').textContent).toBe(
      'Averages over January 2025 to December 2025. Balances as of today.'
    )
    const numbers = q(view, '[data-test-id="circle-numbers"]')
    expect([...numbers.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Money you can reach',
      'Needed every month',
      'Debts',
    ])
    expect([...numbers.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
      '€4,000',
      '€2,000',
      'None',
    ])
    expect(numbers.textContent).toContain(
      'Savings €3,000, current accounts at their lowest in the last 30 days €1,000.'
    )
  })

  it('links the withdrawal rate to Retirement, where it is set', () => {
    guidance.set!(viewOf(facts()))
    const view = open(6)
    const link = q(view, '[data-test-id="circle-numbers"] a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('#retirement')
    expect(link.textContent).toBe('Change it on Retirement')
  })

  it('asks the card question under the debt check, and saves a change there', async () => {
    guidance.set!(viewOf(facts({ belowZero: 1 }), false, { carriesCardBalance: false }))
    const view = open(4)
    const debt = q(view, '[data-check="no-expensive-debt"]')
    expect(debt.textContent).toContain('Do you carry a balance on a credit card or overdraft?')
    const [no, yes] = radios(debt, 'circle-card-choice')
    expect([no.label, yes.label]).toEqual(['No', 'Yes'])
    expect(no.input.checked).toBe(true)
    yes.input.click()
    expect(yes.input.checked).toBe(true)
    await tick()
    expect(saves.calls).toEqual([{ carriesCardBalance: true }])
    expect(takeAnswers).toHaveBeenCalledWith(1, { carriesCardBalance: true })
  })

  it('asks a question once when Your next step on the view asks it', () => {
    guidance.set!(viewOf(facts({ debts: [visa], belowZero: 1 })))
    const view = open(4)
    expect(q(view, '[data-test-id="next-step-card"]').getAttribute('data-step')).toBe(
      'no-expensive-debt'
    )
    expect(view.querySelectorAll('[data-test-id="circle-card-choice"]')).toHaveLength(0)
    expect(
      q(view, '[data-check="no-expensive-debt"] [data-test-id="circle-check-waiting"]').textContent
    ).toBe('Waiting on your answer')
  })

  it('puts a choice back when it did not save', async () => {
    saves.fail = true
    guidance.set!(viewOf(facts({ belowZero: 1 }), false, { carriesCardBalance: false }))
    const view = open(4)
    const [no, yes] = radios(view, 'circle-card-choice')
    yes.input.click()
    await tick()
    await tick()
    expect(q(view, '[data-test-id="circle-view-problem"]').textContent).toBe(
      "Couldn't save your answer. Try again."
    )
    expect(yes.input.checked).toBe(false)
    expect(no.input.checked).toBe(true)
    expect(takeAnswers).not.toHaveBeenCalled()
  })

  it('asks which income is support, and keeps support the months on screen do not show', async () => {
    const f = facts({
      windowCategories: [category({}), category({ id: 12, name: 'Family help', perMonth: 500 })],
    })
    guidance.set!(viewOf(f, false, { supportCategoryIds: [99] }))
    const view = open(2)
    const rows = [...view.querySelectorAll('[data-test-id="circle-support-row"]')]
    expect(rows.map((row) => row.textContent)).toEqual([
      'Salary€2,500 a month',
      'Family help€500 a month',
    ])
    const save = q(view, '[data-test-id="circle-support-save"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    ;(q(rows[1], 'input') as HTMLInputElement).click()
    expect(save.disabled).toBe(false)
    save.click()
    await tick()
    expect(saves.calls).toEqual([{ supportCategoryIds: [99, 12] }])
  })

  it('asks which spending is needed, writes the categories that change, then that it was asked', async () => {
    const f = facts({
      unsure: { categories: 1, uncategorised: 0, all: false },
      windowCategories: [
        category({
          id: 21,
          name: 'Rent',
          type: 'expense',
          perMonth: 1000,
          essential: true,
          via: 'kind',
        }),
        category({
          id: 22,
          name: 'Gym',
          type: 'expense',
          perMonth: 50,
          essential: true,
          via: 'no-kind',
        }),
        category({
          id: 23,
          name: 'Takeaway',
          type: 'expense',
          perMonth: 120,
          essential: false,
          via: 'kind',
        }),
      ],
    })
    guidance.set!(viewOf(f))
    const view = open(3)
    expect(view.textContent).toContain(
      '1 category counts as needed because nothing says otherwise. Choose what you need every month.'
    )
    const rows = [...view.querySelectorAll('[data-test-id="circle-essentials-row"]')]
    const boxes = rows.map((row) => q(row, 'input') as HTMLInputElement)
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false])
    boxes[1].click()
    boxes[2].click()
    ;(q(view, '[data-test-id="circle-essentials-save"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(saves.calls).toEqual([{ kindsAsked: true }])
    })
    // Rent stays as its kind says, so it is not written.
    expect(vi.mocked(apiPut).mock.calls).toEqual([
      ['/api/categories/22', { essential: false }],
      ['/api/categories/23', { essential: true }],
    ])
  })

  it('never lists or writes a category that cannot be needed, whatever the window says', async () => {
    const f = facts({
      unsure: { categories: 1, uncategorised: 0, all: false },
      windowCategories: [
        category({
          id: 22,
          name: 'Gym',
          type: 'expense',
          perMonth: 50,
          essential: true,
          via: 'no-kind',
        }),
        category({
          id: 7,
          name: 'Between my accounts',
          type: 'expense',
          perMonth: 200,
          essential: true,
          via: 'no-kind',
        }),
      ],
    })
    const view = viewOf(f)
    // Stored as a transfer category: the Worker and local-first refuse `essential` on it.
    view.snapshot.categories = [
      { id: 22, name: 'Gym', type: 'expense' },
      { id: 7, name: 'Between my accounts', type: 'transfer' },
    ] as never
    guidance.set!(view)
    const shown = open(4)
    expect(
      [...shown.querySelectorAll('[data-test-id="circle-essentials-row"]')].map((row) =>
        row.textContent?.includes('Between my accounts')
      )
    ).toEqual([false])
    ;(q(shown, '[data-test-id="circle-essentials-save"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(saves.calls).toEqual([{ kindsAsked: true }])
    })
    expect(vi.mocked(apiPut).mock.calls).toEqual([['/api/categories/22', { essential: true }]])
  })

  it('confirms the spending counted by default as needed when Save is pressed as it is', async () => {
    const f = facts({
      unsure: { categories: 1, uncategorised: 0, all: false },
      windowCategories: [
        category({
          id: 22,
          name: 'Gym',
          type: 'expense',
          perMonth: 50,
          essential: true,
          via: 'no-kind',
        }),
      ],
    })
    guidance.set!(viewOf(f))
    const view = open(4)
    ;(q(view, '[data-test-id="circle-essentials-save"]') as HTMLButtonElement).click()
    await vi.waitFor(() => {
      expect(saves.calls).toEqual([{ kindsAsked: true }])
    })
    expect(vi.mocked(apiPut).mock.calls).toEqual([['/api/categories/22', { essential: true }]])
  })

  it('asks about savings outside the app: No saves 0, Yes asks how much', async () => {
    guidance.set!(viewOf(facts()))
    const view = open(5)
    const question = q(view, '[data-test-id="circle-saved-elsewhere"]')
    expect(question.textContent).toContain(
      "Do you have pension or investment savings that aren't in Token Circles?"
    )
    const [no, yes] = radios(question, 'circle-saved-elsewhere-choice')
    expect(view.querySelector('[data-test-id="circle-saved-elsewhere-amount"]')).toBeNull()
    yes.input.click()
    const field = q(view, '[data-test-id="circle-saved-elsewhere-amount"]') as HTMLInputElement
    expect(saves.calls).toEqual([])
    field.focus()
    field.value = '12000'
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
    field.closest('form')!.requestSubmit()
    await tick()
    expect(saves.calls).toEqual([{ savedElsewhere: { amount: 12000, currency: 'EUR' } }])
    no.input.click()
    await tick()
    expect(saves.calls[1]).toEqual({ savedElsewhere: { amount: 0, currency: 'EUR' } })
  })

  it('leaves Escape to a field, and goes back to the list from anywhere else', async () => {
    guidance.set!(viewOf(facts()))
    const view = open(5)
    const [, yes] = radios(
      q(view, '[data-test-id="circle-saved-elsewhere"]'),
      'circle-saved-elsewhere-choice'
    )
    yes.input.click()
    const field = q(view, '[data-test-id="circle-saved-elsewhere-amount"]') as HTMLInputElement
    // Inside an amount, a choice, a text area or a list, Escape is the field's.
    const area = document.createElement('textarea')
    const list = document.createElement('select')
    view.append(area, list)
    for (const target of [field, yes.input, area, list]) {
      target.focus()
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(window.location.hash, target.tagName).toBe('#progress/5')
    }
    area.remove()
    list.remove()
    // From the heading, as from anything else, it goes back to the list.
    q(view, 'h2').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(window.location.hash).toBe('#progress')
    // The address change lands in this test, not the next one.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-test-id="circle-view"]')).toBeNull()
    })
  })

  it('says an amount was given in another currency only when there is an amount', () => {
    guidance.set!(viewOf(facts(), false, { savedElsewhere: { amount: 12000, currency: 'USD' } }))
    const view = open(5)
    expect(q(view, '[data-test-id="circle-saved-elsewhere"]').textContent).toContain(
      'You gave $12,000. Your circles count it again once you save it in EUR, your base currency now.'
    )
    // "No" saves 0 in the currency of the day: nothing to count again, so no note.
    guidance.set!(viewOf(facts(), false, { savedElsewhere: { amount: 0, currency: 'USD' } }))
    expect(q(view, '[data-test-id="circle-saved-elsewhere"]').textContent).not.toContain('You gave')
  })

  it('asks for the own number only once More than enough is the circle worked on', () => {
    guidance.set!(viewOf(facts()))
    const view = open(7)
    expect(view.querySelector('[data-test-id="circle-question-enough"]')).toBeNull()
    expect(q(view, '[data-check="enough"] [data-test-id="circle-check-waiting"]').textContent).toBe(
      'Asked once you reach Work optional'
    )
  })
})

describe('How you compare', () => {
  it('shows the cards beside the checks while the benchmarks gate is open', async () => {
    guidance.set!(viewOf(facts(), true))
    const c = mount(() => <Progress />)
    go('#progress/4')
    const view = q(c, '[data-test-id="circle-view"]')
    await vi.waitFor(() => {
      expect(view.querySelectorAll('[data-test-id="benchmark-card"]').length).toBeGreaterThan(0)
    })
    const compare = q(view, '[data-test-id="circle-compare"]')
    expect(q(compare, 'h3').textContent).toBe('How you compare')
    expect(q(compare, '[data-test-id="circle-compare-region"]').textContent).toBe(
      'Compared with the EU average, as nothing yet says where you live. Change'
    )
    const first = q(compare, '[data-test-id="benchmark-card"]')
    expect(first.getAttribute('data-card')).toBe('cushion')
    expect(q(first, '[data-test-id="benchmark-title"]').textContent).toBe(
      'Your cash covers 2 months of essentials'
    )
    expect(first.querySelector('[data-test-id="benchmark-bar"]')?.getAttribute('aria-label')).toBe(
      'Typical: 1 to 6 months. Yours: 2.'
    )
    expect(q(view, '[data-two]').getAttribute('data-two')).toBe('true')
    const change = q(compare, 'a[href="#settings"]')
    change.click()
    expect(settingsTab()).toBe('general')
    // The link really navigates, a task later: let it land in this test, not the next one.
    await vi.waitFor(() => {
      expect(window.location.hash).toBe('#settings')
    })
    await tick()
  })

  it('says the gap once, in Your next step, and not again in the check, the key figure or a card', async () => {
    guidance.set!(viewOf(facts(), true))
    const c = mount(() => <Progress />)
    go('#progress/4')
    const view = q(c, '[data-test-id="circle-view"]')
    await vi.waitFor(() => {
      expect(view.querySelector('[data-card="cushion"]')).not.toBeNull()
    })
    // Where the cushion stands, then what is between it and three months, once.
    expect(q(view, '[data-test-id="circle-view-key"]').textContent).toBe('2 of 3 months put by')
    expect(view.textContent!.match(/€2,000 (to go|away)/g)).toHaveLength(1)
    expect(q(view, '[data-test-id="next-step-why"]').textContent).toBe('€2,000 to go.')
    expect(q(view, '[data-check="solid-cushion"]').textContent).not.toContain('to go')
    expect(q(view, '[data-card="cushion"]').textContent).not.toContain('Next milestone')
    // A circle further in has no next step on it: its cushion card names the milestone.
    go('#progress/3')
    await vi.waitFor(() => {
      expect(q(c, '[data-test-id="circle-view"]').getAttribute('data-circle')).toBe('3')
    })
    await vi.waitFor(() => {
      expect(q(c, '[data-card="cushion"]').textContent).toContain(
        'Next milestone: 3 months, €2,000 away.'
      )
    })
  })

  it('shows no cards, and keeps one column, while the gate is closed', async () => {
    guidance.set!(viewOf(facts(), false))
    const c = mount(() => <Progress />)
    go('#progress/4')
    await tick()
    await tick()
    const view = q(c, '[data-test-id="circle-view"]')
    expect(view.querySelector('[data-test-id="circle-compare"]')).toBeNull()
    expect(view.querySelector('[data-two="true"]')).toBeNull()
    expect(view.textContent).not.toContain('How you compare')
  })

  it('asks how the household lives on the housing card in Paying your way, and saves it', async () => {
    const spent = facts({
      spendingByKind: { groceries: 300, eating_out: 100, transport: 250, housing: 900 },
    })
    guidance.set!(viewOf(spent, true))
    const c = mount(() => <Progress />)
    go('#progress/2')
    const view = q(c, '[data-test-id="circle-view"]')
    await vi.waitFor(() => {
      expect(view.querySelectorAll('[data-test-id="benchmark-card"]').length).toBe(4)
    })
    const ids = [...view.querySelectorAll('[data-test-id="benchmark-card"]')].map((card) =>
      card.getAttribute('data-card')
    )
    expect(ids).toEqual(['groceries', 'eating-out', 'transport', 'housing'])
    const housing = q(view, '[data-card="housing"]')
    const question = q(housing, '[data-test-id="circle-question-tenure"]')
    expect(q(question, 'legend').textContent).toBe('How do you live?')
    const chips = [...question.querySelectorAll('[data-test-id="circle-tenure-choice"]')]
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Rent',
      'Own with a mortgage',
      'Own outright',
      'Live with family',
    ])
    // Only the housing card asks.
    expect(view.querySelectorAll('[data-test-id="circle-question-tenure"]')).toHaveLength(1)
    q(chips[1], 'input').click()
    await vi.waitFor(() => {
      expect(saves.calls).toEqual([{ tenure: 'mortgage' }])
    })
    expect(vi.mocked(takeAnswers)).toHaveBeenCalledWith(1, { tenure: 'mortgage' })

    // Answered: the store hands the card the answer, and it asks no more.
    guidance.set!(viewOf(spent, true, { tenure: 'mortgage' }))
    await vi.waitFor(() => {
      expect(view.querySelector('[data-test-id="circle-question-tenure"]')).toBeNull()
    })
  })

  it('says beside the card when the answer did not save, and puts the choice back', async () => {
    saves.fail = true
    guidance.set!(viewOf(facts({ spendingByKind: { housing: 900 } }), true))
    const c = mount(() => <Progress />)
    go('#progress/2')
    const view = q(c, '[data-test-id="circle-view"]')
    await vi.waitFor(() => {
      expect(view.querySelector('[data-test-id="circle-question-tenure"]')).not.toBeNull()
    })
    const chip = q(view, '[data-test-id="circle-tenure-choice"] input') as HTMLInputElement
    chip.click()
    await vi.waitFor(() => {
      expect(q(view, '[data-test-id="circle-compare-problem"]').textContent).toBe(
        "Couldn't save your answer. Try again."
      )
    })
    expect(chip.checked).toBe(false)
  })

  it('offers social housing where the figures tell it apart, in the UK', async () => {
    const uk = viewOf(facts({ region: 'UK', spendingByKind: { housing: 900 } }), true)
    guidance.set!({ ...uk, region: { region: 'UK', reason: 'answer', via: null } })
    const c = mount(() => <Progress />)
    go('#progress/2')
    await vi.waitFor(() => {
      expect(c.querySelector('[data-test-id="circle-question-tenure"]')).not.toBeNull()
    })
    expect(
      [...c.querySelectorAll('[data-test-id="circle-tenure-choice"]')].map((one) => one.textContent)
    ).toEqual([
      'Rent privately',
      'Rent social housing',
      'Own with a mortgage',
      'Own outright',
      'Live with family',
    ])
  })

  it('asks who the space covers on the subscription card until the adults are known', async () => {
    const held = facts({ subscriptions: { count: 8, perMonth: 120 } })
    guidance.set!(viewOf(held, true))
    const c = mount(() => <Progress />)
    go('#progress/2')
    const view = q(c, '[data-test-id="circle-view"]')
    await vi.waitFor(() => {
      expect(view.querySelector('[data-card="subscriptions"]')).not.toBeNull()
    })
    const card = q(view, '[data-card="subscriptions"]')
    expect(q(card, '[data-test-id="benchmark-title"]').textContent).toBe(
      '8 subscriptions, about €120 a month'
    )
    const question = q(card, '[data-test-id="circle-space-household"]')
    expect(q(question, 'legend').textContent).toBe('Who does this space cover?')
    q(question, '[data-test-id="circle-space-adults-2"] input').click()
    await vi.waitFor(() => {
      expect(saves.calls).toEqual([{ adults: 2 }])
    })
    expect(vi.mocked(takeAnswers)).toHaveBeenCalledWith(1, { adults: 2 })

    // Answered: the card counts per adult and asks no more.
    guidance.set!(viewOf(held, true, { adults: 2 }))
    await vi.waitFor(() => {
      expect(view.querySelector('[data-test-id="circle-space-household"]')).toBeNull()
    })
    expect(
      [
        ...q(view, '[data-card="subscriptions"]').querySelectorAll(
          '[data-test-id="benchmark-body"]'
        ),
      ]
        .map((one) => one.textContent)
        .at(-1)
    ).toBe("The surveys count per adult: with 2 adults here, that's 4 each.")
  })

  it('puts the household chip back when the answer did not save', async () => {
    saves.fail = true
    guidance.set!(viewOf(facts({ subscriptions: { count: 3, perMonth: 40 } }), true))
    const c = mount(() => <Progress />)
    go('#progress/2')
    await vi.waitFor(() => {
      expect(c.querySelector('[data-test-id="circle-space-household"]')).not.toBeNull()
    })
    const chip = q(c, '[data-test-id="circle-space-adults-1"] input') as HTMLInputElement
    chip.click()
    await vi.waitFor(() => {
      expect(q(c, '[data-test-id="circle-compare-problem"]').textContent).toBe(
        "Couldn't save your answer. Try again."
      )
    })
    expect(chip.checked).toBe(false)
  })

  it('has no comparison in a circle without cards', async () => {
    guidance.set!(viewOf(facts(), true))
    const c = mount(() => <Progress />)
    go('#progress/1')
    await tick()
    await tick()
    expect(c.querySelector('[data-test-id="circle-compare"]')).toBeNull()
  })
})

describe('What your circles asked, in Settings', () => {
  it('asks each question again once Settings removes its answer; the essentials live on Categories', async () => {
    const all: Answers = {
      carriesCardBalance: false,
      setsAsideYearly: true,
      freeMoney: { region: 'DE', answer: 'taken' },
      tenure: 'mortgage',
      supportCategoryIds: [12],
      kindsAsked: true,
      savedElsewhere: { amount: 12000, currency: 'EUR' },
      enoughPerYear: { amount: 48000, currency: 'EUR' },
    }
    // Every Remove answer in Settings, pressed, with what each sends.
    const removed: AnswerChanges[] = []
    const settings = document.createElement('div')
    document.body.appendChild(settings)
    const disposeSettings = render(
      () => (
        <CircleAnswers
          answers={all}
          currency="EUR"
          categoryNames={new Map([[12, 'Family help']])}
          gate
          region="DE"
          disabled={false}
          onSave={async (changes) => {
            removed.push(changes)
            return true
          }}
        />
      ),
      settings
    )
    try {
      // Each essentials choice is kept on its category: nothing here to remove, and the way there.
      const essentials = q(settings, '[data-test-id="settings-answer-essentials"]')
      expect(essentials.querySelector('button')).toBeNull()
      expect(q(essentials, 'a').getAttribute('href')).toBe('#categories')
      for (const button of settings.querySelectorAll<HTMLButtonElement>(
        '[data-test-id$="-remove"]'
      ))
        button.click()
    } finally {
      disposeSettings()
      settings.remove()
    }

    /** A card whose entries can't show whether its balance is carried. */
    const visa = { kind: 'card' as const, id: 3, name: 'Visa', owed: 400, rate: null }
    const unknownCard = { ...visa, payment: null, carried: null, expensive: null }
    const family = {
      id: 12,
      name: 'Family help',
      type: 'income' as const,
      perMonth: 500,
      essential: false,
      via: null,
    }
    /** Where each answer's question is asked, for someone it applies to: in the list, or the step. */
    const askedIn: Record<
      string,
      { circle: number; f: GuidanceFacts; list: string; step?: string }
    > = {
      carriesCardBalance: {
        circle: 4,
        f: facts({ debts: [unknownCard], belowZero: 1 }),
        list: 'circle-question-card',
        step: 'no-expensive-debt',
      },
      setsAsideYearly: {
        circle: 4,
        f: facts({ yearlyBills: { count: 1, perYear: 600, perMonth: 50 } }),
        list: 'circle-question-yearly-bills',
        step: 'yearly-bills',
      },
      freeMoney: {
        circle: 4,
        f: facts({ region: 'DE' }),
        list: 'circle-question-free-money',
        step: 'free-money',
      },
      tenure: {
        circle: 2,
        f: facts({ spendingByKind: { housing: 900 } }),
        list: 'circle-question-tenure',
      },
      supportCategoryIds: {
        circle: 2,
        f: facts({ windowCategories: [family] }),
        list: 'circle-question-support',
      },
      savedElsewhere: { circle: 5, f: facts(), list: 'circle-saved-elsewhere' },
      enoughPerYear: {
        circle: 7,
        f: facts({ cushionMonths: 4, liquid: 8000, invested: 800000 }),
        list: 'circle-question-enough',
        step: 'enough',
      },
    }
    // Every answer with a Remove is one a circle asks again: none left out of this list.
    expect(
      removed
        .map((change) => Object.keys(change))
        .flat()
        .sort()
    ).toEqual(Object.keys(askedIn).sort())

    const c = mount(() => <Progress />)
    for (const change of removed) {
      const [field] = Object.keys(change)
      const where = askedIn[field]
      const answers = readAnswers(mergeAnswers(all, change))
      expect(Object.prototype.hasOwnProperty.call(answers, field), field).toBe(false)
      guidance.set!(viewOf(where.f, true, answers))
      go(`#progress/${where.circle}`)
      await vi.waitFor(() => {
        const view = q(c, '[data-test-id="circle-view"]')
        expect(view.getAttribute('data-circle'), field).toBe(String(where.circle))
        const asked =
          view.querySelector(`[data-test-id="${where.list}"]`) ??
          (where.step
            ? view.querySelector(`[data-test-id="next-step-card"][data-step="${where.step}"]`)
            : null)
        expect(asked, field).not.toBeNull()
        // Asked again: nothing chosen, nothing typed.
        expect(asked!.querySelectorAll('input:checked'), field).toHaveLength(0)
        for (const input of asked!.querySelectorAll<HTMLInputElement>('input:not([type])'))
          expect(input.value, field).toBe('')
      })
    }
  })
})

describe('a circle view says each figure once', () => {
  /** The figures in a text: money, months, shares and days. */
  const figures = (text: string): string[] => [
    ...(text.match(/€[\d,]+/g) ?? []),
    ...(text.match(/\d[\d.]*(?=%| month| day| of 12)/g) ?? []),
  ]

  /**
   * Each part's text: the key figure (where the circle stands), Your next step's why, every
   * check's line, and Your numbers' values (the person's inputs).
   */
  function parts(view: HTMLElement) {
    const all = (sel: string) => [...view.querySelectorAll(sel)].map((el) => el.textContent ?? '')
    return {
      key: all('[data-test-id="circle-view-key"]').join(' '),
      step: all('[data-test-id="next-step-why"], [data-test-id="next-step-meter"]').join(' '),
      checks: all('[data-test-id="circle-check-detail"]'),
      numbers: all('[data-test-id="circle-numbers"] dd, [data-test-id="circle-numbers"] p').join(
        ' '
      ),
    }
  }

  it("says Solid ground's figures once each, as the brief's view had them", () => {
    // 2,800 in reach against 1,460 needed a month: 1.9 of 3 months, 1,580 to go.
    guidance.set!(viewOf(facts({ liquid: 2800, essentials: 1460, cushionMonths: 2800 / 1460 })))
    const c = mount(() => <Progress />)
    go('#progress/4')
    const view = q(c, '[data-test-id="circle-view"]')
    expect(q(view, '[data-test-id="next-step-card"]').getAttribute('data-step')).toBe(
      'solid-cushion'
    )
    const text = view.textContent!
    expect(text.match(/€2,800/g)).toHaveLength(1)
    expect(text.match(/€1,460/g)).toHaveLength(1)
    expect(text.match(/1\.9/g)).toHaveLength(1)
    expect(text.match(/€1,580/g)).toHaveLength(1)
    // Each where it does a job: the inputs in Your numbers, where the circle stands in the key
    // figure, the gap in Your next step, and what the check needs in the check.
    const { key, step, checks, numbers } = parts(view)
    expect(numbers).toContain('€2,800')
    expect(numbers).toContain('€1,460')
    expect(key).toBe('1.9 of 3 months put by')
    expect(step).toBe('€1,580 to go.')
    expect(
      q(view, '[data-check="solid-cushion"] [data-test-id="circle-check-detail"]').textContent
    ).toBe('€4,380 would be three months.')
    expect(view.querySelector('[data-test-id="next-step-meter"]')).toBeNull()
    expect(checks.join(' ')).not.toMatch(/€2,800|€1,460|1\.9|€1,580/)
  })

  // Each circle as the one being worked on, and one reached.
  const cases: [string, number, Partial<GuidanceFacts>][] = [
    ['Clear picture', 1, { sortedShare: 80 }],
    ['Clear picture, short of a year', 1, { monthsInYear: 7, firm: false }],
    ['Paying your way', 2, { ownIncome: 2000, income: 2000 }],
    ['Breathing room', 3, { liquid: 1200, cushionMonths: 0.6 }],
    ['Breathing room, reached', 3, { liquid: 2800, essentials: 1460, cushionMonths: 2800 / 1460 }],
    [
      'Solid ground, with a debt and yearly bills',
      4,
      {
        liquid: 4200,
        cushionMonths: 2.1,
        debts: [
          {
            kind: 'card',
            id: 3,
            name: 'Travel card',
            owed: 400,
            rate: 19.9,
            payment: null,
            carried: true,
            expensive: true,
          },
        ],
        yearlyBills: { count: 1, perYear: 780, perMonth: 65 },
      },
    ],
    ['Room to choose', 5, { liquid: 13000, cushionMonths: 6.5, invested: 20000 }],
    ['Work optional', 6, { liquid: 13000, cushionMonths: 6.5, invested: 70000 }],
    [
      'More than enough',
      7,
      { liquid: 13000, cushionMonths: 6.5, invested: 800000, enoughPerYear: 40000 },
    ],
  ]
  for (const [name, circle, over] of cases) {
    it(`keeps ${name}'s inputs in Your numbers and its standing in the key figure`, () => {
      guidance.set!(viewOf(facts(over)))
      const c = mount(() => <Progress />)
      go(`#progress/${circle}`)
      const { key, step, checks, numbers } = parts(q(c, '[data-test-id="circle-view"]'))
      const elsewhere = new Set([...figures(key), ...figures(numbers)])
      // Your next step and the checks say what to do and what is needed, not those again.
      for (const said of [step, ...checks]) {
        expect(
          figures(said).filter((figure) => elsewhere.has(figure)),
          said
        ).toEqual([])
      }
      // No two parts below the key figure say the same figure either.
      const below = [step, ...checks].flatMap((said) => [...new Set(figures(said))])
      expect(below.length).toBe(new Set(below).size)
    })
  }
})
