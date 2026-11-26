import { expect, test, type Locator, type Page } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

/**
 * Every dialog takes focus when it opens and gives it back when it shuts (utils/dialogFocus.ts).
 *
 * Focus used to stay on the button that opened a dialog, behind it: `autofocus` works only while a
 * page loads, never on a dialog put on the page later, and most dialogs had nothing else. Tab then
 * walked the page under the dialog, and a screen reader read none of it. Each case opens one
 * dialog the way a person does, checks focus is in it, shuts it, and checks focus is back on what
 * opened it. A dialog with a Cancel or a Close is shut both ways: with that, then with Escape, which
 * shuts only the dialog on top.
 */

/** Whether focus is on `inside` or somewhere within it. */
const holdsFocus = (inside: Locator) => inside.evaluate((el) => el.contains(document.activeElement))

interface Trip {
  /** What a person uses to open it, and where focus goes back to unless `back` says otherwise. */
  opener: Locator
  /** Opens it, when that is more than a click on the opener. */
  open?: () => Promise<void>
  /** The dialog, or the field in it that takes focus. */
  inside: Locator
  /** Escape, or the control that shuts it: then it is shut once with that and once with Escape. */
  shut: 'Escape' | Locator
  /** Where focus goes back to, when that is not the opener. */
  back?: Locator
  /** That it has shut, for a dialog that stays drawn when shut. Default: `inside` is hidden. */
  shutDone?: () => Promise<void>
}

async function openAndShut(page: Page, trip: Trip, shut: 'Escape' | Locator) {
  await (trip.open ? trip.open() : trip.opener.click())
  await expect(trip.inside).toBeVisible()
  await expect
    .poll(() => holdsFocus(trip.inside), { message: `focus is in what ${trip.opener} opened` })
    .toBe(true)

  if (shut === 'Escape') await page.keyboard.press('Escape')
  else await shut.click()
  await (trip.shutDone ? trip.shutDone() : expect(trip.inside).toBeHidden())
  await expect(trip.back ?? trip.opener).toBeFocused()
}

async function roundTrip(page: Page, trip: Trip) {
  await openAndShut(page, trip, trip.shut)
  if (trip.shut !== 'Escape') await openAndShut(page, trip, 'Escape')
}

/** A form's Cancel, found by a field only that form has. */
const cancelBeside = (page: Page, field: Locator) =>
  page.locator('form').filter({ has: field }).getByRole('button', { name: 'Cancel' })

test.describe('every dialog takes focus and gives it back @smoke', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)
  })

  test('Transactions: the entry form, the shortcuts, Auto, Reconcile, the bulk dialogs and Recurring', async ({
    page,
  }) => {
    await navigateToRoute(page, 'transactions')
    const add = page.getByTestId('add-transaction-btn')
    await expect(add).toBeVisible()

    await roundTrip(page, { opener: add, inside: page.getByTestId('tx-modal'), shut: 'Escape' })
    await roundTrip(page, {
      opener: add,
      open: async () => {
        await add.focus()
        await page.keyboard.type('?')
      },
      inside: page.getByTestId('shortcuts-modal'),
      shut: 'Escape',
    })
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'Auto', exact: true }),
      inside: page.getByTestId('auto-cat-modal'),
      shut: 'Escape',
    })

    const recurringAdd = page
      .getByRole('heading', { name: 'Recurring Transactions' })
      .locator('xpath=..')
      .getByRole('button', { name: 'Add', exact: true })
    const recurring = page.getByTestId('recurring-modal')
    await roundTrip(page, {
      opener: recurringAdd,
      inside: recurring,
      shut: recurring.getByRole('button', { name: 'Cancel' }),
    })

    // The rest act on the transactions picked in the list.
    await page.locator('tbody input[type="checkbox"]').first().check()
    const bar = page.getByTestId('bulk-action-bar')
    await expect(bar).toBeVisible()
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'Reconcile', exact: true }),
      inside: page.getByTestId('reconcile-modal'),
      shut: 'Escape',
    })
    const byCategory = page.getByTestId('bulk-category-modal')
    await roundTrip(page, {
      opener: bar.getByRole('button', { name: 'Change Category' }),
      inside: byCategory,
      shut: byCategory.getByRole('button', { name: 'Cancel' }),
    })
    const byType = page.getByTestId('bulk-type-modal')
    await roundTrip(page, {
      opener: bar.getByRole('button', { name: 'Change Type' }),
      inside: byType,
      shut: byType.getByRole('button', { name: 'Cancel' }),
    })
    const tags = page.getByTestId('bulk-tag-modal')
    await roundTrip(page, {
      opener: page.getByTestId('bulk-tag-btn'),
      inside: tags,
      shut: tags.getByRole('button', { name: 'Cancel' }),
    })
  })

  test('Bills: Add bill and its Add Category, the calendar, the scan and the catalog', async ({
    page,
  }) => {
    await navigateToRoute(page, 'bills')
    const add = page.getByTestId('add-bill-btn')
    const bill = page.getByTestId('bill-modal')
    await roundTrip(page, {
      opener: add,
      inside: bill,
      shut: bill.getByRole('button', { name: 'Cancel' }),
    })

    // Add Category opens over Add bill, and gives focus back into it.
    await add.click()
    await expect.poll(() => holdsFocus(bill)).toBe(true)
    const categoryName = page.getByPlaceholder('e.g., Utilities, Entertainment')
    const addCategory = bill.getByRole('button', { name: /Add Category/ })
    await roundTrip(page, {
      opener: addCategory,
      inside: categoryName,
      shut: cancelBeside(page, categoryName),
    })
    await bill.getByRole('button', { name: 'Cancel' }).click()
    await expect(add).toBeFocused()

    // Escape shuts only the dialog on top: Add Category, then Add bill.
    await add.click()
    await expect.poll(() => holdsFocus(bill)).toBe(true)
    await addCategory.click()
    await expect.poll(() => holdsFocus(categoryName)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(categoryName).toBeHidden()
    await expect(bill).toBeVisible()
    await expect(addCategory).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(bill).toBeHidden()
    await expect(add).toBeFocused()

    // The scan and the catalog are on the Subscriptions tab.
    await page.getByTestId('bills-tab-subscriptions').click()
    // Both stay on the page while shut, faded out to nothing.
    const faded = (dialog: Locator) => () =>
      expect(dialog.locator('xpath=..')).toHaveCSS('opacity', '0')
    const scan = page.getByTestId('sub-scan-modal')
    await roundTrip(page, {
      opener: page.getByTestId('scan-subscriptions-btn'),
      inside: scan,
      shut: scan.getByRole('button', { name: 'Close' }),
      shutDone: faded(scan),
    })
    const catalog = page.getByRole('dialog', { name: 'Subscription catalog' })
    await roundTrip(page, {
      opener: page.getByTestId('browse-catalog-btn'),
      inside: catalog,
      shut: catalog.getByRole('button', { name: 'Close' }),
      shutDone: faded(catalog),
    })

    await page.getByRole('button', { name: 'Calendar', exact: true }).click()
    const day = page.locator('[role="button"][tabindex="0"]').filter({ hasText: /^\d{1,2}/ })
    await expect(day.first()).toBeVisible()
    const popover = page
      .getByRole('dialog')
      .filter({ has: page.locator('#bill-cal-popover-title') })
    await roundTrip(page, {
      opener: day.first(),
      inside: popover,
      shut: popover.getByRole('button', { name: 'Close' }),
    })
  })

  test('Goals: New Goal and its Add Category, and Add money', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    const add = page.getByTestId('add-goal-btn')
    const goal = page.getByTestId('goals-modal')
    await roundTrip(page, {
      opener: add,
      inside: goal,
      shut: page.getByTestId('goals-modal-cancel'),
    })

    await add.click()
    await expect.poll(() => holdsFocus(goal)).toBe(true)
    const categoryName = page.getByPlaceholder('e.g., Vacation Fund')
    await roundTrip(page, {
      opener: goal.getByRole('button', { name: /Add Category/ }),
      inside: categoryName,
      shut: cancelBeside(page, categoryName),
    })
    await page.getByTestId('goals-modal-cancel').click()
    await expect(add).toBeFocused()

    // Add money opens in place of its button, and the button is made again when it shuts.
    await roundTrip(page, {
      opener: page.getByTestId('goal-contribute-btn').first(),
      inside: page.getByTestId('goal-contribute-form'),
      shut: 'Escape',
      back: page.getByTestId('goal-contribute-btn').first(),
    })
  })

  test('Accounts, Housing, Portfolio and Retirement: each Add dialog', async ({ page }) => {
    await navigateToRoute(page, 'accounts')
    const account = page.getByTestId('add-account-modal')
    await roundTrip(page, {
      opener: page.getByTestId('add-account-btn'),
      inside: account,
      shut: account.getByRole('button', { name: 'Cancel' }),
    })

    await navigateToRoute(page, 'housing')
    const housing = page.getByTestId('housing-modal')
    await roundTrip(page, {
      opener: page.getByTestId('add-housing-btn'),
      inside: housing,
      shut: housing.getByRole('button', { name: 'Cancel' }),
    })

    await navigateToRoute(page, 'portfolio')
    const holding = page.getByTestId('portfolio-modal')
    await roundTrip(page, {
      opener: page.getByTestId('add-holding-btn'),
      inside: holding,
      shut: holding.getByRole('button', { name: 'Cancel' }),
    })

    await navigateToRoute(page, 'retirement')
    await roundTrip(page, {
      opener: page.getByTestId('add-retirement-goal-btn'),
      inside: page.getByTestId('retirement-modal-overlay'),
      shut: page.getByTestId('retirement-modal-cancel'),
    })
  })

  test('Categories and Budgets: Add Category, the icon gallery, Set Budget and Add Allocation', async ({
    page,
  }) => {
    await navigateToRoute(page, 'categories')
    const add = page.getByTestId('add-category-btn')
    const category = page.getByTestId('category-modal-overlay')
    await add.click()
    await expect.poll(() => holdsFocus(category)).toBe(true)
    // The icon gallery opens over Add Category, and gives focus back into it.
    await roundTrip(page, {
      opener: page.getByTestId('category-icon-browse'),
      inside: page.getByTestId('icon-picker-overlay'),
      shut: 'Escape',
    })
    await category.getByRole('button', { name: 'Cancel' }).click()
    await expect(category).toBeHidden()
    await expect(add).toBeFocused()
    await roundTrip(page, { opener: add, inside: category, shut: 'Escape' })

    const budgetAmount = page.getByPlaceholder('500.00')
    await roundTrip(page, {
      opener: page
        .getByTestId('category-card')
        .first()
        .getByRole('button', { name: 'Budget', exact: true }),
      inside: budgetAmount,
      shut: cancelBeside(page, budgetAmount),
    })

    await navigateToRoute(page, 'budgets')
    const budgetCategory = page.getByTestId('budgets-category-modal')
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'Add Category' }),
      inside: budgetCategory,
      shut: budgetCategory.getByRole('button', { name: 'Cancel' }),
    })
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'Set Budget' }).first(),
      inside: budgetAmount,
      shut: cancelBeside(page, budgetAmount),
    })
    const allocate = page.getByTestId('budgets-allocate-modal')
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'Add Allocation' }),
      inside: allocate,
      shut: allocate.getByRole('button', { name: 'Cancel' }),
    })
  })

  test('Loans: Add a loan, and the Delete confirmation from a card menu', async ({ page }) => {
    await navigateToRoute(page, 'loans')
    await roundTrip(page, {
      opener: page.getByTestId('add-loan-btn'),
      inside: page.getByTestId('loans-modal'),
      shut: 'Escape',
    })

    // The menu puts focus back on its button before Delete runs, so that is what opened it.
    const menus = page.getByTestId('loans-item-menu')
    const loans = await menus.count()
    const menu = menus.first()
    const confirm = page.getByRole('alertdialog')
    await roundTrip(page, {
      opener: menu,
      open: async () => {
        await menu.click()
        await page.getByTestId('loans-item-delete').click()
      },
      inside: confirm,
      shut: page.getByTestId('confirm-cancel'),
    })
    // Escape cancelled the delete: it never confirms.
    await expect(menus).toHaveCount(loans)
  })

  test('Escape over Add a loan or Add transaction shuts only the shortcuts list on top', async ({
    page,
  }) => {
    // "?" opens the list over the dialog from one of its buttons (in a field it is typed). The
    // first Escape shuts the list and puts focus back on that button; the next shuts the dialog.
    const list = page.getByTestId('shortcuts-modal')
    const listOver = async (dialog: Locator, button: Locator) => {
      await expect.poll(() => holdsFocus(dialog)).toBe(true)
      await button.focus()
      await page.keyboard.type('?')
      await expect(list).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(list).toBeHidden()
      await expect(dialog).toBeVisible()
      await expect(button).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    await navigateToRoute(page, 'loans')
    await page.getByTestId('add-loan-btn').click()
    const loan = page.getByTestId('loans-modal')
    await listOver(loan, loan.getByRole('button', { name: 'Cancel', exact: true }))

    await navigateToRoute(page, 'transactions')
    await page.getByTestId('add-transaction-btn').click()
    await listOver(page.getByTestId('tx-modal'), page.getByTestId('tx-cancel-btn'))
  })

  test('The shell: Dashboard Views, Take a Tour, Create Profile, the period and Quick add', async ({
    page,
  }) => {
    await navigateToRoute(page, 'dashboard')
    const views = page.getByRole('dialog', { name: 'Dashboard Views' })
    await roundTrip(page, {
      opener: page.getByTestId('dashboard-views'),
      inside: views,
      shut: views.getByRole('button', { name: 'Close', exact: true }),
    })

    const tour = page.getByRole('dialog', { name: 'Take a Tour' })
    await roundTrip(page, {
      opener: page.getByTestId('whats-new-btn'),
      inside: tour,
      shut: tour.getByRole('button', { name: 'Close' }),
    })

    // Create Profile is an item in the profile menu, which is gone by the time it shuts: focus goes
    // back to the menu's button.
    const profileButton = page.getByTestId('profile-dropdown-btn')
    await roundTrip(page, {
      opener: profileButton,
      open: async () => {
        await profileButton.click()
        await page.getByTestId('profile-create-item').click()
      },
      inside: page.getByTestId('profile-modal'),
      shut: 'Escape',
    })

    await roundTrip(page, {
      opener: page.getByTestId('period-label').first(),
      inside: page.getByRole('dialog', { name: 'Choose period' }),
      shut: 'Escape',
    })

    const quickAdd = page.getByRole('button', { name: 'Quick add entry' })
    const sheet = page.getByRole('dialog', { name: 'Add transaction' })
    await roundTrip(page, {
      opener: quickAdd,
      inside: sheet,
      shut: 'Escape',
      shutDone: () => expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0),
    })
  })

  test('Settings: the changelog, the shortcuts, Rename profile and Delete account', async ({
    page,
  }) => {
    await navigateToRoute(page, 'settings')

    await page.getByTestId('settings-tab-about').click()
    const changelog = page.getByRole('dialog', { name: 'Changelog' })
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'View Changelog' }),
      inside: changelog,
      shut: changelog.getByRole('button', { name: 'Close changelog' }),
    })
    await roundTrip(page, {
      opener: page.getByRole('button', { name: 'Keyboard shortcuts' }),
      inside: page.getByTestId('shortcuts-modal'),
      shut: 'Escape',
    })

    // Each profile's Edit opens its rename in place, and is made again when it shuts.
    await page.getByTestId('settings-tab-exports').click()
    const rename = page
      .getByTestId(/^household-profile-/)
      .first()
      .getByRole('button', { name: 'Edit', exact: true })
    await roundTrip(page, {
      opener: rename,
      inside: page.getByTestId('household-rename-input'),
      shut: 'Escape',
      back: rename,
    })

    await page.getByTestId('settings-tab-billing').click()
    const deleteAccount = page.getByRole('button', { name: 'Delete account' })
    const email = page.getByPlaceholder('you@example.com')
    await roundTrip(page, {
      opener: deleteAccount,
      inside: email,
      shut: page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }),
      back: deleteAccount,
    })
  })
})

test.describe('Escape during a tour @smoke', () => {
  test('ends the tour and leaves the dialog under it open for the next Escape', async ({
    page,
  }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    // Take a Tour is a dialog: from it on, the dialogs' Escape is listening before the tour's.
    await page.getByTestId('whats-new-btn').click()
    const picker = page.getByRole('dialog', { name: 'Take a Tour' })
    await picker.getByRole('button', { name: /^Transactions/ }).click()
    const card = page.locator('[data-tour-card]')
    await expect(card).toBeVisible()
    await expect(picker).toBeHidden()

    // The shortcuts list opens under the tour, which is drawn over everything.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await page.keyboard.type('?')
    const list = page.getByTestId('shortcuts-modal')
    await expect(list).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
  })
})

/**
 * Every control Tab stops on, from the top of the page until it comes round again, and the dialog
 * each is in. `walk` names the round, so a second walk on the same page counts afresh.
 */
async function tabStops(page: Page, walk: string, limit = 600) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const stops: { name: string; dialog: string | null }[] = []
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate((round) => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || el === document.body) return null
      if (el.dataset.tabWalk === round) return 'again'
      el.dataset.tabWalk = round
      const dialog = el.closest('[role="dialog"], [role="alertdialog"]')
      const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30)
      return {
        name: `${el.tagName.toLowerCase()} "${name}"`,
        dialog: dialog === null ? null : (dialog.getAttribute('aria-label') ?? 'a dialog'),
      }
    }, walk)
    if (stop === 'again') break
    if (stop) stops.push(stop)
  }
  return stops
}

test.describe('a shut dialog is out of the tab order @smoke', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)
  })

  // The subscription scan and catalog stay on the page while shut, faded out to nothing. Tab
  // walked into them: the catalog's 126 controls and the scan's Close, on Bills, and the scan's
  // Close on Import. Nothing is open in these walks, so a stop in any dialog is a stop in a shut one.
  test('Tab through Bills and Import never lands inside a shut dialog', async ({ page }) => {
    const inDialogs = async (walk: string) => {
      const stops = await tabStops(page, walk)
      expect(stops.length, `Tab stops on ${walk}`).toBeGreaterThan(10)
      return stops.filter((s) => s.dialog !== null).map((s) => `${s.dialog}: ${s.name}`)
    }

    await navigateToRoute(page, 'bills')
    await expect(page.getByTestId('add-bill-btn')).toBeVisible()
    await expect(page.getByTestId('sub-scan-modal').first()).toBeAttached()
    expect(await inDialogs('bills')).toEqual([])

    await page.getByTestId('bills-tab-subscriptions').click()
    await expect(page.getByTestId('scan-subscriptions-btn')).toBeVisible()
    expect(await inDialogs('subscriptions')).toEqual([])

    // Bills can stay on the page, hidden, a moment after it is left: two scans then.
    await navigateToRoute(page, 'import')
    await expect(page.getByTestId('import-header')).toBeVisible()
    await expect(page.getByTestId('sub-scan-modal').last()).toBeAttached()
    expect(await inDialogs('import')).toEqual([])
  })
})
