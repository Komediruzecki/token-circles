/**
 * The circles on Progress: Your next step over the ledger, each row a link to its circle, the
 * circle's own view at `#progress/<n>` with focus moved in and back out, and the questions a step
 * asks, saved through `saveAnswers` and handed to the store at once.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeCircle } from '../../../../shared/guidance/circles'
import { ledgerRows, ledgerStatus } from '../../../../shared/guidance/ledger'
import { nextStepOf } from '../../../../shared/guidance/nextStep'
import { facts, words } from '../../core/__tests__/guidanceFixtures'
import type { JSX } from 'solid-js'
import type { Answers } from '../../../../shared/guidance/answers'
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

import { refreshAchievements } from '../../core/achievementsStore'
import { apiPut } from '../../core/api'
import { takeAnswers } from '../../core/guidance'
import Progress from '../Progress'

/** The view the store would answer for `f`. */
function viewOf(f: GuidanceFacts, gate = false, answers: Answers = {}): GuidanceView {
  const placement = placeCircle(f, { freeMoney: gate })
  return {
    profileId: 1,
    snapshot: {} as never,
    inputs: { profileId: 1, answers, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 },
    gate,
    region: { region: f.region } as never,
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

/** Go to `hash` as a link would, firing the hashchange the app listens for. */
function go(hash: string) {
  history.pushState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
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
      "Solid ground. You're here. 2 of 3 months: €2,000 to go."
    )
    expect(fourth.textContent).toContain('No debt at 10% or more.')
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

    view.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(window.location.hash).toBe('#progress')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
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

  it('stays as it was while another page is on screen', () => {
    guidance.set!(viewOf(facts()))
    const c = mount(() => <Progress />)
    go('#progress/2')
    go('#budgets')
    expect(q(c, '[data-test-id="circle-view"]').getAttribute('data-circle')).toBe('2')
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
      '2 are needed to reach it; 1 more is on its list.'
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
    expect(q(checks[1], '[data-test-id="circle-check-detail"]').textContent).toBe(
      '2 months: €4,000 against €2,000 a month. €2,000 to go.'
    )
    expect(checks[1].textContent).toContain('Needed to reach Solid ground')
    expect(checks[2].textContent).not.toContain('Needed to reach')
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

  it('asks for the own number only once More than enough is the circle worked on', () => {
    guidance.set!(viewOf(facts()))
    const view = open(7)
    expect(view.querySelector('[data-test-id="circle-question-enough"]')).toBeNull()
    expect(q(view, '[data-check="enough"] [data-test-id="circle-check-waiting"]').textContent).toBe(
      'Asked once you reach Work optional'
    )
  })
})
