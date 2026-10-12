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
import type { Page } from '@playwright/test'

/** The active profile's guidance answers, as local-first keeps them: `guidance:<profile id>`. */
async function storedAnswers(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const key = `guidance:${localStorage.getItem('currentProfileId') ?? '1'}`
        const req = indexedDB.open('finance-manager')
        req.onsuccess = () => {
          const db = req.result
          const get = db.transaction('settings', 'readonly').objectStore('settings').get(key)
          get.onsuccess = () => {
            const value = (get.result as { value?: string } | undefined)?.value
            resolve(value === undefined ? null : JSON.parse(value))
            db.close()
          }
          get.onerror = () => {
            resolve(null)
            db.close()
          }
        }
        req.onerror = () => resolve(null)
      })
  )
}

/** Leave the wizard and open Settings, General, at About this space. */
async function aboutThisSpace(page: Page): Promise<void> {
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  await page.evaluate(() => {
    window.location.hash = 'settings'
  })
  await expect(page.getByTestId('settings-about-space')).toBeVisible({ timeout: 30000 })
}

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

  test('asks where you live and who the space covers, and Settings changes the answers', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await expect(page.getByTestId('onboarding-space-region')).toContainText('Where do you live?')
    await page.getByTestId('onboarding-space-region-HR').click()
    await page.getByTestId('onboarding-space-adults-2').click()
    await page.getByTestId('onboarding-space-children-0').click()
    await expect(page.getByRole('radio', { name: 'Croatia' })).toBeChecked()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'HR', adults: 2, children: 0 })

    await aboutThisSpace(page)
    const about = page.getByTestId('about-this-space')
    await expect(about.getByRole('radio', { name: 'Croatia' })).toBeChecked()
    await expect(page.getByTestId('settings-space-region-note')).toHaveText(
      'Compared with Croatia, from your answer.'
    )
    await expect(page.getByTestId('settings-space-adults-2').getByRole('radio')).toBeChecked()
    await expect(page.getByTestId('settings-space-household-note')).toHaveText(
      '2 adults, no children.'
    )

    // A change is saved at once, and survives a reload.
    await page.getByTestId('settings-space-region-DE').click()
    await expect(page.getByTestId('settings-space-region-note')).toHaveText(
      'Compared with Germany, from your answer.'
    )
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'DE', adults: 2, children: 0 })
    await page.getByTestId('settings-space-household-ask-again').click()
    await expect(page.getByTestId('settings-space-household-note')).toHaveText('Not answered yet.')
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'DE' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('settings-about-space')).toBeVisible({ timeout: 30000 })
    await expect(about.getByRole('radio', { name: 'Germany' })).toBeChecked()
    await expect(page.getByTestId('settings-space-household-note')).toHaveText('Not answered yet.')
    expect(await storedAnswers(page)).toEqual({ region: 'DE' })
  })

  test('takes a region left unanswered as skipped, and compares by the base currency', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-currency').selectOption('GBP')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'skipped' })

    await aboutThisSpace(page)
    await expect(page.getByTestId('settings-space-region-note')).toHaveText(
      'You skipped this in setup. Compared with the United Kingdom, going by your base currency, GBP.'
    )
    await expect(page.getByTestId('settings-space-household-note')).toHaveText('Not answered yet.')
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

  test('back navigation walks the steps in reverse', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-back').click()
    await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()
  })
})

test.describe('onboarding wizard at phone width', () => {
  for (const theme of ['light', 'dark']) {
    test(`the step's bottom fades while it goes on below, and Children shows as it opens, ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript((value) => {
        localStorage.setItem('finance-theme', value)
      }, theme)
      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const footer = page.getByTestId('onboarding-panel').locator('footer')
      const body = page.getByTestId('onboarding-body')
      // The cue: the middle's bottom fades out (a mask), and the footer draws nothing of its own.
      const cue = () =>
        body.evaluate((el) => {
          const style = getComputedStyle(el)
          return {
            fades: (style.maskImage || style.webkitMaskImage || 'none') !== 'none',
            footerShadow: getComputedStyle(el.nextElementSibling!).boxShadow,
          }
        })
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
      await expect(page.getByTestId('onboarding-step-space').locator('p').first()).toHaveText(
        "Yours, a partner's or the household's. Add more later."
      )

      // The two questions keep the form's 14 px rhythm between them.
      const region = (await page.getByTestId('onboarding-space-region').boundingBox())!
      const household = (await page.getByTestId('onboarding-space-household').boundingBox())!
      expect(Math.round(household.y - (region.y + region.height))).toBe(14)

      // What makes the room: the questions' lead and the currency help are one line each.
      const lines = (selector: string) =>
        page.evaluate((sel) => {
          const el = document.querySelector<HTMLElement>(sel)!
          return Math.round(
            el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)
          )
        }, selector)
      const currencyHint = await page
        .getByTestId('onboarding-currency')
        .getAttribute('aria-describedby')
      expect(await lines('[data-test-id="onboarding-space-questions-lead"]')).toBe(1)
      expect(await lines(`[id="${currencyHint}"]`)).toBe(1)

      // As the step opens, the Children question's legend is wholly above the footer; its chips
      // go on under it, and the bottom fades to say so.
      const footerTop = (await footer.boundingBox())!.y
      const legend = (await page
        .getByTestId('onboarding-space-household')
        .locator('legend', { hasText: 'Children' })
        .boundingBox())!
      expect(legend.y + legend.height).toBeLessThanOrEqual(footerTop)
      expect(
        (await page.getByTestId('onboarding-space-children-0').boundingBox())!.y
      ).toBeGreaterThan(legend.y + legend.height)
      await expect(body).toHaveAttribute('data-more-below', '')
      expect(await cue()).toEqual({ fades: true, footerShadow: 'none' })

      // At the end, nothing is left below and nothing fades; back up, the fade returns.
      await body.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await expect(body).not.toHaveAttribute('data-more-below')
      expect(await cue()).toEqual({ fades: false, footerShadow: 'none' })
      await body.evaluate((el) => {
        el.scrollTop = 0
      })
      await expect(body).toHaveAttribute('data-more-below', '')

      // A smaller phone fades too. A step that fits has none: on a taller screen, where only the
      // middle grows, and wider.
      await page.setViewportSize({ width: 375, height: 667 })
      await expect(body).toHaveAttribute('data-more-below', '')
      expect(await cue()).toEqual({ fades: true, footerShadow: 'none' })
      await page.setViewportSize({ width: 390, height: 1000 })
      await expect(body).not.toHaveAttribute('data-more-below')
      expect(await cue()).toEqual({ fades: false, footerShadow: 'none' })
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(body).toHaveAttribute('data-more-below', '')
      await page.setViewportSize({ width: 1280, height: 800 })
      await expect(body).not.toHaveAttribute('data-more-below')
      expect(await cue()).toEqual({ fades: false, footerShadow: 'none' })
    })
  }

  for (const { width, height, phone } of [
    { width: 390, height: 844, phone: true },
    { width: 1280, height: 800, phone: false },
  ]) {
    test(`the space questions' chips and Ask again are ${phone ? 'at least 44 px on a phone' : 'their desktop size'}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      // Each chip and Ask again: its height, and for a chip its width and how far its label's
      // centre sits from the chip's.
      const heights = (prefix: string) =>
        page.evaluate(
          (p) =>
            Array.from(
              document.querySelectorAll<HTMLElement>(
                `label[data-test-id^="${p}-region-"], label[data-test-id^="${p}-adults-"], label[data-test-id^="${p}-children-"], [data-test-id$="-ask-again"]`
              )
            ).map((el) => {
              const box = el.getBoundingClientRect()
              const text = el.tagName === 'LABEL' ? el.querySelector('span') : null
              const t = text?.getBoundingClientRect()
              return {
                id: el.dataset.testId,
                h: box.height,
                w: text ? box.width : null,
                off: t ? Math.abs(t.left + t.width / 2 - (box.left + box.width / 2)) : 0,
              }
            }),
          prefix
        )
      const allFit = (list: { h: number; w: number | null; off: number }[]) =>
        phone
          ? list.every(({ h, w, off }) => h >= 44 && (w === null || w >= 44) && off <= 0.5)
          : list.every(({ h }) => h < 40)

      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
      const wizard = await heights('onboarding-space')
      expect(wizard).toHaveLength(13)
      expect(allFit(wizard), JSON.stringify(wizard)).toBe(true)

      await page.getByTestId('onboarding-space-region-HR').click()
      await page.getByTestId('onboarding-space-adults-1').click()
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
      await aboutThisSpace(page)
      await expect(page.getByTestId('settings-space-household-ask-again')).toBeVisible()
      const settings = await heights('settings-space')
      // The chips, and Ask again for both questions.
      expect(settings).toHaveLength(15)
      expect(allFit(settings), JSON.stringify(settings)).toBe(true)
    })
  }

  test('a new step opens at its top, with focus on its heading', async ({ page }) => {
    // Short enough that every step up to the import scrolls.
    await page.setViewportSize({ width: 390, height: 600 })
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    const body = page.getByTestId('onboarding-body')
    const scrollToEnd = async () => {
      const top = await body.evaluate((el) => {
        el.scrollTop = el.scrollHeight
        return el.scrollTop
      })
      expect(top).toBeGreaterThan(0)
    }
    const opensAtTop = async (step: string, heading: string) => {
      await expect(page.getByTestId(`onboarding-step-${step}`)).toBeVisible()
      await expect(page.getByRole('heading', { name: heading })).toBeFocused()
      expect(await body.evaluate((el) => el.scrollTop)).toBe(0)
    }

    // By mouse.
    await scrollToEnd()
    await page.getByTestId('onboarding-next').click()
    await opensAtTop('space', 'Name your space')

    // By Enter in the name, which still continues.
    await scrollToEnd()
    await page.getByTestId('onboarding-profile-name').focus()
    await page.keyboard.press('Enter')
    await opensAtTop('account', 'Create your first account')

    // Through a confirm.
    await scrollToEnd()
    await page.getByTestId('onboarding-next').click()
    await page.getByTestId('confirm-accept').click()
    await opensAtTop('import', 'Bring your data')

    // And back.
    await scrollToEnd()
    await page.getByTestId('onboarding-back').click()
    await opensAtTop('account', 'Create your first account')

    // Escape still asks to leave.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('confirm-accept')).toBeVisible()
  })

  for (const theme of ['light', 'dark']) {
    test(`nothing scrolls sideways on any step at 390 wide, ${theme}`, async ({ page }) => {
      /**
       * What scrolls sideways: the page, and every box in the wizard that can scroll (overflow
       * other than visible or clip) whose content is wider than the box. Then Continue is scrolled
       * into view centred, as a browser does for an element it brings into view, and the panel must
       * not move: a box that clips with overflow: hidden can still be scrolled that way.
       */
      const sidewaysScroll = () =>
        page.evaluate(() => {
          const wizard = document.querySelector<HTMLElement>('[data-test-id="onboarding-wizard"]')!
          const root = document.documentElement
          const wide: string[] = []
          if (root.scrollWidth > root.clientWidth) wide.push(`page ${root.scrollWidth}`)
          for (const el of [wizard, ...Array.from(wizard.querySelectorAll<HTMLElement>('*'))]) {
            const overflowX = getComputedStyle(el).overflowX
            if (overflowX === 'visible' || overflowX === 'clip') continue
            if (el.scrollWidth > el.clientWidth)
              wide.push(`${String(el.className) || el.tagName} ${el.scrollWidth}>${el.clientWidth}`)
          }
          const panel = document.querySelector('[data-test-id="onboarding-panel"]')!
          const before = panel.getBoundingClientRect().left
          document
            .querySelector('[data-test-id="onboarding-next"], [data-test-id="onboarding-finish"]')!
            .scrollIntoView({ block: 'center', inline: 'center' })
          const moved = panel.getBoundingClientRect().left - before
          return { wide, moved }
        })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript((value) => {
        localStorage.setItem('finance-theme', value)
      }, theme)
      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      const steps = ['welcome', 'space', 'account', 'import', 'subscriptions', 'done']
      for (const [index, step] of steps.entries()) {
        await expect(page.getByTestId(`onboarding-step-${step}`)).toBeVisible()
        expect(await sidewaysScroll(), step).toEqual({ wide: [], moved: 0 })
        if (index === steps.length - 1) break
        await page.getByTestId('onboarding-next').click()
        // Leaving the account and import steps empty asks first.
        if (step === 'account' || step === 'import')
          await page.getByTestId('confirm-accept').click()
      }
    })
  }
})

test.describe('About this space in Settings', () => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`"Ask again" follows each status line at ${size.width} wide`, async ({ page }) => {
      await page.setViewportSize(size)
      await gotoServerless(page, 'settings', 'settings-about-space')
      // The card says what its answers belong to; the region's own line says what they are for.
      const card = page.getByTestId('settings-about-space')
      await expect(card).toContainText('Each space keeps its own answers.')
      await expect(card).not.toContainText('official figures')
      await page.getByTestId('settings-space-region-HR').click()
      await page.getByTestId('settings-space-adults-1').click()
      await page.getByTestId('settings-space-children-0').click()
      await expect(page.getByTestId('settings-space-household-note')).toHaveText(
        '1 adult, no children.'
      )
      await expect(page.getByTestId('settings-space-household-ask-again')).toBeEnabled()

      // Where "Ask again" sits against its status line: beside the line's last word, or under the
      // line's start. Anything else is somewhere a reader would not look for it.
      for (const question of ['region', 'household']) {
        const placement = await page.evaluate((q) => {
          const note = document.querySelector(`[data-test-id="settings-space-${q}-note"]`)!
          const ask = document.querySelector(`[data-test-id="settings-space-${q}-ask-again"]`)!
          const range = document.createRange()
          range.selectNodeContents(note)
          const lines = Array.from(range.getClientRects())
          const last = lines[lines.length - 1]
          const first = lines[0]
          const a = ask.getBoundingClientRect()
          const middle = (r: DOMRect) => r.top + r.height / 2
          if (
            Math.abs(middle(a) - middle(last)) < 6 &&
            a.left >= last.right &&
            a.left - last.right <= 24
          )
            return 'beside'
          if (Math.abs(a.left - first.left) <= 1 && a.top >= last.bottom - 1) return 'under'
          return `elsewhere: line ${Math.round(first.left)}-${Math.round(last.right)}, button at ${Math.round(a.left)}`
        }, question)
        expect(['beside', 'under'], question).toContain(placement)
      }

      // With Settings scrolled to its end, the floating + button covers nothing in the card.
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
      const covered = await page.evaluate(() => {
        const fab = document
          .querySelector('button[aria-label="Quick add entry"]')!
          .getBoundingClientRect()
        const card = document.querySelector('[data-test-id="settings-about-space"]')!
        return Array.from(card.querySelectorAll('button, label'))
          .filter((el) => {
            const r = el.getBoundingClientRect()
            return (
              r.right > fab.left && r.left < fab.right && r.bottom > fab.top && r.top < fab.bottom
            )
          })
          .map((el) => el.getAttribute('data-test-id') ?? el.textContent)
      })
      expect(covered).toEqual([])
    })
  }
})
