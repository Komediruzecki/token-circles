/**
 * Release scope 5.16.0, section 1: profiles and household (#584; regressions of #575, #577).
 *
 * Every case runs in both passes. The bug these guard against was a split between where writes
 * land (`currentProfileId`) and what the screen shows: a created profile that the header named
 * but nothing selected, or a click outside the menu that wrote the old selection back.
 */
import { both, expect } from './release-fixtures'
import {
  clickOutsideProfileMenu,
  createProfileFromSidebar,
  goPage,
  isTicked,
  profileButton,
  storedSelection,
  switchProfile,
  tickProfile,
} from './release-helpers'
import type { Page } from '@playwright/test'

/**
 * Categories > Add. An icon is typed in, because saving without one is a separate, known bug in
 * local-first (see the "without an icon" case below), and the profile cases are not about icons.
 */
async function addCategory(page: Page, name: string, icon: string | null = 'cart'): Promise<void> {
  await goPage(page, 'categories', 'categories-header')
  await page.getByTestId('add-category-btn').click()
  const modal = page.getByTestId('category-modal-overlay')
  await modal.getByPlaceholder('e.g., Food, Rent').fill(name)
  if (icon) await modal.getByPlaceholder('e.g., food, home, car').fill(icon)
  await modal.locator('button[type="submit"]').click()
  await expect(modal).toBeHidden()
}

function categoryCards(page: Page, name: string) {
  return page
    .getByTestId('category-card')
    .filter({ has: page.getByTestId('category-name').getByText(name, { exact: true }) })
}

async function openHousehold(page: Page): Promise<void> {
  await goPage(page, 'settings', 'settings-header')
  await page.getByTestId('settings-tab-exports').click()
  const rows = page.locator('[data-test-id^="household-profile-"]')
  // The card loads the profile list on mount; until then it offers a button to load it.
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })
}

/** The Household view row of the profile carrying the Active lock. */
async function householdActiveId(page: Page): Promise<number> {
  const row = page.locator('[data-test-id^="household-profile-"]', {
    has: page.getByTestId('household-active-badge'),
  })
  await expect(row).toHaveCount(1)
  return Number((await row.getAttribute('data-test-id'))?.replace('household-profile-', ''))
}

async function householdTicked(page: Page, id: number): Promise<boolean> {
  return page.getByTestId(`household-profile-${id}`).locator('input[type="checkbox"]').isChecked()
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s1 profiles [${pass}]`, () => {
    test('1.1 a profile created with the button becomes the selection @release', async ({ m }) => {
      const { page } = m
      const name = `zz-new${m.suffix}`
      await createProfileFromSidebar(page, name, 'button')
      const created = await m.profileNamed(name)

      await expect(profileButton(page)).toContainText(name)
      expect(await storedSelection(page)).toEqual({ current: created.id, selected: [created.id] })

      // Pages show the new profile's (empty) data.
      await goPage(page, 'categories', 'categories-header')
      await expect(page.getByTestId('category-card')).toHaveCount(0)

      await openHousehold(page)
      expect(await householdActiveId(page)).toBe(created.id)
    })

    test('1.2 a category made in the new profile stays in it @release', async ({ m }) => {
      const { page } = m
      const name = `zz-new${m.suffix}`
      await createProfileFromSidebar(page, name, 'button')
      const created = await m.profileNamed(name)

      await addCategory(page, 'zz-cat')
      await expect(categoryCards(page, 'zz-cat')).toHaveCount(1)
      expect(
        (await m.rows<{ name: string }>('categories', created.id)).map((c) => c.name)
      ).toContain('zz-cat')

      await switchProfile(page, m.a.id)
      await expect(profileButton(page)).toContainText(m.a.name)
      await goPage(page, 'categories', 'categories-header')
      await expect(categoryCards(page, 'zz-cat')).toHaveCount(0)
      expect(
        (await m.rows<{ name: string }>('categories', m.a.id)).map((c) => c.name)
      ).not.toContain('zz-cat')

      await switchProfile(page, created.id)
      await expect(profileButton(page)).toContainText(name)
      await expect(categoryCards(page, 'zz-cat')).toHaveCount(1)
    })

    test('1.3 created with Enter, then a click outside the menu keeps it @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-enter${m.suffix}`
      await createProfileFromSidebar(page, name, 'enter')
      const created = await m.profileNamed(name)
      await expect(profileButton(page)).toContainText(name)

      // Open the menu again and leave it by clicking elsewhere: before #577 this re-applied the
      // old selection.
      expect(await isTicked(page, created.id)).toBe(true)
      await clickOutsideProfileMenu(page)
      await expect(profileButton(page)).toContainText(name)
      expect(await storedSelection(page)).toEqual({ current: created.id, selected: [created.id] })
    })

    test('1.2b a category saved without picking an icon @release', async ({ m }) => {
      // Not a 5.16 regression: prod 5.15.1 has it. The form sends `icon: null` when no icon was
      // picked; the Worker takes it, the local router's categoryCreateSchema (icon optional
      // string) refuses it, and the user gets "Failed to save category".
      test.fail(
        m.kind === 'local',
        'local-first: POST /api/categories with icon null fails validation (since 5.15.1)'
      )
      const { page } = m
      await addCategory(page, `zz-noicon${m.suffix}`.slice(0, 40), null)
      await expect(categoryCards(page, `zz-noicon${m.suffix}`.slice(0, 40))).toHaveCount(1)
    })

    test('1.4 the Household view lock and ticks follow a sidebar switch @release', async ({
      m,
    }) => {
      const { page } = m
      await openHousehold(page)
      expect(await householdActiveId(page)).toBe(m.a.id)

      await switchProfile(page, m.b.id)
      await expect(profileButton(page)).toContainText(m.b.name)

      // Still on Settings, which stayed mounted: the lock moved without a reload.
      await expect
        .poll(() => householdActiveId(page), { message: 'Active lock follows the switch' })
        .toBe(m.b.id)
      expect(await householdTicked(page, m.b.id)).toBe(true)
      expect(await householdTicked(page, m.a.id)).toBe(false)
    })

    test('1.5 two ticked, closed by a click outside: writes land in the first @release', async ({
      m,
    }) => {
      const { page } = m
      await tickProfile(page, m.b.id)
      await clickOutsideProfileMenu(page)

      // The header names both (in menu order), and the first ticked, the one already active,
      // takes the writes.
      await expect(profileButton(page)).toContainText(' & ')
      await expect(profileButton(page)).toContainText(m.a.name)
      await expect(profileButton(page)).toContainText(m.b.name)
      expect(await storedSelection(page)).toEqual({ current: m.a.id, selected: [m.a.id, m.b.id] })

      const cat = `zz-hh${m.suffix}`.slice(0, 40)
      await addCategory(page, cat)
      await expect
        .poll(async () => (await m.rows<{ name: string }>('categories', m.a.id)).map((c) => c.name))
        .toContain(cat)
      expect(
        (await m.rows<{ name: string }>('categories', m.b.id)).map((c) => c.name)
      ).not.toContain(cat)
    })
  })
}
