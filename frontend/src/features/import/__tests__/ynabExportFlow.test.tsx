/**
 * A YNAB register export dropped on the Bank Imports tab, through the real local-first router on
 * fake-indexeddb: the page's own flow (createImportFlow), from the drop to the stored rows.
 *
 * The welcome mail and the onboarding step say YNAB exports import as they are. Before this, a
 * register export was not recognised at all unless its name happened to contain "ynab", and then
 * every row landed in the one account picked for the file, with each transfer counted twice (as
 * spending in one account and income in the other) and each starting balance counted as income.
 *
 * The header and conventions are pinned in shared/bankImport/adapters/ynab.ts. Every name and
 * amount here is made up.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import { rowsMissingAccount } from '../importFlow'
import type { ImportFlow } from '../importFlow'

let flow: ImportFlow
let dispose: () => void
let host: HTMLDivElement

beforeAll(async () => {
  await Promise.all([
    import('../ImportDataEntry'),
    import('../importFlow'),
    import('../../../core/storage/localApiRouter'),
  ])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  const { ImportDataEntry } = await import('../ImportDataEntry')
  const { createImportFlow } = await import('../importFlow')
  host = document.createElement('div')
  document.body.appendChild(host)
  createRoot((done) => {
    flow = createImportFlow({ initialTab: 'bank-imports', autoResetAfterImport: false })
    const unmount = render(() => <ImportDataEntry flow={flow} />, host)
    dispose = () => {
      unmount()
      done()
    }
  })
})

afterEach(() => {
  dispose()
  host.remove()
})

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const q = (cells: string[]) => cells.map((c) => `"${c}"`).join(',')

const REGISTER = [
  q([
    'Account',
    'Flag',
    'Date',
    'Payee',
    'Category Group/Category',
    'Category Group',
    'Category',
    'Memo',
    'Outflow',
    'Inflow',
    'Cleared',
  ]),
  q([
    'Test Checking',
    '',
    '01/02/2026',
    'Starting Balance',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    '',
    '$0.00',
    '$1,250.00',
    'Reconciled',
  ]),
  q([
    'Test Savings',
    '',
    '01/02/2026',
    'Starting Balance',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    '',
    '$0.00',
    '$3,000.00',
    'Reconciled',
  ]),
  q([
    'Test Checking',
    '',
    '01/05/2026',
    'Example Employer',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    'January pay',
    '$0.00',
    '$2,400.00',
    'Cleared',
  ]),
  q([
    'Test Checking',
    '',
    '01/14/2026',
    'Corner Grocer',
    'Everyday: Groceries',
    'Everyday',
    'Groceries',
    '',
    '$54.20',
    '$0.00',
    'Cleared',
  ]),
  q([
    'Test Checking',
    '',
    '01/20/2026',
    'Transfer : Test Savings',
    '',
    '',
    '',
    'Monthly top-up',
    '$200.00',
    '$0.00',
    'Cleared',
  ]),
  q([
    'Test Savings',
    '',
    '01/20/2026',
    'Transfer : Test Checking',
    '',
    '',
    '',
    'Monthly top-up',
    '$0.00',
    '$200.00',
    'Cleared',
  ]),
].join('\n')

interface StoredAccount {
  id: number
  name: string
  balance: number
  starting_balance: number
  starting_date: string
}
interface StoredTxn {
  date: string
  type: string
  amount: number
  account_id: number
  transfer_account_id?: number | null
}

async function drop(): Promise<void> {
  const file = new File([REGISTER], 'Selected Transactions for Test Plan.csv', {
    type: 'text/csv',
  })
  flow.handleBankFileSelect({ target: { files: [file], value: '' } } as unknown as Event)
  await waitUntil(() => flow.bankFiles().length > 0 && !flow.loading(), 'the file to be read')
}

describe('a YNAB register export on the Bank Imports tab', () => {
  it('shows the accounts the file names in place of an account picker', async () => {
    await drop()
    const row = host.querySelector('[data-test-id="bank-file-row"]')!
    expect(row.querySelector('[data-test-id="bank-file-accounts"]')?.textContent).toBe(
      'Accounts from the file: Test Checking, Test Savings'
    )
    expect(row.querySelector('[data-test-id="bank-target-account"]')).toBeNull()
  })

  it('imports every account, each transfer once and each starting balance as a balance', async () => {
    await drop()
    expect(flow.bankFiles().map((r) => r.bankId)).toEqual(['ynab'])
    // The file says which account every row belongs to: there is no account to choose.
    expect(rowsMissingAccount(flow.bankFiles())).toEqual([])

    await flow.processBankFiles()
    await waitUntil(() => !flow.loading(), 'the files to be read')
    expect(flow.error()).toBeNull()
    expect(flow.activeStep()).toBe('mapping')
    expect(flow.accountBalances()).toMatchObject({
      'Test Checking': '1250.00',
      'Test Savings': '3000.00',
    })
    expect(flow.accountBalanceDates()).toMatchObject({
      'Test Checking': '2026-01-02',
      'Test Savings': '2026-01-02',
    })

    await flow.goToPreview()
    expect(flow.activeStep()).toBe('preview')
    await flow.handleImport('all')
    await waitUntil(() => !flow.loading(), 'the import')
    expect(flow.error()).toBeNull()

    const db = await getDB()
    const accounts = (await db.getAll('accounts')) as StoredAccount[]
    const byName = Object.fromEntries(accounts.map((a) => [a.name, a]))
    expect(Object.keys(byName).sort()).toEqual(['Test Checking', 'Test Savings'])
    expect(byName['Test Checking']).toMatchObject({
      starting_balance: 1250,
      starting_date: '2026-01-02',
    })
    expect(byName['Test Savings']).toMatchObject({ starting_balance: 3000 })

    const txns = (await db.getAll('transactions')) as StoredTxn[]
    const summary = txns
      .map((t) => [t.date, t.type, t.amount, t.account_id, t.transfer_account_id ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    const checking = byName['Test Checking'].id
    const savings = byName['Test Savings'].id
    expect(summary).toEqual([
      ['2026-01-05', 'income', 2400, checking, null],
      ['2026-01-14', 'expense', 54.2, checking, null],
      ['2026-01-20', 'transfer', 200, checking, savings],
    ])
    // What YNAB showed: 1250 + 2400 - 54.20 - 200 in checking, 3000 + 200 in savings.
    const after = Object.fromEntries(
      ((await db.getAll('accounts')) as StoredAccount[]).map((a) => [a.name, a.balance])
    )
    expect(after).toEqual({ 'Test Checking': 3395.8, 'Test Savings': 3200 })
  })
})
