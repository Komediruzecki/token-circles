/**
 * Bank statement import — orchestration.
 *
 * Takes one or more uploaded files, detects the bank (unless forced), parses +
 * transforms each into canonical transactions, and concatenates them into a
 * single `{ headers, rows }` table ready for the app's existing mapping →
 * preview → execute flow. Per-file results and warnings are returned so the UI
 * can show what was detected and where it needs the user's input.
 */
import { txnsToTable } from './canonical'
import { DEFAULT_CATEGORY_RULES } from './categoryRules'
import { decodeText } from './parse'
import { detectBank, getAdapter } from './registry'
import { DEFAULT_TRANSFER_RULES } from './transferRules'
import type {
  BankId,
  CategoryRuleSet,
  StatementMeta,
  TransferRuleSet,
  TransformContext,
} from './types'

export interface BankFileInput {
  filename: string
  bytes: Uint8Array
  /** Force a specific bank (user override); otherwise auto-detected. */
  bankId?: BankId
  /** Target app account for this file (auto-resolved or user-picked). */
  targetAccount?: string
}

export interface ProcessOptions {
  categoryRules?: CategoryRuleSet
  transferRules?: TransferRuleSet
  /** The user's known account names — for transfer counterpart typing. */
  knownAccounts?: string[]
}

export interface FileResult {
  filename: string
  bankId: BankId | null
  confidence: number
  targetAccount: string
  count: number
  meta: StatementMeta
  error?: string
}

export interface ProcessResult {
  headers: string[]
  rows: string[][]
  perFile: FileResult[]
  warnings: string[]
}

/** Build the signature-matching input for detection from raw bytes. */
export function toDetectInput(filename: string, bytes: Uint8Array) {
  return { filename, bytes, textPreview: decodeText(bytes.slice(0, 4096), 'utf-8') }
}

export async function processFiles(
  files: BankFileInput[],
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const categoryRules = options.categoryRules ?? DEFAULT_CATEGORY_RULES
  const transferRules = options.transferRules ?? DEFAULT_TRANSFER_RULES
  const knownAccounts = options.knownAccounts ?? []

  const allRows: string[][] = []
  const perFile: FileResult[] = []
  const warnings: string[] = []
  let headers: string[] = []

  for (const file of files) {
    const detected = file.bankId
      ? { adapter: getAdapter(file.bankId), confidence: 1 }
      : detectBank(toDetectInput(file.filename, file.bytes))
    const adapter = detected?.adapter

    if (!adapter) {
      perFile.push({
        filename: file.filename,
        bankId: null,
        confidence: 0,
        targetAccount: file.targetAccount || '',
        count: 0,
        meta: {},
        error: 'Could not detect the bank for this file',
      })
      warnings.push(`${file.filename}: unknown bank — skipped`)
      continue
    }

    try {
      const parsed = await adapter.parse(file.bytes, file.filename)
      // Without a target account we can't set means_of_payment; fall back to the
      // bank label and warn so the row still imports (the user can remap it).
      const targetAccount = file.targetAccount || adapter.label
      if (!file.targetAccount) {
        warnings.push(`${file.filename}: no target account chosen — using "${adapter.label}"`)
      }
      const ctx: TransformContext = { targetAccount, categoryRules, transferRules, knownAccounts }
      const txns = adapter.transform(parsed, ctx)
      const table = txnsToTable(txns)
      headers = table.headers
      allRows.push(...table.rows)
      perFile.push({
        filename: file.filename,
        bankId: adapter.id,
        confidence: detected?.confidence ?? 1,
        targetAccount,
        count: txns.length,
        meta: parsed.meta,
      })
    } catch (err) {
      perFile.push({
        filename: file.filename,
        bankId: adapter.id,
        confidence: detected?.confidence ?? 1,
        targetAccount: file.targetAccount || '',
        count: 0,
        meta: {},
        error: (err as Error).message,
      })
      warnings.push(`${file.filename}: ${(err as Error).message}`)
    }
  }

  // If nothing produced rows, still return canonical headers for a stable UI.
  if (headers.length === 0) headers = txnsToTable([]).headers
  return { headers, rows: allRows, perFile, warnings }
}
