/**
 * Setup's import: bank statements, read and ready to import in one tap.
 *
 * The wizard used to embed the Import page's whole flow: four tabs, the rules editor, the column
 * mapping and the preview table. On a phone the mapping alone was five screens of 13 px fields.
 * This runs the same flow (importFlow.ts) with the choices that tap-through made: the bank's own
 * columns, every transaction that is not a duplicate, every new category, no budgets from
 * spending. What is left to decide is where each statement goes, and that comes preselected
 * (`defaultTarget`). A file that names each row's account (YNAB's Register file) has nothing to
 * decide: each row goes to its own account, and its card says which.
 *
 * Several files go in together (maff, 19 Nov): the picker takes more than one, so does a drop, and
 * Add another file adds to them. Each is read and shown on a card of its own, and the footer
 * imports them all in one batch, where a transaction two overlapping statements of one account
 * both hold goes in once (shared/bankImport/process.ts).
 *
 * A file it cannot import (a bank it does not know, a table of any other kind, one that does not
 * read) is set aside on its card with a way out instead of a dead end: the Import page opens with
 * it while setup waits there (importHandoff.ts, onboardingStore.ts), or setup goes on without it.
 */
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Index,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js'
import { getLocalCurrency } from '../../core/api'
import { listAdapters } from '../../core/bankImport'
import { IMPORT_ACCOUNT_TYPES } from '../../features/import/accountTypeChoices'
import { createImportFlow, namesItsAccounts } from '../../features/import/importFlow'
import { dayText } from '../../utils/dayText'
import styles from './Onboarding.module.css'
import { inOtherCurrency, newAccountName, statementTargets } from './statementTargets'
import type { BankId } from '../../core/bankImport'
import type { SetupSoFar } from '../../core/onboardingStore'
import type { BankFileRow, ImportSummary } from '../../features/import/importFlow'
import type { HandedImportFile } from '../../features/import/importHandoff'
import type { AccountRef } from './statementTargets'

/** Where the step's import is, over all the files chosen. */
export type FirstImportState =
  /** No file chosen yet. */
  | 'empty'
  /** The files are being read, or read again for another account. */
  | 'reading'
  /** At least one statement has new transactions, ready to import. */
  | 'ready'
  /** The files could not be read through (the reason is on the step); Try again reads them. */
  | 'failed'
  /** Nothing new to import: what the statements hold is here already. */
  | 'nothing-new'
  /**
   * No file it can import: banks it does not read, statements in another currency, or no
   * transactions came out of them.
   */
  | 'unreadable'
  /** Imported on this visit. */
  | 'imported'

/** Where one file of the step is, on its card. */
export type FileState =
  | 'reading'
  | 'ready'
  | 'failed'
  | 'nothing-new'
  | 'unreadable'
  /** A statement in a currency other than the base: set aside, for the Import page. */
  | 'other-currency'

/** A file chosen on the step, in the order chosen. */
export interface ChosenFile {
  file: File
  /** The bank it is from, once read: null for none the app knows. Undefined while it is read. */
  bankId?: BankId | null
  /** It did not read at all. */
  failed?: boolean
  /**
   * The currency the statement is in, when it names one that is not the base: set aside, as
   * balances are kept in the base currency and no account can be made in another (round 3).
   */
  currency?: string
}

/**
 * A statement's rows in the batch: new, here already, and transactions an earlier file holds too
 * (two overlapping exports of one account), which go in once. A row the statement itself repeats
 * is none of these, as before there were several files.
 */
export interface FileCounts {
  fresh: number
  here: number
  repeats: number
}

export interface FirstImportOptions {
  /** The account setup's account step made: the main account (statementTargets.ts). */
  preferredAccount: () => AccountRef | null
  /**
   * What setup has done so far, the wizard's earlier visits and the Import page's imports while
   * setup waited included: where the next statements go, and the result the step shows.
   */
  soFar?: () => SetupSoFar
  /** Each import that went through, with what it brought in. */
  onImported: (summary: ImportSummary) => void
}

/** The files the picker offers: what the bank adapters read. */
export const STATEMENT_ACCEPT =
  '.csv,.xlsx,.xls,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** The bank's name as the app lists it, or '' for none. */
export function bankLabel(bankId: BankId | null): string {
  return listAdapters().find((a) => a.id === bankId)?.label ?? ''
}

/** "a", "a and b", "a, b and c". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const NUMBER = new Intl.NumberFormat('en-GB')

/** "1 transaction", "1,234 transactions". */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${NUMBER.format(n)} ${n === 1 ? one : many}`
}

/** "14 Apr to 1 Jul" this year, "28 Dec 2025 to 3 Jan 2026" across years; ISO dates in. */
export function dateRangeText(
  from: string,
  to: string,
  thisYear = new Date().getFullYear()
): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4) && Number(from.slice(0, 4)) === thisYear
  // Each date holds together (no-break spaces): a narrow card wraps between the dates, never
  // inside one.
  const day = (iso: string) => dayText(iso, !sameYear)
  return from === to ? day(from) : `${day(from)} to ${day(to)}`
}

/** A choice for "Goes into": an account the profile has, or one the import creates. */
export interface TargetChoice {
  name: string
  isNew: boolean
}

export function createFirstImport(options: FirstImportOptions) {
  const [chosen, setChosen] = createSignal<ChosenFile[]>([])
  // Changes waiting to be read: a pick, a removal, another account.
  const [pending, setPending] = createSignal(0)
  const [imported, setImported] = createSignal<ImportSummary | null>(null)
  /**
   * Where the last import's rows went: taken when it starts, since afterwards every row of it
   * reads as here already.
   */
  const [importedInto, setImportedInto] = createSignal<string[] | null>(null)
  /**
   * The result of setup's earlier imports stands in for this step's own until the person brings in
   * another statement: a step opened again (Back to setup, Back from the subscriptions) shows
   * what came in, as the step that imported it did.
   */
  const [earlierShown, setEarlierShown] = createSignal(true)
  const earlier = (): SetupSoFar | null => options.soFar?.() ?? null
  // Files whose account the person picked: theirs stays when the set of files changes.
  const byHand = new Set<File>()
  // Clear abandons what is under way: a read that finishes after it changes nothing.
  let generation = 0
  // One change at a time, each reading the whole batch: a second pick waits for the first.
  let queue: Promise<void> = Promise.resolve()
  let picker: HTMLInputElement | undefined

  const flow = createImportFlow({
    initialTab: 'bank-imports',
    autoResetAfterImport: false,
    onImported: (summary) => {
      setImported(summary)
      options.onImported(summary)
    },
  })

  const reading = () => pending() > 0

  /** Run `job` after the changes before it, unless the files are cleared meanwhile. */
  const run = (job: (mine: number) => Promise<void>): Promise<void> => {
    const mine = generation
    setPending((n) => n + 1)
    queue = queue
      .then(() => (mine === generation ? job(mine) : undefined))
      .catch((err: unknown) => {
        console.error('Reading the statements:', err)
      })
      .finally(() => setPending((n) => n - 1))
    return queue
  }

  /** The statement a file is, in the import: null for a file set aside. */
  const statementOf = (file: File): BankFileRow | null =>
    flow.bankFiles().find((row) => row.file === file) ?? null
  const rangeOf = (file: File) => flow.bankFileRows().find((range) => range.file === file) ?? null
  const bank = (file: File) => bankLabel(statementOf(file)?.bankId ?? null)

  // Each statement's counts, once per read of the batch. A repeat the batch left unpicked
  // (shared/bankImport/process.ts) counts as an earlier file's when an earlier file has the same
  // transaction; otherwise the statement repeats its own row.
  const countsByFile = createMemo(() => {
    const byFile = new Map<File, FileCounts>()
    if (flow.activeStep() !== 'preview') return byFile
    const existing = new Set(flow.existingDuplicateIndices())
    const repeats = flow.duplicateSet()
    const picked = flow.selectedRows()
    const rows = flow.currentRows()
    const earlier = new Set<string>()
    for (const range of flow.bankFileRows()) {
      const counts = { fresh: 0, here: 0, repeats: 0 }
      const keys: string[] = []
      for (let index = range.start; index < range.start + range.count; index++) {
        const key = (rows[index] ?? []).join('\u0001')
        keys.push(key)
        if (existing.has(index)) counts.here++
        else if (picked.has(index)) counts.fresh++
        else if (repeats.has(index) && earlier.has(key)) counts.repeats++
      }
      for (const key of keys) earlier.add(key)
      byFile.set(range.file, counts)
    }
    return byFile
  })
  const countsOf = (file: File): FileCounts =>
    countsByFile().get(file) ?? { fresh: 0, here: 0, repeats: 0 }

  /**
   * Why the batch could not be read, when it stopped before counting any file: the category list
   * not read, say. Every card said "We couldn't read any transactions in this file" for it.
   */
  const failure = (): string | null =>
    !reading() && flow.bankFiles().length > 0 && flow.bankFileRows().length === 0
      ? flow.error()
      : null

  const stateOf = (entry: ChosenFile): FileState => {
    if (reading() || entry.bankId === undefined) return 'reading'
    if (entry.currency) return 'other-currency'
    if (entry.failed || entry.bankId === null) return 'unreadable'
    if (failure() !== null) return 'failed'
    const counts = countsOf(entry.file)
    if (counts.fresh > 0) return 'ready'
    // Nothing to add: because it is all here already or in an earlier file, or because no row of
    // it can be imported, which the Import page can show row by row.
    return counts.here + counts.repeats > 0 ? 'nothing-new' : 'unreadable'
  }

  /** Why a file is set aside: a bank the app does not know, or nothing in it that reads. */
  const problemOf = (entry: ChosenFile): 'unknown' | 'unread' =>
    entry.bankId === null && !entry.failed ? 'unknown' : 'unread'

  const alreadyHere = () => flow.existingDuplicates() ?? 0
  /**
   * The transactions an import would add: the ones picked, less those the import would skip as
   * here already. By index, not by count: a row the statement repeats is both unpicked and
   * counted as a duplicate, and subtracting the count took it off twice.
   */
  const newCount = () => {
    const skipped = new Set(flow.existingDuplicateIndices())
    let count = 0
    for (const index of flow.selectedRows()) if (!skipped.has(index)) count++
    return count
  }
  /** The import itself is running (reading has its own state). */
  const importing = () => flow.loading() && !reading()

  const state = (): FirstImportState => {
    if (imported()) return 'imported'
    if (chosen().length === 0) {
      return earlierShown() && (earlier()?.imported ?? 0) > 0 ? 'imported' : 'empty'
    }
    if (reading()) return 'reading'
    const states = chosen().map(stateOf)
    if (states.includes('ready')) return 'ready'
    if (states.includes('failed')) return 'failed'
    return states.includes('nothing-new') ? 'nothing-new' : 'unreadable'
  }

  /**
   * The files the import leaves out, as it cannot read them or they are in another currency: each
   * can go to the Import page.
   */
  const setAside = (): ChosenFile[] =>
    chosen().filter((entry) => ['unreadable', 'other-currency'].includes(stateOf(entry)))

  /** The accounts a file that names its accounts (YNAB's Register file) names, in its order. */
  const fileAccounts = (row: BankFileRow): string[] => row.meta.accounts ?? []
  /**
   * The accounts such a file names that start below zero and this import makes: a card or a loan
   * in YNAB, which as a current account read as an overdraft, expensive debt that held Solid
   * ground back (3 Nov review A4). Setup asks what each one is, with Credit Card chosen; the
   * others are current accounts, unasked. An account the profile has keeps its own type.
   */
  const belowZero = (row: BankFileRow): string[] => {
    if (!namesItsAccounts(row)) return []
    const opening = row.meta.startingBalances ?? {}
    const have = new Set(flow.bankAccounts().map((a) => a.name.trim().toLowerCase()))
    return fileAccounts(row).filter(
      (name) => (opening[name]?.amount ?? 0) < 0 && !have.has(name.trim().toLowerCase())
    )
  }
  /** The type an account that starts below zero is made as: Credit Card until chosen. */
  const typeOf = (name: string): string => flow.accountTypes()[name] ?? 'credit'
  const setTypeOf = (name: string, type: string) => {
    flow.setAccountTypes({ ...flow.accountTypes(), [name]: type })
  }

  /**
   * The accounts a file's new transactions go into: each one's own, and a transfer's other end.
   * The same columns the mapping step reads accounts from.
   */
  const newRowAccounts = (file: File): string[] => {
    const range = rangeOf(file)
    if (!range) return []
    const mapping = flow.columnMapping()
    const rows = flow.currentRows()
    const skipped = new Set(flow.existingDuplicateIndices())
    const picked = flow.selectedRows()
    const names: string[] = []
    const add = (cell: string | undefined) => {
      const name = cell?.trim()
      if (name && !names.includes(name)) names.push(name)
    }
    for (let index = range.start; index < range.start + range.count; index++) {
      const row = rows[index]
      if (!row || !picked.has(index) || skipped.has(index)) continue
      if (mapping.means_of_payment !== undefined) add(row[mapping.means_of_payment])
      const transfer =
        mapping.type !== undefined && row[mapping.type]?.trim().toLowerCase() === 'transfer'
      if (transfer && mapping.category !== undefined) add(row[mapping.category])
    }
    return names
  }

  /** Where an import's new transactions go, file by file, each account once. */
  const whereItGoes = (): string[] => {
    const names: string[] = []
    for (const row of flow.bankFiles()) {
      if (countsOf(row.file).fresh === 0) continue
      const into = namesItsAccounts(row) ? newRowAccounts(row.file) : [row.targetAccount]
      for (const name of into) if (name && !names.includes(name)) names.push(name)
    }
    return names
  }

  /**
   * The account a new statement goes into, when nothing names one: "Revolut EUR". Only a statement
   * in the base currency is in the import, so the name is never another currency's.
   */
  const suggestedName = (row: BankFileRow) =>
    row.bankId ? newAccountName(row.bankId, getLocalCurrency()) : 'Imported account'

  /**
   * Every statement's account by setup's rule (statementTargets.ts), but the ones the person
   * picked: run whenever the set of files changes, added or removed, and at every pick by hand,
   * which claims its account for its bank. Each file's own answer
   * (resolveTargetAccount, on the Import page's terms) is not kept: it took an account named for
   * the bank in any currency, and the first file only was ever placed again. A file read with no
   * transaction in it never takes the main account (finding 13). Answers whether a target moved.
   */
  const placeStatements = (): boolean => {
    const rows = flow.bankFiles()
    const placed = rows.filter((row) => row.bankId !== null && !namesItsAccounts(row))
    if (placed.length === 0) return false
    const accounts = flow.bankAccounts()
    const targets = statementTargets({
      statements: placed.map((row) => ({
        bankId: row.bankId as BankId,
        currency: row.meta.currency ?? null,
        byHand: byHand.has(row.file) ? row.targetAccount : null,
        empty: rangeOf(row.file)?.count === 0,
      })),
      earlier: earlier()?.statements ?? [],
      accounts,
      made: options.preferredAccount(),
      base: getLocalCurrency(),
    })
    let moved = false
    placed.forEach((row, at) => {
      const index = rows.indexOf(row)
      const target = targets[at]
      // None for a statement in another currency, which `add` keeps out of the import.
      if (target === null || target === row.targetAccount) return
      flow.updateBankFile(index, { targetAccount: target })
      moved = true
    })
    return moved
  }

  /**
   * Place the statements and read them. Once read, a file found empty may have taken the main
   * account it cannot keep: placed again, the batch is read again.
   */
  const placeAndRead = async (mine: number) => {
    placeStatements()
    await prepare(mine)
    if (mine !== generation || !placeStatements()) return
    await prepare(mine)
  }

  const targetChoices = (row: BankFileRow): TargetChoice[] => {
    const existing = flow.bankAccounts().map((a) => a.name)
    const choices: TargetChoice[] = existing.map((name) => ({ name, isNew: false }))
    for (const name of [row.targetAccount, suggestedName(row)]) {
      if (name && !existing.includes(name) && !choices.some((c) => c.name === name)) {
        choices.push({ name, isNew: true })
      }
    }
    return choices
  }

  /** The statements to the import preview, with the flow's own steps and their defaults. */
  const prepare = async (mine: number) => {
    if (flow.bankFiles().length === 0) {
      // Nothing left to read: what an earlier read counted goes with it.
      flow.resetForm()
      return
    }
    // Out of the last preview first: a batch with no rows in it leaves the flow where it was.
    flow.setActiveStep('upload')
    await flow.processBankFiles()
    if (mine !== generation || flow.activeStep() !== 'mapping') return
    await flow.goToPreview()
  }

  /** Read `picked` into the import, beside the files chosen already. */
  const add = (picked: readonly File[]): Promise<void> => {
    if (picked.length === 0 || importing()) return Promise.resolve()
    // After an import, a new pick starts a new set: the last one is in.
    if (imported()) clear()
    const fresh = picked.filter((file) => !chosen().some((entry) => entry.file === file))
    if (fresh.length === 0) return Promise.resolve()
    setChosen((list) => [...list, ...fresh.map((file) => ({ file }))])
    return run(async (mine) => {
      // A file removed while it waited to be read is not read.
      const still = fresh.filter((file) => chosen().some((entry) => entry.file === file))
      if (still.length === 0) return
      if (flow.bankFiles().length === 0) {
        flow.resetForm()
        // The flow keeps the types chosen for the last file: this set starts from its own.
        flow.setAccountTypes({})
      }
      // The account setup's last step created has to be one "Goes into" can offer.
      await flow.loadBankAccounts()
      if (mine !== generation) return
      await flow.addBankFiles(still)
      if (mine !== generation) return
      const rows = flow.bankFiles()
      const base = getLocalCurrency()
      const otherCurrency = (row: BankFileRow) => inOtherCurrency(row.meta.currency, base)
      setChosen((list) =>
        list.map((entry) => {
          if (!still.includes(entry.file)) return entry
          const row = rows.find((one) => one.file === entry.file)
          if (!row) return { file: entry.file, bankId: null, failed: true }
          return otherCurrency(row)
            ? {
                file: entry.file,
                bankId: row.bankId,
                currency: row.meta.currency!.trim().toUpperCase(),
              }
            : { file: entry.file, bankId: row.bankId }
        })
      )
      // Only statements in the base currency go into the import: a file from a bank it does not
      // know, or a statement in another currency, waits on its card, for the Import page.
      for (let index = rows.length - 1; index >= 0; index--) {
        if (!rows[index].bankId || otherCurrency(rows[index])) flow.removeBankFile(index)
      }
      await placeAndRead(mine)
      if (mine !== generation) return
      // What the import makes them as: Credit Card, until the person chooses another.
      for (const row of flow.bankFiles()) {
        for (const name of belowZero(row)) setTypeOf(name, typeOf(name))
      }
    })
  }

  /** Leave a file out: the others are read again without it, and placed again. */
  const remove = (file: File): Promise<void> => {
    if (importing()) return Promise.resolve()
    byHand.delete(file)
    const left = chosen().filter((entry) => entry.file !== file)
    if (left.length === 0) {
      clear()
      return Promise.resolve()
    }
    setChosen(left)
    return run(async (mine) => {
      const index = flow.bankFiles().findIndex((row) => row.file === file)
      // Set aside, it was never in the import: nothing to read again.
      if (index < 0) return
      flow.removeBankFile(index)
      await placeAndRead(mine)
    })
  }

  /** Read the files again after a read that stopped (`failure()`), as they are. */
  const retry = (): Promise<void> => {
    if (importing() || state() !== 'failed') return Promise.resolve()
    return run(async (mine) => {
      await flow.loadBankAccounts()
      if (mine !== generation) return
      await placeAndRead(mine)
    })
  }

  /**
   * Send a statement to another account: its rows name the account, so it is read again. The pick
   * claims the account for its bank, and the other statements are placed again at once (round 4):
   * placed at the next file added or removed instead, one moved at an action that had nothing to
   * do with it, and imported before that, two banks went into one account.
   */
  const setTarget = (file: File, name: string): Promise<void> => {
    if (importing()) return Promise.resolve()
    byHand.add(file)
    return run(async (mine) => {
      const index = flow.bankFiles().findIndex((row) => row.file === file)
      if (index < 0) return
      flow.updateBankFile(index, { targetAccount: name })
      await placeAndRead(mine)
    })
  }

  const importNow = async () => {
    if (state() !== 'ready' || flow.loading()) return
    setImportedInto(whereItGoes())
    await flow.handleImport('selected')
  }

  /** Forget every file: back to the picker. */
  function clear() {
    generation++
    flow.resetForm()
    byHand.clear()
    setChosen([])
    setImported(null)
    setImportedInto(null)
  }

  /** Bring in another statement: the picker, past the result shown. */
  const another = () => {
    setEarlierShown(false)
    clear()
  }

  /**
   * A file and the Import page tab that reads it, for the way out: `file`, else the first one set
   * aside. A bank the app knows goes to Bank Imports, any other table to File Upload.
   */
  const handOver = (file?: File): Omit<HandedImportFile, 'typed'> | null => {
    const entry = file ? chosen().find((one) => one.file === file) : setAside()[0]
    if (!entry) return null
    // It is the Import page's now: the step offers it no more.
    setChosen((list) => list.filter((one) => one !== entry))
    return { file: entry.file, tab: entry.bankId ? 'bank-imports' : 'file-upload' }
  }

  /** A statement's new transactions' first and last day, ISO, or null when the dates do not read. */
  const dateRangeOf = (file: File): { from: string; to: string } | null => {
    const column = flow.columnMapping().date
    const range = rangeOf(file)
    if (column === undefined || !range) return null
    const rows = flow.currentRows()
    const picked = flow.selectedRows()
    let from = ''
    let to = ''
    for (let index = range.start; index < range.start + range.count; index++) {
      if (!picked.has(index)) continue
      const day = rows[index]?.[column]?.slice(0, 10) ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      if (!from || day < from) from = day
      if (!to || day > to) to = day
    }
    return from ? { from, to } : null
  }

  return {
    flow,
    files: chosen,
    state,
    stateOf,
    problemOf,
    countsOf,
    statementOf,
    bank,
    newCount,
    alreadyHere,
    importing,
    imported,
    importedInto,
    setAside,
    targetChoices,
    namesAccounts: (row: BankFileRow) => namesItsAccounts(row),
    fileAccounts,
    belowZero,
    typeOf,
    setTypeOf,
    dateRangeOf,
    add,
    remove,
    setTarget,
    importNow,
    retry,
    failure,
    clear,
    another,
    earlier,
    handOver,
    /** Open the system's file picker: the footer's "Choose a file", and Add another file. */
    openPicker: () => picker?.click(),
    attachPicker: (el: HTMLInputElement | undefined) => {
      picker = el
    },
  }
}

export type FirstImport = ReturnType<typeof createFirstImport>

function FileGlyph() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function PlusGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/**
 * Why a statement in another currency is set aside, in its card's words: what it would do to the
 * balances, and no promise of converting it, which nothing here does.
 */
function otherCurrencyLine(currency: string, base: string): string {
  return `This statement is in ${currency}. Your balances are kept in ${base}, so importing it would count its amounts as ${base}.`
}

/** Up to three names, then how many more. */
function someOf(names: readonly string[]): string {
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  return listed(more > 0 ? [...shown, `${more} more`] : shown)
}

/**
 * The statement step's body: a card for each file chosen, in the order chosen. The wizard's
 * footer carries the step's actions (OnboardingWizard.tsx). `onOpenInImport` takes a file set
 * aside to the Import page, from its own card, once nothing else is waiting to be imported.
 */
export function FirstImportPanel(props: {
  importer: FirstImport
  onOpenInImport?: (file: File) => void
}) {
  const importer = props.importer
  const inputId = `onboarding-import-input-${createUniqueId()}`
  const banks = () => listed(listAdapters().map((a) => a.label))
  onCleanup(() => {
    importer.attachPicker(undefined)
  })

  // A drop of files on the step, from a desktop: dragenter and dragleave fire for every child the
  // pointer crosses, so the highlight follows how deep it is.
  const [dropping, setDropping] = createSignal(false)
  let depth = 0
  const carriesFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files') ?? false
  const busy = () => importer.state() === 'reading' || importer.importing()

  const categoriesLine = () => {
    const names = importer.flow.newCategories()
    return names.length === 0 ? '' : `New categories: ${someOf(names)}.`
  }

  /**
   * What setup brought in, as setup counts it (setupSoFar: this step's imports, its earlier ones
   * and the Import page's while setup waited), and where it went: the accounts a register named,
   * else the ones chosen. Without what setup counts, this step's own import.
   */
  const doneLine = () => {
    const summary = importer.imported()
    if (summary && summary.imported === 0) {
      return 'Nothing new was imported: every transaction in it was here already.'
    }
    const earlier = importer.earlier()
    const total = earlier?.imported || summary?.imported || 0
    if (total === 0) return 'Nothing new was imported: every transaction in it was here already.'
    const into = earlier ? earlier.into : (importer.importedInto() ?? [])
    if (into === null) return `Imported ${counted(total, 'transaction')}.`
    const where =
      into.length === 0
        ? 'your account'
        : into.length <= 3
          ? listed(into)
          : counted(into.length, 'account')
    return `Imported ${counted(total, 'transaction')} into ${where}.`
  }

  /** A file set aside can go to Import from its card when nothing else is waiting to import. */
  const handsOver = () =>
    props.onOpenInImport !== undefined &&
    (importer.state() === 'imported' ||
      (importer.files().length > 1 && importer.state() !== 'ready' && !busy()))

  const fileCard = (entry: () => ChosenFile, done = false) => {
    const state = () => importer.stateOf(entry())
    const row = () => importer.statementOf(entry().file)
    const counts = () => importer.countsOf(entry().file)
    const meta = () => {
      const parts: string[] = []
      const bank = importer.bank(entry().file)
      if (bank) parts.push(bank)
      if (state() === 'ready') parts.push(counted(counts().fresh, 'new transaction'))
      return parts.join(' · ')
    }
    // The dates the statement covers, on a line of their own: after the count, a phone's card
    // wrapped them mid-date or left a separator hanging at the end of a line.
    const dates = () => {
      const range = state() === 'ready' ? importer.dateRangeOf(entry().file) : null
      return range ? dateRangeText(range.from, range.to) : ''
    }
    return (
      <div
        class={styles.fileCard}
        data-test-id="onboarding-import-file"
        data-state={state()}
        data-file={entry().file.name}
      >
        <div class={styles.fileTop}>
          <div class={styles.fileText}>
            <div class={styles.fileName}>{entry().file.name}</div>
            <Show when={meta()}>
              <div class={styles.fileMeta} data-test-id="onboarding-import-meta">
                {meta()}
              </div>
            </Show>
            <Show when={dates()}>
              <div class={styles.fileMeta} data-test-id="onboarding-import-dates">
                {dates()}
              </div>
            </Show>
          </div>
          <Show when={!done}>
            <button
              type="button"
              class={styles.iconBtn}
              aria-label={`Remove ${entry().file.name}`}
              data-test-id="onboarding-import-remove"
              disabled={busy()}
              onClick={() => {
                void importer.remove(entry().file)
              }}
            >
              <CloseGlyph />
            </button>
          </Show>
        </div>

        <Show when={state() === 'reading'}>
          <p class={styles.cardLine} role="status">
            <span class={styles.inlineSpinner} aria-hidden="true" />
            Reading the statement…
          </p>
        </Show>

        <Show when={state() === 'ready' ? row() : null}>
          {(statement) => (
            <>
              <Show when={importer.namesAccounts(statement())}>
                <p class={styles.hint} data-test-id="onboarding-import-accounts">
                  Each row goes to its own account: {someOf(importer.fileAccounts(statement()))}.
                </p>
              </Show>
              <Show when={importer.belowZero(statement()).length > 0}>
                <fieldset class={styles.typeChoice} data-test-id="onboarding-import-types">
                  <legend class={styles.hint} data-test-id="onboarding-import-types-lead">
                    {importer.belowZero(statement()).length === 1
                      ? 'Starts below zero, as a card often does. What kind of account is it?'
                      : 'These start below zero, as cards often do. What kind of account is each?'}
                  </legend>
                  <For each={importer.belowZero(statement())}>
                    {(name) => (
                      <label class={styles.typeRow}>
                        <span class={styles.typeName} data-test-id="onboarding-import-type-name">
                          {name}
                        </span>
                        <select
                          class={`${styles.input} ${styles.typeSelect}`}
                          data-test-id="onboarding-import-type"
                          disabled={importer.importing()}
                          onChange={(e) => {
                            importer.setTypeOf(name, e.currentTarget.value)
                          }}
                        >
                          <For each={IMPORT_ACCOUNT_TYPES}>
                            {(choice) => (
                              <option
                                value={choice.value}
                                selected={choice.value === importer.typeOf(name)}
                              >
                                {choice.label}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                    )}
                  </For>
                </fieldset>
              </Show>
              <Show when={!importer.namesAccounts(statement())}>
                <label class={`${styles.field} ${styles.target}`}>
                  <span class={styles.fieldLabel}>Goes into</span>
                  <select
                    class={styles.input}
                    data-test-id="onboarding-import-target"
                    disabled={importer.importing()}
                    onChange={(e) => {
                      void importer.setTarget(entry().file, e.currentTarget.value)
                    }}
                  >
                    <For each={importer.targetChoices(statement())}>
                      {(choice) => (
                        <option
                          value={choice.name}
                          selected={choice.name === statement().targetAccount}
                        >
                          {choice.isNew ? `New account: ${choice.name}` : choice.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
              <Show when={counts().here > 0}>
                <p class={styles.hint}>
                  {counted(counts().here, 'transaction')} in it {counts().here === 1 ? 'is' : 'are'}{' '}
                  here already and stay as they are.
                </p>
              </Show>
              <Show when={counts().repeats > 0}>
                <p class={styles.hint} data-test-id="onboarding-import-repeats">
                  {counted(counts().repeats, 'transaction')} in it{' '}
                  {counts().repeats === 1 ? 'is' : 'are'} in an earlier file too, and go
                  {counts().repeats === 1 ? 'es' : ''} in once.
                </p>
              </Show>
            </>
          )}
        </Show>

        <Show when={state() === 'nothing-new'}>
          <p class={styles.cardLine} data-test-id="onboarding-import-nothing-new">
            {counts().here === 0
              ? 'Nothing new: every transaction in it is in an earlier file too.'
              : 'Nothing new: every transaction in it is here already.'}
          </p>
        </Show>

        <Show when={state() === 'unreadable' || state() === 'other-currency'}>
          <Show
            when={entry().currency}
            fallback={
              <p class={styles.cardLine} data-test-id="onboarding-import-problem">
                {importer.problemOf(entry()) === 'unknown'
                  ? "We don't recognise the bank in this file. The Import page reads it once you match its columns."
                  : "We couldn't read any transactions in this file. The Import page shows what's in it."}
              </p>
            }
          >
            {(currency) => (
              <p class={styles.cardLine} data-test-id="onboarding-import-currency">
                {otherCurrencyLine(currency(), getLocalCurrency())}
              </p>
            )}
          </Show>
          <Show when={handsOver()}>
            <button
              type="button"
              class={styles.linkBtn}
              data-test-id="onboarding-import-open-file"
              onClick={() => props.onOpenInImport?.(entry().file)}
            >
              Open {entry().file.name} in Import
            </button>
          </Show>
        </Show>
      </div>
    )
  }

  return (
    <div
      class={styles.firstImport}
      classList={{ [styles.dropping]: dropping() }}
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return
        e.preventDefault()
        depth += 1
        setDropping(!busy())
      }}
      onDragOver={(e) => {
        if (carriesFiles(e)) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) return
        depth = Math.max(0, depth - 1)
        if (depth === 0) setDropping(false)
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return
        e.preventDefault()
        depth = 0
        setDropping(false)
        if (busy()) return
        const dropped = Array.from(e.dataTransfer?.files ?? [])
        if (dropped.length > 0) void importer.add(dropped)
      }}
    >
      <input
        id={inputId}
        ref={(el) => {
          importer.attachPicker(el)
        }}
        type="file"
        multiple
        accept={STATEMENT_ACCEPT}
        class={styles.fileInput}
        data-test-id="onboarding-import-input"
        disabled={busy()}
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files ?? [])
          // Cleared, so choosing the same file again is a change too.
          e.currentTarget.value = ''
          if (picked.length > 0) void importer.add(picked)
        }}
      />
      <Switch>
        <Match when={importer.state() === 'empty'}>
          <label for={inputId} class={styles.pick} data-test-id="onboarding-import-pick">
            <span class={styles.pickGlyph}>
              <FileGlyph />
            </span>
            <b>Choose a statement</b>
            <span>CSV or Excel, as your bank's app exports it. Several at once is fine.</span>
          </label>
          <p class={styles.hint} data-test-id="onboarding-import-banks">
            Reads exports from {banks()}. Any other file goes to the Import page, where you match
            its columns.
          </p>
          <p class={styles.hint} data-test-id="onboarding-import-ynab">
            Moving from YNAB? Choose the Register file from its Export Plan download here. Each row
            goes to its own account, transfers stay transfers, and YNAB's starting balances go to
            accounts that are new or still empty.
          </p>
        </Match>

        <Match when={importer.state() === 'imported'}>
          <div class={styles.fileCard} data-test-id="onboarding-import-file" data-state="imported">
            <p class={styles.cardLine} data-test-id="onboarding-import-done">
              {doneLine()}
            </p>
            <button
              type="button"
              class={styles.linkBtn}
              data-test-id="onboarding-import-another"
              onClick={() => {
                importer.another()
              }}
            >
              Bring in another statement
            </button>
          </div>
          <Index each={importer.setAside()}>{(entry) => fileCard(entry, true)}</Index>
        </Match>

        <Match when={true}>
          <div class={styles.fileList}>
            <Index each={importer.files()}>{(entry) => fileCard(entry)}</Index>
          </div>
          <Show when={importer.state() === 'ready' && categoriesLine()}>
            <p class={styles.hint} data-test-id="onboarding-import-categories">
              {categoriesLine()}
            </p>
          </Show>
          <Show
            when={
              importer.state() === 'failed'
                ? importer.failure()
                : importer.state() === 'ready' && importer.flow.error()
            }
          >
            {(reason) => (
              <p class={styles.cardError} role="alert" data-test-id="onboarding-import-error">
                {reason()}
              </p>
            )}
          </Show>
          <button
            type="button"
            class={styles.linkBtn}
            data-test-id="onboarding-import-add"
            disabled={busy()}
            onClick={() => importer.openPicker()}
          >
            <PlusGlyph />
            Add another file
          </button>
        </Match>
      </Switch>
    </div>
  )
}
