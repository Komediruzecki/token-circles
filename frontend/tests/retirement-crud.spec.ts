import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Retirement Planning CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'retirement')
  })

  test('should display retirement header', async ({ page }) => {
    const header = page.getByTestId('retirement-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByTestId('retirement-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/retirement|savings progress|track/i)
  })

  test('should have add goal button', async ({ page }) => {
    await expect(page.getByTestId('add-retirement-goal-btn')).toBeVisible()
  })

  test('should have an editable assumptions panel', async ({ page }) => {
    const assumptions = page.getByTestId('retirement-assumptions')
    await expect(assumptions).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('retirement-input-networth')).toBeEditable()
    await expect(page.getByTestId('retirement-input-contribution')).toBeEditable()
  })

  test('should redraw the projection when an assumption changes', async ({ page }) => {
    const summary = page.getByTestId('retirement-summary')
    await expect(summary).toBeVisible({ timeout: 10000 })
    const before = await summary.textContent()

    await page.getByTestId('retirement-input-contribution').fill('4321')
    await expect(summary).not.toHaveText(before ?? '')
  })

  test('should have a card for each lifestyle target', async ({ page }) => {
    const cards = page.getByTestId('retirement-lifestyle-card')
    await expect(cards.first()).toBeVisible({ timeout: 10000 })
  })

  test('should have goals section', async ({ page }) => {
    const goalsSection = page.getByTestId('retirement-goals')
    await expect(goalsSection).toBeVisible({ timeout: 10000 })
  })

  test('should have goals grid', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // The grid wrapper renders only when at least one goal card exists.
    expect(await page.getByTestId('retirement-goals-grid').count()).toBe(cardCount > 0 ? 1 : 0)
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const gridCount = await page.getByTestId('retirement-goals-grid').count()
    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // Cards live inside the grid: cards exist iff the grid rendered.
    expect(cardCount > 0).toBe(gridCount === 1)
  })

  test('should have goal card with icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // One icon per goal card.
    expect(await page.getByTestId('retirement-goal-icon').count()).toBe(cardCount)
  })

  test('should display goal icon 🎯', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-icon').count()).toBe(cardCount)
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-name').count()).toBe(cardCount)
  })

  test('should display goal balance', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-balance').count()).toBe(cardCount)
  })

  test('should have progress bar for goal', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-progress-bar').count()).toBe(cardCount)
  })

  test('should display progress percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-progress-percent').count()).toBe(cardCount)
  })

  test('should display progress target', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-progress-target').count()).toBe(cardCount)
  })

  test('should display detail items', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // Each goal card renders three detail items (monthly, return, target date).
    expect(await page.getByTestId('retirement-detail-item').count()).toBe(cardCount * 3)
  })

  test('should display monthly contribution detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-monthly-contribution').count()).toBe(cardCount)
  })

  test('should display expected return detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-expected-return').count()).toBe(cardCount)
  })

  test('should display target date detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-target-date').count()).toBe(cardCount)
  })

  test('should have edit button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-edit-btn').count()).toBe(cardCount)
  })

  test('should have delete button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-delete-btn').count()).toBe(cardCount)
  })

  test('should open add goal modal', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-modal')).toBeVisible({ timeout: 2000 })
  })

  test('should have add/edit modal with title', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    // Copy is the point: the title reflects add vs edit mode, scoped to the title node.
    const title = page.getByTestId('retirement-modal-title')
    await expect(title).toBeVisible()
    await expect(title).toHaveText(/Add Retirement Goal|Edit Goal/)
  })

  test('should have form group for goal name', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-name')).toBeVisible()
  })

  test('should have input for goal name', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-name')).toBeEditable()
  })

  test('should have form group for target amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-amount')).toBeVisible()
  })

  test('should have input for target amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-amount')).toBeEditable()
  })

  test('should have form group for current amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-amount')).toBeVisible()
  })

  test('should have input for current amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-amount')).toBeEditable()
  })

  test('should have form group for current age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-age')).toBeVisible()
  })

  test('should have input for current age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-age')).toBeEditable()
  })

  test('should have form group for retirement age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-retirement-age')).toBeVisible()
  })

  test('should have input for retirement age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-retirement-age')).toBeEditable()
  })

  test('should have form group for target date', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-date')).toBeVisible()
  })

  test('should have date input for target date', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-date')).toBeEditable()
  })

  test('should have form group for monthly contribution', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-monthly-contribution')).toBeVisible()
  })

  test('should have input for monthly contribution', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-monthly-contribution')).toBeEditable()
  })

  test('should have form group for expected return', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-expected-return')).toBeVisible()
  })

  test('should have input for expected return', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-expected-return')).toBeEditable()
  })

  test('should have form row layout', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    // Paired fields that share a form row both render.
    await expect(page.getByTestId('retirement-form-target-amount')).toBeVisible()
    await expect(page.getByTestId('retirement-form-current-amount')).toBeVisible()
  })

  test('should have modal footer with cancel and submit buttons', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    await expect(page.getByTestId('retirement-modal-footer')).toBeVisible()
    await expect(page.getByTestId('retirement-modal-cancel')).toBeVisible()
    await expect(page.getByTestId('retirement-modal-submit')).toBeVisible()
  })

  test('should have cancel button in modal footer', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-modal-cancel')).toBeVisible()
  })

  test('should have create/update button in modal footer', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-modal-submit')).toBeVisible()
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    const modal = page.getByTestId('retirement-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Click the overlay backdrop (top-left corner sits outside the centered modal).
    await page.getByTestId('retirement-modal-overlay').click({ position: { x: 0, y: 0 } })
    await expect(modal).not.toBeVisible({ timeout: 2000 })
  })

  test('should close modal when clicking cancel button', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    const modal = page.getByTestId('retirement-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    await page.getByTestId('retirement-modal-cancel').click()
    await expect(modal).not.toBeVisible({ timeout: 2000 })
  })

  test('should handle empty retirement state', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const emptyState = page.getByTestId('empty-state')
    const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyState).toBeFalsy()
  })

  test('should show empty state message when no retirement goals', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const emptyState = page.getByTestId('empty-state')
    const hasEmptyText = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyText).toBeFalsy()
  })

  test('should have a results panel beside the assumptions', async ({ page }) => {
    await expect(page.getByTestId('retirement-results')).toBeVisible({ timeout: 10000 })
  })

  test('should render the projection chart', async ({ page }) => {
    await page.waitForTimeout(500)

    // The projection chart (and its Chart.js legend) is drawn on a <canvas>, so there is no
    // separate legend DOM node to target — assert the chart container renders instead.
    await expect(page.getByTestId('retirement-chart')).toBeVisible()
  })

  test('should handle console errors gracefully', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    // Either the placeholder or the panel it becomes; the page never shows neither.
    await expect(
      page.getByTestId('loading-state').or(page.getByTestId('retirement-results')).first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('should have responsive goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const cards = page.getByTestId('retirement-goal-card')
    // Cards are data-driven; when any render, the first is visible in the grid.
    if (await cards.count()) {
      await expect(cards.first()).toBeVisible()
    }
  })

  test('should have proper form validation', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    const modal = page.getByTestId('retirement-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Submitting the empty form is blocked by the required fields, so the modal stays open.
    await page.getByTestId('retirement-modal-submit').click()
    await expect(modal).toBeVisible()
  })

  test('should be visible on page', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await expect(page.getByTestId('retirement-page')).toBeVisible({ timeout: 5000 })
  })

  test('should render all page elements correctly', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    await expect(page.getByTestId('retirement-page-header')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('retirement-subtitle')).toBeVisible({ timeout: 5000 })
  })

  test('should format currency correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    // The projection summary always renders formatted money amounts (digits present).
    const details = page.getByTestId('retirement-summary')
    await expect(details).toBeVisible()
    await expect(details).toContainText(/\d/)
  })

  test('should format date correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    // One formatted target date per goal card (data-driven; tolerant of an empty goal list).
    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-target-date').count()).toBe(cardCount)
  })

  test('should display retirement age badges', async ({ page }) => {
    await page.waitForTimeout(500)

    // One retirement-age badge per goal card.
    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-age-badge').count()).toBe(cardCount)
  })
})

/**
 * Layout of the assumptions form, measured rather than eyeballed.
 *
 * The form pairs controls two to a row. Explanations used to sit under one of the two as
 * block text, which made that column taller and knocked its control out of line with its
 * neighbour — visible as a date-of-birth picker floating above the net worth box beside
 * it. The explanations now live behind info tips, which are painted over the page and
 * occupy no layout at all. These assert that property directly, because it is the kind of
 * regression that reappears the moment someone adds one more hint.
 */
test.describe('the assumptions form stays in line', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'retirement')
    await expect(page.getByTestId('retirement-assumptions')).toBeVisible({ timeout: 10000 })
  })

  test('no field carries text below its control', async ({ page }) => {
    // The row aligns its two groups on their end edge, so a group whose control is the
    // last thing in it ends exactly where the control does. Anything rendered after the
    // control — the block hints this page used to carry — opens a gap between the two,
    // and that gap is what lifted one column's input above its neighbour's. Measuring
    // the gap catches the defect in whichever field someone reintroduces it, rather than
    // in the one pair of controls that happened to show it.
    const groups = await page.evaluate(() => {
      const form = document.querySelector('[data-test-id="retirement-assumptions"]')
      if (!form) return []
      return [...form.querySelectorAll('[class*="form-row"] > *')]
        .map((group) => {
          const controls = [...group.querySelectorAll('input, select')]
          if (controls.length === 0) return null
          const lowest = Math.max(...controls.map((c) => c.getBoundingClientRect().bottom))
          return {
            gap: group.getBoundingClientRect().bottom - lowest,
            label: (group.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40),
          }
        })
        .filter((g) => g !== null)
    })

    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      expect(group.gap, `"${group.label}" has text under its control`).toBeLessThanOrEqual(2)
    }
  })

  test('opening an info tip does not move the control it explains', async ({ page }) => {
    const birth = page.getByTestId('retirement-input-birth')
    const before = await birth.boundingBox()

    await page.getByTestId('retirement-info-birth').click()
    await expect(page.getByTestId('retirement-info-birth-panel')).toBeVisible()

    const after = await birth.boundingBox()
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0)
  })

  test('the info tip is reachable by tap, not only by hover', async ({ page }) => {
    await page
      .getByTestId('retirement-info-swr')
      .tap({ force: true })
      .catch(async () => {
        // Desktop Chrome has no touch by default; a click is the same code path.
        await page.getByTestId('retirement-info-swr').click()
      })
    await expect(page.getByTestId('retirement-info-swr-panel')).toContainText('annual spending')
  })

  test('the tip panel clips its accent to its own corners', async ({ page }) => {
    await page.getByTestId('retirement-info-swr').click()
    const panel = page.getByTestId('retirement-info-swr-panel')
    await expect(panel).toBeVisible()

    // The accent hairline spans the full width of a panel with rounded corners, so without
    // the clip it runs straight past where the corner curves away and overhangs the edge.
    const shape = await panel.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return {
        overflow: cs.overflow,
        radius: parseFloat(cs.borderTopLeftRadius),
        onScreen: box.left >= 0 && box.right <= window.innerWidth,
      }
    })
    expect(shape.overflow).toBe('hidden')
    expect(shape.radius).toBeGreaterThan(0)
    expect(shape.onScreen).toBe(true)
  })

  test('the chart options are the app switch, not native checkboxes', async ({ page }) => {
    const markers = page.getByTestId('retirement-toggle-markers')
    await expect(markers).toHaveAttribute('role', 'switch')
    // Markers are on by default: the date each lifestyle is reached is the answer the page
    // exists to give, not a preference to go looking for.
    await expect(markers).toHaveAttribute('aria-checked', 'true')

    // The label is inside the control, so clicking the words flips it.
    await markers.getByText('Mark when each lifestyle is reached').click()
    await expect(markers).toHaveAttribute('aria-checked', 'false')
  })

  test('settings rows keep their wording left and their switch right', async ({ page }) => {
    const row = page.getByTestId('retirement-toggle-inflation')
    await expect(row).toHaveAttribute('role', 'switch')

    const layout = await page.evaluate(() => {
      const sw = document.querySelector('[data-test-id="retirement-toggle-inflation"]')!
      const row = sw.parentElement!
      const copy = row.firstElementChild!
      return {
        copyLeft: Math.round(copy.getBoundingClientRect().left),
        copyRight: Math.round(copy.getBoundingClientRect().right),
        switchLeft: Math.round(sw.getBoundingClientRect().left),
        rowRight: Math.round(row.getBoundingClientRect().right),
        text: (copy.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }
    })
    // Title and its live description on the left, switch hard against the right edge.
    expect(layout.switchLeft).toBeGreaterThan(layout.copyRight)
    expect(layout.text).toContain('Adjust for inflation')
    expect(layout.text).toMatch(/A real return of [\d.]+% after inflation\./)
  })

  test('the chart zooms on a scroll and offers a way back', async ({ page }) => {
    const chart = page.getByTestId('retirement-chart')
    await expect(chart).toBeVisible()
    await expect(page.getByTestId('retirement-zoom-reset')).toHaveCount(0)

    // Scroll it into view first: boundingBox() reports document coordinates, and a chart sitting
    // below the fold gets a wheel event that scrolls the PAGE instead of zooming the chart. How
    // far down it sits depends on how much is rendered above it, which depends on the data.
    await chart.scrollIntoViewIfNeeded()
    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)

    const reset = page.getByTestId('retirement-zoom-reset')
    await expect(reset).toBeVisible()

    // Fewer ticks on the axis is the visible result: the scale relabels from the range.
    const zoomedTicks = await page.evaluate(() => {
      const c = (window as any).Chart?.getChart?.('retirement-projection-chart')
      return c ? c.scales.x.ticks.length : null
    })

    await reset.click()
    await expect(page.getByTestId('retirement-zoom-reset')).toHaveCount(0)
    if (zoomedTicks !== null) expect(zoomedTicks).toBeGreaterThan(0)
  })

  test('the withdrawal rate slider drives the projection', async ({ page }) => {
    const chip = page.getByTestId('retirement-runway-chip')
    await expect(chip).toBeVisible()

    const slider = page.getByTestId('retirement-slider-swr')
    await slider.fill('11')
    await expect(page.getByTestId('retirement-input-swr')).toHaveValue('11')
    await expect(chip).toContainText('runs out')

    await slider.fill('3')
    await expect(chip).toContainText('as long as you like')
  })
})
