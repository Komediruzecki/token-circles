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

// ---------------------------------------------------------------------------
// Review findings, 2026-10-31. Each case failed on f09677e3.
// ---------------------------------------------------------------------------

const HEADER_ROW = REGISTER.split('\n')[0]!

/** account, date, payee, outflow, inflow, and an optional group and category */
const row = (a: string, d: string, p: string, o: string, i: string, group = '', cat = '') =>
  q([a, '', d, p, group && cat ? `${group}: ${cat}` : '', group, cat, '', o, i, 'Cleared'])

async function dropText(text: string, name = 'Register.csv'): Promise<void> {
  const file = new File([text], name, { type: 'text/csv' })
  flow.handleBankFileSelect({ target: { files: [file], value: '' } } as unknown as Event)
  await waitUntil(() => flow.bankFiles().length > 0 && !flow.loading(), 'the file to be read')
}

async function importAll(): Promise<void> {
  await flow.processBankFiles()
  await waitUntil(() => !flow.loading(), 'the files to be read')
  expect(flow.error()).toBeNull()
  await flow.goToPreview()
  await flow.handleImport('selected')
  await waitUntil(() => !flow.loading(), 'the import')
  expect(flow.error()).toBeNull()
}

async function stored() {
  const db = await getDB()
  const accounts = (await db.getAll('accounts')) as StoredAccount[]
  const name = new Map(accounts.map((a) => [a.id, a.name]))
  const txns = ((await db.getAll('transactions')) as StoredTxn[])
    .map((t) => [
      t.date,
      t.type,
      t.amount,
      name.get(t.account_id) ?? null,
      t.transfer_account_id ? (name.get(t.transfer_account_id) ?? null) : null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return { accounts: Object.fromEntries(accounts.map((a) => [a.name, a])), txns }
}

describe('review: a YNAB register export on the Bank Imports tab', () => {
  it('imports two identical rows as two, and a second import of the file adds nothing', async () => {
    const text = [
      HEADER_ROW,
      row('Test Checking', '01/21/2026', 'Cafe', '$3.00', '$0.00', 'Everyday', 'Eating'),
      row('Test Checking', '01/21/2026', 'Cafe', '$3.00', '$0.00', 'Everyday', 'Eating'),
      row('Test Checking', '01/20/2026', 'Transfer : Test Savings', '$100.00', '$0.00'),
      row('Test Checking', '01/20/2026', 'Transfer : Test Savings', '$100.00', '$0.00'),
      row('Test Savings', '01/20/2026', 'Transfer : Test Checking', '$0.00', '$100.00'),
      row('Test Savings', '01/20/2026', 'Transfer : Test Checking', '$0.00', '$100.00'),
    ].join('\n')
    await dropText(text)
    await flow.processBankFiles()
    await waitUntil(() => !flow.loading(), 'the files to be read')
    await flow.goToPreview()
    expect(flow.duplicateIndices()).toEqual([])
    expect(flow.selectedRows().size).toBe(4)
    await flow.handleImport('selected')
    await waitUntil(() => !flow.loading(), 'the import')
    expect((await stored()).txns).toEqual([
      ['2026-01-20', 'transfer', 100, 'Test Checking', 'Test Savings'],
      ['2026-01-20', 'transfer', 100, 'Test Checking', 'Test Savings'],
      ['2026-01-21', 'expense', 3, 'Test Checking', null],
      ['2026-01-21', 'expense', 3, 'Test Checking', null],
    ])

    flow.resetForm()
    await dropText(text)
    await importAll()
    expect((await stored()).txns).toHaveLength(4)
  })

  it('books spending in a category named like an account as spending, and says why', async () => {
    await dropText(
      [
        HEADER_ROW,
        row('Test Checking', '01/10/2026', 'Travel Agent', '$80.00', '$0.00', 'Goals', 'Vacation'),
        row('Test Checking', '01/20/2026', 'Transfer : Vacation', '$100.00', '$0.00'),
        row('Vacation', '01/20/2026', 'Transfer : Test Checking', '$0.00', '$100.00'),
      ].join('\n')
    )
    await flow.processBankFiles()
    await waitUntil(() => !flow.loading(), 'the files to be read')
    await flow.goToPreview()
    expect(flow.previewWarnings().map((w) => w.reason)).toContain(
      'Register.csv: The category Vacation has the name of an account, so its rows were categorized by your rules instead.'
    )
    await flow.handleImport('selected')
    await waitUntil(() => !flow.loading(), 'the import')
    const { accounts, txns } = await stored()
    expect(txns).toEqual([
      ['2026-01-10', 'expense', 80, 'Test Checking', null],
      ['2026-01-20', 'transfer', 100, 'Test Checking', 'Vacation'],
    ])
    expect(accounts['Vacation']!.balance).toBe(100)
    expect(accounts['Test Checking']!.balance).toBe(-180)
  })

  it('gives an existing empty account its starting balance, and keeps one that is in use', async () => {
    const db = await getDB()
    const base = { type: 'giro', currency: 'EUR', balance: 0, starting_balance: 0, profile_id: 1 }
    await db.add('accounts', { ...base, name: 'Test Checking' })
    const savings = await db.add('accounts', { ...base, name: 'Test Savings', balance: 40 })
    await db.add('transactions', {
      date: '2025-12-30',
      type: 'income',
      amount: 40,
      amount_local: 40,
      description: 'Earlier',
      account_id: savings,
      profile_id: 1,
    })
    await flow.loadBankAccounts()
    await dropText(REGISTER)
    await flow.processBankFiles()
    await waitUntil(() => !flow.loading(), 'the files to be read')
    await flow.goToPreview()
    expect(flow.previewWarnings().map((w) => w.reason)).toEqual([
      'Test Savings already has a starting balance or transactions, so the starting balance of 3000.00 in this import was not applied to it.',
    ])
    await flow.handleImport('selected')
    await waitUntil(() => !flow.loading(), 'the import')
    const { accounts } = await stored()
    expect(accounts['Test Checking']).toMatchObject({
      starting_balance: 1250,
      starting_date: '2026-01-02',
      balance: 3395.8,
    })
    expect(accounts['Test Savings']).toMatchObject({ starting_balance: 0, balance: 240 })
  })

  it('lets the Bank Imports file picker choose a .tsv file', () => {
    // YNAB writes TSV for currencies with a decimal comma. The File Upload tab's picker is left
    // as it is: its reader splits on commas only.
    const input = host.querySelector<HTMLInputElement>('input[type="file"][multiple]')!
    expect(input.accept.split(',')).toEqual(
      expect.arrayContaining(['.tsv', 'text/tab-separated-values'])
    )
  })
})

describe('review: a transfer to an account the profile does not have yet', () => {
  it('is said to create that account, and does', async () => {
    const db = await getDB()
    await db.add('accounts', {
      name: 'Revolut Main',
      type: 'giro',
      currency: 'EUR',
      balance: 0,
      starting_balance: 0,
      profile_id: 1,
    })
    localStorage.setItem(
      'bankImportTransferRules:1',
      JSON.stringify({
        ownAccounts: [],
        keywords: ['top-up'],
        counterparts: { 'pocket savings': 'Pocket Savings' },
      })
    )
    await flow.loadBankAccounts()
    await dropText(
      [
        'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
        'Topup,Current,2026-01-05 10:00:00,2026-01-05 10:00:01,Top-up from Pocket Savings,100.00,0.00,EUR,COMPLETED,100.00',
      ].join('\n'),
      'account-statement_2026-01.csv'
    )
    expect(flow.bankFiles()[0]).toMatchObject({ bankId: 'revolut', targetAccount: 'Revolut Main' })
    await importAll()
    // What happens: the mapping step lists Pocket Savings as an account, the import creates it,
    // and the transfer has both ends.
    const { txns } = await stored()
    expect(txns).toEqual([['2026-01-05', 'transfer', 100, 'Pocket Savings', 'Revolut Main']])
    expect(flow.bankWarnings()).toEqual([
      'account-statement_2026-01.csv: transfers name accounts you do not have yet: Pocket Savings. The import creates them as new accounts.',
    ])
  })
})

describe('review round 2: a category named like an account the profile already has', () => {
  it('books the spending against the account it left, and says why', async () => {
    const db = await getDB()
    const base = { type: 'giro', currency: 'EUR', balance: 0, starting_balance: 0, profile_id: 1 }
    await db.add('accounts', { ...base, name: 'Vacation' })
    await flow.loadBankAccounts()
    await dropText(
      [
        HEADER_ROW,
        row('Test Checking', '01/13/2026', 'Travel Agent', '$80.00', '$0.00', 'Goals', 'Vacation'),
      ].join('\n')
    )
    await flow.processBankFiles()
    await waitUntil(() => !flow.loading(), 'the files to be read')
    await flow.goToPreview()
    expect(flow.previewWarnings().map((w) => w.reason)).toContain(
      'Register.csv: The category Vacation has the name of an account, so its rows were categorized by your rules instead.'
    )
    await flow.handleImport('selected')
    await waitUntil(() => !flow.loading(), 'the import')
    const { accounts, txns } = await stored()
    expect(txns).toEqual([['2026-01-13', 'expense', 80, 'Test Checking', null]])
    expect(accounts['Vacation']!.balance).toBe(0)
    expect(accounts['Test Checking']!.balance).toBe(-80)
  })
})

describe('review round 2: notes from reading the files, in the preview', () => {
  it('are not listed as rows imported with changes', async () => {
    const { ImportPreviewStep } = await import('../ImportPreviewStep')
    await dropText(
      [
        HEADER_ROW,
        row('Test Checking', '01/10/2026', 'Travel Agent', '$80.00', '$0.00', 'Goals', 'Vacation'),
        row('Test Checking', '01/20/2026', 'Transfer : Vacation', '$100.00', '$0.00'),
      ].join('\n')
    )
    await flow.processBankFiles()
    await waitUntil(() => !flow.loading(), 'the files to be read')
    await flow.goToPreview()
    const preview = document.createElement('div')
    document.body.appendChild(preview)
    const unmount = render(() => <ImportPreviewStep flow={flow} />, preview)
    try {
      const note =
        'Register.csv: The category Vacation has the name of an account, so its rows were categorized by your rules instead.'
      expect(
        preview.querySelector('[data-test-id="import-warnings"]')?.textContent ?? ''
      ).not.toContain(note)
      expect(preview.querySelector('[data-test-id="import-notes"]')?.textContent ?? '').toContain(
        note
      )
    } finally {
      unmount()
      preview.remove()
    }
  })
})

describe('review round 3: the import log', () => {
  it('counts rows imported with a warning, not notes about the import as a whole', async () => {
    const db = await getDB()
    const checking = await db.add('accounts', {
      name: 'Test Checking',
      type: 'giro',
      currency: 'EUR',
      balance: 40,
      starting_balance: 0,
      profile_id: 1,
    })
    await db.add('transactions', {
      date: '2025-12-30',
      type: 'income',
      amount: 40,
      amount_local: 40,
      description: 'Earlier',
      account_id: checking,
      profile_id: 1,
    })
    await flow.loadBankAccounts()
    await dropText(
      [
        HEADER_ROW,
        row(
          'Test Checking',
          '01/02/2026',
          'Starting Balance',
          '$0.00',
          '$500.00',
          'Inflow',
          'Ready to Assign'
        ),
        row('Test Checking', '01/13/2026', 'Shop', '$5.00', '$0.00', 'Everyday', 'Groceries'),
      ].join('\n')
    )
    await importAll()
    // The kept starting balance is a note in the response's warnings, without a row index.
    expect(flow.previewWarnings().map((w) => w.reason)).toEqual([
      'Test Checking already has a starting balance or transactions, so the starting balance of 500.00 in this import was not applied to it.',
    ])
    let logs: { details?: string }[] = []
    await waitUntil(() => {
      void db.getAll('import_logs').then((all) => (logs = all as { details?: string }[]))
      return logs.length > 0
    }, 'the import log')
    expect(JSON.parse(logs[0]!.details!)).toMatchObject({ rows_with_warnings: 0 })
  })
})
