/**
 * A loan card opens its payments on a chart under it, and its "…" menu reaches the rest: an extra
 * payment straight away, every payment, Edit and Delete.
 *
 * Local-first (the IndexedDB router): each case makes its own loans in its own browser, so the
 * Worker's shared fixture keeps its one loan and nothing needs sweeping. The cards and the chart
 * are the same code in both modes; the loan the chart has to fetch when signed in is covered by
 * src/features/loans/__tests__/loansPage.test.tsx.
 */
import { expect, test } from '@playwright/test'
import { gotoServerless } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

/** The setup wizard can open over local-first's demo: leave it each time it shows up. */
async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByTestId('confirm-accept')
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

/** The first of the month `months` months ago, so a payment is made on it every month since. */
function monthsAgo(months: number): string {
  const now = new Date()
  const at = new Date(now.getFullYear(), now.getMonth() - months, 1)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-01`
}

// Three made-up loans part way through: A has made 15 of its 60 payments, B 7 of 36, C 31 of 120.
const LOANS = [
  {
    name: 'zz-chart-a',
    principal: 18000,
    interest_rate: 5,
    term_months: 60,
    start_date: monthsAgo(14),
  },
  {
    name: 'zz-chart-b',
    principal: 9000,
    interest_rate: 7,
    term_months: 36,
    start_date: monthsAgo(6),
  },
  // Six figures owed: the widest amount a card has to keep on one line on a phone.
  {
    name: 'zz-chart-c',
    principal: 300000,
    interest_rate: 4,
    term_months: 120,
    start_date: monthsAgo(30),
  },
]

const card = (page: Page, name: string): Locator =>
  page.getByTestId('loans-item').filter({
    has: page.getByTestId('loans-item-name').getByText(name, { exact: true }),
  })
const toggle = (page: Page, name: string): Locator =>
  card(page, name).getByTestId('loans-item-name')
const chart = (page: Page): Locator => page.getByTestId('loans-item-chart')
const menu = (page: Page): Locator => page.getByTestId('loans-menu')

/** Saved through the app's own client, so the page reads its list again as after any write. */
async function addLoans(page: Page, loans: typeof LOANS = LOANS): Promise<void> {
  await page.evaluate(async (loans) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      apiPost: (url: string, body: unknown) => Promise<unknown>
    }
    for (const loan of loans) await mod.apiPost('/api/loans', loan)
  }, loans)
  for (const loan of loans) await expect(card(page, loan.name)).toHaveCount(1, { timeout: 15_000 })
}

// Seven figures owed, made up: the widest amounts the chart's figures have to fit beside each other.
const BIG = {
  name: 'zz-chart-big',
  principal: 1_250_000,
  interest_rate: 3.5,
  term_months: 300,
  start_date: monthsAgo(23),
}

/**
 * How the open chart sits in its box: how far anything in it reaches past the box's border, how
 * far the page scrolls sideways, how far the drawing's width is from its wrap's, how many of the
 * four figures broke onto a second line, and, when the sentence on top wraps, whether its last
 * line is at least half its longest (a word or two alone on the last line is a short one).
 */
function chartFit(page: Page) {
  return chart(page).evaluate((panel) => {
    const box = panel.firstElementChild as HTMLElement
    const style = window.getComputedStyle(box)
    const edge = box.getBoundingClientRect()
    const left = edge.left + parseFloat(style.borderLeftWidth)
    const right = edge.right - parseFloat(style.borderRightWidth)
    let past = 0
    for (const el of box.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      past = Math.max(past, r.right - right, left - r.left)
    }
    const wrapped = [...box.querySelectorAll('[data-test-id="loans-chart-readout"] dd')].filter(
      (dd) =>
        dd.getBoundingClientRect().height > 1.5 * parseFloat(window.getComputedStyle(dd).lineHeight)
    ).length
    const svg = box.querySelector('[data-test-id="loans-payoff-chart"]')!
    const sentence = box.querySelector('[data-test-id="loans-chart-sentence"]')!
    const range = document.createRange()
    range.selectNodeContents(sentence)
    const lines = new Map<number, number>()
    for (const r of range.getClientRects()) {
      const top = Math.round(r.top)
      lines.set(top, (lines.get(top) ?? 0) + r.width)
    }
    const widths = [...lines.values()]
    return {
      past: Math.max(0, Math.round(past)),
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      drawing: Math.abs(
        Math.round(svg.getBoundingClientRect().width - svg.parentElement!.clientWidth)
      ),
      wrapped,
      lastLine: widths.length > 1 ? widths[widths.length - 1] / Math.max(...widths) >= 0.5 : true,
    }
  })
}

interface Box {
  name: string
  x: number
  y: number
  w: number
  h: number
}

/** Each card where it sits on the page, not on the screen, which scrolls as a chart opens. */
function cardBoxes(page: Page): Promise<Box[]> {
  return page.getByTestId('loans-item').evaluateAll((cards) =>
    cards.map((c) => {
      const r = c.getBoundingClientRect()
      return {
        name: c.querySelector('[data-test-id="loans-item-name"]')?.textContent ?? '',
        x: Math.round(r.x + window.scrollX),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    })
  )
}

test.describe('the chart under a loan card', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000)
    await leaveOnboarding(page)
    await gotoServerless(page, 'loans', 'loans-header')
    await addLoans(page)
  })

  test('opens under its row with the cards beside it where they were, and closes again @smoke', async ({
    page,
  }) => {
    const before = await cardBoxes(page)
    // The first card of a row with another card beside it: the chart goes in after it, and the
    // other cards of the row have to stay above the chart.
    const first = before.find(
      (b) =>
        before.some((o) => o.y === b.y && o.x > b.x) &&
        !before.some((o) => o.y === b.y && o.x < b.x)
    )
    expect(first, `a row of two cards in ${JSON.stringify(before)}`).toBeTruthy()
    const row = before.filter((b) => b.y === first!.y)
    const opener = toggle(page, first!.name)

    await opener.click()
    await expect(chart(page)).toBeVisible()
    await expect(opener).toHaveAttribute('aria-expanded', 'true')
    await expect(opener).toHaveAttribute('aria-controls', (await chart(page).getAttribute('id'))!)

    const after = await cardBoxes(page)
    for (const b of before.filter((c) => c.y <= first!.y)) {
      expect(
        after.find((a) => a.name === b.name),
        `${b.name} stays where it was`
      ).toEqual(b)
    }
    const panel = await chart(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(r.x + window.scrollX),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
      }
    })
    const left = Math.min(...before.map((b) => b.x))
    const right = Math.max(...before.map((b) => b.x + b.w))
    expect(panel.y).toBeGreaterThan(Math.max(...row.map((b) => b.y + b.h)))
    expect(panel.x).toBe(left)
    expect(panel.w).toBe(right - left)

    await page.keyboard.press('Escape')
    await expect(chart(page)).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect(opener).toHaveAttribute('aria-expanded', 'false')

    await opener.click()
    await expect(chart(page)).toBeVisible()
    await opener.click()
    await expect(chart(page)).toHaveCount(0)
  })

  test('marks today on the line and says how far along the loan is @smoke', async ({ page }) => {
    await toggle(page, 'zz-chart-a').click()
    await expect(page.getByTestId('loans-chart-sentence')).toHaveText(
      /^15 of 60 payments made\. The last is due in [A-Z][a-z]+ \d{4}\.$/
    )
    await expect(page.getByTestId('loans-chart-left')).toHaveText('45')
    await expect(page.getByTestId('loans-payoff-today')).toBeVisible()
    await expect(page.getByTestId('loans-payoff-today')).toHaveText('Today')
    await expect(page.getByTestId('loans-payoff-end')).not.toHaveAttribute('data-paid', '')

    // One chart at a time.
    await toggle(page, 'zz-chart-c').click()
    await expect(chart(page)).toHaveCount(1)
    await expect(page.getByTestId('loans-chart-sentence')).toHaveText(/^31 of 120 payments made/)
    await expect(toggle(page, 'zz-chart-a')).toHaveAttribute('aria-expanded', 'false')
  })

  test('the card menu adds an extra payment straight away, from the keyboard @smoke', async ({
    page,
  }) => {
    const trigger = card(page, 'zz-chart-b').getByTestId('loans-item-menu')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
    await expect(page.getByTestId('loans-item-add-extra')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('loans-item-schedule')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(trigger).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(page.getByTestId('loans-item-add-extra')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#loans\/\d+\/extras(\?|$)/)
    await expect(page.getByTestId('loans-extra-amount')).toBeFocused()

    await page.keyboard.type('500')
    await page.getByTestId('loans-extra-month').selectOption('20')
    await page.getByTestId('loans-extra-add').click()
    await expect(page.getByTestId('loans-extra-item')).toHaveCount(1)

    // Back on the cards, the chart marks it as planned.
    await page.goBack()
    await expect(page).toHaveURL(/#loans(\?|$)/)
    await toggle(page, 'zz-chart-b').click()
    await expect(page.getByTestId('loans-payoff-extra')).toHaveCount(1)
    await expect(page.getByTestId('loans-payoff-extra')).toHaveAttribute('data-made', 'false')
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('the chart opens straight under its card and in view, and the menu stays open @smoke', async ({
      page,
    }) => {
      // Every amount on a card on one line.
      const lines = await card(page, 'zz-chart-c')
        .getByTestId('loans-item-details')
        .locator('dd')
        .evaluateAll((dds) =>
          dds.map(
            (dd) =>
              dd.getBoundingClientRect().height / parseFloat(window.getComputedStyle(dd).lineHeight)
          )
        )
      for (const n of lines) expect(n).toBeLessThan(1.5)

      await toggle(page, 'zz-chart-b').tap()
      await expect(chart(page)).toBeVisible()
      expect(
        await chart(page).evaluate(
          (el) =>
            el.previousElementSibling?.querySelector('[data-test-id="loans-item-name"]')
              ?.textContent
        )
      ).toBe('zz-chart-b')
      // All of it brought into view, clear of the floating add button, its card still on screen
      // above it.
      const fab = page.getByRole('button', { name: 'Quick add entry' })
      const fabTop = (await fab.boundingBox())!.y
      await expect
        .poll(() => chart(page).evaluate((el) => Math.round(el.getBoundingClientRect().bottom)))
        .toBeLessThanOrEqual(fabTop)
      expect(
        await card(page, 'zz-chart-b').evaluate((el) => el.getBoundingClientRect().top)
      ).toBeGreaterThanOrEqual(0)

      await card(page, 'zz-chart-c').getByTestId('loans-item-menu').tap()
      await expect(menu(page)).toBeVisible()
      // Still open a few frames on, when the scroll events of the tap have all come in.
      await page.evaluate(
        () =>
          new Promise<void>((done) => {
            let frames = 0
            const tick = () => {
              if (++frames < 5) requestAnimationFrame(tick)
              else done()
            }
            requestAnimationFrame(tick)
          })
      )
      await expect(menu(page)).toBeVisible()
      await page.getByTestId('loans-item-schedule').tap()
      await expect(page).toHaveURL(/#loans\/\d+\/schedule(\?|$)/)
    })
  })
})

test.describe('the chart at any width', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000)
    await leaveOnboarding(page)
    await gotoServerless(page, 'loans', 'loans-header')
    await addLoans(page, [BIG])
  })

  // From a wide screen through a tablet with the sidebar shown (820 px leaves the box 426 px) to a
  // phone: the four figures, Close and the drawing stay inside the box, and the sentence on top
  // leaves no word or two alone on its last line.
  test('keeps its figures, its Close and its drawing inside its box @smoke', async ({ page }) => {
    for (const width of [1440, 1024, 900, 820, 768, 700, 600, 561, 480, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const opener = toggle(page, BIG.name)
      if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click()
      await expect(page.getByTestId('loans-payoff-chart')).toBeVisible()
      await expect
        .poll(() => chartFit(page), { message: `the chart at ${width} px` })
        .toEqual({ past: 0, sideways: 0, drawing: 0, wrapped: 0, lastLine: true })
    }
  })
})
