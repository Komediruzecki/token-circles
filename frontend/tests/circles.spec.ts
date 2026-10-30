/**
 * The seven circles on Progress, in both storage modes: Your next step over the ledger, each
 * circle's row with the person's own figure, a circle's own view at `#progress/<n>`, and the card
 * question answered there, kept through a reload and listed in Settings, About this space.
 *
 * The statement is generated here, relative to today: the last twelve full months, each with a
 * salary of 3,000, a rent of 1,000 and two grocery runs of 200. So a year is on file, all of it
 * sorted, own income covers the 1,400 spent a month, and with 2,800 in a savings account the money
 * in reach covers two months of essentials: the fourth circle, Solid ground, is the one being
 * worked on. Round invented values; nothing here is anyone's.
 */
import { expect, test } from '@playwright/test'
import { viaApp } from './form-errors-helpers'
import { bootSignedIn, deleteAccount, signUpAndIn } from './own-account'
import { E2E_BASE, gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

/** 'YYYY-MM' `n` months before this one. */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const YEAR = [
  'Date,Description,Amount,Category,Type',
  ...[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].flatMap((n) => {
    const m = monthsAgo(n)
    return [
      `${m}-01,Salary,3000.00,Salary,income`,
      `${m}-02,Flat rent,-1000.00,Rent,expense`,
      `${m}-10,Corner market,-200.00,Groceries,expense`,
      `${m}-21,Corner market,-200.00,Groceries,expense`,
    ]
  }),
].join('\n')

/** The rows' figures, circle by circle, for the year above and 2,800 in reach. */
const ROWS = [
  { state: 'reached', key: '12 of 12 months on file' },
  { state: 'reached', key: 'Own income covers 214% of spending' },
  { state: 'reached', key: '2 months of essentials' },
  { state: 'current', key: '2 of 3 months put by' },
  { state: 'later', key: 'Two years of spending: €33,600' },
  { state: 'later', key: '25 years of spending: €420,000' },
  { state: 'later', key: 'Your own number' },
]

/** Import a generated statement on the Import page, as pasted CSV. */
async function importStatement(page: Page, statement: string, rows: number): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = 'import'
  })
  await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('import-tab-paste-csv').click()
  await page.getByTestId('import-paste-textarea').fill(statement)
  await page.getByTestId('import-paste-parse').click()
  await page.getByTestId('import-continue-mapping').click()
  await page.getByTestId('import-continue-preview').click()
  await expect(page.getByTestId('import-preview-total')).toHaveText(String(rows))
  await page.getByTestId('import-execute-all').click()
  await expect(page.getByTestId('import-result')).toContainText(`Imported ${rows}`, {
    timeout: 30_000,
  })
}

async function openProgress(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = 'progress'
  })
  await expect(page.getByTestId('progress-header')).toBeVisible({ timeout: 30_000 })
}

/** The rows' states and figures, read off the page. */
async function rowsShown(page: Page) {
  const out: Array<{ state: string | null; key: string | null }> = []
  for (const row of await page.locator('[data-circle-row]').all()) {
    const key = row.getByTestId('circle-row-key')
    out.push({
      state: await row.getAttribute('data-state'),
      key: (await key.count()) > 0 ? await key.textContent() : null,
    })
  }
  return out
}

/** Local-first, through setup's first two steps, which make the space, and skip the rest. */
async function aSpaceOnly(page: Page): Promise<void> {
  await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
}

/** The year imported, 2,800 put in a savings account, and Progress open on the circles. */
async function aYearInSolidGround(page: Page): Promise<void> {
  await importStatement(page, YEAR, 48)
  await viaApp(page, 'POST', '/api/accounts', {
    name: 'Rainy day',
    type: 'savings',
    starting_balance: 2800,
  })
  await openProgress(page)
  await expect.poll(() => rowsShown(page), { timeout: 30_000 }).toEqual(ROWS)

  const circles = page.locator('[data-tour="progress-circles"]')
  await expect(circles.getByTestId('progress-divider-circles')).toContainText('Circle 4 of 7')
  await expect(circles.getByTestId('circles-status')).toHaveText(
    "You're in the fourth circle: Solid ground.€1,400 to three months of essentials."
  )
  await expect(page.locator('[data-circle-row="4"] a')).toHaveAttribute(
    'aria-label',
    "Solid ground. You're here. 2 of 3 months put by."
  )

  const step = page.locator('[data-tour="progress-next-step"]').getByTestId('next-step-card')
  await expect(step.getByTestId('next-step-title')).toHaveText('Grow your cushion to three months')
  await expect(step.getByTestId('next-step-why')).toHaveText(
    '€1,400 to go: €2,800 you can reach, against €1,400 needed a month.'
  )
  await expect(step.getByTestId('next-step-action')).toHaveAttribute('href', '#goals')
  await expect(step.getByTestId('next-step-then')).toHaveText(
    'Then: grow your cushion to six months, and raise your savings rate by one point.'
  )
}

/** Open the fourth circle from its row, and go back to the list with Escape. */
async function openAndCloseSolidGround(page: Page): Promise<void> {
  await page.locator('[data-circle-row="4"] a').click()
  await expect(page).toHaveURL(/#progress\/4/)
  const view = page.getByTestId('circle-view')
  await expect(view.getByRole('heading', { level: 2 })).toHaveText('Solid ground')
  await expect(view.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(view).toContainText('Circle 4 of 7')
  await expect(view.getByTestId('next-step-title')).toHaveText('Grow your cushion to three months')
  await expect(page.getByTestId('progress-list')).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('circle-view')).toHaveCount(0)
  await expect(page.locator('[data-circle-row="4"] a')).toBeFocused()
}

/**
 * A card 300 below zero with no entries of its own: nothing shows whether its balance is carried,
 * so Solid ground's debt check waits on the card question. Answered in the circle's view, the
 * check is met, the answer survives a reload, and Settings, About this space lists it.
 */
async function answerTheCardQuestion(page: Page): Promise<void> {
  await viaApp(page, 'POST', '/api/accounts', {
    name: 'Travel card',
    type: 'credit',
    starting_balance: -300,
  })
  await openProgress(page)
  const step = page.locator('[data-tour="progress-next-step"]').getByTestId('next-step-card')
  await expect(step).toHaveAttribute('data-step', 'no-expensive-debt', { timeout: 30_000 })
  await expect(step.getByTestId('next-step-title')).toHaveText(
    'Do you carry a balance on a credit card or overdraft?'
  )

  await page.locator('[data-circle-row="4"] a').click()
  const view = page.getByTestId('circle-view')
  const debt = view.locator('[data-check="no-expensive-debt"]')
  await expect(debt).toHaveAttribute('data-state', 'not-known')
  await expect(debt.getByTestId('circle-check-waiting')).toHaveText('Waiting on your answer')
  await expect(debt.getByTestId('circle-check-detail')).toHaveText(
    'Travel card has too few entries to show whether you carry its €300.'
  )
  // Your next step asks it on this view, so the check does not ask it twice.
  await expect(debt.getByTestId('circle-card-choice')).toHaveCount(0)
  await view.getByTestId('next-step-choice').filter({ hasText: 'No' }).click()
  await expect(debt).toHaveAttribute('data-state', 'met', { timeout: 30_000 })
  const no = debt.getByTestId('circle-card-choice').filter({ hasText: 'No' }).locator('input')
  await expect(no).toBeChecked()

  await page.reload({ waitUntil: 'domcontentloaded' })
  const again = page.getByTestId('circle-view').locator('[data-check="no-expensive-debt"]')
  await expect(again).toHaveAttribute('data-state', 'met', { timeout: 30_000 })
  await expect(
    again.getByTestId('circle-card-choice').filter({ hasText: 'No' }).locator('input')
  ).toBeChecked()

  await page.evaluate(() => {
    window.location.hash = 'settings'
  })
  await expect(page.getByTestId('settings-header')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('settings-tab-general').click()
  const answer = page.getByTestId('settings-answer-card')
  await expect(answer).toContainText('Do you carry a balance on a credit card or overdraft?', {
    timeout: 30_000,
  })
  await expect(
    answer.getByTestId('settings-answer-card-choice').filter({ hasText: 'No' }).locator('input')
  ).toBeChecked()
}

test.describe('The seven circles @smoke', () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test('local-first: the ledger reads a year, and a circle opens from its row', async ({
    page,
  }) => {
    await aSpaceOnly(page)

    // Nothing on file yet: Getting started's first step, and the first circle "for now".
    await openProgress(page)
    const step = page.locator('[data-tour="progress-next-step"]').getByTestId('next-step-card')
    await expect(step.getByTestId('next-step-title')).toHaveText('Import a year of statements', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('progress-divider-circles')).toContainText(
      'For now: 0 of 12 months'
    )
    await expect(page.getByTestId('circles-waiting')).toHaveText(
      'Your figures appear once 3 months are tracked.'
    )

    await aYearInSolidGround(page)
    await openAndCloseSolidGround(page)
    await answerTheCardQuestion(page)
  })

  test("signed in: the ledger reads a year, and a circle's address survives a reload", async ({
    page,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await bootSignedIn(ctx)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-skip').click()
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

      await aYearInSolidGround(page)
      await openAndCloseSolidGround(page)

      await page.goto(`${E2E_BASE}/#progress/3`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const view = page.getByTestId('circle-view')
      await expect(view.getByRole('heading', { level: 2 })).toHaveText('Breathing room', {
        timeout: 30_000,
      })
      await expect(view).toContainText('Reached')
      await view.getByTestId('circle-back').click()
      await expect(page).toHaveURL(/#progress(\?|$)/)
      await expect(page.locator('[data-circle-row="3"] a')).toBeFocused()

      await answerTheCardQuestion(page)
    } finally {
      await deleteAccount(ctx, email)
    }
  })
})

test.describe('The seven circles, compared', () => {
  test('local-first: the cards carry a band and say where their figures come from, and ask how you live and who the space covers', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await aSpaceOnly(page)
    await aYearInSolidGround(page)

    await page.locator('[data-circle-row="4"] a').click()
    const compare = page.getByTestId('circle-view').getByTestId('circle-compare')
    await expect(compare.getByRole('heading', { level: 3 })).toHaveText('How you compare', {
      timeout: 30_000,
    })
    const cushion = compare.locator('[data-card="cushion"]')
    await expect(cushion.getByTestId('benchmark-title')).toHaveText(
      'Your cash covers 2 months of essentials'
    )
    await expect(cushion.locator('li[data-kind="band"]')).toHaveText('Typical')
    await expect(cushion.getByTestId('benchmark-bar')).toHaveAttribute(
      'aria-label',
      'Typical: 1 to 6 months. Yours: 2.'
    )
    const where = cushion.getByTestId('benchmark-where')
    await where.locator('summary').click()
    const links = where.locator('a')
    await expect(links.first()).toBeVisible()
    for (const href of await links.evaluateAll((all) =>
      all.map((link) => link.getAttribute('href'))
    )) {
      expect(href).toMatch(/^https:\/\//)
    }

    // Paying your way: rent is a third of take-home pay, and the housing card asks how you live.
    await page.evaluate(() => {
      window.location.hash = 'progress/2'
    })
    const paying = page.getByTestId('circle-view')
    await expect(paying.getByRole('heading', { level: 2 })).toHaveText('Paying your way')
    const housing = paying.locator('[data-card="housing"]')
    await expect(housing.getByTestId('benchmark-title')).toHaveText(
      'Housing takes 33.3% of your take-home pay',
      { timeout: 30_000 }
    )
    await expect(paying.locator('[data-card="groceries"] li[data-kind="band"]')).toHaveText(
      'Above typical'
    )
    const question = housing.getByTestId('circle-question-tenure')
    await expect(question.locator('legend')).toHaveText('How do you live?')
    await question
      .getByTestId('circle-tenure-choice')
      .filter({ hasText: /^Rent$/ })
      .click()
    await expect(question).toHaveCount(0)
    await expect(housing.getByTestId('benchmark-body')).toHaveText(
      'Households in the EU spend 18.9% on average (2025).'
    )

    // The subscriptions on Bills lead, and the card asks who the space covers until it knows.
    await expect(paying.getByTestId('benchmark-card').first()).toHaveAttribute(
      'data-card',
      'subscriptions'
    )
    const subscriptions = paying.locator('[data-card="subscriptions"]')
    await expect(subscriptions.getByTestId('benchmark-title')).toHaveText(
      'No subscriptions on Bills'
    )
    const household = subscriptions.getByTestId('circle-space-household')
    await household.getByTestId('circle-space-adults-2').click()
    await expect(household).toHaveCount(0)

    // Kept in About this space, where it can change.
    await page.evaluate(() => {
      window.location.hash = 'settings'
    })
    await page.getByTestId('settings-tab-general').click()
    const tenure = page.getByTestId('settings-answer-tenure')
    await expect(tenure.locator('input:checked')).toHaveCount(1, { timeout: 30_000 })
    await expect(tenure.locator('label:has(input:checked)')).toHaveText('Rent')
  })
})
