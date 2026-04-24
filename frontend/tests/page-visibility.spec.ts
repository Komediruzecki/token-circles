/**
 * Page Visibility Tests
 * Tests that all pages are visible with the correct CSS classes
 */

import { expect,test } from '@playwright/test'

test.describe('Page Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3800')
  })

  test('dashboard page is visible on initial load', async ({ page }) => {
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-content')).toBeVisible()
    await expect(page.locator('.page-dashboard')).toBeVisible()
  })

  test('transactions page is visible', async ({ page }) => {
    await page.click('text=Transactions')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-transactions')).toBeVisible()
  })

  test('accounts page is visible', async ({ page }) => {
    await page.click('text=Accounts')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-accounts')).toBeVisible()
  })

  test('categories page is visible', async ({ page }) => {
    await page.click('text=Categories')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-categories')).toBeVisible()
  })

  test('budgets page is visible', async ({ page }) => {
    await page.click('text=Budgets')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-budgets')).toBeVisible()
  })

  test('goals page is visible', async ({ page }) => {
    await page.click('text=Goals')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-goals')).toBeVisible()
  })

  test('loans page is visible', async ({ page }) => {
    await page.click('text=Loans')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-loans')).toBeVisible()
  })

  test('bills page is visible', async ({ page }) => {
    await page.click('text=Bills')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-bills')).toBeVisible()
  })

  test('retirement page is visible', async ({ page }) => {
    await page.click('text=Retirement')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-retirement')).toBeVisible()
  })

  test('analytics page is visible', async ({ page }) => {
    await page.click('text=Analytics')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-analytics')).toBeVisible()
  })

  test('import page is visible', async ({ page }) => {
    await page.click('text=Import')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-import')).toBeVisible()
  })

  test('settings page is visible', async ({ page }) => {
    await page.click('text=Settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.settings-grid')).toBeVisible()
  })

  test('housing page is visible', async ({ page }) => {
    await page.click('text=Housing')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-housing')).toBeVisible()
  })

  test('dashboard component sections are visible', async ({ page }) => {
    await expect(page.locator('h2')).toBeVisible()
  })

  test('transactions table is visible', async ({ page }) => {
    await page.click('text=Transactions')
    await expect(page.locator('table')).toBeVisible()
  })

  test('accounts grid is visible', async ({ page }) => {
    await page.click('text=Accounts')
    await expect(page.locator('h1:has-text("Finance Manager")')).toBeVisible()
  })
})