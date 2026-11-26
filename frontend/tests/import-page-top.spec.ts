/**
 * The top of the Import page after an import (maff, 19 Nov). A sheet with twelve accounts left a
 * line of balance for each and the subscription offer above the import methods, and the link field
 * began over a screen down: 1,467 px at 1440x900, 1,890 px on a phone. The card an import leaves
 * keeps a long list shut, so the methods and the link stay on the first screen, and a link that is
 * not a sheet's is said at the field, not in a banner at the top. The card offers to keep the sheet
 * in Connected sources, where Sync reads it again.
 *
 * Local-first, the sheet answered by a route: made-up accounts and amounts.
 */
import { expect, test } from '@playwright/test'
import { gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

const ACCOUNTS = Array.from({ length: 12 }, (_, i) => `Example Account ${i + 1}`)
const CSV =
  'Date,Description,Amount,Means of Payment\n' +
  ACCOUNTS.map(
    (account, i) =>
      `2026-10-${String(i + 1).padStart(2, '0')},Example payee ${i + 1},-${(12.5 + i).toFixed(2)},${account}`
  ).join('\n') +
  '\n'
const LINK = 'https://docs.google.com/spreadsheets/d/1ExampleSheetForTestsOnly00000/edit#gid=0'

/** Twelve accounts in this browser's store, for the sheet's rows to go into. */
async function seedAccounts(page: Page): Promise<void> {
  await page.evaluate(
    (names) =>
      new Promise<void>((resolve, reject) => {
        const profileId = Number(localStorage.getItem('currentProfileId') ?? '1')
        const request = indexedDB.open('finance-manager')
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('accounts', 'readwrite')
          names.forEach((name, i) =>
            tx.objectStore('accounts').add({
              name,
              type: 'giro',
              currency: 'EUR',
              balance: 400 + i * 25,
              starting_balance: 400 + i * 25,
              profile_id: profileId,
              created_at: '2026-09-01T00:00:00.000Z',
            })
          )
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            reject(tx.error ?? new Error('could not seed the accounts'))
          }
        }
        request.onerror = () => {
          reject(request.error ?? new Error('could not open the store'))
        }
      }),
    ACCOUNTS
  )
}

/** A browser with nothing in it but twelve accounts, and the sheet read and imported into them. */
async function importTheSheet(page: Page): Promise<void> {
  await page.route('https://docs.google.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/csv',
      headers: { 'access-control-allow-origin': '*' },
      body: CSV,
    })
  )
  await page.route('https://corsproxy.io/**', (route) => route.abort())
  await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  await seedAccounts(page)

  await page.evaluate(() => {
    window.location.hash = 'import'
  })
  await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('import-tab-google-sheets').click()
  await page.getByTestId('import-sheet-url').fill(LINK)
  await page.getByTestId('import-sheet-fetch').click()
  await page.getByTestId('import-continue-preview').click({ timeout: 20_000 })
  await page.getByTestId('import-execute-all').click({ timeout: 20_000 })
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`after a sheet import, the methods and the link stay on the first screen at ${size.width} @smoke`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(size)
    await importTheSheet(page)

    await expect(page.getByTestId('import-result')).toHaveText('Imported 12 transactions', {
      timeout: 20_000,
    })
    await expect(page.getByTestId('import-after-balances')).toContainText('12 accounts changed.')
    await expect(page.getByTestId('import-after-balances-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await expect(page.getByTestId('import-scan-offer')).toBeVisible()

    // The flow starts over three seconds after an import, on the same tab.
    await expect(page.getByTestId('import-sheet-url')).toBeVisible({ timeout: 10_000 })
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
    const tabs = await page.getByTestId('import-tab-google-sheets').boundingBox()
    const link = await page.getByTestId('import-sheet-url').boundingBox()
    expect(tabs).not.toBeNull()
    expect(link).not.toBeNull()
    expect(tabs!.y).toBeLessThan(size.height)
    expect(link!.y + link!.height).toBeLessThanOrEqual(size.height)

    // A link that is not a sheet's is said under the field.
    await page.getByTestId('import-sheet-url').fill('not a link')
    await page.getByTestId('import-sheet-fetch').click()
    await expect(page.getByTestId('import-sheet-url')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('import-error')).toHaveCount(0)

    // The sheet just read goes into Connected sources from the card, for Sync to read again.
    await page.getByTestId('import-after-sheet-name').fill('Example ledger')
    await page.getByTestId('import-after-save-sheet').click()
    await expect(page.getByTestId('import-after-saved')).toHaveText(
      `"Example ledger" is in Connected sources below. Sync brings in every row of the sheet that isn't in Token Circles yet.`
    )
    await expect(page.getByRole('button', { name: 'Auto sync Example ledger' })).toBeVisible()
  })
}

// Review of 19 Nov, round 4: at 390 px the entry's line went on under the arrow at the row's
// edge, "(12 imported)" starting left of the name above it.
test('Recent Imports goes on under the name where its line wraps, at 390 px @smoke', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await importTheSheet(page)
  const entry = page.locator('details').filter({ hasText: '12\u00a0imported' })
  await expect(entry).toBeVisible({ timeout: 20_000 })

  const lines = await entry.locator('summary').evaluate((summary) => {
    const name = summary.querySelector('strong')!.getBoundingClientRect()
    const arrow = summary.querySelector('svg')!.getBoundingClientRect()
    // Where each line of its words starts: the text, not the arrow before it.
    const starts = new Map<number, number>()
    const words = document.createTreeWalker(summary, NodeFilter.SHOW_TEXT)
    for (let node = words.nextNode(); node; node = words.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width === 0) continue
        const top = Math.round(rect.top)
        starts.set(top, Math.min(starts.get(top) ?? Infinity, rect.left))
      }
    }
    return {
      name: { left: name.left, top: name.top, bottom: name.bottom },
      arrow: { right: arrow.right, top: arrow.top, bottom: arrow.bottom },
      starts: [...starts.values()],
    }
  })
  // The arrow sits before the name, on its line.
  expect(lines.arrow.right).toBeLessThanOrEqual(lines.name.left + 0.5)
  expect(lines.arrow.top).toBeLessThan(lines.name.bottom)
  expect(lines.arrow.bottom).toBeGreaterThan(lines.name.top)
  // The line wraps at this width, and each of its lines starts where the name does.
  expect(lines.starts.length).toBeGreaterThan(1)
  for (const start of lines.starts) expect(start).toBeGreaterThanOrEqual(lines.name.left - 0.5)
})
