/**
 * The retirement planner, driven through the real component.
 *
 * The bug this page had was not in the arithmetic — it was that nothing on it was
 * connected to anything. The projection came from server defaults no control could reach,
 * so the chart was a fixed picture of someone else's retirement. A test that computes a
 * projection and compares numbers would not have caught that; these mount the panel and
 * type into it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRetirement } from '../../../../shared/retirement'
import { DEFAULT_SETTINGS, settingsToInput } from '../../../../shared/retirementSettings'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import type { RetirementSettings } from '../../../../shared/retirementSettings'

let serverSettings: Partial<RetirementSettings> = {}
let serverFilled: { field: string; value: number | string; source: string }[] = []

const apiGet = vi.fn(async () => ({
  settings: { ...DEFAULT_SETTINGS, ...serverSettings },
  filled: serverFilled,
  missing: [],
  startMonth: '2026-01',
}))
const apiPut = vi.fn(async (_path: string, body: RetirementSettings) => ({ settings: body }))
const showToast = vi.fn()

vi.mock('../../core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...(args as [])),
  apiPut: (...args: unknown[]) => apiPut(...(args as [string, RetirementSettings])),
  formatCurrency: (n: number) => `EUR ${Math.round(n)}`,
  showToast: (...args: unknown[]) => showToast(...args),
}))

// The chart needs a canvas jsdom will not give it. What it was asked to draw is asserted
// through the captured props instead, which is the part that can actually be wrong.
// Captured inside an effect, not in the component body: Solid props are getters, and a
// body-level read would freeze the first render and make every later assertion vacuous.
let lastChartData: any = null
vi.mock('../../components/Chart', async () => {
  const { createEffect } = await import('solid-js')
  return {
    default: (props: any) => {
      createEffect(() => {
        lastChartData = props.data
      })
      return null
    },
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  serverSettings = {}
  serverFilled = []
  lastChartData = null
  apiGet.mockClear()
  apiPut.mockClear()
  showToast.mockClear()
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
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.unstubAllGlobals()
})

async function mountPlanner() {
  // The panel reloads through refetchOnActive, which only fetches while its page is the
  // visible one — that is how a profile switch reaches it. In the app a page mounts only
  // when navigated to; here we have to say so.
  setPage('retirement')
  const { default: RetirementPlanner } = await import('../RetirementPlanner')
  dispose = render(() => <RetirementPlanner />, host)
  await flush()
  await flush()
  return host
}

function byTestId(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-test-id="${id}"]`)
}

function inputByTestId(root: HTMLElement, id: string): HTMLInputElement | null {
  return root.querySelector(`[data-test-id="${id}"]`)
}

function buttonByTestId(root: HTMLElement, id: string): HTMLButtonElement | null {
  return root.querySelector(`[data-test-id="${id}"]`)
}

const byTestIdAll = (root: HTMLElement, id: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-test-id="${id}"]`),
]

/** The month controls are a pair of selects, so a month is chosen in two gestures. */
async function pickMonth(picker: HTMLElement, value: string) {
  const [monthSel, yearSel] = [...picker.querySelectorAll<HTMLSelectElement>('select')]
  const [year, month] = value.split('-')
  yearSel.value = year
  yearSel.dispatchEvent(new Event('change', { bubbles: true }))
  monthSel.value = String(Number(month))
  monthSel.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

/** Type into a control the way a person does: focus it, set the value, fire input. */
async function type(input: HTMLInputElement, value: string) {
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

async function check(input: HTMLInputElement, checked: boolean) {
  input.checked = checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

/** The net-worth series the chart was last handed. */
const netWorthSeries = (): number[] => lastChartData.datasets[0].data

describe('loading', () => {
  it('shows the saved assumptions in the controls', async () => {
    serverSettings = { netWorth: 66931.42, monthlyContribution: 1200, annualReturnPct: 5.78 }
    const root = await mountPlanner()

    expect(inputByTestId(root, 'retirement-input-networth')!.value).toBe('66931.42')
    expect(inputByTestId(root, 'retirement-input-contribution')!.value).toBe('1200')
    expect(inputByTestId(root, 'retirement-input-return')!.value).toBe('5.78')
  })

  it('says which figures came from the user data and where from', async () => {
    serverFilled = [
      { field: 'netWorth', value: 66931.42, source: 'Total of your accounts' },
      { field: 'monthlyExpenses', value: 2400, source: '14 months of transactions' },
    ]
    const root = await mountPlanner()

    const note = byTestId(root, 'retirement-derived-note')
    expect(note).not.toBeNull()
    expect(note!.textContent).toContain('Current net worth')
    expect(note!.textContent).toContain('Total of your accounts')
    expect(note!.textContent).toContain('14 months of transactions')
  })

  it('says nothing when there was nothing to fill in', async () => {
    const root = await mountPlanner()
    expect(byTestId(root, 'retirement-derived-note')).toBeNull()
  })
})

describe('editing', () => {
  it('redraws the projection as the contribution is typed, before anything is saved', async () => {
    serverSettings = { netWorth: 10000, monthlyContribution: 500, annualReturnPct: 7 }
    const root = await mountPlanner()

    const before = netWorthSeries()
    await type(inputByTestId(root, 'retirement-input-contribution')!, '2000')
    const after = netWorthSeries()

    expect(after[after.length - 1]).toBeGreaterThan(before[before.length - 1])
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('redraws when the opening balance changes', async () => {
    serverSettings = { netWorth: 10000, monthlyContribution: 0, annualReturnPct: 7 }
    const root = await mountPlanner()

    await type(inputByTestId(root, 'retirement-input-networth')!, '100000')
    expect(netWorthSeries()[0]).toBeCloseTo(100000, 6)
  })

  it('redraws when the expected return changes', async () => {
    serverSettings = { netWorth: 100000, monthlyContribution: 0, annualReturnPct: 5 }
    const root = await mountPlanner()

    const slower = netWorthSeries()
    await type(inputByTestId(root, 'retirement-input-return')!, '9')
    const faster = netWorthSeries()
    expect(faster[faster.length - 1]).toBeGreaterThan(slower[slower.length - 1])
  })

  it('moves the retirement date when the target lifestyle gets cheaper', async () => {
    serverSettings = {
      netWorth: 200000,
      monthlyContribution: 2000,
      annualReturnPct: 7,
      birthMonth: '1994-01',
      lifestyles: [{ id: 'a', label: 'Zagreb', monthlySpendToday: 3000 }],
    }
    const root = await mountPlanner()

    const expensive = byTestId(root, 'retirement-crossing')!.textContent
    const spendInput = [...host.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.getAttribute('aria-label') === "Monthly spending in today's money"
    )!
    await type(spendInput, '1200')
    const cheap = byTestId(root, 'retirement-crossing')!.textContent

    expect(cheap).not.toBe(expensive)
    expect(cheap).toMatch(/^Age \d+/)
  })

  it('shows a card per lifestyle, each with its own target', async () => {
    serverSettings = {
      netWorth: 300000,
      monthlyContribution: 2000,
      annualReturnPct: 7,
      safeWithdrawalRatePct: 4,
      lifestyles: [
        { id: 'zg', label: 'Zagreb', monthlySpendToday: 1500 },
        { id: 'zh', label: 'Zurich', monthlySpendToday: 4000 },
      ],
    }
    const root = await mountPlanner()

    const cards = byTestIdAll(root, 'retirement-lifestyle-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Zagreb')
    expect(cards[0].textContent).toContain('EUR 450000')
    expect(cards[1].textContent).toContain('Zurich')
    expect(cards[1].textContent).toContain('EUR 1200000')
  })

  it('adds and removes a lifestyle', async () => {
    const root = await mountPlanner()
    expect(byTestIdAll(root, 'retirement-lifestyle-card')).toHaveLength(1)

    buttonByTestId(root, 'retirement-add-lifestyle')!.click()
    await flush()
    expect(byTestIdAll(root, 'retirement-lifestyle-card')).toHaveLength(2)

    const remove = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.getAttribute('aria-label') === 'Remove lifestyle'
    )
    remove[1].click()
    await flush()
    expect(byTestIdAll(root, 'retirement-lifestyle-card')).toHaveLength(1)
  })

  it('will not let the last lifestyle be removed, leaving nothing to aim at', async () => {
    await mountPlanner()
    const remove = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === 'Remove lifestyle'
    )!
    expect(remove.disabled).toBe(true)
  })
})

describe('modes', () => {
  it('starts in whichever mode was saved', async () => {
    serverSettings = { mode: 'advanced' }
    const root = await mountPlanner()
    expect(byTestId(root, 'retirement-input-income')).not.toBeNull()
    expect(byTestId(root, 'retirement-input-contribution')).toBeNull()
  })

  it('swaps the single contribution for income and spending', async () => {
    const root = await mountPlanner()
    expect(byTestId(root, 'retirement-input-contribution')).not.toBeNull()
    expect(byTestId(root, 'retirement-input-income')).toBeNull()

    buttonByTestId(root, 'retirement-mode-advanced')!.click()
    await flush()

    expect(byTestId(root, 'retirement-input-contribution')).toBeNull()
    expect(byTestId(root, 'retirement-input-income')).not.toBeNull()
    expect(byTestId(root, 'retirement-input-expenses')).not.toBeNull()
    expect(byTestId(root, 'retirement-input-raise')).not.toBeNull()
  })

  it('only offers pay steps and spending periods in advanced mode', async () => {
    const root = await mountPlanner()
    expect(byTestId(root, 'retirement-income-steps')).toBeNull()

    buttonByTestId(root, 'retirement-mode-advanced')!.click()
    await flush()
    expect(byTestId(root, 'retirement-income-steps')).not.toBeNull()
    expect(byTestId(root, 'retirement-expense-periods')).not.toBeNull()
  })

  it('adds a pay step that changes the projection', async () => {
    serverSettings = {
      mode: 'advanced',
      netWorth: 0,
      monthlyIncome: 3000,
      monthlyExpenses: 2000,
      annualReturnPct: 6,
    }
    const root = await mountPlanner()
    const before = netWorthSeries()

    buttonByTestId(root, 'retirement-add-step')!.click()
    await flush()
    const stepAmount = [...host.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.getAttribute('aria-label') === 'Monthly income from then'
    )!
    await type(stepAmount, '8000')

    const after = netWorthSeries()
    expect(after[after.length - 1]).toBeGreaterThan(before[before.length - 1])
  })
})

describe('inflation', () => {
  it('collapses the real reading onto the nominal one when switched off', async () => {
    serverSettings = {
      netWorth: 100000,
      monthlyContribution: 0,
      annualReturnPct: 6,
      annualInflationPct: 3,
      adjustForInflation: true,
    }
    const root = await mountPlanner()

    const real = netWorthSeries()
    const toggle = byTestId(root, 'retirement-toggle-inflation')!.querySelector('input')!
    await check(toggle, false)
    const nominal = netWorthSeries()

    expect(nominal[nominal.length - 1]).toBeGreaterThan(real[real.length - 1])
    // The rate is kept, so switching back restores the assumption rather than a default.
    expect(inputByTestId(root, 'retirement-input-inflation')!.value).toBe('3')
  })

  it("switches the chart between today's money and future money", async () => {
    serverSettings = {
      netWorth: 100000,
      monthlyContribution: 0,
      annualReturnPct: 6,
      annualInflationPct: 3,
    }
    const root = await mountPlanner()

    expect(lastChartData.datasets[0].label).toContain("today's money")
    const todays = netWorthSeries()

    const toggle = byTestId(root, 'retirement-toggle-nominal')!.querySelector('input')!
    await check(toggle, true)

    expect(lastChartData.datasets[0].label).not.toContain("today's money")
    expect(netWorthSeries()[10]).toBeGreaterThan(todays[10])
  })

  it("draws a flat target in today's money and a rising one in future money", async () => {
    serverSettings = {
      annualInflationPct: 3,
      lifestyles: [{ id: 'a', label: 'A', monthlySpendToday: 2000 }],
    }
    const root = await mountPlanner()

    const flat = lastChartData.datasets[lastChartData.datasets.length - 1].data
    expect(flat[0]).toBeCloseTo(flat[flat.length - 1], 6)

    await check(byTestId(root, 'retirement-toggle-nominal')!.querySelector('input')!, true)
    const rising = lastChartData.datasets[lastChartData.datasets.length - 1].data
    expect(rising[rising.length - 1]).toBeGreaterThan(rising[0])
  })
})

describe('the return band', () => {
  it('adds a better and a worse line either side of the plan', async () => {
    const root = await mountPlanner()
    const plain = lastChartData.datasets.length

    await check(byTestId(root, 'retirement-toggle-band')!.querySelector('input')!, true)
    expect(lastChartData.datasets.length).toBe(plain + 2)

    const [worse, better] = lastChartData.datasets.slice(1, 3)
    const last = (d: any) => d.data[d.data.length - 1]
    expect(last(worse)).toBeLessThan(last(lastChartData.datasets[0]))
    expect(last(better)).toBeGreaterThan(last(lastChartData.datasets[0]))
  })
})

describe('saving', () => {
  it('will not offer to save until something has changed', async () => {
    const root = await mountPlanner()
    const button = buttonByTestId(root, 'retirement-save-settings')!
    expect(button.disabled).toBe(true)

    await type(inputByTestId(root, 'retirement-input-networth')!, '1234')
    expect(button.disabled).toBe(false)
  })

  it('sends what is on screen and confirms', async () => {
    const root = await mountPlanner()

    await type(inputByTestId(root, 'retirement-input-networth')!, '54321')
    buttonByTestId(root, 'retirement-save-settings')!.click()
    await flush()
    await flush()

    expect(apiPut).toHaveBeenCalledTimes(1)
    const [path, body] = apiPut.mock.calls[0]
    expect(path).toBe('/api/retirement/settings')
    expect(body.netWorth).toBe(54321)
    expect(showToast).toHaveBeenCalledWith('Retirement assumptions saved', 'success')
    expect(buttonByTestId(root, 'retirement-save-settings')!.disabled).toBe(true)
  })

  it('says so and stays editable when the save fails', async () => {
    apiPut.mockRejectedValueOnce(new Error('offline'))
    const root = await mountPlanner()

    await type(inputByTestId(root, 'retirement-input-networth')!, '54321')
    buttonByTestId(root, 'retirement-save-settings')!.click()
    await flush()
    await flush()

    expect(showToast).toHaveBeenCalledWith('Failed to save your retirement assumptions', 'error')
    expect(buttonByTestId(root, 'retirement-save-settings')!.disabled).toBe(false)
  })

  it('keeps working when the settings cannot be loaded at all', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline'))
    const root = await mountPlanner()

    expect(showToast).toHaveBeenCalledWith('Failed to load your retirement assumptions', 'error')
    expect(byTestId(root, 'retirement-assumptions')).not.toBeNull()
  })
})

describe('the chart and the model agree', () => {
  it('plots exactly what the shared model returns for the settings on screen', async () => {
    serverSettings = {
      netWorth: 50000,
      monthlyContribution: 900,
      annualReturnPct: 7,
      annualInflationPct: 2.5,
      birthMonth: '1994-01',
      lifeExpectancyAge: 90,
    }
    const root = await mountPlanner()

    const expected = projectRetirement(
      settingsToInput({ ...DEFAULT_SETTINGS, ...serverSettings } as RetirementSettings, '2026-01')
    )
    const yearlyReal = expected.rows.filter((_, i) => i % 12 === 0).map((r) => r.netWorthReal)

    expect(netWorthSeries()).toHaveLength(yearlyReal.length)
    expect(netWorthSeries()[0]).toBeCloseTo(yearlyReal[0], 6)
    expect(netWorthSeries()[20]).toBeCloseTo(yearlyReal[20], 6)
    expect(lastChartData.labels[0]).toBe('32')
    expect(byTestId(root, 'retirement-summary')!.textContent).toContain('Investment growth')
  })
})

describe('controls that cannot do anything say so', () => {
  it('disables "plan until age" until there is a date of birth to count from', async () => {
    const root = await mountPlanner()
    expect(inputByTestId(root, 'retirement-input-life')!.disabled).toBe(true)
    expect(byTestId(root, 'retirement-life-needs-birth')!.textContent).toContain('date of birth')

    await pickMonth(byTestId(root, 'retirement-input-birth')!, '1994-01')
    expect(inputByTestId(root, 'retirement-input-life')!.disabled).toBe(false)
    expect(byTestId(root, 'retirement-life-needs-birth')).toBeNull()
  })

  it('shortens the projection once an age can be counted to', async () => {
    serverSettings = { birthMonth: '1994-01', lifeExpectancyAge: 70 }
    const root = await mountPlanner()
    const short = netWorthSeries().length

    await type(inputByTestId(root, 'retirement-input-life')!, '95')
    expect(netWorthSeries().length).toBeGreaterThan(short)
  })

  it('does not print an infinite multiple when the withdrawal rate is cleared', async () => {
    const root = await mountPlanner()
    await type(inputByTestId(root, 'retirement-input-swr')!, '')
    expect(byTestId(root, 'retirement-assumptions')!.textContent).not.toContain('Infinity')
  })
})

describe('a pay step the user typed is the pay they get', () => {
  it('projects a pay cut rather than ignoring it', async () => {
    serverSettings = {
      mode: 'advanced',
      netWorth: 0,
      monthlyIncome: 5000,
      monthlyExpenses: 2000,
      annualRaisePct: 5,
      annualReturnPct: 6,
    }
    const root = await mountPlanner()
    const before = netWorthSeries()

    buttonByTestId(root, 'retirement-add-step')!.click()
    await flush()
    const stepAmount = [...host.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.getAttribute('aria-label') === 'Monthly income from then'
    )!
    await type(stepAmount, '1500')

    const after = netWorthSeries()
    expect(after[after.length - 1]).toBeLessThan(before[before.length - 1])
  })
})

/**
 * These are the bugs the panel actually shipped with, in the order a user hit them.
 * Each one is a regression test rather than a feature test: the arithmetic was fine, the
 * controls were not usable.
 */
describe('the controls behave like controls', () => {
  const labelled = (label: string) =>
    [...host.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.getAttribute('aria-label') === label
    )!

  it('keeps focus in a list row across a whole number, one keystroke at a time', async () => {
    const root = await mountPlanner()
    buttonByTestId(root, 'retirement-mode-advanced')!.click()
    await flush()
    buttonByTestId(root, 'retirement-add-step')!.click()
    await flush()

    const field = labelled('Monthly income from then')
    field.focus()
    const nodeAtStart = field

    // Typing "4500" is four separate input events, and every one of them rewrites the
    // array behind the row. Keyed by reference, <For> would rebuild the row each time and
    // the caret would land back on the body after the first digit.
    for (const text of ['4', '45', '450', '4500']) {
      await type(labelled('Monthly income from then'), text)
      expect(document.activeElement).toBe(nodeAtStart)
      expect(labelled('Monthly income from then')).toBe(nodeAtStart)
    }

    expect(nodeAtStart.value).toBe('4500')
  })

  it('keeps focus while editing a lifestyle name', async () => {
    await mountPlanner()
    const field = labelled('Lifestyle name')
    field.focus()

    for (const text of ['C', 'Co', 'Cos', 'Cosy']) {
      await type(labelled('Lifestyle name'), text)
      expect(document.activeElement).toBe(field)
    }
    expect(field.value).toBe('Cosy')
  })

  it('lets a number field be emptied instead of snapping back to 0', async () => {
    const root = await mountPlanner()
    const netWorth = inputByTestId(root, 'retirement-input-networth')!
    await type(netWorth, '5000')
    expect(netWorth.value).toBe('5000')

    await type(netWorth, '')
    // The box stays empty while it has focus. Writing "0" back under the caret is what
    // made this field impossible to retype.
    expect(netWorth.value).toBe('')

    netWorth.dispatchEvent(new Event('blur', { bubbles: true }))
    await flush()
    expect(netWorth.value).toBe('0')
  })

  it('lets a decimal be typed without the field rewriting itself', async () => {
    const root = await mountPlanner()
    const swr = inputByTestId(root, 'retirement-input-swr')!

    for (const text of ['3', '3.7', '3.75']) {
      await type(swr, text)
      expect(swr.value).toBe(text)
    }
  })

  it('leaves a half-typed number alone instead of clearing it', async () => {
    const root = await mountPlanner()
    const swr = inputByTestId(root, 'retirement-input-swr')!

    // Mid-way through "3.75" the text reads "3." — which a number input reports as an
    // empty value while still showing the "3." to the user. Writing anything back here is
    // what used to eat the keystroke.
    swr.focus()
    swr.value = ''
    swr.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(swr.value).toBe('')

    await type(swr, '3.75')
    expect(swr.value).toBe('3.75')
  })

  it('picks a birth year in one gesture, without stepping through decades', async () => {
    const root = await mountPlanner()
    const picker = byTestId(root, 'retirement-input-birth')!
    const [monthSel, yearSel] = [...picker.querySelectorAll<HTMLSelectElement>('select')]

    // The whole point: 1950 is present as an option, not something you scroll back to.
    expect([...yearSel.options].some((o) => o.value === '1950')).toBe(true)
    expect([...monthSel.options].map((o) => o.textContent)).toContain('September')

    await pickMonth(picker, '1950-09')
    expect(yearSel.value).toBe('1950')
    expect(monthSel.value).toBe('9')
    expect(inputByTestId(root, 'retirement-input-life')!.disabled).toBe(false)
  })

  it('saves an auto-filled contribution rather than rejecting it as invalid', async () => {
    // What the derivation produced from real data: an average of money, which is a
    // division, which is not a round number. `step="0.01"` then marked the field invalid
    // and the save bounced.
    serverSettings = { monthlyContribution: 7.292500000001382 }
    const root = await mountPlanner()

    const field = inputByTestId(root, 'retirement-input-contribution')!
    expect(field.value).toBe('7.29')
    // `step="0.01"` makes 7.292500000001382 invalid, and one invalid field blocks the
    // whole form: the submit button does nothing and the browser puts a bubble on a
    // number the user never typed.
    expect(field.checkValidity()).toBe(true)
    expect(field.closest('form')!.checkValidity()).toBe(true)

    // Saving is gated on having changed something, so change something.
    await type(inputByTestId(root, 'retirement-input-networth')!, '1000')
    buttonByTestId(root, 'retirement-save-settings')!.click()
    await flush()
    expect(apiPut).toHaveBeenCalled()
    expect(apiPut.mock.calls[0][1].monthlyContribution).toBeCloseTo(7.29, 10)
  })
})

/**
 * Pages stay mounted since the keep-alive host (#317) — they are hidden with CSS, not
 * unmounted — so an onMount loader fires once for the whole session. Switching profile in
 * the sidebar left this panel showing the previous profile's plan until the page was
 * reloaded by hand.
 */
describe('a profile switch reloads the plan', () => {
  it('re-asks the server when the active profile changes', async () => {
    serverSettings = { netWorth: 1000 }
    const root = await mountPlanner()
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(inputByTestId(root, 'retirement-input-networth')!.value).toBe('1000')

    // The other profile's saved plan.
    serverSettings = { netWorth: 250000 }
    bumpProfileVersion()
    await flush()
    await flush()

    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(inputByTestId(root, 'retirement-input-networth')!.value).toBe('250000')
  })

  it('does not refetch while the page is hidden, and catches up on return', async () => {
    serverSettings = { netWorth: 1000 }
    const root = await mountPlanner()
    expect(apiGet).toHaveBeenCalledTimes(1)

    // Away on another page: a switch there must not fan out a fetch from every mounted page.
    setPage('dashboard')
    await flush()
    serverSettings = { netWorth: 777 }
    bumpProfileVersion()
    await flush()
    expect(apiGet).toHaveBeenCalledTimes(1)

    setPage('retirement')
    await flush()
    await flush()
    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(inputByTestId(root, 'retirement-input-networth')!.value).toBe('777')
  })

  it('leaves unsaved edits alone when nothing changed profile', async () => {
    const root = await mountPlanner()
    await type(inputByTestId(root, 'retirement-input-networth')!, '4242')
    setPage('dashboard')
    await flush()
    setPage('retirement')
    await flush()
    // A plain revisit is not a refetch — that is what keeps navigation instant, and it is
    // also what stops a typed-but-unsaved figure being thrown away.
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(inputByTestId(root, 'retirement-input-networth')!.value).toBe('4242')
  })
})
