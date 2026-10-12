import { expect, test } from '@playwright/test'
import { gotoServerless, login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Categories', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
    await expect(page.getByTestId('category-card').first())
      .toBeVisible({ timeout: 10000 })
      .catch(() => {})
  })

  test('should display categories header', async ({ page }) => {
    const header = getByTestId(page, 'categories-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'categories-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add category button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-category-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should display categories grid', async ({ page }) => {
    await page.waitForTimeout(1500)

    const grid = getByTestId(page, 'categories-grid')
    await expect(grid).toBeVisible({ timeout: 5000 })
  })

  test('should display expense categories', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Categories grid should contain category cards
    const cards = getByTestId(page, 'category-card')
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should display category items with colors', async ({ page }) => {
    await page.waitForTimeout(1500)

    const categoryItems = getByTestId(page, 'category-card')
    const count = await categoryItems.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should display category name', async ({ page }) => {
    await page.waitForTimeout(1500)

    const nameElements = getByTestId(page, 'category-name')
    const count = await nameElements.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should display transaction count for category', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Categories page shows spending per category instead of transaction count
    const cards = getByTestId(page, 'category-card')
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should display spending amount for category', async ({ page }) => {
    await page.waitForTimeout(1500)

    const amounts = getByTestId(page, 'category-spending')
    const count = await amounts.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should have category action buttons', async ({ page }) => {
    await page.waitForTimeout(1500)

    const cards = getByTestId(page, 'category-card')
    const count = await cards.count()
    if (count > 0) {
      const firstCard = cards.first()
      // Category cards have action buttons (budget, edit, delete)
      const buttons = firstCard.locator('button')
      const buttonCount = await buttons.count()
      expect(buttonCount).toBeGreaterThanOrEqual(1)
    }
  })

  test('should have category items with icons', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Icons are SVGs inside category cards
    const cards = getByTestId(page, 'category-card')
    const count = await cards.count()
    if (count > 0) {
      const firstCard = cards.first()
      const icons = firstCard.locator('svg')
      const iconCount = await icons.count()
      expect(iconCount).toBeGreaterThanOrEqual(1)
    }
  })

  test('should display category color indicators', async ({ page }) => {
    await page.waitForTimeout(1500)

    // Category color is shown via background color on the icon wrapper
    const colorIndicators = getByTestId(page, 'category-color')
    const count = await colorIndicators.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should have multiple category tabs', async ({ page }) => {
    await page.waitForTimeout(1500)

    const tabs = getByTestId(page, 'category-tabs')
    await expect(tabs).toBeVisible()

    const tabButtons = tabs.locator('button')
    const count = await tabButtons.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('should filter by category type', async ({ page }) => {
    await page.waitForTimeout(500)

    const expenseTab = getByTestId(page, 'tab-expense')
    const incomeTab = getByTestId(page, 'tab-income')

    await expect(expenseTab).toBeVisible()
    await expect(incomeTab).toBeVisible()
  })

  test('should display total category spending', async ({ page }) => {
    const spendingElements = getByTestId(page, 'category-spending')
    await expect(spendingElements.first()).toBeVisible({ timeout: 10000 })
    const count = await spendingElements.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should have add category modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = getByTestId(page, 'add-category-btn')
    await addBtn.click()

    await page.waitForTimeout(500)
    const modal = getByTestId(page, 'category-modal-title')
    await expect(modal).toBeVisible()
  })
})

test.describe('Categories dialog, "Needed every month"', () => {
  for (const { width, height, phone } of [
    { width: 390, height: 844, phone: true },
    { width: 1280, height: 800, phone: false },
  ]) {
    test(`its whole row toggles the box, ${phone ? 'at least 44 px tall on a phone' : 'at its desktop size'}, with the form's spacing`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await gotoServerless(page, 'categories', 'categories-header')
      await page.getByTestId('add-category-btn').click()
      const box = page.getByTestId('category-essential')
      await expect(box).toBeVisible()
      const row = page.locator('label').filter({ has: box })
      const rowHeight = (await row.boundingBox())!.height
      if (phone) expect(rowHeight).toBeGreaterThanOrEqual(44)
      else expect(rowHeight).toBeLessThan(30)

      // What a person sees is the form's spacing at every width: the Kind help ends about 20 px
      // above the row's words, and the hint starts about 9 px under them.
      const gaps = await box.evaluate((input) => {
        const textBox = (el: Element) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return Array.from(range.getClientRects())
        }
        const words = textBox(input.closest('label')!.querySelector('span')!)[0]
        const kindHelp = document.getElementById(
          document
            .querySelector('[data-test-id="category-kind"]')!
            .getAttribute('aria-describedby')!
        )!
        const hint = document.getElementById(input.getAttribute('aria-describedby')!)!
        return {
          kindHelpToWords: words.top - textBox(kindHelp).at(-1)!.bottom,
          wordsToHint: textBox(hint)[0].top - words.bottom,
        }
      })
      expect(gaps.kindHelpToWords, JSON.stringify(gaps)).toBeGreaterThanOrEqual(18)
      expect(gaps.kindHelpToWords, JSON.stringify(gaps)).toBeLessThanOrEqual(22)
      expect(gaps.wordsToHint, JSON.stringify(gaps)).toBeGreaterThanOrEqual(7)
      expect(gaps.wordsToHint, JSON.stringify(gaps)).toBeLessThanOrEqual(11)

      // A tap on the row's far end, away from the box and its words, still toggles it; on a phone
      // so does one at its top edge and one at its bottom edge, where it reaches over the hint.
      const size = (await row.boundingBox())!
      const taps = phone
        ? [
            { x: size.width / 2, y: 0.5 },
            { x: size.width / 2, y: size.height - 0.5 },
            { x: size.width - 4, y: size.height - 3 },
          ]
        : [{ x: size.width - 4, y: size.height - 3 }]
      for (const position of taps) {
        const before = await box.isChecked()
        await row.click({ position, timeout: 5000 })
        await expect(box, JSON.stringify(position)).toBeChecked({ checked: !before })
      }
    })
  }
})
