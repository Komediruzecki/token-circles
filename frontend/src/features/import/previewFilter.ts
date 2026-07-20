/**
 * Pure helpers for the import preview's row filter. The preview table can be
 * narrowed to only within-batch duplicates or only "no-account transfers"
 * (transfers routing into a value that isn't a real account, so the money lands
 * nowhere and balances drift). Kept framework-free — no signals — so the logic
 * is unit-testable without a reactive root, and shared by the store's warning
 * count, the filter's row set, and the badge counts.
 */

export type PreviewFilter = 'all' | 'duplicates' | 'no-account-transfer'

export interface VoidTransferContext {
  /** Column index of the Type column in the active mapping (undefined = unmapped). */
  typeIdx: number | undefined
  /** Column index of the Category/destination column (undefined = unmapped). */
  categoryIdx: number | undefined
  /** Value name -> its type. `'account'` marks a value the user flagged as an account. */
  categoryTypes: Record<string, string>
  /** Names of accounts that already exist (matched case-insensitively). */
  accountNames: string[]
}

/**
 * Is this row a transfer whose destination is NOT (and won't become) a real
 * account? A transfer needs a real account on both sides; otherwise it can't
 * move money on both legs and the balance drifts into a void.
 */
export function isTransferToVoid(row: string[], ctx: VoidTransferContext): boolean {
  const { typeIdx, categoryIdx } = ctx
  if (typeIdx === undefined || categoryIdx === undefined) return false
  if ((row[typeIdx] ?? '').trim().toLowerCase() !== 'transfer') return false
  const dest = (row[categoryIdx] ?? '').trim()
  if (!dest) return false
  const existing = new Set(ctx.accountNames.map((n) => n.toLowerCase()))
  return !(ctx.categoryTypes[dest] === 'account' || existing.has(dest.toLowerCase()))
}

/**
 * Void-transfer destinations grouped by name, with the total offending row count,
 * for the preview's warning block.
 */
export function voidTransferDestinations(
  rows: string[][],
  ctx: VoidTransferContext
): { names: string[]; count: number } {
  if (ctx.categoryIdx === undefined) return { names: [], count: 0 }
  const bad = new Map<string, number>()
  for (const row of rows) {
    if (!isTransferToVoid(row, ctx)) continue
    const dest = (row[ctx.categoryIdx] ?? '').trim()
    bad.set(dest, (bad.get(dest) ?? 0) + 1)
  }
  return { names: [...bad.keys()], count: [...bad.values()].reduce((a, b) => a + b, 0) }
}

/**
 * Indices into `rows` shown by the active preview filter. `'all'` returns every
 * index; `'duplicates'` the within-batch duplicate rows; `'no-account-transfer'`
 * the void-transfer rows. The returned indices are always ascending, so slicing
 * them for pagination preserves original row order.
 */
export function visibleRowIndices(
  filter: PreviewFilter,
  rows: string[][],
  duplicateIndices: number[],
  ctx: VoidTransferContext
): number[] {
  switch (filter) {
    case 'duplicates': {
      const dups = new Set(duplicateIndices)
      return rows.reduce<number[]>((acc, _row, i) => {
        if (dups.has(i)) acc.push(i)
        return acc
      }, [])
    }
    case 'no-account-transfer':
      return rows.reduce<number[]>((acc, row, i) => {
        if (isTransferToVoid(row, ctx)) acc.push(i)
        return acc
      }, [])
    default:
      return rows.map((_row, i) => i)
  }
}
