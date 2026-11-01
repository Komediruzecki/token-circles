/**
 * The note an import adds once for each value set to Account in the mapping step that rows with a
 * Means of Payment use as their category (shared/importRowChecks.ts). Both runtimes push it, so
 * its wording is pinned here once, in every variant.
 */
import { describe, expect, it } from 'vitest'
import { markedAccountUsedAsCategoryNote as note } from '../../../../shared/importRowChecks'

const base = {
  name: 'Savings',
  rows: 3,
  paidFrom: ['Checking'],
  notAccounts: [] as string[],
  categorised: true,
  types: ['expense'],
  preview: false,
}

describe('markedAccountUsedAsCategoryNote', () => {
  it('says the expenses came off the paying account, and how to undo and redo them as transfers', () => {
    expect(note(base)).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Checking as their ' +
        'Means of Payment, so they came off Checking in the Savings category. Set Savings to ' +
        'Expense. To move the money into Savings instead, delete this import under Recent ' +
        "Imports, change these rows' Type to Transfer, and import again."
    )
  })

  it('in a preview, says what the import will do, and to change the Type before importing', () => {
    expect(note({ ...base, preview: true })).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Checking as their ' +
        'Means of Payment, so they will come off Checking in the Savings category. Set Savings ' +
        "to Expense. To move the money into Savings instead, change these rows' Type to Transfer " +
        'before you import.'
    )
    expect(note({ ...base, rows: 1, types: ['income'], preview: true })).toContain(
      'so it will go into Checking in the Savings category. Set Savings to Income.'
    )
    expect(note({ ...base, types: ['expense', 'income'], preview: true })).toContain(
      'so they will be booked to Checking in the Savings category.'
    )
    expect(note({ ...base, paidFrom: [], notAccounts: ['Cash'], preview: true })).toContain(
      'Cash is not an account, so they will be left with no account, in the Savings category.'
    )
    expect(note({ ...base, notAccounts: ['Cash'], preview: true })).toContain(
      'The rows with Checking will be booked to it, and the rest will be left with no account ' +
        'because Cash is not an account. All of them will be in the Savings category.'
    )
  })

  it('drops the count for a single row', () => {
    expect(note({ ...base, name: 'IB', rows: 1 })).toBe(
      '"IB" is set to Account in the mapping step, but its row has Checking as its Means of ' +
        'Payment, so it came off Checking in the IB category. Set IB to Expense. To move the ' +
        "money into IB instead, delete this import under Recent Imports, change this row's Type " +
        'to Transfer, and import again.'
    )
  })

  it('says incomes went into the account, and offers no transfer, which would take money out of it', () => {
    expect(note({ ...base, types: ['income'] })).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Checking as their ' +
        'Means of Payment, so they went into Checking in the Savings category. Set Savings to ' +
        'Income.'
    )
  })

  it('says a mix of both was booked to the account', () => {
    expect(note({ ...base, types: ['expense', 'income'] })).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Checking as their ' +
        'Means of Payment, so they were booked to Checking in the Savings category. Set Savings ' +
        'to Expense or Income.'
    )
  })

  it('lists several paying accounts, and says when a gated import left the rows without the category', () => {
    expect(note({ ...base, paidFrom: ['Checking', 'Visa', 'Cash'], categorised: false })).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Checking, Visa and ' +
        'Cash as their Means of Payment, so they came off Checking, Visa and Cash with no ' +
        'category. Set Savings to Expense. To move the money into Savings instead, delete this ' +
        "import under Recent Imports, change these rows' Type to Transfer, and import again."
    )
  })

  it('does not say rows came off a Means of Payment that names no account', () => {
    expect(note({ ...base, paidFrom: [], notAccounts: ['Cash'] })).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Cash as their Means ' +
        'of Payment. Cash is not an account, so they were left with no account, in the Savings ' +
        'category. Set Savings to Expense. To move the money into Savings instead, delete this ' +
        "import under Recent Imports, change these rows' Type to Transfer, and import again."
    )
    expect(
      note({ ...base, rows: 1, paidFrom: [], notAccounts: ['Cash'], categorised: false })
    ).toContain(
      'but its row has Cash as its Means of Payment. Cash is not an account, so it was left with ' +
        'no account and no category.'
    )
  })

  it('separates the rows booked to an account from the ones left with none', () => {
    expect(note({ ...base, paidFrom: ['Checking'], notAccounts: ['Cash', 'Wallet'] })).toBe(
      '"Savings" is set to Account in the mapping step, but its 3 rows have Checking, Cash and ' +
        'Wallet as their Means of Payment. The rows with Checking were booked to it, and the ' +
        'rest were left with no account because Cash and Wallet are not accounts. All of them ' +
        'are in the Savings category. Set Savings to Expense. To move the money into Savings ' +
        "instead, delete this import under Recent Imports, change these rows' Type to " +
        'Transfer, and import again.'
    )
  })
})
