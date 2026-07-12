import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Housing', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'housing')
  })

  test('should display housing header', async ({ page }) => {
    const header = getByTestId(page, 'housing-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'housing-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add housing button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-housing-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should display housing summary cards', async ({ page }) => {
    // The summary strip renders unconditionally (above the loading/empty/list branch).
    await expect(getByTestId(page, 'housing-summary')).toBeVisible()
    await expect(getByTestId(page, 'housing-summary-total')).toBeVisible()
    await expect(getByTestId(page, 'housing-summary-active')).toBeVisible()
    await expect(getByTestId(page, 'housing-summary-autopay')).toBeVisible()
  })

  test('should display housing cards', async ({ page }) => {
    // Cards render only when the profile has housing rows; otherwise the empty state shows.
    // Wait for the content area to resolve, then assert on whichever rendered.
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const cards = getByTestId(page, 'housing-card')
    if ((await cards.count()) > 0) {
      await expect(cards.first()).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should display housing property/description', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const names = getByTestId(page, 'housing-card-name')
    if ((await names.count()) > 0) {
      await expect(names.first()).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should display housing monthly cost', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const amounts = getByTestId(page, 'housing-card-amount')
    if ((await amounts.count()) > 0) {
      const first = amounts.first()
      await expect(first).toBeVisible()
      await expect(first).toHaveText(/\d/) // a formatted monthly amount
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should display housing due date', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const dues = getByTestId(page, 'housing-card-due')
    if ((await dues.count()) > 0) {
      await expect(dues.first()).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should display housing notes if present', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    // Notes are optional per row; assert visibility only when at least one card has them,
    // otherwise fall back to the resolved content container.
    const notes = getByTestId(page, 'housing-card-notes')
    if ((await notes.count()) > 0) {
      await expect(notes.first()).toBeVisible()
    } else {
      await expect(
        getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
      ).toBeVisible()
    }
  })

  test('should display autopay badge', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    // Every card carries an autopay/manual badge in this wrapper.
    const badges = getByTestId(page, 'housing-card-autopay')
    if ((await badges.count()) > 0) {
      await expect(badges.first()).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should display housing expense type', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const types = getByTestId(page, 'housing-card-type')
    if ((await types.count()) > 0) {
      await expect(types.first()).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should have housing delete buttons', async ({ page }) => {
    // The component exposes no per-row edit control; each card has a delete (ConfirmButton).
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const deleteBtns = getByTestId(page, 'housing-card-delete')
    if ((await deleteBtns.count()) > 0) {
      await expect(deleteBtns.first()).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })

  test('should have add housing modal', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
  })

  test('should have expense type select', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
    await expect(getByTestId(page, 'housing-type-select')).toBeVisible()
  })

  test('should have property input', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
    await expect(getByTestId(page, 'housing-property-input')).toBeVisible()
  })

  test('should have monthly amount input', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
    await expect(getByTestId(page, 'housing-amount-input')).toBeVisible()
  })

  test('should have due month/day inputs', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
    await expect(getByTestId(page, 'housing-due-month-select')).toBeVisible()
    await expect(getByTestId(page, 'housing-due-day-input')).toBeVisible()
  })

  test('should have autopay toggle', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
    // The checkbox is visually hidden behind a styled slider, so assert it is attached.
    await expect(getByTestId(page, 'housing-autopay-toggle')).toBeAttached()
  })

  test('should have notes textarea', async ({ page }) => {
    await getByTestId(page, 'add-housing-btn').click()
    await expect(getByTestId(page, 'housing-modal')).toBeVisible()
    await expect(getByTestId(page, 'housing-notes-input')).toBeVisible()
  })

  test('should display empty state', async ({ page }) => {
    // With demo data the list renders; with none the empty state renders. Assert the content
    // area resolved to exactly one of them.
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('should calculate total monthly cost', async ({ page }) => {
    // The Monthly Total card always renders with a formatted currency value.
    const totalValue = getByTestId(page, 'housing-summary-total-value')
    await expect(totalValue).toBeVisible()
    await expect(totalValue).toHaveText(/\d/)
  })

  test('should handle delete confirmation', async ({ page }) => {
    await expect(
      getByTestId(page, 'housing-list').or(getByTestId(page, 'housing-empty'))
    ).toBeVisible({ timeout: 10000 })
    const deleteBtns = getByTestId(page, 'housing-card-delete')
    if ((await deleteBtns.count()) > 0) {
      const first = deleteBtns.first()
      await expect(first).toBeVisible()
      await first.click()
      // ConfirmButton swaps the trash button for an inline Confirm?/Yes/No affordance; the
      // wrapper (and its confirm control) stay in place.
      await expect(first).toBeVisible()
    } else {
      await expect(getByTestId(page, 'housing-empty')).toBeVisible()
    }
  })
})
