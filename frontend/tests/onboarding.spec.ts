/**
 * Onboarding wizard e2e.
 *
 * Zero-state boots (no demo seed, no profiles) auto-open the wizard — the
 * state a brand-new signup lands in. The @smoke path walks the whole core
 * flow; the rest cover skip/relaunch semantics, the embedded importer, and
 * subscription detection end-to-end.
 */
import { expect, test } from '@playwright/test'
import { gotoServerless, gotoServerlessZeroState } from './test-helpers'

test.describe('onboarding wizard', () => {
  test('@smoke auto-opens for a pristine user and completes the core path', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    // Welcome step
    await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

    // Your space: rename + base currency
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    const nameInput = page.getByTestId('onboarding-profile-name')
    await expect(nameInput).toHaveValue('Personal Profile')
    await nameInput.fill('My Money')
    await page.getByTestId('onboarding-currency').selectOption('EUR')
    await page.getByTestId('onboarding-next').click()

    // First account
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-account-name').fill('Main Checking')
    await page.getByTestId('onboarding-account-balance').fill('1500')
    await page.getByTestId('onboarding-account-create').click()
    await expect(page.getByTestId('onboarding-account-chip')).toHaveCount(1)
    await expect(page.getByTestId('onboarding-account-chip')).toContainText('Main Checking')
    await page.getByTestId('onboarding-next').click()

    // Bring your data: skip (confirm dialog)
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await page.getByTestId('confirm-accept').click()

    // Subscriptions: nothing to find without transactions
    await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible()
    await expect(page.getByTestId('sub-scan-empty')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

    // Done → dashboard
    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await expect(page.getByTestId('dashboard-header')).toBeVisible()

    // The account exists, the profile is renamed, the flag is stamped.
    await page.evaluate(() => {
      window.location.hash = 'accounts'
    })
    await expect(page.getByTestId('accounts-header')).toBeVisible()
    await expect(page.getByTestId('account-card').first()).toContainText('Main Checking')
    const flag = await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))
    expect(flag).toBe('completed')
  })

  test('does not appear when the workspace already has data', async ({ page }) => {
    await gotoServerless(page, 'dashboard', 'dashboard-header')
    // Give the pristine check time to resolve, then require absence.
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  })

  test('skip asks for confirmation, persists, and can be relaunched from the tour menu', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    // Cancelling the confirm keeps the wizard open
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()

    // Confirming closes it and stamps the skip flag
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))).toBe(
      'skipped'
    )

    // A reload must NOT re-open it
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    // ...but the tour menu relaunches it on demand
    await page.getByTestId('whats-new-btn').click()
    await page.getByTestId('tour-open-onboarding').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
  })

  test('can be relaunched from Settings and a done flag survives re-login checks', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    // The skip is mirrored into the settings KV (fire-and-forget) — wait for
    // the write to land in IndexedDB before simulating a fresh device.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                const req = indexedDB.open('finance-manager')
                req.onsuccess = () => {
                  const db = req.result
                  try {
                    const get = db
                      .transaction('settings', 'readonly')
                      .objectStore('settings')
                      .get('onboarding')
                    get.onsuccess = () => {
                      resolve((get.result as { value?: string } | undefined)?.value ?? null)
                      db.close()
                    }
                    get.onerror = () => {
                      resolve(null)
                      db.close()
                    }
                  } catch {
                    resolve(null)
                    db.close()
                  }
                }
                req.onerror = () => resolve(null)
              })
          ),
        { timeout: 10000 }
      )
      .toBe('skipped')

    // Even with the local flag wiped (fresh browser / new device against the
    // same data) the wizard stays closed once the pristine check consults settings.
    await page.evaluate(() => localStorage.removeItem('finance_onboarding:local'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    // ...and the remote decision has been re-cached locally.
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))).toBe(
      'skipped'
    )

    // Settings → About → Run setup wizard relaunches on demand
    await page.evaluate(() => {
      window.location.hash = 'settings'
    })
    await expect(page.getByTestId('settings-header')).toBeVisible()
    await page.getByTestId('settings-tab-about').click()
    await page.getByTestId('settings-run-onboarding').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
  })

  test('recognizes existing accounts when relaunched over real data', async ({ page }) => {
    // Demo workspace: accounts already exist. Relaunch the wizard manually.
    await gotoServerless(page, 'dashboard', 'dashboard-header')
    await page.getByTestId('whats-new-btn').click()
    await page.getByTestId('tour-open-onboarding').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()

    await page.getByTestId('onboarding-next').click() // welcome → space
    await page.getByTestId('onboarding-next').click() // space → account (name unchanged)

    // The step acknowledges the accounts instead of pitching "your first account".
    await expect(page.getByTestId('onboarding-step-account')).toContainText('already have')
    await expect(page.getByTestId('onboarding-account-chip').first()).toBeVisible()
    await expect(page.getByTestId('onboarding-next')).toHaveText('Continue')

    // Continue goes straight through — no "skip account?" confirmation.
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await expect(page.getByTestId('confirm-accept')).toHaveCount(0)
  })

  test('escape key asks to leave the wizard', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('confirm-cancel')).toBeVisible()
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
  })

  test('the footer promotes the import once there is a file to import', async ({ page }) => {
    // The step body's own "Process & continue" sits under the account pickers, so on a phone it
    // was below the fold while the footer's big primary button offered to skip the whole step.
    // The action the user came for was the one they had to scroll for; the one that abandons the
    // flow was the one under their thumb.
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-profile-name')).toHaveValue('Personal Profile')
    await page.getByTestId('onboarding-next').click()

    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-account-name').fill('Revolut EUR')
    await page.getByTestId('onboarding-account-create').click()
    await expect(page.getByTestId('onboarding-account-chip')).toHaveCount(1)
    await page.getByTestId('onboarding-next').click()

    // Nothing staged yet: skipping is genuinely the only forward action, so it keeps the primary.
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await expect(page.getByTestId('onboarding-next')).toHaveText('Continue without importing')
    await expect(page.getByTestId('onboarding-import-process-bank')).toHaveCount(0)

    await page.getByTestId('bank-file-input').setInputFiles('tests/fixtures/revolut-sample.csv')
    await expect(page.getByTestId('bank-file-row')).toBeVisible()

    // Now there is something to import, and it takes the primary.
    const primary = page.getByTestId('onboarding-import-process-bank')
    await expect(primary).toBeVisible()
    await expect(primary).toHaveText('Process & continue')
    // Skipping is still reachable, demoted to the ghost button beside it.
    await expect(page.getByTestId('onboarding-import-skip')).toHaveText("Don't import")
    // ...and it is no longer what the big button does.
    await expect(page.getByTestId('onboarding-next')).toHaveCount(0)

    // The footer button does exactly what the inline one does.
    await page.getByTestId('bank-target-account').selectOption('Revolut EUR')
    await primary.click()
    await expect(page.getByTestId('onboarding-import-to-preview')).toBeVisible()
  })

  test('imports a bank statement inline and auto-detects subscriptions', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    // Fast-forward: welcome → space → account
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-profile-name')).toHaveValue('Personal Profile')
    await page.getByTestId('onboarding-next').click()

    // Create the account the statement will land in
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-account-name').fill('Revolut EUR')
    await page.getByTestId('onboarding-account-create').click()
    await expect(page.getByTestId('onboarding-account-chip')).toHaveCount(1)
    await page.getByTestId('onboarding-next').click()

    // Import step: bank tab is preselected; drop the statement fixture
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await page.getByTestId('bank-file-input').setInputFiles('tests/fixtures/revolut-sample.csv')
    await expect(page.getByTestId('bank-file-row')).toBeVisible()
    await page.getByTestId('bank-target-account').selectOption('Revolut EUR')
    await page.getByTestId('bank-process-btn').click()

    // Canonical table auto-maps; the wizard FOOTER now carries the flow's
    // forward action at each sub-step (mapping → preview → import).
    await expect(page.getByTestId('onboarding-import-to-preview')).toBeVisible()
    await page.getByTestId('onboarding-import-to-preview').click()

    // Footer Back walks import sub-steps (preview → mapping → upload), not
    // wizard steps — and forward again re-processes from the kept file rows.
    await expect(page.getByTestId('onboarding-import-selected')).toBeVisible()
    await page.getByTestId('onboarding-back').click()
    await expect(page.getByTestId('import-map-date')).toBeVisible()
    await page.getByTestId('onboarding-back').click()
    await expect(page.getByTestId('bank-file-row')).toBeVisible()
    await page.getByTestId('bank-process-btn').click()
    await expect(page.getByTestId('onboarding-import-to-preview')).toBeVisible()
    await page.getByTestId('onboarding-import-to-preview').click()

    // Primary shows the live selection count (fixture = 7 unique rows) and imports
    await expect(page.getByTestId('onboarding-import-selected')).toHaveText('Import selected (7)')
    await page.getByTestId('onboarding-import-selected').click()
    await expect(page.getByTestId('onboarding-import-summary')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('onboarding-next').click()

    // Subscription detection over the imported charges
    await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible()
    const netflixRow = page.locator('[data-test-id="sub-scan-row"][data-name="Netflix"]')
    await expect(netflixRow).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-test-id="sub-scan-row"][data-name="Spotify"]')).toBeVisible()
    /*
     * One button, both jobs. The panel used to carry its own "Add 2" mid-step while the footer's
     * Continue silently did not add — the required order was add, wait, continue, and nothing
     * said so. The footer's single primary now names the whole action, and the in-panel button
     * is gone in the wizard.
     */
    await expect(page.getByTestId('sub-scan-add-btn')).toHaveCount(0)
    const addContinue = page.getByTestId('onboarding-subs-add-continue')
    await expect(addContinue).toHaveText(/Add 2 subscriptions & continue/)
    await addContinue.click()

    // Done step reflects the session, finish lands on the dashboard
    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await expect(page.getByTestId('onboarding-step-done')).toContainText('transactions imported')
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    // The subscriptions are now tracked in Bills
    await page.evaluate(() => {
      window.location.hash = 'bills'
    })
    await expect(page.getByTestId('bills-header')).toBeVisible()
    await page.getByTestId('bills-tab-subscriptions').click()
    await expect(page.locator('.page-bills').getByText('Netflix').first()).toBeVisible()
    await expect(page.locator('.page-bills').getByText('Spotify').first()).toBeVisible()
  })

  test("'Don't import' mid-flow confirms, discards, and advances", async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    // Fast-forward to the import step (skipping the account with its confirm)
    await page.getByTestId('onboarding-next').click()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await page.getByTestId('confirm-accept').click()

    // Reach the mapping sub-step with prepared data
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await page.getByTestId('bank-file-input').setInputFiles('tests/fixtures/revolut-sample.csv')
    await expect(page.getByTestId('bank-file-row')).toBeVisible()
    await page.getByTestId('bank-target-account').selectOption('__create-account__')
    await page.getByTestId('account-select-name').fill('Revolut EUR')
    await page.getByTestId('account-select-submit').click()
    await page.getByTestId('bank-process-btn').click()
    await expect(page.getByTestId('onboarding-import-to-preview')).toBeVisible()

    // The footer ghost escape confirms the discard, then advances
    await page.getByTestId('onboarding-import-skip').click()
    await expect(page.getByTestId('confirm-accept')).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible()
  })

  for (const theme of ['light', 'dark']) {
    test(`the wizard's hints read at 4.5:1 or better against the panel, ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('finance-theme', value)
      }, theme)
      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      // Each hint on the step: its colour at its opacity over the glass panel, and the panel over
      // the overlay's ground at each stop of its gradient. The lowest ratio over the stops is an
      // estimate of the worst place on screen: it leaves out the panel's backdrop blur and the orbit
      // field behind it, which put the painted pixels within about 2% of it when measured. Computed
      // colours, composited on a canvas the way the page composites them.
      const contrasts = (step: string) =>
        page.getByTestId(step).evaluate(async (stepEl) => {
          const panel = stepEl.closest<HTMLElement>('[data-test-id="onboarding-panel"]')!
          const overlay = panel.closest<HTMLElement>('[data-test-id="onboarding-wizard"]')!
          await Promise.all(
            panel
              .getAnimations({ subtree: true })
              .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
              .map((a) => a.finished)
          )
          const ctx = document.createElement('canvas').getContext('2d', {
            willReadFrequently: true,
          })!
          const paint = (color: string, alpha = 1) => {
            ctx.fillStyle = '#010203'
            ctx.fillStyle = color
            if (ctx.fillStyle === '#010203') throw new Error(`the canvas cannot read ${color}`)
            ctx.globalAlpha = alpha
            ctx.fillRect(0, 0, 1, 1)
            ctx.globalAlpha = 1
          }
          const luminance = () => {
            const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)).map((v) => {
              const c = v / 255
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
          }
          const ground = getComputedStyle(overlay).backgroundImage.match(/rgba?\([^)]*\)/g) ?? []
          const hints = Array.from(stepEl.querySelectorAll<HTMLElement>('[class*="fieldHint"]'))
          return hints.map((hint) => {
            let opacity = 1
            for (let n: HTMLElement | null = hint; n && n !== panel; n = n.parentElement) {
              opacity *= parseFloat(getComputedStyle(n).opacity)
            }
            const ratios = ground.map((stop) => {
              paint(stop)
              paint(getComputedStyle(panel).backgroundColor)
              const back = luminance()
              paint(getComputedStyle(hint).color, opacity)
              const fore = luminance()
              return (Math.max(back, fore) + 0.05) / (Math.min(back, fore) + 0.05)
            })
            return {
              hint: hint.textContent!.trim(),
              stops: ratios.length,
              lowest: Math.round(Math.min(...ratios) * 100) / 100,
            }
          })
        })

      await page.getByTestId('onboarding-next').click()
      const space = await contrasts('onboarding-step-space')
      await page.getByTestId('onboarding-next').click()
      const account = await contrasts('onboarding-step-account')
      expect(space.length).toBeGreaterThan(0)
      expect(account.length).toBeGreaterThan(0)
      for (const measured of [...space, ...account]) {
        expect(measured.stops, measured.hint).toBeGreaterThan(1)
        expect(measured.lowest, measured.hint).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('back navigation walks the steps in reverse', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-back').click()
    await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()
  })
})

test.describe('onboarding wizard at phone width', () => {
  const sizes = [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
  ]
  for (const size of sizes) {
    for (const theme of ['light', 'dark']) {
      test(`the panel stays on a ${size.width}x${size.height} screen on every step, ${theme}`, async ({
        page,
      }) => {
        /**
         * Everything wrong with the panel's place on the screen, as a list (empty when right):
         * - the page, the overlay, the panel or its body scrolls sideways, or any other box in the
         *   wizard is wider inside than out. A table, what is inside it and its own wrapper are
         *   the exception: the import step's mapping and preview tables are wider than a phone and
         *   scroll inside their wrappers.
         * - the panel reaches past an edge of the screen, or a footer button past the panel's.
         * - the overlay is scrolled at all.
         * Then the footer's primary button (Continue, or what stands in for it) is scrolled into
         * view centred, as a browser does for an element it brings into view, and the panel must
         * not move and the overlay must still not be scrolled: a box that clips with
         * overflow: hidden can still be scrolled that way.
         */
        const misplaced = () =>
          page.evaluate(() => {
            const found: string[] = []
            const root = document.documentElement
            const overlay = document.querySelector<HTMLElement>(
              '[data-test-id="onboarding-wizard"]'
            )!
            const panel = document.querySelector<HTMLElement>('[data-test-id="onboarding-panel"]')!
            if (root.scrollWidth > root.clientWidth)
              found.push(`page ${root.scrollWidth}>${root.clientWidth}`)
            for (const el of [overlay, ...Array.from(overlay.querySelectorAll<HTMLElement>('*'))]) {
              const overflowX = getComputedStyle(el).overflowX
              if (overflowX === 'visible' || overflowX === 'clip') continue
              if (el.closest('table') || el.querySelector(':scope > table')) continue
              if (el.scrollWidth > el.clientWidth)
                found.push(
                  `${String(el.className) || el.tagName} ${el.scrollWidth}>${el.clientWidth}`
                )
            }
            const box = panel.getBoundingClientRect()
            if (
              box.left < 0 ||
              box.top < 0 ||
              box.right > root.clientWidth ||
              box.bottom > root.clientHeight
            )
              found.push(`panel ${box.left},${box.top} to ${box.right},${box.bottom}`)
            const buttons = Array.from(panel.querySelectorAll<HTMLElement>('footer button'))
            for (const button of buttons) {
              const b = button.getBoundingClientRect()
              if (
                b.left < box.left ||
                b.top < box.top ||
                b.right > box.right ||
                b.bottom > box.bottom
              )
                found.push(`${button.dataset.testId} ${b.left},${b.top} to ${b.right},${b.bottom}`)
            }
            if (overlay.scrollLeft || overlay.scrollTop)
              found.push(`overlay scrolled to ${overlay.scrollLeft},${overlay.scrollTop}`)

            const primary = buttons[buttons.length - 1]
            primary.scrollIntoView({ block: 'center', inline: 'center' })
            const after = panel.getBoundingClientRect()
            if (after.left !== box.left || after.top !== box.top)
              found.push(`panel moved ${after.left - box.left},${after.top - box.top}`)
            if (overlay.scrollLeft || overlay.scrollTop)
              found.push(
                `overlay scrolled to ${overlay.scrollLeft},${overlay.scrollTop} by ${primary.dataset.testId}`
              )
            return found
          })
        // The panel rises 14 px as it opens; measure where it settles.
        const check = async (step: string) => {
          await page
            .getByTestId('onboarding-panel')
            .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
          expect(await misplaced(), step).toEqual([])
        }

        await page.setViewportSize(size)
        await page.addInitScript((value) => {
          localStorage.setItem('finance-theme', value)
        }, theme)
        await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

        await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()
        await check('welcome')
        await page.getByTestId('onboarding-next').click()
        await expect(page.getByTestId('onboarding-profile-name')).toHaveValue('Personal Profile')
        await check('space')
        await page.getByTestId('onboarding-next').click()

        await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
        await check('account, empty')
        await page.getByTestId('onboarding-account-name').fill('Revolut EUR')
        await page.getByTestId('onboarding-account-create').click()
        await expect(page.getByTestId('onboarding-account-chip')).toHaveCount(1)
        await check('account, one added')
        await page.getByTestId('onboarding-next').click()

        await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
        await check('import, no file')
        await page.getByTestId('bank-file-input').setInputFiles('tests/fixtures/revolut-sample.csv')
        await expect(page.getByTestId('bank-file-row')).toBeVisible()
        await page.getByTestId('bank-target-account').selectOption('Revolut EUR')
        await check('import, a file chosen')
        await page.getByTestId('bank-process-btn').click()
        await expect(page.getByTestId('import-map-date')).toBeVisible()
        await check('import, mapping')
        await page.getByTestId('onboarding-import-to-preview').click()
        await expect(page.getByTestId('onboarding-import-selected')).toBeVisible()
        await check('import, preview')
        await page.getByTestId('onboarding-import-skip').click()
        await page.getByTestId('confirm-accept').click()

        await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible()
        await check('subscriptions')
        await page.getByTestId('onboarding-next').click()
        await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
        await check('done')
      })
    }
  }
})
