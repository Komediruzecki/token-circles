/**
 * The import's Category column names a category, and on a Transfer row the account the money went
 * to. A row that names the account that paid it (Means of Payment) books from that account, and
 * its Category is its category.
 *
 * Every row read Category as an account: the account map is seeded with the profile's accounts, so
 * a profile with an account "Vacation" booked an expense categorised "Vacation" and paid from
 * Checking against Vacation (Vacation -80, Checking 0). A row with no Means of Payment still
 * resolves as it did; which rule it should follow is a separate decision. The Worker mirror is
 * worker/test/import-category-named-like-account.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { markedAccountUsedAsCategoryNote } from '../../../../../shared/importRowChecks'
import { getDB } from '../idb.js'
import { importExecute } from '../localHandlers.js'

const MAPPING = { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 }

let checking = 0
let vacation = 0

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'transactions', 'categories', 'accounts', 'settings']) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  checking = (await db.add('accounts', {
    name: 'Checking',
    type: 'giro',
    balance: 0,
    starting_balance: 0,
    profile_id: 1,
  })) as number
  vacation = (await db.add('accounts', {
    name: 'Vacation',
    type: 'savings',
    balance: 0,
    starting_balance: 0,
    profile_id: 1,
  })) as number
})

async function balance(id: number): Promise<number> {
  return ((await (await getDB()).get('accounts', id)) as { balance: number }).balance
}

async function balanceOf(name: string): Promise<number | undefined> {
  const accounts = (await (await getDB()).getAllFromIndex('accounts', 'by_profile', 1)) as {
    name: string
    balance: number
  }[]
  return accounts.find((a) => a.name === name)?.balance
}

async function onlyTransaction(): Promise<Record<string, unknown>> {
  const txns = (await (await getDB()).getAllFromIndex('transactions', 'by_profile', 1)) as Record<
    string,
    unknown
  >[]
  expect(txns).toHaveLength(1)
  return txns[0]
}

async function accountNames(): Promise<string[]> {
  const accounts = (await (await getDB()).getAllFromIndex('accounts', 'by_profile', 1)) as {
    name: string
  }[]
  return accounts.map((a) => a.name).sort()
}

async function categoryId(name: string): Promise<number> {
  const db = await getDB()
  const existing = (
    (await db.getAllFromIndex('categories', 'by_profile', 1)) as {
      id: number
      name: string
    }[]
  ).find((c) => c.name === name)
  if (existing) return existing.id
  return (await db.add('categories', {
    name,
    type: 'expense',
    color: '#000000',
    icon: 'tag',
    profile_id: 1,
  })) as number
}

type Body = {
  imported: number
  duplicates: number
  new_categories: string[]
  new_accounts: string[]
  warnings: { index?: number; reason: string }[]
}

async function categoryName(id: unknown): Promise<string | undefined> {
  if (typeof id !== 'number') return undefined
  return ((await (await getDB()).get('categories', id)) as { name: string } | undefined)?.name
}

describe('a category named like an account, on a row with a Means of Payment, in local-first', () => {
  it('books an expense against the account it was paid from, in that category', async () => {
    const res = await importExecute({
      rows: [['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense']],
      mapping: MAPPING,
      categoryTypes: { Vacation: 'expense', Checking: 'account' },
    })
    expect(((await res.json()) as Body).imported).toBe(1)

    const txn = await onlyTransaction()
    expect(txn.type).toBe('expense')
    expect(txn.account_id).toBe(checking)
    expect(txn.transfer_account_id ?? null).toBeNull()
    expect(await categoryName(txn.category_id)).toBe('Vacation')
    expect(await balance(checking)).toBe(-80)
    expect(await balance(vacation)).toBe(0)
  })

  it('does the same for a sheet without a Type column', async () => {
    await importExecute({
      rows: [['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking']],
      mapping: { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4 },
      categoryTypes: { Vacation: 'expense', Checking: 'account' },
    })

    const txn = await onlyTransaction()
    expect(txn.account_id).toBe(checking)
    expect(await categoryName(txn.category_id)).toBe('Vacation')
    expect(await balance(checking)).toBe(-80)
    expect(await balance(vacation)).toBe(0)
  })

  it('books a row whose category is set to Account from its Means of Payment, and notes it once', async () => {
    const res = await importExecute({
      rows: [['2026-01-12', 'Monthly deposit', '500', 'IB', 'Checking', 'Expense']],
      mapping: MAPPING,
      categoryTypes: { IB: 'account', Checking: 'account' },
    })
    const body = (await res.json()) as Body

    const txn = await onlyTransaction()
    // The row's own Type, read from the paying account's side.
    expect(txn.type).toBe('expense')
    expect(txn.account_id).toBe(checking)
    expect(txn.transfer_account_id ?? null).toBeNull()
    expect(await categoryName(txn.category_id)).toBe('IB')
    expect(await balance(checking)).toBe(-500)
    // No row uses IB as an account, so none is made beside the category.
    expect(await accountNames()).toEqual(['Checking', 'Vacation'])
    expect(body.warnings).toEqual([
      {
        reason: markedAccountUsedAsCategoryNote({
          name: 'IB',
          rows: 1,
          paidFrom: ['Checking'],
          notAccounts: [],
          preview: false,
          categorised: true,
          types: ['expense'],
        }),
      },
    ])
  })

  it('notes a Means of Payment that names no account as such, not as the account paid from', async () => {
    const body = (await (
      await importExecute({
        rows: [['2026-01-12', 'Put aside', '-200', 'Savings', 'Cash', 'Expense']],
        mapping: MAPPING,
        categoryTypes: { Savings: 'account' },
      })
    ).json()) as Body

    const txn = await onlyTransaction()
    expect(txn.account_id ?? null).toBeNull()
    expect(await categoryName(txn.category_id)).toBe('Savings')
    expect(body.warnings).toEqual([
      {
        reason: markedAccountUsedAsCategoryNote({
          name: 'Savings',
          rows: 1,
          paidFrom: [],
          notAccounts: ['Cash'],
          preview: false,
          categorised: true,
          types: ['expense'],
        }),
      },
    ])
  })

  it('keeps the category of a row paid from an account when the same name is also a transfer target', async () => {
    const preview = await importExecute({
      rows: [
        ['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense'],
        ['2026-01-13', 'Save', '200', 'Vacation', 'Checking', 'Transfer'],
      ],
      mapping: MAPPING,
      categoryTypes: { Vacation: 'account', Checking: 'account' },
      dry_run: true,
    })
    expect(((await preview.json()) as Body).new_categories).toEqual(['Vacation'])
    await importExecute({
      rows: [
        ['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense'],
        ['2026-01-13', 'Save', '200', 'Vacation', 'Checking', 'Transfer'],
      ],
      mapping: MAPPING,
      categoryTypes: { Vacation: 'account', Checking: 'account' },
      approvedCategories: ['Vacation'],
    })
    const txns = (await (await getDB()).getAllFromIndex('transactions', 'by_profile', 1)) as {
      type: string
      category_id?: number
    }[]
    const expense = txns.find((t) => t.type === 'expense')!
    expect(await categoryName(expense.category_id)).toBe('Vacation')
    expect(await balance(checking)).toBe(-280)
    expect(await balance(vacation)).toBe(200)
  })

  it('makes categories, not accounts, of names set to Account that only rows paid from Checking use', async () => {
    // The mapping step sets these to Account: classifyCategory reads "ib" in Library, "saving",
    // "invest" and "rev" as account names.
    const REAL = [
      ['2026-03-01', 'Late fee', '12', 'Library'],
      ['2026-03-02', 'Supermarket', '40', 'Groceries'],
      ['2026-03-03', 'Book sale', '8', 'Library'],
      ['2026-03-04', 'Put aside', '200', 'Savings'],
      ['2026-03-05', 'ETF buy', '500', 'Investments'],
      ['2026-03-06', 'Supermarket', '35', 'Groceries'],
      ['2026-03-07', 'Membership', '15', 'Library'],
      ['2026-03-08', 'Magazine', '6', 'Review'],
      ['2026-03-09', 'Supermarket', '22', 'Groceries'],
      ['2026-03-10', 'Put aside', '200', 'Savings'],
    ]
    const rows = REAL.map(([d, s, a, c]) => [d, s, `-${a}`, c, 'Checking', 'Expense'])
    const categoryTypes = {
      Library: 'account',
      Savings: 'account',
      Investments: 'account',
      Review: 'account',
      Groceries: 'expense',
      Checking: 'account',
    }
    const preview = (await (
      await importExecute({ rows, mapping: MAPPING, categoryTypes, dry_run: true })
    ).json()) as Body
    expect(preview.new_accounts).toEqual([])
    // The preview's copy says to change the rows before importing, not to undo the import.
    expect(preview.warnings[0].reason).toBe(
      markedAccountUsedAsCategoryNote({
        name: 'Library',
        rows: 3,
        paidFrom: ['Checking'],
        notAccounts: [],
        preview: true,
        categorised: true,
        types: ['expense'],
      })
    )
    expect([...preview.new_categories].sort()).toEqual([
      'Groceries',
      'Investments',
      'Library',
      'Review',
      'Savings',
    ])

    const body = (await (
      await importExecute({
        rows,
        mapping: MAPPING,
        categoryTypes,
        approvedCategories: preview.new_categories,
      })
    ).json()) as Body
    expect(body.imported).toBe(10)
    expect(await accountNames()).toEqual(['Checking', 'Vacation'])
    expect(await balance(checking)).toBe(-1038)
    expect(body.warnings.map((w) => w.reason)).toEqual([
      markedAccountUsedAsCategoryNote({
        name: 'Library',
        rows: 3,
        paidFrom: ['Checking'],
        notAccounts: [],
        preview: false,
        categorised: true,
        types: ['expense'],
      }),
      markedAccountUsedAsCategoryNote({
        name: 'Savings',
        rows: 2,
        paidFrom: ['Checking'],
        notAccounts: [],
        preview: false,
        categorised: true,
        types: ['expense'],
      }),
      markedAccountUsedAsCategoryNote({
        name: 'Investments',
        rows: 1,
        paidFrom: ['Checking'],
        notAccounts: [],
        preview: false,
        categorised: true,
        types: ['expense'],
      }),
      markedAccountUsedAsCategoryNote({
        name: 'Review',
        rows: 1,
        paidFrom: ['Checking'],
        notAccounts: [],
        preview: false,
        categorised: true,
        types: ['expense'],
      }),
    ])
  })

  it("still reads a Transfer row's category as the account the money went to", async () => {
    await importExecute({
      rows: [['2026-01-13', 'Save', '100', 'Vacation', 'Checking', 'Transfer']],
      mapping: MAPPING,
      categoryTypes: { Checking: 'account' },
    })

    const txn = await onlyTransaction()
    expect(txn.type).toBe('transfer')
    expect(txn.account_id).toBe(checking)
    expect(txn.transfer_account_id).toBe(vacation)
    expect(await balance(checking)).toBe(-100)
    expect(await balance(vacation)).toBe(100)
  })

  it('offers the category as new in the preview, so an approved import creates it', async () => {
    const res = await importExecute({
      rows: [
        ['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense'],
        ['2026-01-13', 'Save', '100', 'Savings', 'Checking', 'Transfer'],
      ],
      mapping: MAPPING,
      categoryTypes: { Vacation: 'expense', Checking: 'account' },
      dry_run: true,
    })
    const body = (await res.json()) as Body
    expect(body.new_categories).toEqual(['Vacation'])
    expect(body.new_accounts).toEqual(['Savings'])
  })
})

describe('a re-import over rows an earlier import booked against the category account', () => {
  const rows = [
    ['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense'],
    ['2026-01-12', 'Monthly deposit', '500', 'IB', 'Checking', 'Expense'],
  ]
  const categoryTypes = { Vacation: 'expense', IB: 'account', Checking: 'account' }

  async function ib(): Promise<number> {
    return (await (
      await getDB()
    ).add('accounts', {
      name: 'IB',
      type: 'ib',
      balance: 500,
      starting_balance: 0,
      profile_id: 1,
    })) as number
  }

  // A row an earlier import wrote carries that import's id; one typed in by hand has none.
  async function plant(row: Record<string, unknown>): Promise<void> {
    await (
      await getDB()
    ).add('transactions', {
      currency: 'EUR',
      profile_id: 1,
      amount_local: row.amount,
      import_id: 'imp-earlier',
      ...row,
    })
  }

  it('counts them as duplicates, as they were stored: in that account, in that category', async () => {
    const ibId = await ib()
    // As the import stored them before: an expense in Vacation's account, and the IB deposit as an
    // income into IB, its type from the sign because IB is set to Account.
    await plant({
      date: '2026-01-10',
      description: 'Travel Agent',
      amount: 80,
      type: 'expense',
      account_id: vacation,
      category_id: await categoryId('Vacation'),
    })
    await plant({
      date: '2026-01-12',
      description: 'Monthly deposit',
      amount: 500,
      type: 'income',
      account_id: ibId,
      category_id: await categoryId('IB'),
    })

    const body = (await (
      await importExecute({ rows, mapping: MAPPING, categoryTypes })
    ).json()) as Body
    expect(body).toMatchObject({ imported: 0, duplicates: 2 })
    expect(await (await getDB()).getAllFromIndex('transactions', 'by_profile', 1)).toHaveLength(2)
  })

  it('counts one stored with no category too, as a gated import left it', async () => {
    const ibId = await ib()
    await plant({
      date: '2026-01-12',
      description: 'Monthly deposit',
      amount: 500,
      type: 'income',
      account_id: ibId,
    })

    const body = (await (
      await importExecute({ rows: [rows[1]], mapping: MAPPING, categoryTypes })
    ).json()) as Body
    expect(body).toMatchObject({ imported: 0, duplicates: 1 })
  })

  it('counts one moved to another category since, so the row is not booked twice', async () => {
    // The person moved the earlier import's copy from Vacation to Holidays after importing it.
    await plant({
      date: '2026-01-10',
      description: 'Travel Agent',
      amount: 80,
      type: 'expense',
      account_id: vacation,
      category_id: await categoryId('Holidays'),
    })

    const body = (await (
      await importExecute({ rows: [rows[0]], mapping: MAPPING, categoryTypes })
    ).json()) as Body
    expect(body).toMatchObject({ imported: 0, duplicates: 1 })
  })

  it('never takes a row typed in by hand in that account for one', async () => {
    // A real payment from the Vacation account, entered by hand: same day, text and amount.
    for (const category_id of [undefined, await categoryId('Vacation')]) {
      await plant({
        date: '2026-01-10',
        description: 'Travel Agent',
        amount: 80,
        type: 'expense',
        account_id: vacation,
        category_id,
        import_id: null,
      })
      const body = (await (
        await importExecute({ rows: [rows[0]], mapping: MAPPING, categoryTypes })
      ).json()) as Body
      expect(body).toMatchObject({ imported: 1, duplicates: 0 })
      await (await getDB()).clear('transactions')
    }
  })

  it('still takes an imported row really paid from that account for one, a known limit', async () => {
    // Indistinguishable from an earlier import's copy of this row: same import stamp, account,
    // day, text and amount. Accepted, and listed for maff in dev-changelog.md.
    await plant({
      date: '2026-01-10',
      description: 'Travel Agent',
      amount: 80,
      type: 'expense',
      account_id: vacation,
      category_id: await categoryId('Vacation'),
    })

    const body = (await (
      await importExecute({ rows: [rows[0]], mapping: MAPPING, categoryTypes })
    ).json()) as Body
    expect(body).toMatchObject({ imported: 0, duplicates: 1 })
  })
})

describe('a row with no Means of Payment, in local-first', () => {
  // Unchanged here: it books into the account its category is set to, with its type from the
  // sign, as before. Which rule it should follow is a separate decision.
  it('books an opening deposit into the Savings account', async () => {
    await importExecute({
      rows: [['2026-01-02', 'Opening deposit', '200', 'Savings', '', 'Income']],
      mapping: MAPPING,
      categoryTypes: { Savings: 'account' },
    })
    expect(await balanceOf('Savings')).toBe(200)
    // As main resolves it: an ungated run also gives the row a Savings category.
    expect(await categoryName((await onlyTransaction()).category_id)).toBe('Savings')
  })

  it('books a sheet of IB rows into IB', async () => {
    await importExecute({
      rows: [
        ['2026-03-01', 'Deposit', '1000', 'IB'],
        ['2026-03-15', 'Dividend', '30', 'IB'],
        ['2026-03-20', 'Fee', '-5', 'IB'],
      ],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
    })
    expect(await balanceOf('IB')).toBe(1025)
  })
})
