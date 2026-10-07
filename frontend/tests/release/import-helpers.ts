/**
 * Statements for the Import cases, made up on the spot.
 *
 * Each is generated from the format the importer reads (the Revolut adapter in
 * shared/bankImport/adapters/revolut.ts, or the generic CSV the paste tab maps), with invented
 * merchants and round amounts. Nothing here comes from a real statement or from tests/fixtures.
 */
import { expect } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Page } from '@playwright/test'

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
