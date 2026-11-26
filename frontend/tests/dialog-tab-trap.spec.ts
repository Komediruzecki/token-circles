import { expect, test, type Locator, type Page } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

/**
 * Tab stays inside the dialog on top, and so does Shift+Tab (utils/dialogFocus.ts).
 *
 * Measured on 26 Nov 2026 before the change: Tab walked out of all 34 dialogs that open over a
 * page, after 2 to 125 presses, most often onto Quick add, and Shift+Tab from the first stop left
 * 33 of them. Each case opens a dialog the way a person does, presses Tab once for each stop in it
 * and three times more, and fails the first time focus is outside it; then it puts focus on the
 * dialog's first stop and presses Shift+Tab once. Each dialog is checked on its own (expect.soft),
 * so a run names every dialog that lets focus out, not only the first.
 */

interface Trap {
  /** What the dialog is called in a failure. */
  name: string
  /** What a person uses to open it. */
  opener: Locator
  /** Opens it, when that is more than a click on the opener. */
  open?: () => Promise<void>
  /** The dialog, or the field in it that takes focus. */
  inside: Locator
  /** That it has shut, for a dialog that stays drawn when shut. Default: `inside` is hidden. */
  shutDone?: () => Promise<void>
}

/** Where focus is: inside the dialog being checked, and what it is on. */
const where = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { inside: false, at: 'nothing (the page)' }
    const label =
      el.getAttribute('aria-label') ??
      el.getAttribute('data-test-id') ??
      (el.textContent ?? '').trim().slice(0, 40)
    return {
      inside: el.closest('[data-tab-trap]') !== null,
      at: `${el.tagName.toLowerCase()} "${label}"`,
    }
  })

/**
 * Marks the dialog `inside` is in, and counts the stops Tab makes in it. The dialog is the closest
 * element that says it is one, or, for a dialog box that does not, the closest holding a heading.
 */
const markDialog = (inside: Locator) =>
  inside.evaluate((el) => {
    const said = el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
    let dialog: Element = said ?? el
    if (!said) {
      for (let at: Element | null = el; at; at = at.parentElement) {
        if (at.querySelector('h2, h3')) {
          dialog = at
          break
        }
      }
    }
    for (const old of document.querySelectorAll('[data-tab-trap]')) {
      old.removeAttribute('data-tab-trap')
    }
    dialog.setAttribute('data-tab-trap', '')
    const tabbable =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [tabindex], [contenteditable="true"]'
    return [...dialog.querySelectorAll<HTMLElement>(tabbable)].filter(
      (c) =>
        c.tabIndex >= 0 &&
        !c.matches(':disabled') &&
        c.closest('[inert]') === null &&
        c.checkVisibility({ visibilityProperty: true })
    ).length
  })

/** Puts focus on the first stop in the marked dialog, or its first that opens nothing. */
const focusFirst = (page: Page, opensNothing = false) =>
  page.evaluate((plain) => {
    const dialog = document.querySelector('[data-tab-trap]')!
    const stops = [
      ...dialog.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]'
      ),
    ].filter(
      (c) =>
        c.tabIndex >= 0 &&
        !c.matches(':disabled') &&
        c.checkVisibility({ visibilityProperty: true }) &&
        // An (i) opens its panel when it takes focus, and the panel would take the Escape.
        !(plain && c.hasAttribute('aria-expanded'))
    )
    stops[0].focus()
  }, opensNothing)

async function keepsTab(page: Page, trap: Trap) {
  await (trap.open ? trap.open() : trap.opener.click())
  await expect(trap.inside).toBeVisible()
  await expect
    .poll(() => trap.inside.evaluate((el) => el.contains(document.activeElement)), {
      message: `focus is in ${trap.name}`,
    })
    .toBe(true)
  const stops = await markDialog(trap.inside)

  const presses = stops + 3
  let left = ''
  for (let i = 1; i <= presses; i++) {
    await page.keyboard.press('Tab')
    const now = await where(page)
    if (!now.inside) {
      left = `Tab ${i} of ${presses} (${stops} stops) went to ${now.at}`
      break
    }
  }
  expect.soft(left, `${trap.name}: Tab stays inside`).toBe('')

  await focusFirst(page)
  await page.keyboard.press('Shift+Tab')
  const back = await where(page)
  expect
    .soft(back.inside ? '' : `went to ${back.at}`, `${trap.name}: Shift+Tab from the first stop`)
    .toBe('')

  // Shut from inside, where Escape is the dialog's.
  await focusFirst(page, true)
  await page.keyboard.press('Escape')
  await (trap.shutDone ? trap.shutDone() : expect(trap.inside).toBeHidden())
}

/** The dialogs that stay on the page while shut, faded out to nothing. */
const faded = (dialog: Locator) => () =>
  expect(dialog.locator('xpath=..')).toHaveCSS('opacity', '0')
const noModalOpen = (page: Page) => () =>
  expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0)

test.describe('Tab stays inside the dialog on top @smoke', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
  })

  test('Transactions: the entry form, the shortcuts, Auto, Recurring, Reconcile and the bulk dialogs', async ({
    page,
  }) => {
    await navigateToRoute(page, 'transactions')
    const add = page.getByTestId('add-transaction-btn')
    await expect(add).toBeVisible()
    await keepsTab(page, {
      name: 'Add transaction',
      opener: add,
      inside: page.getByTestId('tx-modal'),
    })
    await keepsTab(page, {
      name: 'Keyboard shortcuts',
      opener: add,
      open: async () => {
        await add.focus()
        await page.keyboard.type('?')
      },
      inside: page.getByTestId('shortcuts-modal'),
    })
    await keepsTab(page, {
      name: 'Auto Categorize',
      opener: page.getByRole('button', { name: 'Auto', exact: true }),
      inside: page.getByTestId('auto-cat-modal'),
    })
    await keepsTab(page, {
      name: 'Recurring rule',
      opener: page
        .getByRole('heading', { name: 'Recurring Transactions' })
        .locator('xpath=..')
        .getByRole('button', { name: 'Add', exact: true }),
      inside: page.getByTestId('recurring-modal'),
    })

    // The rest act on the transactions picked in the list.
    await page.locator('tbody input[type="checkbox"]').first().check()
    const bar = page.getByTestId('bulk-action-bar')
    await expect(bar).toBeVisible()
    await keepsTab(page, {
      name: 'Reconcile',
      opener: page.getByRole('button', { name: 'Reconcile', exact: true }),
      inside: page.getByTestId('reconcile-modal'),
    })
    await keepsTab(page, {
      name: 'Change Category',
      opener: bar.getByRole('button', { name: 'Change Category' }),
      inside: page.getByTestId('bulk-category-modal'),
    })
    await keepsTab(page, {
      name: 'Change Type',
      opener: bar.getByRole('button', { name: 'Change Type' }),
      inside: page.getByTestId('bulk-type-modal'),
    })
    await keepsTab(page, {
      name: 'Tags',
      opener: page.getByTestId('bulk-tag-btn'),
      inside: page.getByTestId('bulk-tag-modal'),
    })
  })

  test('Bills: Add bill and its Add Category, the scan, the catalog and a calendar day', async ({
    page,
  }) => {
    await navigateToRoute(page, 'bills')
    const add = page.getByTestId('add-bill-btn')
    const bill = page.getByTestId('bill-modal')
    await keepsTab(page, { name: 'Add bill', opener: add, inside: bill })

    // Add Category opens over Add bill; Tab stays in Add Category.
    await add.click()
    await expect.poll(() => bill.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await keepsTab(page, {
      name: 'Add Category over Add bill',
      opener: bill.getByRole('button', { name: /Add Category/ }),
      inside: page.getByPlaceholder('e.g., Utilities, Entertainment'),
    })
    await page.keyboard.press('Escape')
    await expect(bill).toBeHidden()

    await page.getByTestId('bills-tab-subscriptions').click()
    const scan = page.getByTestId('sub-scan-modal')
    await keepsTab(page, {
      name: 'Subscription scan',
      opener: page.getByTestId('scan-subscriptions-btn'),
      inside: scan,
      shutDone: faded(scan),
    })
    const catalog = page.getByRole('dialog', { name: 'Subscription catalog' })
    await keepsTab(page, {
      name: 'Subscription catalog',
      opener: page.getByTestId('browse-catalog-btn'),
      inside: catalog,
      shutDone: faded(catalog),
    })

    await page.getByRole('button', { name: 'Calendar', exact: true }).click()
    const day = page.locator('[role="button"][tabindex="0"]').filter({ hasText: /^\d{1,2}/ })
    await expect(day.first()).toBeVisible()
    await keepsTab(page, {
      name: 'Bill calendar day',
      opener: day.first(),
      inside: page.getByRole('dialog').filter({ has: page.locator('#bill-cal-popover-title') }),
    })
  })

  test('Goals, Accounts, Housing, Portfolio and Retirement: each Add dialog', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    const addGoal = page.getByTestId('add-goal-btn')
    const goal = page.getByTestId('goals-modal')
    await keepsTab(page, { name: 'New Goal', opener: addGoal, inside: goal })
    await addGoal.click()
    await expect.poll(() => goal.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await keepsTab(page, {
      name: 'Add Category over New Goal',
      opener: goal.getByRole('button', { name: /Add Category/ }),
      inside: page.getByPlaceholder('e.g., Vacation Fund'),
    })
    await page.keyboard.press('Escape')
    await expect(goal).toBeHidden()

    await navigateToRoute(page, 'accounts')
    await keepsTab(page, {
      name: 'Add account',
      opener: page.getByTestId('add-account-btn'),
      inside: page.getByTestId('add-account-modal'),
    })
    await navigateToRoute(page, 'housing')
    await keepsTab(page, {
      name: 'Add housing',
      opener: page.getByTestId('add-housing-btn'),
      inside: page.getByTestId('housing-modal'),
    })
    await navigateToRoute(page, 'portfolio')
    await keepsTab(page, {
      name: 'Add holding',
      opener: page.getByTestId('add-holding-btn'),
      inside: page.getByTestId('portfolio-modal'),
    })
    await navigateToRoute(page, 'retirement')
    await keepsTab(page, {
      name: 'Add retirement goal',
      opener: page.getByTestId('add-retirement-goal-btn'),
      inside: page.getByTestId('retirement-modal-overlay'),
    })
  })

  test('Categories and Budgets: Add Category, the icon gallery, Set Budget and Add Allocation', async ({
    page,
  }) => {
    await navigateToRoute(page, 'categories')
    const add = page.getByTestId('add-category-btn')
    const category = page.getByTestId('category-modal-overlay')
    await keepsTab(page, { name: 'Add Category', opener: add, inside: category })
    await add.click()
    await expect
      .poll(() => category.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true)
    await keepsTab(page, {
      name: 'Icon gallery over Add Category',
      opener: page.getByTestId('category-icon-browse'),
      inside: page.getByRole('dialog', { name: 'Choose an icon' }),
    })
    await page.keyboard.press('Escape')
    await expect(category).toBeHidden()

    const budgetAmount = page.getByPlaceholder('500.00')
    await keepsTab(page, {
      name: 'Set Budget (Categories)',
      opener: page
        .getByTestId('category-card')
        .first()
        .getByRole('button', { name: 'Budget', exact: true }),
      inside: budgetAmount,
    })

    await navigateToRoute(page, 'budgets')
    await keepsTab(page, {
      name: 'Add Category (Budgets)',
      opener: page.getByRole('button', { name: 'Add Category' }),
      inside: page.getByTestId('budgets-category-modal'),
    })
    await keepsTab(page, {
      name: 'Set Budget (Budgets)',
      opener: page.getByRole('button', { name: 'Set Budget' }).first(),
      inside: budgetAmount,
    })
    await keepsTab(page, {
      name: 'Add Allocation',
      opener: page.getByRole('button', { name: 'Add Allocation' }),
      inside: page.getByTestId('budgets-allocate-modal'),
    })
  })

  test('Loans, the shell and Settings: the loan form, the confirm, the shell dialogs and the changelog', async ({
    page,
  }) => {
    await navigateToRoute(page, 'loans')
    await keepsTab(page, {
      name: 'Add a loan',
      opener: page.getByTestId('add-loan-btn'),
      inside: page.getByTestId('loans-modal'),
    })
    const menu = page.getByTestId('loans-item-menu').first()
    await keepsTab(page, {
      name: 'Delete confirmation',
      opener: menu,
      open: async () => {
        await menu.click()
        await page.getByTestId('loans-item-delete').click()
      },
      inside: page.getByRole('alertdialog'),
    })

    await navigateToRoute(page, 'dashboard')
    await keepsTab(page, {
      name: 'Dashboard Views',
      opener: page.getByTestId('dashboard-views'),
      inside: page.getByRole('dialog', { name: 'Dashboard Views' }),
    })
    await keepsTab(page, {
      name: 'Take a Tour',
      opener: page.getByTestId('whats-new-btn'),
      inside: page.getByRole('dialog', { name: 'Take a Tour' }),
    })
    const profileButton = page.getByTestId('profile-dropdown-btn')
    await keepsTab(page, {
      name: 'Create Profile',
      opener: profileButton,
      open: async () => {
        await profileButton.click()
        await page.getByTestId('profile-create-item').click()
      },
      inside: page.getByTestId('profile-modal'),
    })
    await keepsTab(page, {
      name: 'Choose period',
      opener: page.getByTestId('period-label').first(),
      inside: page.getByRole('dialog', { name: 'Choose period' }),
    })
    await keepsTab(page, {
      name: 'Quick add',
      opener: page.getByRole('button', { name: 'Quick add entry' }),
      inside: page.getByRole('dialog', { name: 'Add transaction' }),
      shutDone: noModalOpen(page),
    })
    await keepsTab(page, {
      name: 'Command bar',
      opener: page.getByTestId('profile-dropdown-btn'),
      open: async () => {
        await page.keyboard.press('Control+k')
      },
      inside: page.getByRole('dialog', { name: 'Quick entry command bar' }),
      shutDone: noModalOpen(page),
    })

    await navigateToRoute(page, 'settings')
    await page.getByTestId('settings-tab-about').click()
    await keepsTab(page, {
      name: 'Changelog',
      opener: page.getByRole('button', { name: 'View Changelog' }),
      inside: page.getByRole('dialog', { name: 'Changelog' }),
    })
  })

  test('an (i) in a dialog still opens and closes from the keyboard', async ({ page }) => {
    await navigateToRoute(page, 'transactions')
    await page.getByTestId('add-transaction-btn').click()
    const form = page.getByTestId('tx-modal')
    await expect.poll(() => form.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    const info = form.getByRole('button', { name: /^How much money moved/ })
    const panel = page.getByRole('tooltip')

    // Tab to it: the panel opens as it takes focus.
    const stops = await markDialog(form)
    for (
      let i = 0;
      i <= stops && !(await info.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab')
    }
    await expect(info).toBeFocused()
    await expect(panel).toBeVisible()

    // Escape shuts the panel only.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(form).toBeVisible()
    await expect(info).toBeFocused()

    // Enter pins it open, and Enter again shuts it.
    await page.keyboard.press('Enter')
    await expect(panel).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(panel).toBeHidden()

    // Tab goes on to the next stop, still in the form.
    await page.keyboard.press('Tab')
    expect((await where(page)).inside).toBe(true)
    await expect(panel).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
  })
})
