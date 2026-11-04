/**
 * What a statement from a bank the app knows brings in, in setup's words (review M4).
 *
 * Setup reads such a file and offers one line and one button. The Import page read the same file
 * into "Map your data columns to the 12 required fields", category types and a row count, and the
 * day-2 mail sends people there. A statement whose every file is from a bank the app knows now
 * opens on this summary after its dry run: "N26 file recognised: 300 entries, 1 Nov 2025 to 31 Oct
 * 2026." and "Import 300 entries", with the columns behind Check the columns.
 *
 * The count is what the import adds, as setup counts it: the rows picked, less those here already
 * (by index: a row the statement repeats is unpicked and a duplicate at once). The dates are those
 * rows' first and last day.
 */
import { bankLabel, counted, dateRangeText, listed } from '../../components/onboarding/FirstImport'
import { namesItsAccounts } from './importFlow'
import type { BankFileRow } from './importFlow'

/**
 * Whether these statements open on the summary: each from a bank the app knows, none naming its
 * own accounts. A YNAB Register file does (its accounts and their types are set on the columns
 * step), and a file the app does not know goes to its columns.
 */
export function summarises(files: readonly BankFileRow[]): boolean {
  return files.length > 0 && files.every((f) => f.bankId !== null && !namesItsAccounts(f))
}

export interface BankSummaryInput {
  files: readonly BankFileRow[]
  /** The rows the bank transform made, as the flow holds them. */
  rows: readonly (readonly string[])[]
  /** The column holding each row's ISO date. */
  dateColumn: number | undefined
  /** The rows picked for the import. */
  selected: ReadonlySet<number>
  /** The rows the dry run found here already. */
  alreadyHere: readonly number[]
  /** The rows the dry run could not import as they are. */
  invalid: number
  /** The categories the import would create. */
  newCategories: readonly string[]
}

export interface BankSummary {
  line: string
  /** The import button's label, or null when there is nothing to import. */
  button: string | null
  notes: string[]
}

const entries = (n: number) => counted(n, 'entry', 'entries')

/** Up to three names, then how many more. */
function someOf(names: readonly string[]): string {
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  return listed(more > 0 ? [...shown, `${more} more`] : shown)
}

export function bankSummary(
  input: BankSummaryInput,
  thisYear = new Date().getFullYear()
): BankSummary {
  const banks = [...new Set(input.files.map((f) => bankLabel(f.bankId)).filter(Boolean))]
  const recognised = `${listed(banks)} ${input.files.length === 1 ? 'file' : 'files'} recognised`

  const here = new Set(input.alreadyHere)
  let count = 0
  let from = ''
  let to = ''
  for (const index of input.selected) {
    if (here.has(index)) continue
    count++
    const day =
      input.dateColumn === undefined
        ? ''
        : (input.rows[index]?.[input.dateColumn] ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    if (!from || day < from) from = day
    if (!to || day > to) to = day
  }

  if (count === 0) {
    return here.size > 0
      ? {
          line: `${recognised}: all ${entries(here.size)} in it are here already.`,
          button: null,
          notes: [],
        }
      : {
          line: `${recognised}, but none of its rows can be imported as they are.`,
          button: null,
          notes: ['Check the columns to see why.'],
        }
  }

  const dates = from ? `, ${dateRangeText(from, to, thisYear)}` : ''
  const accounts = [...new Set(input.files.map((f) => f.targetAccount).filter(Boolean))]
  const notes: string[] = []
  if (accounts.length > 0) notes.push(`Goes into ${listed(accounts)}.`)
  if (input.newCategories.length > 0) notes.push(`New categories: ${someOf(input.newCategories)}.`)
  if (here.size > 0) {
    notes.push(
      here.size === 1
        ? '1 entry in it is here already and stays as it is.'
        : `${entries(here.size)} in it are here already and stay as they are.`
    )
  }
  if (input.invalid > 0) {
    notes.push(
      input.invalid === 1
        ? "1 row can't be imported as it is. Check the columns to see why."
        : `${counted(input.invalid, 'row')} can't be imported as they are. Check the columns to see why.`
    )
  }
  return {
    line: `${recognised}: ${entries(count)}${dates}.`,
    button: `Import ${entries(count)}`,
    notes,
  }
}
