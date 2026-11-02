/**
 * Entries for the prints' browser tests (prints.spec.ts and prints-layout.spec.ts): a month as
 * circles-fixture.ts writes its year (a salary of 3,000, a rent of 1,000 and two grocery runs of
 * 200), or with five-digit amounts for the test that looks for a leak. Round invented values;
 * nothing here is anyone's.
 */
import { expect } from '@playwright/test'
import { go, monthsAgo } from './circles-fixture'
import type { Page } from '@playwright/test'

export { monthsAgo }

export interface Entry {
  description: string
  amount: number
  type: 'income' | 'expense'
  date: string
}

/** A month of `n` entries (up to four), on days that have passed in any month. */
export function aMonth(month: string, n = 4, pay = 3000, rent = 1000, shop = 200): Entry[] {
  return [
    { description: 'Salary', amount: pay, type: 'income' as const, date: `${month}-01` },
    { description: 'Flat rent', amount: rent, type: 'expense' as const, date: `${month}-02` },
    { description: 'Corner market', amount: shop, type: 'expense' as const, date: `${month}-03` },
    { description: 'Corner market', amount: shop, type: 'expense' as const, date: `${month}-04` },
  ].slice(0, n)
}

/** The months from `from` months ago to `to` months ago, oldest first. */
export const monthsBack = (from: number, to = 1): string[] =>
  Array.from({ length: from - to + 1 }, (_, i) => monthsAgo(from - i))

/** "October 2026", as the prints name a month. */
export const monthName = (month: string): string =>
  new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** Writes the entries through the page's own API client, in whichever mode the page runs. */
export async function write(page: Page, entries: Entry[]): Promise<void> {
  await page.evaluate(async (rows) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      apiPost: (url: string, body: unknown) => Promise<unknown>
    }
    for (const row of rows) await mod.apiPost('/api/transactions', row)
  }, entries)
}

/** Progress at its prints, once the shelf has drawn its seal. */
export async function toPrints(page: Page): Promise<void> {
  await go(page, 'progress/prints')
  await expect(page.getByTestId('prints-seal')).toBeVisible({ timeout: 30_000 })
}

/** The toast that says `text`, in the Notifications region. */
export const toastSaying = (page: Page, text: string) =>
  page.getByRole('region', { name: 'Notifications' }).getByRole('status').filter({ hasText: text })
