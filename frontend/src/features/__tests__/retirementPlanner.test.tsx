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
let serverFilledAfterSave: { field: string; value: number | string; source: string }[] = []
const apiPut = vi.fn(async (_path: string, body: RetirementSettings) => ({
  settings: body,
  filled: serverFilledAfterSave,
}))
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
let lastChartOptions: any = null
let lastChartPlugins: any = null
vi.mock('../../components/Chart', async () => {
  const { createEffect } = await import('solid-js')
  return {
    default: (props: any) => {
      createEffect(() => {
        lastChartData = props.data
        lastChartOptions = props.options
        lastChartPlugins = props.plugins
      })
      // Zoom gestures anchor on the x scale, so the stand-in has to answer for one: a
      // 600px plot over whatever range the options currently ask for.
      props.onReady?.({
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 280 }) },
        scales: {
          x: {
            width: 600,
            getValueForPixel: (px: number) => {
              const points = (lastChartData?.labels?.length ?? 1) - 1
              const min = lastChartOptions?.scales?.x?.min ?? 0
              const max = lastChartOptions?.scales?.x?.max ?? points
              return min + (px / 600) * (max - min)
            },
          },
        },
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
  serverFilledAfterSave = []
  lastChartData = null
  lastChartOptions = null
  lastChartPlugins = null
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

/** Every toggle on the page is now a branded switch, so they are pressed, not checked. */
function switchByTestId(root: HTMLElement, id: string): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[role="switch"][data-test-id="${id}"]`)!
}

const isOn = (toggle: HTMLButtonElement) => toggle.getAttribute('aria-checked') === 'true'

async function flip(toggle: HTMLButtonElement, on: boolean) {
  if (isOn(toggle) !== on) toggle.click()
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
    await flip(switchByTestId(root, 'retirement-toggle-inflation'), false)
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

    await flip(switchByTestId(root, 'retirement-toggle-nominal'), true)

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

    await flip(switchByTestId(root, 'retirement-toggle-nominal'), true)
    const rising = lastChartData.datasets[lastChartData.datasets.length - 1].data
    expect(rising[rising.length - 1]).toBeGreaterThan(rising[0])
  })
})

describe('the return band', () => {
  it('adds a better and a worse line either side of the plan', async () => {
    const root = await mountPlanner()
    const plain = lastChartData.datasets.length

    await flip(switchByTestId(root, 'retirement-toggle-band'), true)
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

    // The explanation now lives behind the field's info tip, so it costs no layout and
    // does not shove the control out of line with its neighbour. Opening it is what
    // makes the sentence readable, so that is what the test does.
    const tip = byTestId(root, 'retirement-life-needs-birth')!
    tip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(byTestId(root, 'retirement-life-needs-birth-panel')!.textContent).toContain(
      'date of birth'
    )

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

describe('the withdrawal rate says what it costs', () => {
  const chip = (root: HTMLElement) => byTestId(root, 'retirement-runway-chip')!

  it('says the money never runs out while growth covers the draw', async () => {
    // 4% against a 4.39% real return: the pot earns more than it gives up.
    serverSettings = { safeWithdrawalRatePct: 4, annualReturnPct: 7, annualInflationPct: 2.5 }
    const root = await mountPlanner()
    expect(chip(root).textContent).toContain('for as long as you like')
  })

  it('counts the years it does last once the draw outpaces growth', async () => {
    serverSettings = { safeWithdrawalRatePct: 12, annualReturnPct: 7, annualInflationPct: 2.5 }
    const root = await mountPlanner()
    // ln(0.12 / (0.12 - 0.043902)) / ln(1.043902) = 10.6 years.
    expect(chip(root).textContent).toContain('11 years')
    expect(chip(root).textContent).toContain('runs out')
  })

  it('names the age the money runs out at, when there is an age to count to', async () => {
    serverSettings = {
      safeWithdrawalRatePct: 12,
      annualReturnPct: 7,
      annualInflationPct: 2.5,
      birthMonth: '1995-10',
      netWorth: 50000,
      monthlyContribution: 1000,
    }
    const root = await mountPlanner()
    expect(chip(root).textContent).toMatch(/around age \d+/)
  })

  it('changes its mind as the slider is dragged past the real return', async () => {
    serverSettings = { safeWithdrawalRatePct: 4, annualReturnPct: 7, annualInflationPct: 2.5 }
    const root = await mountPlanner()
    expect(chip(root).textContent).toContain('for as long as you like')

    const slider = inputByTestId(root, 'retirement-slider-swr')!
    slider.value = '9'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(chip(root).textContent).toContain('runs out')
  })

  it('drives the same value from the slider and the number box', async () => {
    const root = await mountPlanner()
    const slider = inputByTestId(root, 'retirement-slider-swr')!
    const box = inputByTestId(root, 'retirement-input-swr')!

    slider.value = '6.5'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(box.value).toBe('6.5')

    // A figure the slider's tenths cannot land on is still allowed: the box is there for
    // exactly that, and the slider follows as closely as it can.
    await type(box, '3.25')
    expect(Number(slider.value)).toBeCloseTo(3.25, 2)
    expect(byTestId(root, 'retirement-assumptions')!.textContent).not.toContain('NaN')
  })

  it('rounds what the slider emits, so the field can still be saved', async () => {
    const root = await mountPlanner()
    const slider = inputByTestId(root, 'retirement-slider-swr')!
    slider.value = '4.3'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    // A step-invalid value blocks the whole form from submitting, so the emitted number
    // has to stay a clean two decimals.
    expect(inputByTestId(root, 'retirement-input-swr')!.value).toBe('4.3')
  })

  it('explains itself in a tip rather than in a line that shifts the form', async () => {
    const root = await mountPlanner()
    // No hint element under the control: the explanation costs the layout nothing until
    // it is asked for. That is what stopped the field falling out of line with its
    // neighbour in the same row.
    byTestId(root, 'retirement-info-swr')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    const text = document.querySelector('[data-test-id="retirement-info-swr-panel"]')!.textContent!
    expect(text).toContain('25x your annual spending')
    expect(text).toContain('not more money to live on')
  })
})

describe('the chart marks when each lifestyle is reached', () => {
  const markers = () => lastChartOptions?.plugins?.lifestyleMarkers?.markers ?? []
  const markerToggle = (root: HTMLElement) => switchByTestId(root, 'retirement-toggle-markers')
  const lifestyleSpend = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.getAttribute('aria-label') === "Monthly spending in today's money"
    )!

  it('registers the marker plugin with the chart', async () => {
    await mountPlanner()
    expect(lastChartPlugins?.[0]?.id).toBe('lifestyleMarkers')
  })

  it('marks each lifestyle that is reached, on by default', async () => {
    serverSettings = {
      netWorth: 50000,
      monthlyContribution: 1500,
      lifestyles: [
        { id: 'a', label: 'Lean', monthlySpendToday: 1000 },
        { id: 'b', label: 'Comfortable', monthlySpendToday: 2000 },
      ],
    }
    const root = await mountPlanner()
    expect(isOn(markerToggle(root))).toBe(true)
    expect(markers().map((m: { label: string }) => m.label)).toEqual(['Lean', 'Comfortable'])
  })

  it('places a marker at the month of the crossing, not the nearest year', async () => {
    serverSettings = { netWorth: 50000, monthlyContribution: 1500 }
    await mountPlanner()
    const x = markers()[0].x
    expect(Number.isInteger(x)).toBe(false)
    expect(x).toBeGreaterThan(0)
  })

  it('gives each lifestyle the colour of its own target line', async () => {
    serverSettings = {
      netWorth: 50000,
      monthlyContribution: 2000,
      lifestyles: [
        { id: 'a', label: 'Lean', monthlySpendToday: 800 },
        { id: 'b', label: 'Rich', monthlySpendToday: 1200 },
      ],
    }
    await mountPlanner()
    const targetLines = lastChartData.datasets.filter((d: { label: string }) =>
      d.label.endsWith(' target')
    )
    expect(markers().map((m: { color: string }) => m.color)).toEqual(
      targetLines.map((d: { borderColor: string }) => d.borderColor)
    )
  })

  it('marks nothing for a lifestyle the plan never reaches', async () => {
    serverSettings = {
      netWorth: 0,
      monthlyContribution: 0,
      lifestyles: [{ id: 'a', label: 'Never', monthlySpendToday: 9000 }],
    }
    await mountPlanner()
    expect(markers()).toEqual([])
  })

  it('clears the markers when the toggle is turned off', async () => {
    serverSettings = { netWorth: 50000, monthlyContribution: 1500 }
    const root = await mountPlanner()
    expect(markers().length).toBe(1)

    await flip(markerToggle(root), false)
    // Emptied rather than removed: the plugin instance is shared across chart updates and
    // only its options change, so an absent key would leave the last markers drawn.
    expect(markers()).toEqual([])
  })

  it('follows an edit to a lifestyle without a reload', async () => {
    serverSettings = { netWorth: 50000, monthlyContribution: 1500 }
    const root = await mountPlanner()
    const before = markers()[0].x

    await type(lifestyleSpend(root), '4000')
    expect(markers()[0].x).toBeGreaterThan(before)
  })
})

describe('what was filled in from your data stops being claimed once you save it', () => {
  it('takes the provenance back from the save, not from the last load', async () => {
    serverFilled = [
      { field: 'monthlyContribution', value: 7.29, source: 'Income minus spending over 12 months' },
    ]
    const root = await mountPlanner()
    expect(byTestId(root, 'retirement-derived-note')!.textContent).toContain('Monthly contribution')

    await type(inputByTestId(root, 'retirement-input-contribution')!, '500')
    serverFilledAfterSave = []
    buttonByTestId(root, 'retirement-save-settings')!.click()
    await flush()
    await flush()
    // Saving is exactly what stops a field being derived. Leaving the note up would go on
    // crediting "your data" for a figure the user had just typed.
    expect(byTestId(root, 'retirement-derived-note')).toBeNull()
  })

  it('keeps showing whatever the save says is still derived', async () => {
    serverFilled = [{ field: 'netWorth', value: 1, source: 'Total of your accounts' }]
    const root = await mountPlanner()
    await type(inputByTestId(root, 'retirement-input-contribution')!, '500')
    serverFilledAfterSave = [{ field: 'birthMonth', value: '1994-01', source: 'Age 32 on a goal' }]
    buttonByTestId(root, 'retirement-save-settings')!.click()
    await flush()
    await flush()
    const note = byTestId(root, 'retirement-derived-note')!
    expect(note.textContent).toContain('Date of birth')
    expect(note.textContent).not.toContain('Current net worth')
  })

  it('sends the contribution it was given back unchanged', async () => {
    const root = await mountPlanner()
    await type(inputByTestId(root, 'retirement-input-contribution')!, '500')
    buttonByTestId(root, 'retirement-save-settings')!.click()
    await flush()
    // The reported bug: a contribution of exactly the default is a real answer, and has
    // to reach the server as one.
    expect(apiPut.mock.calls[0][1].monthlyContribution).toBe(500)
  })
})

describe('the chart can be zoomed into a few years', () => {
  const xScale = () => lastChartOptions.scales.x
  const wheel = (root: HTMLElement, deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaY, clientX: 300, bubbles: true, cancelable: true })
    byTestId(root, 'retirement-chart')!.dispatchEvent(event)
    return event
  }

  it('starts showing the whole projection', async () => {
    const root = await mountPlanner()
    expect(xScale().min).toBeUndefined()
    expect(xScale().max).toBeUndefined()
    expect(byTestId(root, 'retirement-zoom-reset')).toBeNull()
  })

  it('narrows the axis on a scroll, and says so with a way back', async () => {
    const root = await mountPlanner()
    wheel(root, -120)
    await flush()

    const span = xScale().max - xScale().min
    expect(span).toBeGreaterThan(0)
    expect(span).toBeLessThan(netWorthSeries().length - 1)
    expect(byTestId(root, 'retirement-zoom-reset')).not.toBeNull()
  })

  it('keeps narrowing as the scrolling continues', async () => {
    const root = await mountPlanner()
    wheel(root, -120)
    await flush()
    const first = xScale().max - xScale().min

    for (let i = 0; i < 4; i++) wheel(root, -120)
    await flush()
    expect(xScale().max - xScale().min).toBeLessThan(first)
  })

  it('swallows the scroll while zooming, so the page does not run away underneath', async () => {
    const root = await mountPlanner()
    expect(wheel(root, -120).defaultPrevented).toBe(true)
  })

  it('keeps the wheel even when there is nothing left to zoom out of', async () => {
    // Handing the gesture back at the extreme reads as the page lurching out from under
    // you mid-scroll. Moving off the chart is what returns the wheel to the page.
    const root = await mountPlanner()
    expect(wheel(root, 120).defaultPrevented).toBe(true)
    expect(xScale().min).toBeUndefined()
  })

  it('goes back to the whole projection from the reset button', async () => {
    const root = await mountPlanner()
    for (let i = 0; i < 3; i++) wheel(root, -120)
    await flush()
    expect(xScale().min).not.toBeUndefined()

    buttonByTestId(root, 'retirement-zoom-reset')!.click()
    await flush()
    expect(xScale().min).toBeUndefined()
    expect(byTestId(root, 'retirement-zoom-reset')).toBeNull()
  })

  it('goes back on a double-click, which is what people try first', async () => {
    const root = await mountPlanner()
    for (let i = 0; i < 3; i++) wheel(root, -120)
    await flush()

    byTestId(root, 'retirement-chart')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    expect(xScale().min).toBeUndefined()
  })

  it('pulls the view back inside a projection that got shorter', async () => {
    serverSettings = { birthMonth: '1994-01', lifeExpectancyAge: 95 }
    const root = await mountPlanner()
    for (let i = 0; i < 6; i++) wheel(root, -120)
    await flush()
    const long = netWorthSeries().length

    await type(inputByTestId(root, 'retirement-input-life')!, '60')
    const short = netWorthSeries().length
    expect(short).toBeLessThan(long)
    // The window has to follow the data, not point past the end of it.
    expect(xScale().max).toBeLessThanOrEqual(short - 1)
  })

  it('leaves the markers on their crossings while zoomed', async () => {
    serverSettings = { netWorth: 50000, monthlyContribution: 1500 }
    const root = await mountPlanner()
    const before = lastChartOptions.plugins.lifestyleMarkers.markers[0].x

    for (let i = 0; i < 3; i++) wheel(root, -120)
    await flush()
    // Zoom moves the scale, not the data, so a marker stays at the month it belongs to.
    expect(lastChartOptions.plugins.lifestyleMarkers.markers[0].x).toBe(before)
  })
})

describe('zoom gestures beyond the wheel', () => {
  const xScale = () => lastChartOptions.scales.x
  const chartEl = (root: HTMLElement) => byTestId(root, 'retirement-chart')!
  const pointer = (type: string, id: number, clientX: number) =>
    new PointerEvent(type, { pointerId: id, clientX, bubbles: true, cancelable: true })

  const pinch = (root: HTMLElement, from: [number, number], to: [number, number]) => {
    const el = chartEl(root)
    el.dispatchEvent(pointer('pointerdown', 1, from[0]))
    el.dispatchEvent(pointer('pointerdown', 2, from[1]))
    el.dispatchEvent(pointer('pointermove', 1, to[0]))
    el.dispatchEvent(pointer('pointermove', 2, to[1]))
    el.dispatchEvent(pointer('pointerup', 1, to[0]))
    el.dispatchEvent(pointer('pointerup', 2, to[1]))
  }

  it('zooms in when two fingers move apart', async () => {
    const root = await mountPlanner()
    pinch(root, [250, 350], [100, 500])
    await flush()
    expect(xScale().max - xScale().min).toBeLessThan(netWorthSeries().length - 1)
  })

  it('zooms back out when they come together', async () => {
    const root = await mountPlanner()
    pinch(root, [250, 350], [50, 550])
    await flush()
    const zoomedIn = xScale().max - xScale().min

    pinch(root, [50, 550], [280, 320])
    await flush()
    expect(xScale().min === undefined || xScale().max - xScale().min > zoomedIn).toBe(true)
  })

  it('drags the view sideways once there is somewhere to drag to', async () => {
    const root = await mountPlanner()
    for (let i = 0; i < 5; i++) {
      chartEl(root).dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, clientX: 500, bubbles: true, cancelable: true })
      )
    }
    await flush()
    const before = xScale().min

    const el = chartEl(root)
    el.dispatchEvent(pointer('pointerdown', 1, 400))
    el.dispatchEvent(pointer('pointermove', 1, 300))
    el.dispatchEvent(pointer('pointerup', 1, 300))
    await flush()
    // Dragging left walks the window forward through the projection.
    expect(xScale().min).toBeGreaterThan(before)
  })

  it('ignores a drag while the whole projection is showing', async () => {
    const root = await mountPlanner()
    const el = chartEl(root)
    el.dispatchEvent(pointer('pointerdown', 1, 400))
    el.dispatchEvent(pointer('pointermove', 1, 200))
    el.dispatchEvent(pointer('pointerup', 1, 200))
    await flush()
    // A page that scrolls under your finger matters more than a pan with nowhere to go.
    expect(xScale().min).toBeUndefined()
  })

  it('does not start a gesture from a right click', async () => {
    const root = await mountPlanner()
    const el = chartEl(root)
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 9,
        button: 2,
        pointerType: 'mouse',
        clientX: 400,
        bubbles: true,
      })
    )
    el.dispatchEvent(pointer('pointermove', 9, 100))
    await flush()
    expect(xScale().min).toBeUndefined()
  })
})
