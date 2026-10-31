/**
 * Setup's first import: one bank statement, read and ready to import in one tap.
 *
 * The wizard used to embed the Import page's whole flow: four tabs, the rules editor, the column
 * mapping and the preview table. On a phone the mapping alone was five screens of 13 px fields.
 * This runs the same flow (importFlow.ts) with the choices that tap-through made: the bank's own
 * columns, every transaction that is not a duplicate, every new category, no budgets from
 * spending. What is left to decide is where the statement goes, and that comes preselected: the
 * account the bank names, else the one setup just created, else a new account named for the bank.
 *
 * A file it cannot import (a bank it does not know, a table of any other kind, one that does not
 * read) gets a way out instead of a dead end: setup finishes and the Import page opens with the
 * file (importHandoff.ts), or setup goes on without it.
 */
import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js'
import { listAdapters } from '../../core/bankImport'
import { createImportFlow } from '../../features/import/importFlow'
import styles from './Onboarding.module.css'
import type { BankId } from '../../core/bankImport'
import type { BankFileRow, ImportSummary } from '../../features/import/importFlow'
import type { HandedImportFile } from '../../features/import/importHandoff'

/** Where the first import is. */
export type FirstImportState =
  /** No file chosen yet. */
  | 'empty'
  /** The chosen file is being read, or read again for another account. */
  | 'reading'
  /** A statement with new transactions, ready to import. */
  | 'ready'
  /** A statement whose transactions are all here already. */
  | 'nothing-new'
  /** Not a bank this reads, or no transactions came out of it. */
  | 'unreadable'
  /** Imported on this visit. */
  | 'imported'

export interface FirstImportOptions {
  /** The account setup just created, where a statement goes unless its bank names another. */
  preferredAccount: () => string | null
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
  const format = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
  // Each date holds together (no-break spaces): a narrow card wraps between the dates, never
  // inside one.
  const day = (iso: string) => format.format(new Date(`${iso}T00:00:00Z`)).replace(/ /g, '\u00a0')
  return from === to ? day(from) : `${day(from)} to ${day(to)}`
}

/** A choice for "Goes into": an account the profile has, or one the import creates. */
export interface TargetChoice {
  name: string
  isNew: boolean
}

export function createFirstImport(options: FirstImportOptions) {
  const [file, setFile] = createSignal<File | null>(null)
  const [reading, setReading] = createSignal(false)
  const [problem, setProblem] = createSignal<'unknown' | 'unread' | null>(null)
  const [imported, setImported] = createSignal<ImportSummary | null>(null)
  // A later choice wins over an earlier one still reading.
  let generation = 0
  let picker: HTMLInputElement | undefined

  const flow = createImportFlow({
    initialTab: 'bank-imports',
    autoResetAfterImport: false,
    onImported: (summary) => {
      setImported(summary)
      options.onImported(summary)
    },
  })

  const statement = (): BankFileRow | null => flow.bankFiles()[0] ?? null
  const bank = () => bankLabel(statement()?.bankId ?? null)
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
    if (!file()) return 'empty'
    if (reading()) return 'reading'
    if (problem() || flow.activeStep() !== 'preview') return 'unreadable'
    if (newCount() > 0) return 'ready'
    // Nothing to add: because it is all here already, or because no row of it can be imported,
    // which the Import page can show row by row.
    return alreadyHere() > 0 ? 'nothing-new' : 'unreadable'
  }

  /** The account a new statement goes into, when its bank names none the profile has. */
  const suggestedName = (row: BankFileRow) =>
    [bankLabel(row.bankId), row.meta.currency].filter(Boolean).join(' ') || 'Imported account'

  /**
   * Where a statement goes when its bank names no account the profile has: the account setup made
   * on this visit; else one the profile has already (setup reopened at this step, or run again),
   * the newest in the statement's currency, else the newest whose currency is not known. A new
   * account only when no account fits: a new one beside an account the person just added would
   * split their money in two, and a statement in one currency does not belong in an account kept
   * in another.
   */
  const defaultTarget = (row: BankFileRow) => {
    const accounts = flow.bankAccounts()
    const preferred = options.preferredAccount()
    if (preferred && accounts.some((a) => a.name === preferred)) return preferred
    const currency = row.meta.currency?.toUpperCase()
    const fits = accounts.filter(
      (a) => !currency || !a.currency || a.currency.toUpperCase() === currency
    )
    if (fits.length === 0) return suggestedName(row)
    const same = fits.filter((a) => currency && a.currency?.toUpperCase() === currency)
    const pool = same.length > 0 ? same : fits
    return pool.reduce((newest, a) => (a.id > newest.id ? a : newest), pool[0]).name
  }

  const targetChoices = (): TargetChoice[] => {
    const row = statement()
    const existing = flow.bankAccounts().map((a) => a.name)
    const choices: TargetChoice[] = existing.map((name) => ({ name, isNew: false }))
    if (!row) return choices
    for (const name of [row.targetAccount, suggestedName(row)]) {
      if (name && !existing.includes(name) && !choices.some((c) => c.name === name)) {
        choices.push({ name, isNew: true })
      }
    }
    return choices
  }

  /** Bank statement to the import preview, with the flow's own steps and their defaults. */
  const prepare = async (mine: number) => {
    await flow.processBankFiles()
    if (mine !== generation) return
    if (flow.activeStep() !== 'mapping') {
      setProblem('unread')
      return
    }
    await flow.goToPreview()
  }

  const choose = async (picked: File) => {
    const mine = ++generation
    setImported(null)
    setProblem(null)
    setFile(picked)
    setReading(true)
    try {
      flow.resetForm()
      // The account setup's last step created has to be one "Goes into" can offer.
      await flow.loadBankAccounts()
      if (mine !== generation) return
      await flow.addBankFiles([picked])
      if (mine !== generation) return
      const row = statement()
      if (!row) {
        setProblem('unread')
        return
      }
      if (!row.bankId) {
        setProblem('unknown')
        return
      }
      if (!row.targetAccount) flow.updateBankFile(0, { targetAccount: defaultTarget(row) })
      await prepare(mine)
    } finally {
      if (mine === generation) setReading(false)
    }
  }

  /** Send the statement to another account: its rows name the account, so it is read again. */
  const setTarget = async (name: string) => {
    if (!statement() || reading() || flow.loading()) return
    const mine = ++generation
    flow.updateBankFile(0, { targetAccount: name })
    setReading(true)
    try {
      await prepare(mine)
    } finally {
      if (mine === generation) setReading(false)
    }
  }

  const importNow = async () => {
    if (state() !== 'ready' || flow.loading()) return
    await flow.handleImport('selected')
  }

  /** Forget the file: back to the picker. */
  const clear = () => {
    generation++
    flow.resetForm()
    setFile(null)
    setProblem(null)
    setImported(null)
    setReading(false)
  }

  /** The file and the Import page tab that reads it, for the way out. */
  const handOver = (): HandedImportFile | null => {
    const chosen = file()
    if (!chosen) return null
    return { file: chosen, tab: statement()?.bankId ? 'bank-imports' : 'file-upload' }
  }

  /** The new transactions' first and last day, ISO, or null when the dates do not read. */
  const dateRange = (): { from: string; to: string } | null => {
    const column = flow.columnMapping().date
    if (column === undefined) return null
    const rows = flow.currentRows()
    let from = ''
    let to = ''
    for (const index of flow.selectedRows()) {
      const day = rows[index]?.[column]?.slice(0, 10) ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      if (!from || day < from) from = day
      if (!to || day > to) to = day
    }
    return from ? { from, to } : null
  }

  return {
    flow,
    file,
    state,
    bank,
    newCount,
    alreadyHere,
    importing,
    imported,
    problem,
    statement,
    targetChoices,
    dateRange,
    choose,
    setTarget,
    importNow,
    clear,
    handOver,
    /** Open the system's file picker: the footer's "Choose a file". */
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

/** The statement step's body. The wizard's footer carries its actions (OnboardingWizard.tsx). */
export function FirstImportPanel(props: { importer: FirstImport }) {
  const importer = props.importer
  const inputId = `onboarding-import-input-${createUniqueId()}`
  const banks = () => listed(listAdapters().map((a) => a.label))
  onCleanup(() => {
    importer.attachPicker(undefined)
  })

  const metaLine = () => {
    const parts: string[] = []
    if (importer.bank()) parts.push(importer.bank())
    if (importer.state() === 'ready') parts.push(counted(importer.newCount(), 'new transaction'))
    return parts.join(' · ')
  }

  // The dates the statement covers, on a line of their own: after the count, a phone's card
  // wrapped them mid-date or left a separator hanging at the end of a line.
  const datesLine = () => {
    const range = importer.state() === 'ready' ? importer.dateRange() : null
    return range ? dateRangeText(range.from, range.to) : ''
  }

  const categoriesLine = () => {
    const names = importer.flow.newCategories()
    if (names.length === 0) return ''
    const shown = names.slice(0, 3)
    const more = names.length - shown.length
    return `New categories: ${listed(more > 0 ? [...shown, `${more} more`] : shown)}.`
  }

  return (
    <div class={styles.firstImport}>
      <input
        id={inputId}
        ref={(el) => {
          importer.attachPicker(el)
        }}
        type="file"
        accept={STATEMENT_ACCEPT}
        class={styles.fileInput}
        data-test-id="onboarding-import-input"
        disabled={importer.state() === 'reading' || importer.importing()}
        onChange={(e) => {
          const picked = e.currentTarget.files?.[0]
          // Cleared, so choosing the same file again is a change too.
          e.currentTarget.value = ''
          if (picked) void importer.choose(picked)
        }}
      />
      <Show
        when={importer.state() !== 'empty'}
        fallback={
          <>
            <label for={inputId} class={styles.pick} data-test-id="onboarding-import-pick">
              <span class={styles.pickGlyph}>
                <FileGlyph />
              </span>
              <b>Choose a statement</b>
              <span>CSV or Excel, as your bank's app exports it</span>
            </label>
            <p class={styles.hint} data-test-id="onboarding-import-banks">
              Reads exports from {banks()}. Any other file goes to the Import page, where you match
              its columns.
            </p>
          </>
        }
      >
        <div
          class={styles.fileCard}
          data-test-id="onboarding-import-file"
          data-state={importer.state()}
        >
          <div class={styles.fileTop}>
            <div class={styles.fileText}>
              <div class={styles.fileName}>{importer.file()?.name}</div>
              <Show when={metaLine()}>
                <div class={styles.fileMeta} data-test-id="onboarding-import-meta">
                  {metaLine()}
                </div>
              </Show>
              <Show when={datesLine()}>
                <div class={styles.fileMeta} data-test-id="onboarding-import-dates">
                  {datesLine()}
                </div>
              </Show>
            </div>
            <Show when={importer.state() !== 'imported'}>
              <button
                type="button"
                class={styles.iconBtn}
                aria-label={`Remove ${importer.file()?.name ?? 'the file'}`}
                data-test-id="onboarding-import-remove"
                disabled={importer.state() === 'reading' || importer.importing()}
                onClick={() => {
                  importer.clear()
                }}
              >
                <CloseGlyph />
              </button>
            </Show>
          </div>

          <Show when={importer.state() === 'reading'}>
            <p class={styles.cardLine} role="status">
              <span class={styles.inlineSpinner} aria-hidden="true" />
              Reading the statement…
            </p>
          </Show>

          <Show when={importer.state() === 'ready'}>
            <label class={styles.field}>
              <span class={styles.fieldLabel}>Goes into</span>
              <select
                class={styles.input}
                data-test-id="onboarding-import-target"
                disabled={importer.importing()}
                onChange={(e) => {
                  void importer.setTarget(e.currentTarget.value)
                }}
              >
                <For each={importer.targetChoices()}>
                  {(choice) => (
                    <option
                      value={choice.name}
                      selected={choice.name === importer.statement()?.targetAccount}
                    >
                      {choice.isNew ? `New account: ${choice.name}` : choice.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <Show when={categoriesLine()}>
              <p class={styles.hint} data-test-id="onboarding-import-categories">
                {categoriesLine()}
              </p>
            </Show>
            <Show when={importer.alreadyHere() > 0}>
              <p class={styles.hint}>
                {counted(importer.alreadyHere(), 'transaction')} in it{' '}
                {importer.alreadyHere() === 1 ? 'is' : 'are'} here already and stay as they are.
              </p>
            </Show>
          </Show>

          <Show when={importer.state() === 'nothing-new'}>
            <p class={styles.cardLine} data-test-id="onboarding-import-nothing-new">
              Nothing new: every transaction in it is here already.
            </p>
          </Show>

          <Show when={importer.state() === 'unreadable'}>
            <p class={styles.cardLine} data-test-id="onboarding-import-problem">
              {importer.problem() === 'unknown'
                ? "We don't recognise the bank in this file. The Import page reads it once you match its columns."
                : "We couldn't read any transactions in this file. The Import page shows what's in it."}
            </p>
          </Show>

          <Show when={importer.state() === 'imported'}>
            <p class={styles.cardLine} data-test-id="onboarding-import-done">
              {(importer.imported()?.imported ?? 0) > 0
                ? `Imported ${counted(importer.imported()!.imported, 'transaction')} into ${importer.statement()?.targetAccount ?? 'your account'}.`
                : 'Nothing new was imported: every transaction in it was here already.'}
            </p>
            <button
              type="button"
              class={styles.linkBtn}
              data-test-id="onboarding-import-another"
              onClick={() => {
                importer.clear()
              }}
            >
              Bring in another statement
            </button>
          </Show>

          <Show when={importer.flow.error() && importer.state() === 'ready'}>
            <p class={styles.cardError} role="alert">
              {importer.flow.error()}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  )
}
