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

// ---------------------------------------------------------------------------
// Review findings, 2026-10-31. Each case failed on f09677e3.
// ---------------------------------------------------------------------------

/** One register row: account, date, payee, outflow, inflow and an optional group and category. */
const reg = (
  account: string,
  date: string,
  payee: string,
  out: string,
  inn: string,
  group = '',
  category = ''
) => [
  account,
  '',
  date,
  payee,
  group && category ? `${group}: ${category}` : '',
  group,
  category,
  '',
  out,
  inn,
  'Cleared',
]

describe('review: identical rows in one register', () => {
  it('gives the second of two identical rows its own duplicate key, and the same key on a re-read', async () => {
    const rows = [
      reg(CHECKING, '01/21/2026', 'Cafe', '$3.00', '$0.00', 'Everyday', 'Eating'),
      reg(CHECKING, '01/21/2026', 'Cafe', '$3.00', '$0.00', 'Everyday', 'Eating'),
      reg(CHECKING, '01/20/2026', 'Transfer : Test Savings', '$100.00', '$0.00'),
      reg(CHECKING, '01/20/2026', 'Transfer : Test Savings', '$100.00', '$0.00'),
      reg(SAVINGS, '01/20/2026', 'Transfer : Test Checking', '$0.00', '$100.00'),
      reg(SAVINGS, '01/20/2026', 'Transfer : Test Checking', '$0.00', '$100.00'),
    ]
    const once = await processFiles([{ filename: 'Register.csv', bytes: enc(file(rows)) }])
    expect(once.rows).toHaveLength(4)
    expect(once.duplicateIndices).toEqual([])
    // The same file twice in one batch: each row of the second copy matches one of the first.
    const twice = await processFiles([
      { filename: 'Register.csv', bytes: enc(file(rows)) },
      { filename: 'Register (1).csv', bytes: enc(file(rows)) },
    ])
    expect(twice.duplicateIndices).toEqual([4, 5, 6, 7])
  })
})

describe('review: a category with the name of an account', () => {
  it('is not used as the category, and the file says so', async () => {
    const rows = [
      reg(CHECKING, '01/10/2026', 'Travel Agent', '$80.00', '$0.00', 'Goals', 'Vacation'),
      reg(CHECKING, '01/11/2026', 'Corner Grocer', '$5.00', '$0.00', 'Everyday', 'test savings'),
      reg(CHECKING, '01/20/2026', 'Transfer : Vacation', '$100.00', '$0.00'),
      reg(SAVINGS, '01/21/2026', 'Bank Interest', '$0.00', '$1.00', 'Income', 'Interest'),
    ]
    const { parsed, txns } = await read(file(rows))
    expect(txns.map((t) => [t.type, t.meansOfPayment, t.category])).toEqual([
      ['Expense', CHECKING, 'Other'],
      ['Expense', CHECKING, 'Other'],
      ['Transfer', CHECKING, 'Vacation'],
      ['Income', SAVINGS, 'Interest'],
    ])
    expect(parsed.meta.warnings).toEqual([
      'The categories Vacation and test savings have the names of accounts, so their rows were categorized by your rules instead.',
    ])
  })
})

describe('review: amounts', () => {
  it.each([
    ['.50', 0.5],
    ['-.50', -0.5],
    ['$.50', 0.5],
    [',50 €', 0.5],
  ])('reads %s with its leading decimal separator', async (cell, amount) => {
    const csv = ['Date,Payee,Memo,Amount', `2026-01-15,Shop,m,"${cell}"`].join('\n')
    const { txns } = await read(csv)
    expect(txns[0].amount * (txns[0].type === 'Expense' ? -1 : 1)).toBe(amount)
  })

  it('reads a currency without decimals by the file, not cell by cell', async () => {
    const yen = [
      reg(CHECKING, '01/14/2026', 'Shop', '¥1,234', '¥0'),
      reg(CHECKING, '01/15/2026', 'Shop', '¥500', '¥0'),
    ]
    const { txns: yenTxns } = await read(file(yen))
    expect(yenTxns.map((t) => t.amount)).toEqual([1234, 500])
    const kr = [
      reg(CHECKING, '14.01.2026', 'Shop', '1.234 kr.', '0 kr.'),
      reg(CHECKING, '15.01.2026', 'Shop', '2.500.000 kr.', '0 kr.'),
    ]
    const { txns: krTxns } = await read(file(kr, '\t'))
    expect(krTxns.map((t) => t.amount)).toEqual([1234, 2500000])
  })

  it('still reads a one-off thousands comma as thousands when the file has cents', async () => {
    const rows = [
      reg(CHECKING, '01/14/2026', 'Shop', '$1,234', '$0.00'),
      reg(CHECKING, '01/15/2026', 'Shop', '$5.50', '$0.00'),
    ]
    const { txns } = await read(file(rows))
    expect(txns.map((t) => t.amount)).toEqual([1234, 5.5])
  })
})

describe('review: dates', () => {
  it('reads year-first dates with slashes or dots', async () => {
    const rows = [
      reg(CHECKING, '2026/01/14', 'Shop', '$5.00', '$0.00'),
      reg(CHECKING, '2026.01.15', 'Shop', '$6.00', '$0.00'),
    ]
    const { txns } = await read(file(rows))
    expect(txns.map((t) => t.date)).toEqual(['2026-01-14', '2026-01-15'])
  })

  it('counts the rows it skips for a date it cannot read, and says so', async () => {
    const rows = [
      reg(CHECKING, 'Jan 14th', 'Shop', '$5.00', '$0.00'),
      reg(CHECKING, '', 'Shop', '$6.00', '$0.00'),
      reg(CHECKING, '01/15/2026', 'Shop', '$7.00', '$0.00'),
    ]
    const { parsed, txns } = await read(file(rows))
    expect(txns).toHaveLength(1)
    expect(parsed.meta.warnings).toEqual([
      '2 rows were skipped because their date could not be read.',
    ])
  })

  it('says the same for the CSV YNAB imports', async () => {
    const csv = ['Date,Payee,Memo,Amount', 'someday,Shop,,-5.00', '2026-01-15,Shop,,-6.00'].join(
      '\n'
    )
    const { parsed, txns } = await read(csv)
    expect(txns).toHaveLength(1)
    expect(parsed.meta.warnings).toEqual(['1 row was skipped because its date could not be read.'])
  })
})

describe('review: a row with more cells than the header', () => {
  it('is skipped with a warning instead of read with shifted columns', async () => {
    const text = [
      file([reg(CHECKING, '01/14/2026', 'Shop', '$5.00', '$0.00')]),
      // An amount with a thousands comma that nobody quoted: twelve cells under eleven names.
      '"Test Checking","","01/15/2026","Shop","","","","",$0.00,$1,250.00,"Cleared"',
    ].join('\n')
    const { parsed, txns } = await read(text)
    expect(txns.map((t) => t.amount)).toEqual([5])
    expect(parsed.meta.warnings).toEqual([
      '1 row was skipped because it has more cells than the header: an amount with a comma that is not in quotes is the usual cause.',
    ])
  })
})

describe('review: a register without an Account column', () => {
  it('keeps its starting balance, for the account chosen for the file', async () => {
    const header = HEADER.filter((h) => h !== 'Account')
    const text = [
      header.map((h) => `"${h}"`).join(','),
      '"","01/02/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$500.00,"Reconciled"',
      '"","01/13/2026","Shop","","","","",$5.00,$0.00,"Cleared"',
    ].join('\n')
    const result = await processFiles([
      { filename: 'Register.csv', bytes: enc(text), targetAccount: 'Chosen Account' },
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.perFile[0].meta.startingBalances).toEqual({
      'Chosen Account': { amount: 500, date: '2026-01-02' },
    })
  })
})

describe('review: the YNAB 4 register', () => {
  it.each([
    'Account,Flag,Check Number,Date,Payee,Category,Master Category,Sub Category,Memo,Outflow,Inflow,Cleared,Running Balance',
    'Account,Flag,Date,Payee,Category,Master Category,Sub Category,Memo,Outflow,Inflow,Cleared',
    'Account,Flag,Date,Payee,Category,Memo,Outflow,Inflow,Cleared,Running Balance',
  ])("is not taken for the register of today's YNAB: %s", (header) => {
    for (const name of ['Register.csv', 'YNAB 4 Register.csv']) {
      expect(detectBank(toDetectInput(name, enc(header)))?.adapter.id).not.toBe('ynab')
    }
  })
})

describe('review: transfer ends that are not accounts yet', () => {
  it('says nothing about them for a file that names its accounts', async () => {
    const result = await processFiles([{ filename: 'Register.csv', bytes: enc(file(US_ROWS)) }], {
      knownAccounts: ['Some Other Account'],
    })
    expect(result.warnings).toEqual([])
  })
})

describe('review: a shifted row whose extra cell is empty', () => {
  it('is skipped when it is wider than the rows around it', async () => {
    const csv = [
      'Date,Payee,Category,Memo,Outflow,Inflow',
      '2026-01-14,Shop,Food,m,"5,00",',
      // "1.234,56" not in quotes: Outflow reads "1.234", Inflow "56", and the empty Inflow spills over.
      '2026-01-15,Shop,Food,m,1.234,56,',
      '2026-01-16,Shop,Food,m,"6,00",',
    ].join('\n')
    const { parsed, txns } = await read(csv)
    expect(txns.map((t) => t.amount)).toEqual([5, 6])
    expect(parsed.meta.warnings).toEqual([
      '1 row was skipped because it has more cells than the header: an amount with a comma that is not in quotes is the usual cause.',
    ])
  })

  it('is read when every row ends with a separator', async () => {
    const csv = [
      'Date,Payee,Memo,Amount',
      '2026-01-14,Shop,m,-5.00,',
      '2026-01-15,Shop,m,-6.00,',
    ].join('\n')
    const { parsed, txns } = await read(csv)
    expect(txns.map((t) => t.amount)).toEqual([5, 6])
    expect(parsed.meta.warnings).toBeUndefined()
  })
})
