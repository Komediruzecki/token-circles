/**
 * A file exported FROM YNAB: the register of an "Export Plan" download, or "Export # Transactions"
 * from an account register. Not the import CSV YNAB reads (Date,Payee,Memo,Outflow,Inflow), which
 * bankImport.test.ts covers.
 *
 * The header and the conventions below are pinned from sources, not guessed:
 * - YNAB, "How to Export Plan Data" (support.ynab.com, updated 2026-08-18): CSV, or TSV "for
 *   currencies that use a comma"; plan files start "YNAB Export - ", a selection "Selected
 *   Transactions for ".
 * - parse-ynab-export 1.0.6 (npm) README sample: the eleven-column header, quoted text, bare
 *   amounts with a currency sign ("kr 30,00", "€144,36"), "Transfer : <account>" payees and
 *   "Split (1/2) " memos.
 * - YNAB, "The Starting Balance" and "Transfer Transactions" (support.ynab.com): the payee
 *   "Starting Balance"; a transfer shows in both accounts' registers.
 * - csv_to_ynab_json.py (gist StephenBrown2, 2026-04-03): income sits in the category group
 *   "Inflow", category "Ready to Assign".
 *
 * Every name and amount here is made up.
 */
import { describe, expect, it } from 'vitest'
import { ynabAdapter } from '../../../../../shared/bankImport/adapters/ynab'
import { processFiles, toDetectInput } from '../../../../../shared/bankImport/process'
import { detectBank } from '../../../../../shared/bankImport/registry'
import type { TransformContext } from '../../../../../shared/bankImport/types'

const enc = (s: string) => new TextEncoder().encode(s)

const HEADER = [
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
]

/**
 * Quote the text cells and leave the amounts bare, as YNAB's own (tab-separated) sample does. An
 * amount holding the separator is quoted, as any CSV writer must: whether YNAB's comma files write
 * thousands separators at all is not documented, so the tests only assume a well-formed file.
 */
function line(cells: string[], delimiter: string): string {
  return cells
    .map((c, i) => ((i === 8 || i === 9) && !c.includes(delimiter) ? c : `"${c}"`))
    .join(delimiter)
}

function file(rows: string[][], delimiter = ','): string {
  const header = HEADER.map((h) => `"${h}"`).join(delimiter)
  return [header, ...rows.map((r) => line(r, delimiter))].join('\n')
}

const CHECKING = 'Test Checking'
const SAVINGS = 'Test Savings'

/** A US-dollar plan, month-first dates. */
const US_ROWS: string[][] = [
  [
    CHECKING,
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
  ],
  [
    SAVINGS,
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
  ],
  [
    CHECKING,
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
  ],
  [
    CHECKING,
    'Red',
    '01/14/2026',
    'Corner Grocer',
    'Everyday: Groceries',
    'Everyday',
    'Groceries',
    '',
    '$54.20',
    '$0.00',
    'Cleared',
  ],
  [
    CHECKING,
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
  ],
  [
    SAVINGS,
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
  ],
  [
    CHECKING,
    '',
    '01/22/2026',
    'Hardware Shop',
    'Home: Repairs',
    'Home',
    'Repairs',
    'Split (1/2) Paint',
    '$30.00',
    '$0.00',
    'Uncleared',
  ],
  [
    CHECKING,
    '',
    '01/22/2026',
    'Hardware Shop',
    'Home: Garden',
    'Home',
    'Garden',
    'Split (2/2) ',
    '$12.50',
    '$0.00',
    'Uncleared',
  ],
]

/** The same plan in a currency with a decimal comma: tabs, day-first dates, sign before or after. */
const EU_ROWS: string[][] = [
  [
    CHECKING,
    '',
    '02.01.2026',
    'Starting Balance',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    '',
    '€0,00',
    '€1.250,00',
    'Reconciled',
  ],
  [
    CHECKING,
    '',
    '05.01.2026',
    'Example Employer',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    'January pay',
    '0,00€',
    '2.400,00€',
    'Cleared',
  ],
  [
    CHECKING,
    '',
    '14.01.2026',
    'Corner Grocer',
    'Everyday: Groceries',
    'Everyday',
    'Groceries',
    '',
    '54,20€',
    '0,00€',
    'Cleared',
  ],
  [
    CHECKING,
    '',
    '20.01.2026',
    'Transfer : Test Savings',
    '',
    '',
    '',
    '',
    '€200,00',
    '€0,00',
    'Cleared',
  ],
]

const ctx = (over: Partial<TransformContext> = {}): TransformContext => ({
  targetAccount: 'Chosen Account',
  categoryRules: [{ category: 'Salary', keywords: ['employer'] }],
  transferRules: { ownAccounts: [], keywords: ['transfer'], counterparts: {} },
  knownAccounts: [],
  ...over,
})

async function read(text: string, filename = 'Register.csv') {
  const parsed = await ynabAdapter.parse(enc(text), filename)
  return { parsed, txns: ynabAdapter.transform(parsed, ctx()) }
}

describe('a YNAB register export is detected from its header', () => {
  it.each([
    ['comma', ','],
    ['semicolon', ';'],
    ['tab', '\t'],
  ])('with %s separators, whatever the file is called', (_name, delimiter) => {
    const text = file(US_ROWS.slice(0, 1), delimiter)
    for (const name of ['Register.csv', 'Selected Transactions for Test Plan.tsv', 'export.csv']) {
      const det = detectBank(toDetectInput(name, enc(text)))
      expect(det?.adapter.id).toBe('ynab')
      expect(det?.confidence).toBeGreaterThan(0.9)
    }
  })

  it('with a byte-order mark in front of the header', () => {
    const bom = String.fromCharCode(0xfeff)
    const det = detectBank(toDetectInput('Register.csv', enc(bom + file(US_ROWS.slice(0, 1)))))
    expect(det?.adapter.id).toBe('ynab')
  })
})

describe('a YNAB register export, row by row', () => {
  it("imports each row into the row's own account", async () => {
    const { txns } = await read(file(US_ROWS))
    const groceries = txns.find((t) => t.description === 'Corner Grocer')
    expect(groceries).toMatchObject({
      date: '2026-01-14',
      type: 'Expense',
      meansOfPayment: CHECKING,
      category: 'Groceries',
      amount: 54.2,
    })
    expect(txns.every((t) => t.meansOfPayment !== 'Chosen Account')).toBe(true)
  })

  it('lists the accounts the file names, so no account has to be chosen for it', async () => {
    const { parsed } = await read(file(US_ROWS))
    expect(parsed.meta.accounts).toEqual([CHECKING, SAVINGS])
  })

  it('imports a transfer once, from the account the money left to the one it reached', async () => {
    const { txns } = await read(file(US_ROWS))
    const transfers = txns.filter((t) => t.type === 'Transfer')
    expect(transfers).toEqual([
      expect.objectContaining({
        date: '2026-01-20',
        meansOfPayment: CHECKING,
        category: SAVINGS,
        amount: 200,
        description: 'Monthly top-up',
      }),
    ])
    expect(txns.filter((t) => t.amount === 200)).toHaveLength(1)
  })

  it('imports a transfer whose other half is not in the file, in the right direction', async () => {
    // Exporting selected transactions from the savings register alone.
    const { txns } = await read(file([US_ROWS[5]]))
    expect(txns).toEqual([
      expect.objectContaining({
        type: 'Transfer',
        meansOfPayment: CHECKING,
        category: SAVINGS,
        amount: 200,
      }),
    ])
  })

  it('keeps two equal transfers on one day as two', async () => {
    const { txns } = await read(file([US_ROWS[4], US_ROWS[4], US_ROWS[5], US_ROWS[5]]))
    expect(txns.filter((t) => t.type === 'Transfer')).toHaveLength(2)
  })

  it('takes starting balances out of the transactions and hands them to the accounts', async () => {
    const { parsed, txns } = await read(file(US_ROWS))
    expect(txns.some((t) => t.description === 'Starting Balance')).toBe(false)
    expect(parsed.meta.startingBalances).toEqual({
      [CHECKING]: { amount: 1250, date: '2026-01-02' },
      [SAVINGS]: { amount: 3000, date: '2026-01-02' },
    })
  })

  it("leaves YNAB's Ready to Assign out of the categories, so income is categorized as income", async () => {
    const { txns } = await read(file(US_ROWS))
    expect(txns.find((t) => t.description === 'January pay')).toMatchObject({
      type: 'Income',
      amount: 2400,
      category: 'Salary',
    })
  })

  it('imports each part of a split as its own row, without the split marker', async () => {
    const { txns } = await read(file(US_ROWS))
    const parts = txns.filter((t) => t.date === '2026-01-22')
    expect(parts.map((t) => [t.category, t.amount, t.description])).toEqual([
      ['Repairs', 30, 'Paint'],
      ['Garden', 12.5, 'Hardware Shop'],
    ])
  })

  it('imports the whole example as five transactions', async () => {
    const { txns } = await read(file(US_ROWS))
    expect(txns.map((t) => t.type)).toEqual(['Income', 'Expense', 'Transfer', 'Expense', 'Expense'])
  })

  it('reads a tab-separated export with decimal commas and the sign on either side', async () => {
    const { parsed, txns } = await read(file(EU_ROWS, '\t'), 'Register.tsv')
    expect(parsed.meta.startingBalances).toEqual({
      [CHECKING]: { amount: 1250, date: '2026-01-02' },
    })
    expect(txns.map((t) => [t.date, t.type, t.amount])).toEqual([
      ['2026-01-05', 'Income', 2400],
      ['2026-01-14', 'Expense', 54.2],
      ['2026-01-20', 'Transfer', 200],
    ])
  })

  it('reads an amount whose currency is an abbreviation ending in a dot', async () => {
    const rows = [
      [
        CHECKING,
        '',
        '14.01.2026',
        'Corner Grocer',
        '',
        '',
        '',
        '',
        '1.234,56 kr.',
        '0,00 kr.',
        'Cleared',
      ],
    ]
    const { txns } = await read(file(rows, '\t'))
    expect(txns[0]).toMatchObject({ type: 'Expense', amount: 1234.56 })
  })

  it('skips a row that moves no money', async () => {
    const rows = [
      [CHECKING, '', '01/14/2026', 'Corner Grocer', '', '', '', '', '$0.00', '$0.00', 'Cleared'],
    ]
    const { txns } = await read(file(rows))
    expect(txns).toEqual([])
  })
})

describe('processing a YNAB register export', () => {
  it('needs no target account and does not warn about one', async () => {
    const result = await processFiles([{ filename: 'Register.csv', bytes: enc(file(US_ROWS)) }])
    expect(result.perFile[0]).toMatchObject({ bankId: 'ynab', count: 5 })
    expect(result.warnings.filter((w) => w.includes('no target account'))).toEqual([])
    expect(result.perFile[0].meta.accounts).toEqual([CHECKING, SAVINGS])
  })
})
