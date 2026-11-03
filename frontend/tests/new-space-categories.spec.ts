/**
 * A new space has the default categories, so the first quick add files where it should: a fresh
 * account, and a fresh local-only browser, go through setup and type "coffee 4.50", and the entry
 * lands under Eating out.
 *
 * Reported in the 3 Nov test run: a new space started with no categories at all, so the same
 * entry was stored with none, and every page that groups by category had nothing to group. The
 * unit tests for each path that makes a profile are worker/test/new-profile-categories.test.ts
 * and frontend/src/core/storage/__tests__/newProfileCategories.test.ts.
 */
import { expect, test } from '@playwright/test'
import { bootSignedIn, deleteAccount, signUpAndIn } from './own-account'
import { E2E_BASE, gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

/** Through setup the way a new person goes: the space as offered, one account, no statement. */
async function throughSetup(page: Page): Promise<void> {
  await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await page.getByTestId('onboarding-account-name').fill('Main account')
  await page.getByTestId('onboarding-account-balance').fill('500')
  await page.getByTestId('onboarding-account-create').click()
  await expect(page.getByTestId('onboarding-step-import')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-import-skip').click()
  await expect(page.getByTestId('onboarding-step-done')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-finish').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
}

/** Quick add from the command bar, and wait for the app to say it was added. */
async function quickAdd(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('Control+k')
  const quick = page.getByLabel('Quick entry', { exact: true })
  await expect(quick).toBeVisible({ timeout: 10_000 })
  await quick.fill(text)
  await quick.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText('Entry added')
  ).toBeVisible({ timeout: 15_000 })
}

test.describe('a new space has the default categories', () => {
  test.setTimeout(120_000)

  test('a fresh account files "coffee 4.50" under Eating out', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    const { email } = await signUpAndIn(context)
    try {
      await bootSignedIn(context)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded' })
      await throughSetup(page)

      const categories = (await (
        await context.request.get(`${E2E_BASE}/api/categories`)
      ).json()) as Array<{ id: number; name: string }>
      expect(categories.map((c) => c.name)).toEqual(
        expect.arrayContaining(['Groceries', 'Eating out', 'Housing', 'Salary'])
      )

      await quickAdd(page, 'coffee 4.50')
      const { rows } = (await (
        await context.request.get(`${E2E_BASE}/api/transactions?limit=5`)
      ).json()) as {
        rows: Array<{ description: string; amount: number; category_id: number | null }>
      }
      const coffee = rows.find((t) => t.description.toLowerCase() === 'coffee')
      expect(coffee?.amount).toBe(4.5)
      expect(categories.find((c) => c.id === coffee?.category_id)?.name).toBe('Eating out')
    } finally {
      await deleteAccount(context, email)
      await context.close()
    }
  })

  test('a fresh local-only browser files "coffee 4.50" under Eating out', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    try {
      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await throughSetup(page)
      await quickAdd(page, 'coffee 4.50')

      const stored = await page.evaluate(
        () =>
          new Promise<{ amount: number; category: string | null } | null>((resolve, reject) => {
            const req = indexedDB.open('finance-manager')
            req.onerror = () => reject(new Error(String(req.error)))
            req.onsuccess = () => {
              const db = req.result
              const tx = db.transaction(['transactions', 'categories'], 'readonly')
              const all = tx.objectStore('transactions').getAll()
              const cats = tx.objectStore('categories').getAll()
              tx.oncomplete = () => {
                const rows = all.result as Array<{
                  description: string
                  amount: number
                  category_id: number | null
                }>
                const names = new Map(
                  (cats.result as Array<{ id: number; name: string }>).map((c) => [c.id, c.name])
                )
                const coffee = rows.find((t) => t.description.toLowerCase() === 'coffee')
                db.close()
                resolve(
                  coffee
                    ? {
                        amount: coffee.amount,
                        category: names.get(coffee.category_id ?? -1) ?? null,
                      }
                    : null
                )
              }
            }
          })
      )
      expect(stored).toEqual({ amount: 4.5, category: 'Eating out' })
    } finally {
      await context.close()
    }
  })
})
