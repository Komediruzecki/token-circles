/**
 * The floating + on a phone, in local-first mode: the Guided Orbit offers the categories of the
 * profile an entry will be filed under, straight after one is made and straight after a switch.
 *
 * Reported on dev (main 229e324b), 2026-10-07, following exactly this path on a phone:
 *
 * 1. "Continue with no account", create a profile from the sidebar, add a category on Budgets
 *    (it had none), then Transactions and the floating +: 50, Expense, Next. The orb said there
 *    were no expense categories.
 * 2. Reload, switch to another profile and open the orb there, switch back, and Categories shows
 *    the one category. The orb offered the other profile's predefined categories instead.
 *
 * In local-first a category made on Budgets was stored without `tax_deductible`, so every typed
 * read of that profile's categories failed validation, and App's quick-entry list kept whatever
 * it held before. See src/core/quickEntryLists.ts and src/core/storage/handlers/categories.ts.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './e2e-constants'
import type { Locator, Page } from '@playwright/test'

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

// The demo seed and three loads of the app on a phone-sized page.
test.setTimeout(120_000)

/** "Continue with no account" from the sign-in screen, as a deployed build shows it. */
async function enterLocalFirst(page: Page): Promise<void> {
  await page.goto(`${E2E_BASE}/robots.txt`)
  await page.evaluate(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
  })
  await page.goto(`${E2E_BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('try-no-account').click({ timeout: 60_000 })
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Example', {
    timeout: 90_000,
  })
  await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 60_000 })
}

/**
 * The setup wizard opens over a pristine profile whenever the app gets round to it, which can be a
 * moment after the page looks ready, and takes every tap until it is left. Leave it, confirming
 * when it asks, each time it shows up.
 */
async function leaveSetupWheneverItOpens(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByRole('button', { name: 'Confirm' })
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

const sidebarToggle = (page: Page) => page.getByRole('button', { name: 'Toggle sidebar' })

/** Is the sidebar meant to be open? The toggle says so at once; the slide takes a moment. */
async function sidebarWanted(page: Page): Promise<boolean> {
  return ((await sidebarToggle(page).getAttribute('class')) ?? '').includes('mobile-toggle-open')
}

/** On a phone the sidebar slides in from the left: is it on screen now? */
async function sidebarOnScreen(page: Page): Promise<boolean> {
  const box = await page.getByTestId('profile-dropdown-btn').boundingBox()
  return !!box && box.x >= 0 && box.x + box.width <= 390
}

async function openSidebar(page: Page): Promise<void> {
  if (!(await sidebarWanted(page))) await sidebarToggle(page).click()
  await expect.poll(() => sidebarOnScreen(page)).toBe(true)
}

/** A nav link closes it by itself; anything else needs the toggle. Either way, wait out the slide. */
async function closeSidebar(page: Page): Promise<void> {
  if (await sidebarWanted(page)) await sidebarToggle(page).click()
  await expect.poll(() => sidebarOnScreen(page)).toBe(false)
}

async function goTo(page: Page, name: string): Promise<void> {
  await openSidebar(page)
  await page.getByTestId(`nav-link-${name}`).click()
  await closeSidebar(page)
}

/**
 * Is the profile menu open? Its rows are clipped to no height when it is shut, which Playwright
 * still calls visible, so the menu box's own height decides.
 */
async function profileMenuIsOpen(page: Page): Promise<boolean> {
  return page
    .getByTestId('profile-create-item')
    .evaluate((el) => (el.parentElement?.getBoundingClientRect().height ?? 0) > 20)
    .catch(() => false)
}

/** Click something in the profile menu. Opening and clicking are retried as a pair. */
async function inProfileMenu(page: Page, target: () => Locator): Promise<void> {
  await openSidebar(page)
  await expect(async () => {
    if (!(await profileMenuIsOpen(page))) await page.getByTestId('profile-dropdown-btn').click()
    await expect.poll(() => profileMenuIsOpen(page)).toBe(true)
    await page.waitForTimeout(250)
    await target().click({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

async function switchProfile(page: Page, name: string): Promise<void> {
  const id = await page.evaluate(async (wanted) => {
    const spec = '/src/core/storage/idb.ts'
    const { getDB } = (await import(/* @vite-ignore */ spec)) as {
      getDB(): Promise<{ getAll(store: string): Promise<{ id: number; name: string }[]> }>
    }
    return (await (await getDB()).getAll('profiles')).find((p) => p.name === wanted)?.id
  }, name)
  expect(id, `profile "${name}"`).toBeDefined()
  await inProfileMenu(page, () => page.locator(`[data-profile-id="${id}"] span`).first())
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText(name)
  await closeSidebar(page)
}

/** The floating +, an amount on the keypad, Expense, Next: the category step. */
async function orbAtCategories(page: Page, digits: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Quick add entry' }).tap()
  const orb = page.getByRole('dialog', { name: 'Add transaction' })
  await expect(orb).toBeVisible()
  for (const digit of digits) await orb.getByRole('button', { name: digit, exact: true }).tap()
  await orb.getByRole('button', { name: 'Expense', exact: true }).tap()
  await orb.getByRole('button', { name: 'Next', exact: true }).tap()
  return orb
}

/** A category chip on the orb's category step, by its name. */
function chip(orb: Locator, name: string): Locator {
  return orb.getByRole('button', { name, exact: true })
}

/** Close the orb. It fades out and stays in the page, so "closed" is its overlay taking no taps. */
async function closeOrb(orb: Locator): Promise<void> {
  await orb.getByRole('button', { name: 'Close' }).tap()
  await expect
    .poll(() => orb.evaluate((el) => getComputedStyle(el.parentElement!).pointerEvents))
    .toBe('none')
}

test('the orb offers the active profile’s categories after a create and after a switch', async ({
  page,
}) => {
  const validationErrors: string[] = []
  page.on('console', (msg) => {
    if (/Validation failed/.test(msg.text())) validationErrors.push(msg.text())
  })

  await leaveSetupWheneverItOpens(page)
  await enterLocalFirst(page)

  // 1. A profile from the sidebar; it becomes the active one.
  await inProfileMenu(page, () => page.getByTestId('profile-create-item'))
  await page.getByTestId('profile-name-input').fill('Test')
  await page.getByTestId('profile-create-submit').click()
  await expect(page.getByTestId('profile-modal')).toBeHidden({ timeout: 15_000 })
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Test')
  await closeSidebar(page)

  // Budgets: no categories yet, so one is made there.
  await goTo(page, 'budgets')
  await page.getByRole('button', { name: 'Add Category' }).first().click()
  const modal = page.getByTestId('budgets-category-modal')
  await modal.getByPlaceholder('e.g., Food, Rent').fill('Food')
  await modal.getByPlaceholder('e.g., food, home, car').fill('food')
  await modal.locator('button[type="submit"]').click()
  await expect(modal).toBeHidden()

  // Transactions, then the floating +: 50, Expense, Next.
  await goTo(page, 'transactions')
  let orb = await orbAtCategories(page, '50')
  await expect(chip(orb, 'Food')).toBeVisible()
  await closeOrb(orb)

  // 2. Reload, open the orb on another profile, then come back to this one.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Test', { timeout: 60_000 })
  await switchProfile(page, 'Example Mid Income')
  orb = await orbAtCategories(page, '5')
  await expect(chip(orb, 'Housing')).toBeVisible()
  await closeOrb(orb)

  await switchProfile(page, 'Test')
  await goTo(page, 'categories')
  await expect(page.getByTestId('category-name')).toHaveText(['Food'])

  // Only this profile's one category. The demo profile has a "Food" of its own, so the other
  // profile's list would show "Food" too: its "Housing" is what tells them apart.
  orb = await orbAtCategories(page, '50')
  await expect(chip(orb, 'Food')).toBeVisible()
  await expect(chip(orb, 'Housing')).toHaveCount(0)

  // And it lands: the category is this profile's, so the save takes it.
  await chip(orb, 'Food').tap()
  await orb.getByRole('button', { name: /^Add / }).tap()
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText('Entry added')
  ).toBeVisible({ timeout: 15_000 })

  expect(validationErrors).toEqual([])
})
