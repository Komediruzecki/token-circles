/**
 * Release scope 5.16.0, section 6: badges are per profile (#580), they are announced on the write
 * that earns them (#574), and local-first evaluates them at all (#581).
 *
 * Toasts are recorded as they are inserted (badge-helpers.ts `installToastRecorder`): badge
 * toasts share one channel, so a second one replaces the first on screen at once.
 */
import {
  BADGE_TOAST,
  badgeToastsSince,
  environmentBadges,
  installToastRecorder,
  progressEarnedCount,
  recordToasts,
  settleBadges,
  storedBadgeIds,
  toastsSeen,
  waitForBadgeRecord,
} from './badge-helpers'
import {
  continueWithNoAccount,
  freshLocalBrowser,
  openHousehold,
  setHousehold,
  switchTo,
} from './profile-helpers'
import { both, callLocalApi, cloudTest, expect, localTest } from './release-fixtures'
import { createProfileFromSidebar, goPage, profileButton, trackApi } from './release-helpers'
import type { Page, TestInfo } from '@playwright/test'
import type { Mode, Profile } from './release-fixtures'

const FIRST_BUDGET = /Badge unlocked: First budget\./
const SUMMARY = /(\d+) badges earned from your history so far\./

function firstOfMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

/** The Budgets page card of a category: its header carries the name and the Set Budget button. */
function budgetCardHeader(page: Page, category: string) {
  return page
    .getByTestId('budgets-category-actions')
    .locator('xpath=..')
    .filter({ has: page.getByRole('heading', { name: category, exact: true }) })
}

async function openProgress(page: Page): Promise<void> {
  await goPage(page, 'progress', 'progress-header')
}

/**
 * Make `zz-new`, the new profile of scope case 1.1, and wait for its first evaluation. Returns
 * the profile and the badges the environment alone gave it.
 */
async function newProfile(m: Mode): Promise<{ created: Profile; env: string[] }> {
  const name = `zz-new${m.suffix}`
  await createProfileFromSidebar(m.page, name, 'button')
  await expect(profileButton(m.page)).toContainText(name)
  const created = await m.profileNamed(name)
  await settleBadges(m.page)
  return { created, env: await environmentBadges(m.page) }
}

/**
 * On a new profile, set its first budget from the Budgets page, and wait for the badge toast the
 * write itself sets off. Returns where the toast record stood before the save, and the page-clock
 * time of the save.
 */
async function earnFirstBudget(
  m: Mode
): Promise<{ from: number; savedAt: number; created: Profile; env: string[] }> {
  const { page } = m
  const { created, env } = await newProfile(m)
  // A category to budget for. The local router stores what it is sent, so the body carries
  // what the Categories form would (`tax_deductible` included, see KNOWN_LOCAL_CONSOLE).
  await m.api('/api/categories', {
    method: 'POST',
    body: {
      name: 'Zz Fuel',
      type: 'expense',
      icon: 'cart',
      color: '#f59e0b',
      tax_deductible: false,
    },
  })
  await settleBadges(page)
  expect(await storedBadgeIds(m, created.id), 'the new profile before its budget').toEqual(env)

  await recordToasts(page)
  const from = (await toastsSeen(page)).length
  await goPage(page, 'budgets', 'budgets-header')
  await budgetCardHeader(page, 'Zz Fuel').getByTitle('Set Budget').click()
  await page.getByPlaceholder('500.00').fill('300')
  const savedAt = await page.evaluate(() => Date.now())
  await page.getByRole('button', { name: 'Save Budget' }).click()
  await expect(page.getByPlaceholder('500.00')).toBeHidden()
  await expect
    .poll(async () => (await badgeToastsSince(page, from)).length, {
      message: 'a badge toast after the budget save',
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  return { from, savedAt, created, env }
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s6 badges [${pass}]`, () => {
    test('6.2 a new profile has no badges, and the others keep theirs @release', async ({ m }) => {
      const { page } = m
      await waitForBadgeRecord(m, m.a.id)
      const before = await storedBadgeIds(m, m.a.id)
      expect(before.length).toBeGreaterThan(0)

      const { created, env } = await newProfile(m)
      await openProgress(page)
      // Right after a switch, Progress can show the previous profile's badges for a moment
      // (section 9, Known), so this waits for the new profile's own count.
      await expect.poll(() => progressEarnedCount(page), { timeout: 15_000 }).toBe(env.length)
      if (env.length === 0) await expect(page.getByTestId('timeline-empty')).toBeVisible()
      expect(await storedBadgeIds(m, created.id)).toEqual(env)

      await switchTo(page, m.a)
      await settleBadges(page)
      await expect.poll(() => progressEarnedCount(page), { timeout: 15_000 }).toBe(before.length)
      expect(await storedBadgeIds(m, m.a.id)).toEqual(before)
    })

    test('6.3 a first budget is announced on the write, for that profile only @release', async ({
      m,
    }, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 60_000)
      const { page } = m
      await waitForBadgeRecord(m, m.a.id)
      const aBefore = await storedBadgeIds(m, m.a.id)
      const bBefore = await storedBadgeIds(m, m.b.id)

      const { from, savedAt, created, env } = await earnFirstBudget(m)
      // Give a second toast time to show, then: exactly one, and it is the budget's.
      // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- an observation window: what is checked is that nothing more arrives in it
      await page.waitForTimeout(3_000)
      const seen = (await toastsSeen(page)).slice(from)
      const badges = seen.filter((t) => BADGE_TOAST.test(t.text))
      expect(badges.map((t) => t.text)).toHaveLength(1)
      expect(badges[0].text).toMatch(FIRST_BUDGET)
      const delay = badges[0].at - savedAt
      testInfo.annotations.push({
        type: 'first-budget toast after the save, ms',
        description: String(delay),
      })
      expect(delay, 'the toast follows the write itself').toBeLessThan(10_000)
      expect(await storedBadgeIds(m, created.id)).toEqual([...env, 'first-budget'].sort())

      // The other profiles did not gain it.
      const mark = (await toastsSeen(page)).length
      await switchTo(page, m.a)
      await settleBadges(page)
      expect(await storedBadgeIds(m, m.a.id)).toEqual(aBefore)
      expect(await storedBadgeIds(m, m.b.id)).toEqual(bBefore)
      if (m.kind === 'cloud') {
        expect(aBefore).not.toContain('first-budget')
        expect(bBefore).not.toContain('first-budget')
      }
      expect(await badgeToastsSince(page, mark)).toEqual([])
      await openProgress(page)
      await expect.poll(() => progressEarnedCount(page), { timeout: 15_000 }).toBe(aBefore.length)
    })

    test('6.5 after a badge toast, 10 s with no repeated requests and no second toast @release', async ({
      m,
    }, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 60_000)
      const { page } = m
      await waitForBadgeRecord(m, m.a.id)
      const api = trackApi(page)
      const { from, created } = await earnFirstBudget(m)
      const recordAfter = await storedBadgeIds(m, created.id)

      const mark = api.mark()
      const toastCount = (await toastsSeen(page)).length
      // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- an observation window: what is checked is that nothing more arrives in it
      await page.waitForTimeout(10_000)

      expect(await badgeToastsSince(page, toastCount), 'a second badge toast').toEqual([])
      expect((await badgeToastsSince(page, from)).length).toBe(1)
      expect(await storedBadgeIds(m, created.id)).toEqual(recordAfter)
      if (m.kind === 'cloud') {
        const calls = api.since(mark).map((c) => `${c.method} ${c.path}`)
        const repeated = calls.filter((c, i) => calls.indexOf(c) !== i)
        expect(repeated, `requests in the 10 s after the toast: ${calls.join(', ')}`).toEqual([])
        // A second evaluation would read the import logs again; a second save would PUT settings.
        expect(api.count(mark, 'GET', /^\/api\/import-logs/)).toBe(0)
        expect(api.count(mark, 'PUT', /^\/api\/settings/)).toBe(0)
      }
      api.stop()
    })
  })
}

cloudTest.describe('5.16.0 s6 badges [cloud]', () => {
  cloudTest(
    '6.1 household ticks and switches announce no badge the active profile did not earn @release',
    async ({ m, cloud }, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 120_000)
      const { page } = m
      // Family earns two badges Personal does not have: a budget and a savings goal.
      await cloud.family.api.post('/api/budgets', {
        category_id: cloud.family.categories.Groceries,
        amount: 300,
        period: 'monthly',
        start_date: firstOfMonth(),
      })
      await cloud.family.api.post('/api/savings-goals', {
        name: 'Zz Family Fund',
        target_amount: 900,
        target_date: '',
        monthly_contribution: null,
        category_id: null,
      })
      await waitForBadgeRecord(m, m.a.id)
      // Family's own first evaluation, as the active profile, then back to Personal: from here
      // on neither profile has anything new to earn.
      await switchTo(page, m.b)
      await waitForBadgeRecord(m, m.b.id)
      await switchTo(page, m.a)
      await settleBadges(page)
      const personal = await storedBadgeIds(m, m.a.id)
      const family = await storedBadgeIds(m, m.b.id)
      expect(family).toEqual(expect.arrayContaining(['first-budget', 'goal-in-sight']))
      expect(personal).not.toContain('first-budget')
      expect(personal).not.toContain('goal-in-sight')

      await recordToasts(page)
      const from = (await toastsSeen(page)).length
      const steps: string[] = []
      for (let round = 1; round <= 3; round++) {
        await openHousehold(page)
        await setHousehold(page, m.b.id, true)
        await settleBadges(page)
        steps.push(`round ${round}: Personal active, Family ticked`)
        await setHousehold(page, m.b.id, false)
        await settleBadges(page)
        await switchTo(page, m.b)
        await settleBadges(page)
        steps.push(`round ${round}: switched to Family`)
        await openHousehold(page)
        await setHousehold(page, m.a.id, true)
        await settleBadges(page)
        await setHousehold(page, m.a.id, false)
        await settleBadges(page)
        await switchTo(page, m.a)
        await settleBadges(page)
        steps.push(`round ${round}: back on Personal`)
      }

      expect(await badgeToastsSince(page, from), steps.join('; ')).toEqual([])
      expect(await storedBadgeIds(m, m.a.id)).toEqual(personal)
      expect(await storedBadgeIds(m, m.b.id)).toEqual(family)
    }
  )
})

localTest.describe('5.16.0 s6 badges [local]', () => {
  localTest(
    "6.4 each seeded profile's first load announces one summary, not one toast per badge @release",
    async ({ browser }, testInfo: TestInfo) => {
      testInfo.setTimeout(testInfo.timeout + 180_000)
      // A browser of the case's own, with the recorder in place before the app boots: the first
      // evaluation runs as soon as the demo is seeded.
      const fresh = await freshLocalBrowser(browser, { init: [installToastRecorder] })
      const { page, context, problems } = fresh
      try {
        await continueWithNoAccount(page)
        await expect(profileButton(page)).toContainText('Example', { timeout: 90_000 })
        await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 60_000 })

        const profiles = async () => {
          const res = await callLocalApi<Profile[] | { profiles: Profile[] }>(page, '/api/profiles')
          return Array.isArray(res.body) ? res.body : res.body.profiles
        }
        const stored = async (id: number) => {
          const res = await callLocalApi<Record<string, unknown>>(page, '/api/settings')
          const raw = res.body[`achievements:${id}`]
          if (typeof raw !== 'string' || raw === '') return null
          return (JSON.parse(raw) as { unlocks?: unknown[] }).unlocks?.length ?? 0
        }
        const summaries = async (from: number) =>
          (await toastsSeen(page))
            .slice(from)
            .map((t) => t.text)
            .filter((t) => BADGE_TOAST.test(t))

        const all = await profiles()
        const active = Number(await page.evaluate(() => localStorage.getItem('currentProfileId')))
        const mid = all.find((p) => p.id === active) as Profile
        const low = all.find((p) => /Low Income/.test(p.name)) as Profile
        expect(mid.name).toMatch(/Mid Income/)

        for (const [i, profile] of [mid, low].entries()) {
          const from = i === 0 ? 0 : (await toastsSeen(page)).length
          if (i > 0) await switchTo(page, profile)
          await expect
            .poll(() => stored(profile.id), {
              message: `record of ${profile.name}`,
              timeout: 30_000,
            })
            .not.toBeNull()
          const count = (await stored(profile.id)) as number
          expect(count, `${profile.name} earns several badges from its history`).toBeGreaterThan(1)
          // The toast lands after the record is saved: give it a moment, then exactly one.
          await expect
            .poll(async () => (await summaries(from)).length, { timeout: 10_000 })
            .toBeGreaterThan(0)
          // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- an observation window: what is checked is that nothing more arrives in it
          await page.waitForTimeout(2_000)
          const seen = await summaries(from)
          expect(seen, `badge toasts on ${profile.name}'s first load`).toHaveLength(1)
          const match = SUMMARY.exec(seen[0])
          expect(match, seen[0]).toBeTruthy()
          expect(Number((match as RegExpExecArray)[1])).toBe(count)
        }
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    }
  )
})
