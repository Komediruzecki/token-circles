/**
 * Release scope 5.16.0, section 5: savings goals without a target date (#583), and retirement
 * goals kept apart from savings goals in local-first (#581).
 *
 * Before #583 the date was required, an edit filled in today's date, and the seeded undated goals
 * read "Due today". Before #581 local-first stored retirement goals in the savings-goal store, so
 * each page listed the other's goals.
 */
import { hasBadgeRecord } from './badge-helpers'
import { switchTo } from './profile-helpers'
import { both, expect, isoDaysAgo, localRows, localTest } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

interface GoalRow {
  id: number
  name: string
  profile_id?: number
  deadline?: string | null
  target_date?: string | null
}

interface RetirementRow {
  id: number
  name: string
  profile_id: number
}

function goalCard(page: Page, name: string) {
  return page
    .getByTestId('goal-card')
    .filter({ has: page.getByTestId('goal-name').filter({ hasText: name }) })
}

/**
 * The goal's rings: the compact one on its card and the full one under Goals Progress, which is
 * the one that says "by <month>" for a dated goal.
 */
function goalRings(page: Page, name: string) {
  return page.locator(`svg[role="img"][aria-label^="${name}:"]`).locator('xpath=..')
}

const BY_MONTH = / by [A-Z][a-z]+ \d{4}/

/** The card reads "No target date", and neither ring names a month. */
async function expectUndated(page: Page, name: string): Promise<void> {
  await expect(goalCard(page, name).getByTestId('goal-date')).toHaveText('No target date')
  const rings = goalRings(page, name)
  await expect(rings).toHaveCount(2)
  for (const text of await rings.allInnerTexts()) expect(text).not.toMatch(BY_MONTH)
}

/** The card shows the date as the page formats it, and the full ring says "by <Mon YYYY>". */
async function expectDated(page: Page, name: string, iso: string): Promise<void> {
  const shown = await page.evaluate(
    (d) => ({
      card: new Date(d).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      ring: new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    }),
    iso
  )
  await expect(goalCard(page, name).getByTestId('goal-date')).toContainText(shown.card)
  const rings = goalRings(page, name)
  await expect(rings).toHaveCount(2)
  expect((await rings.allInnerTexts()).join(' | ')).toContain(`by ${shown.ring}`)
}

/** The one stored goal of the starting profile with this name. */
async function storedGoal(m: Mode, name: string): Promise<GoalRow> {
  const rows = (await m.rows<GoalRow>('goals', m.a.id)).filter((g) => g.name === name)
  expect(rows, `one stored goal "${name}"`).toHaveLength(1)
  return rows[0]
}

/** The date a stored goal carries, under either key the page reads (`deadline || target_date`). */
function storedDate(goal: GoalRow): string | null {
  return goal.deadline || goal.target_date || null
}

/** An undated goal, sent as the Goals form sends one. */
async function addUndatedGoal(m: Mode, name: string): Promise<void> {
  await m.api('/api/savings-goals', {
    method: 'POST',
    body: {
      name,
      target_amount: 800,
      target_date: '',
      monthly_contribution: null,
      category_id: null,
    },
  })
}

async function openGoals(page: Page): Promise<void> {
  await goPage(page, 'goals', 'goals-header')
}

async function editGoal(page: Page, name: string): Promise<void> {
  await goalCard(page, name).getByTestId('goal-edit-btn').click()
  await expect(page.getByTestId('goals-modal')).toBeVisible()
  await expect(page.getByTestId('goals-form-name')).toHaveValue(name)
}

async function submitGoal(page: Page): Promise<void> {
  await page.getByTestId('goals-modal-submit').click()
  await expect(page.getByTestId('goals-modal')).toBeHidden()
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s5 goals [${pass}]`, () => {
    test('5.1 a goal saves with no target date @release', async ({ m }) => {
      const { page } = m
      const name = 'Zz Lantern Fund'
      await openGoals(page)
      await page.getByTestId('add-goal-btn').click()
      await expect(page.getByTestId('goals-modal')).toBeVisible()
      await page.getByTestId('goals-form-name').fill(name)
      await page.getByTestId('goals-form-target').fill('1000')
      await expect(page.getByTestId('goals-form-date')).toHaveValue('')
      await submitGoal(page)

      await expectUndated(page, name)
      expect(storedDate(await storedGoal(m, name))).toBeNull()
    })

    test('5.2 renaming an undated goal keeps it undated @release', async ({ m }) => {
      const { page } = m
      await addUndatedGoal(m, 'Zz Harbor Fund')
      await openGoals(page)
      await expectUndated(page, 'Zz Harbor Fund')

      await editGoal(page, 'Zz Harbor Fund')
      // Before #583 the edit form filled in today's date here, and the save stored it.
      await expect(page.getByTestId('goals-form-date')).toHaveValue('')
      await page.getByTestId('goals-form-name').fill('Zz Quay Fund')
      await submitGoal(page)

      await expect(goalCard(page, 'Zz Harbor Fund')).toHaveCount(0)
      await expectUndated(page, 'Zz Quay Fund')
      expect(storedDate(await storedGoal(m, 'Zz Quay Fund'))).toBeNull()
    })

    test('5.3 a date given and then cleared leaves the goal undated @release', async ({ m }) => {
      const { page } = m
      const name = 'Zz Comet Fund'
      const date = isoDaysAgo(-200)
      await addUndatedGoal(m, name)
      await openGoals(page)

      await editGoal(page, name)
      await page.getByTestId('goals-form-date').fill(date)
      await submitGoal(page)
      await expectDated(page, name, date)
      expect(storedDate(await storedGoal(m, name))).toBe(date)

      await editGoal(page, name)
      await expect(page.getByTestId('goals-form-date')).toHaveValue(date)
      await page.getByTestId('goals-form-date').fill('')
      await submitGoal(page)
      await expectUndated(page, name)
      expect(storedDate(await storedGoal(m, name))).toBeNull()
    })
  })
}

localTest.describe('5.16.0 s5 goals [local]', () => {
  localTest('5.4 the seeded goals read No target date, not Due today @release', async ({ m }) => {
    const { page } = m
    await openGoals(page)
    // Example Mid Income, active on a fresh demo.
    await expect(page.getByTestId('goal-card')).toHaveCount(1)
    await expectUndated(page, 'Emergency Fund')

    const high = await m.profileNamed('Example High Income')
    await switchTo(page, high)
    await expect(page.getByTestId('goal-card')).toHaveCount(2)
    await expectUndated(page, 'Emergency Fund')
    await expectUndated(page, 'Vacation')

    const cards = page.getByTestId('goals-grid')
    await expect(cards).not.toContainText('Due today')
    await expect(cards).not.toContainText('Invalid Date')
  })

  localTest('5.5 Retirement lists only retirement goals @release', async ({ m }) => {
    const { page } = m
    await m.api('/api/retirement-goals', {
      method: 'POST',
      body: {
        name: 'Zz Harbor Pension',
        target_amount: 400000,
        current_amount: 20000,
        target_date: isoDaysAgo(-365 * 20),
        monthly_contribution: 500,
        expected_return_rate: 6,
        current_age: 45,
        retirement_age: 65,
      },
    })

    await goPage(page, 'retirement', 'retirement-header')
    const section = page.getByTestId('retirement-goals')
    const cards = section.getByTestId('retirement-goal-card')
    await expect(cards).toHaveCount(1)
    await expect(cards.getByTestId('retirement-goal-name')).toHaveText('Zz Harbor Pension')
    // Before #581: the seeded savings goal, with "Target Date: Invalid Date".
    await expect(section).not.toContainText('Emergency Fund')
    await expect(section).not.toContainText('Invalid Date')

    // Each kind in its own store.
    const retirement = await localRows<RetirementRow>(page, 'retirement_goals')
    expect(retirement.filter((g) => g.profile_id === m.a.id).map((g) => g.name)).toEqual([
      'Zz Harbor Pension',
    ])
    expect((await m.rows<GoalRow>('goals', m.a.id)).map((g) => g.name)).not.toContain(
      'Zz Harbor Pension'
    )
  })

  localTest(
    '5.6 a retirement goal made on Retirement is not a savings goal @release',
    async ({ m }) => {
      const { page } = m
      const name = 'Zz Dune Pension'
      await goPage(page, 'retirement', 'retirement-header')
      await page.getByTestId('add-retirement-goal-btn').click()
      const modal = page.getByTestId('retirement-modal')
      await expect(modal).toBeVisible()
      await page.getByTestId('retirement-form-name').fill(name)
      await page.getByTestId('retirement-form-target-amount').fill('300000')
      await page.getByTestId('retirement-form-current-amount').fill('10000')
      await page.getByTestId('retirement-form-current-age').fill('40')
      await page.getByTestId('retirement-form-retirement-age').fill('67')
      await page.getByTestId('retirement-form-target-date').fill(isoDaysAgo(-365 * 27))
      await page.getByTestId('retirement-form-monthly-contribution').fill('400')
      await page.getByTestId('retirement-form-expected-return').fill('5')
      await page.getByTestId('retirement-modal-submit').click()
      await expect(modal).toBeHidden()
      await expect(page.getByTestId('retirement-goal-card').filter({ hasText: name })).toHaveCount(
        1
      )

      // Savings Goals, opened for the first time now: the seeded goal, and not the new one.
      await openGoals(page)
      await expect(goalCard(page, 'Emergency Fund')).toHaveCount(1)
      await expect(page.getByTestId('goal-card')).toHaveCount(1)
      await expect(goalCard(page, name)).toHaveCount(0)

      expect((await m.rows<GoalRow>('goals', m.a.id)).map((g) => g.name)).not.toContain(name)
      const retirement = await localRows<RetirementRow>(page, 'retirement_goals')
      expect(retirement.filter((g) => g.name === name && g.profile_id === m.a.id)).toHaveLength(1)
    }
  )

  localTest(
    '5.7 no Validation failed for budgets, bills, loans or savings goals @release',
    async ({ m }, testInfo) => {
      // The fixture fails any local case on any `Validation failed`. This case makes sure the four
      // typed reads ran at all, in every seeded profile: the pages read through the raw client,
      // so the reads that validate are the badge evaluation's (core/achievementsStore.ts).
      testInfo.setTimeout(testInfo.timeout + 90_000)
      const { page } = m
      const four = /Validation failed for \/(budgets|bills|loans|savings-goals)\b/
      const failed: string[] = []
      page.on('console', (msg) => {
        if (four.test(msg.text())) failed.push(msg.text())
      })

      const order = [
        m.a,
        await m.profileNamed('Example Low Income'),
        await m.profileNamed('Example High Income'),
      ]
      for (const [i, profile] of order.entries()) {
        if (i > 0) await switchTo(page, profile)
        await goPage(page, 'budgets', 'budgets-header')
        await goPage(page, 'bills', 'bills-header')
        await goPage(page, 'loans', 'loans-header')
        await goPage(page, 'goals', 'goals-header')
        // The profile's first evaluation is over once its record is stored, or once it has failed.
        await expect
          .poll(async () => failed.length > 0 || (await hasBadgeRecord(m, profile.id)), {
            message: `badge evaluation of ${profile.name}`,
            timeout: 30_000,
          })
          .toBe(true)
        expect(failed, `typed reads in ${profile.name}`).toEqual([])
      }
    }
  )
})
