/**
 * Import page e2e — regression coverage for the refactored import flow
 * (importFlow controller + shared step components on the page surface).
 */
import { expect, test } from '@playwright/test'
import { gotoServerless } from './test-helpers'

const PASTED_CSV = [
  'Date,Description,Amount,Category,Type',
  '2026-07-01,Onboarding Test Salary,2000.00,Salary,income',
  '2026-07-02,Onboarding Test Groceries,-52.30,Groceries,expense',
  '2026-07-03,Onboarding Test Coffee,-3.20,Dining,expense',
].join('\n')

test.describe('import page', () => {
  test('@smoke paste CSV walks upload → mapping → preview → execute', async ({ page }) => {
    await gotoServerless(page, 'import', 'import-header')

    // Method tabs render (refactored ImportDataEntry)
    await expect(page.getByTestId('import-tab-google-sheets')).toBeVisible()
    await expect(page.getByTestId('import-tab-bank-imports')).toBeVisible()

    // Paste CSV
    await page.getByTestId('import-tab-paste-csv').click()
    await page.getByTestId('import-paste-textarea').fill(PASTED_CSV)
    await page.getByTestId('import-paste-parse').click()
    await page.getByTestId('import-continue-mapping').click()

    // Mapping auto-detected the standard headers
    await expect(page.getByTestId('import-map-date')).toHaveValue('0')
    await expect(page.getByTestId('import-map-description')).toHaveValue('1')
    await expect(page.getByTestId('import-map-amount')).toHaveValue('2')
    await page.getByTestId('import-continue-preview').click()

    // Preview shows all rows selected; execute
    await expect(page.getByTestId('import-preview-total')).toHaveText('3')
    await page.getByTestId('import-execute-all').click()
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('import-result')).toContainText('Imported')

    // Post-import subscription-scan offer appears and opens the scan modal
    await expect(page.getByTestId('import-scan-offer')).toBeVisible()
    await page.getByTestId('import-scan-open').click()
    await expect(page.getByTestId('sub-scan-modal')).toBeVisible()
  })

  test('re-importing the same rows says nothing is new and logs the skips', async ({ page }) => {
    test.setTimeout(90000)
    await gotoServerless(page, 'import', 'import-header')

    const runPasteImport = async () => {
      await page.getByTestId('import-tab-paste-csv').click()
      await page.getByTestId('import-paste-textarea').fill(PASTED_CSV)
      await page.getByTestId('import-paste-parse').click()
      await page.getByTestId('import-continue-mapping').click()
      await page.getByTestId('import-continue-preview').click()
      await page.getByTestId('import-execute-all').waitFor()
    }

    // Round 1: everything is new — no "already imported" banner.
    await runPasteImport()
    await expect(page.getByTestId('import-existing-dups')).toHaveCount(0)
    await page.getByTestId('import-execute-all').click()
    await expect(page.getByTestId('import-result')).toContainText('Imported 3', {
      timeout: 15000,
    })
    // The flow auto-resets to the upload step after a successful import.
    await expect(page.getByTestId('import-paste-textarea')).toBeVisible({ timeout: 15000 })

    // Round 2: the dry-run warns up front, the result says "nothing new",
    // and the import log records the skipped duplicates.
    await runPasteImport()
    await expect(page.getByTestId('import-existing-dups')).toBeVisible()
    await expect(page.getByTestId('import-existing-dups')).toContainText(
      'Everything here was already imported'
    )
    await page.getByTestId('import-execute-all').click()
    await expect(page.getByTestId('import-result')).toContainText('No new transactions', {
      timeout: 15000,
    })
    await expect(page.getByTestId('import-paste-textarea')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('3 duplicates skipped').first()).toBeVisible()
  })

  test('bank imports tab shows the inline account picker', async ({ page }) => {
    await gotoServerless(page, 'import', 'import-header')
    await page.getByTestId('import-tab-bank-imports').click()
    await page.getByTestId('bank-file-input').setInputFiles('tests/fixtures/revolut-sample.csv')
    await expect(page.getByTestId('bank-file-row')).toBeVisible()

    // The account dropdown offers in-place creation
    const select = page.getByTestId('bank-target-account')
    await select.selectOption('__create-account__')
    await expect(page.getByTestId('account-select-create')).toBeVisible()
    await page.getByTestId('account-select-name').fill('Onboarding E2E Bank')
    await page.getByTestId('account-select-submit').click()
    // Creation selects the new account in the dropdown
    await expect(select).toHaveValue('Onboarding E2E Bank', { timeout: 10000 })
  })
})
