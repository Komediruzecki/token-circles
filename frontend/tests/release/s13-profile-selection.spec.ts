/**
 * Release scope 5.16.1, section 13: the profile selection has one owner. Ticking a profile in
 * Settings reaches the sidebar header at once, and closing the sidebar menu no longer writes an
 * older selection back, including the one the setup wizard makes in an empty workspace.
 */
import {
  continueWithNoAccount,
  freshLocalBrowser,
  householdCheckbox,
  openHousehold,
  setHousehold,
} from './profile-helpers'
import { both, callLocalApi, expect, localTest } from './release-fixtures'
import {
  clickOutsideProfileMenu,
  isTicked,
  openProfileMenu,
  profileButton,
  storedSelection,
} from './release-helpers'
import type { Page } from '@playwright/test'
import type { Mode, Profile } from './release-fixtures'

/** Mark the window: a reload replaces it, and the mark with it. */
async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __tcSameWindow?: boolean }).__tcSameWindow = true
  })
}

async function sameWindow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __tcSameWindow?: boolean }).__tcSameWindow === true
  )
}

const byId = (x: number, y: number) => x - y

/** Both profiles are the selection: in storage, with `a` still the one writes go to. */
async function expectBothSelected(m: Mode): Promise<void> {
  const stored = await storedSelection(m.page)
  expect(stored.current).toBe(m.a.id)
  expect([...stored.selected].sort(byId)).toEqual([m.a.id, m.b.id].sort(byId))
}

/** The header names both, as "<one> & <other>". */
async function expectHeaderShowsBoth(m: Mode): Promise<void> {
  const header = profileButton(m.page)
  await expect(header).toContainText(' & ')
  await expect(header).toContainText(m.a.name)
  await expect(header).toContainText(m.b.name)
}

for (const [pass, test] of both) {
  test.describe(`5.16.1 s13 profile selection [${pass}]`, () => {
    test('13.1 a second profile ticked in Settings shows in the header without a reload @release', async ({
      m,
    }) => {
      const { page } = m
      await openHousehold(page)
      await markWindow(page)
      await setHousehold(page, m.b.id, true)

      await expectHeaderShowsBoth(m)
      await expectBothSelected(m)
      expect(await sameWindow(page), 'no reload').toBe(true)
    })

    test('13.2 opening the profile menu and clicking outside keeps both selected @release', async ({
      m,
    }) => {
      const { page } = m
      await openHousehold(page)
      await setHousehold(page, m.b.id, true)
      await expectHeaderShowsBoth(m)
      await markWindow(page)

      await openProfileMenu(page)
      expect(await isTicked(page, m.a.id)).toBe(true)
      expect(await isTicked(page, m.b.id)).toBe(true)
      await clickOutsideProfileMenu(page)

      await expectHeaderShowsBoth(m)
      await expectBothSelected(m)
      // In Settings too: the household view still ticks both.
      await expect(householdCheckbox(page, m.a.id)).toBeChecked()
      await expect(householdCheckbox(page, m.b.id)).toBeChecked()
      // And the menu, opened again, still does.
      expect(await isTicked(page, m.a.id)).toBe(true)
      expect(await isTicked(page, m.b.id)).toBe(true)
      await clickOutsideProfileMenu(page)
      await expectBothSelected(m)
      expect(await sameWindow(page), 'no reload').toBe(true)
    })
  })
}

localTest.describe('5.16.1 s13 profile selection [local]', () => {
  localTest(
    "13.3 the setup wizard's new profile is ticked, and a click outside the menu keeps it @release",
    async ({ browser }, testInfo) => {
      testInfo.setTimeout(testInfo.timeout + 120_000)
      // An empty local workspace: a browser that has had profiles before gets no demo seed
      // (idb.ts getCurrentProfileId), so the setup wizard opens over no profile at all. The
      // wizard's "Use local-only" leaves a browser in the same state.
      const { context, page, problems } = await freshLocalBrowser(browser, { noDemo: true })
      try {
        await continueWithNoAccount(page)
        const wizard = page.getByTestId('onboarding-wizard')
        await expect(wizard).toBeVisible({ timeout: 60_000 })
        await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()
        await page.getByTestId('onboarding-next').click()
        await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
        const name = 'Zz Wizard Space'
        await page.getByTestId('onboarding-profile-name').fill(name)
        await page.getByTestId('onboarding-next').click()
        await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('onboarding-skip').click()
        await page.getByTestId('confirm-accept').click()
        await expect(wizard).toBeHidden()

        const res = await callLocalApi<Profile[] | { profiles: Profile[] }>(page, '/api/profiles')
        const all = Array.isArray(res.body) ? res.body : res.body.profiles
        expect(all.map((p) => p.name)).toEqual([name])
        const created = all[0]

        await expect(profileButton(page)).toContainText(name)
        expect(await isTicked(page, created.id), 'ticked in the sidebar menu').toBe(true)
        await clickOutsideProfileMenu(page)
        expect(await storedSelection(page)).toEqual({ current: created.id, selected: [created.id] })
        await expect(profileButton(page)).toContainText(name)
        expect(await isTicked(page, created.id), 'still ticked after the menu closed').toBe(true)
        await clickOutsideProfileMenu(page)
        expect(await storedSelection(page)).toEqual({ current: created.id, selected: [created.id] })
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    }
  )
})
