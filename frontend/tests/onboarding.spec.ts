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
    const flag = await page.evaluate(() => localStorage.getItem('finance_onboarding'))
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
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding'))).toBe('skipped')

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
    await page.evaluate(() => localStorage.removeItem('finance_onboarding'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    // ...and the remote decision has been re-cached locally.
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding'))).toBe('skipped')

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
    await page.getByTestId('sub-scan-add-btn').click()
    // Added rows move to the tracked section
    await expect(page.getByTestId('sub-scan-add-btn')).toBeDisabled()
    await page.getByTestId('onboarding-next').click()

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
