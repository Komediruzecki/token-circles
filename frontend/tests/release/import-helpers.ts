/**
 * Statements for the Import cases, made up on the spot.
 *
 * Each is generated from the format the importer reads (the Revolut adapter in
 * shared/bankImport/adapters/revolut.ts, or the generic CSV the paste tab maps), with invented
 * merchants and round amounts. Nothing here comes from a real statement or from tests/fixtures.
 */
import { expect } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'

export interface StatementRow {
  /** YYYY-MM-DD */
  date: string
  description: string
  /** Negative is money out. */
  amount: number
  currency?: string
}

const REVOLUT_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'

/** A Revolut account statement: the header the adapter detects, one COMPLETED row each. */
export function revolutStatement(rows: readonly StatementRow[]): string {
  let balance = 5000
  const lines = rows.map((r) => {
    balance += r.amount
    const kind = r.amount < 0 ? 'CARD_PAYMENT' : 'TRANSFER_IN'
    return [
      kind,
      'Current',
      `${r.date} 09:00:00`,
      `${r.date} 10:00:00`,
      r.description,
      r.amount.toFixed(2),
      '0.00',
      r.currency ?? 'EUR',
      'COMPLETED',
      balance.toFixed(2),
    ].join(',')
  })
  return `${[REVOLUT_HEADER, ...lines].join('\n')}\n`
}

/** The generic CSV the paste tab maps by its headers. */
export function genericCsv(rows: readonly StatementRow[]): string {
  return [
    'Date,Description,Amount,Type',
    ...rows.map(
      (r) =>
        `${r.date},${r.description},${r.amount.toFixed(2)},${r.amount < 0 ? 'expense' : 'income'}`
    ),
  ].join('\n')
}

/** Import > Bank imports, with a statement added and waiting for its account. */
export async function addBankStatement(page: Page, filename: string, csv: string): Promise<void> {
  await goPage(page, 'import', 'import-header')
  await page.getByTestId('import-tab-bank-imports').click()
  await page.getByTestId('bank-file-input').setInputFiles({
    name: filename,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  })
  await expect(page.getByTestId('bank-file-row').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('bank-target-account').first()).toBeVisible()
}

/** The accounts the statement's account picker offers, by name (the option values). */
export async function importAccountOptions(page: Page): Promise<string[]> {
  return page
    .getByTestId('bank-target-account')
    .first()
    .evaluate((el) =>
      [...(el as HTMLSelectElement).options]
        .map((o) => o.value)
        .filter((v) => v !== '' && v !== '__create-account__')
    )
}

/**
 * The statement's account picked, processed, mapped, and on to the preview: the step whose dry run
 * of the import tells the user what it would skip and create.
 */
export async function previewStatement(page: Page, account: string, rows: number): Promise<void> {
  await page.getByTestId('bank-target-account').first().selectOption(account)
  await page.getByTestId('bank-process-btn').click()
  await page.getByTestId('import-continue-preview').click()
  await expect(page.getByTestId('import-preview-total')).toHaveText(String(rows), {
    timeout: 20_000,
  })
}

/** Import > Recent Imports: one entry per import, newest first. Shown on the upload step. */
export function recentImports(page: Page): Locator {
  // h2 > card
  return page
    .getByRole('heading', { name: 'Recent Imports', exact: true })
    .locator('xpath=..')
    .locator('details')
}

/** Every data-version counter the app tracks, by entity: what a write bumps, in either mode. */
export async function dataVersions(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const mod = (await import('/src/core/dataVersions.ts' as string)) as {
      trackedEntities: () => string[]
      entityVersion: (tag: string) => number
    }
    return Object.fromEntries(mod.trackedEntities().map((t) => [t, mod.entityVersion(t)]))
  })
}

// ---------------------------------------------------------------------------------------------
// The categorization rules editor (Import > Bank imports, and the wizard's import step)
// ---------------------------------------------------------------------------------------------

export interface ShownRule {
  category: string
  keywords: string
}

/**
 * Store a profile's category keyword rules where the app keeps them: in this browser, per
 * profile (core/bankImport/rulesStore.ts). They never reach the server, so this is the only way
 * to arrange them.
 */
export async function arrangeImportRules(
  page: Page,
  profileId: number,
  rules: readonly { category: string; keywords: string[] }[]
): Promise<void> {
  await page.evaluate(
    ([pid, value]) => {
      localStorage.setItem(`bankImportCategoryRules:${pid}`, value)
    },
    [String(profileId), JSON.stringify(rules)] as const
  )
}

/** A profile's stored category rules, as the app would load them (null: never saved). */
export async function storedImportRules(
  page: Page,
  profileId: number
): Promise<{ category: string; keywords: string[] }[] | null> {
  const raw = await page.evaluate(
    (pid) => localStorage.getItem(`bankImportCategoryRules:${pid}`),
    String(profileId)
  )
  return raw === null ? null : (JSON.parse(raw) as { category: string; keywords: string[] }[])
}

/** Open the rules editor inside `scope` (the Import page, or the wizard), if it is closed. */
export async function openRulesEditor(scope: Locator): Promise<void> {
  const toggle = scope.getByTestId('bank-rules-toggle')
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  if ((await toggle.innerText()).startsWith('Edit')) await toggle.click()
  await expect(toggle).toHaveText(/^Hide categorization/)
}

/** The category keyword rules the open editor in `scope` shows, row by row. */
export async function rulesShown(scope: Locator): Promise<ShownRule[]> {
  const categories = scope.getByPlaceholder('Category (pick or type)')
  const keywords = scope.getByPlaceholder('keyword1, keyword2, ...')
  const rows: ShownRule[] = []
  const n = await categories.count()
  for (let i = 0; i < n; i++) {
    rows.push({
      category: await categories.nth(i).inputValue(),
      keywords: await keywords.nth(i).inputValue(),
    })
  }
  return rows
}
