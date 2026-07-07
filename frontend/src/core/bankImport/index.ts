/**
 * Bank statement import — public API.
 *
 * The Bank Imports tab imports from here. Everything below is additive: parsing
 * and transformation run fully client-side and emit the app's canonical import
 * table, which the existing mapping → preview → `/api/import/execute` pipeline
 * consumes unchanged in both serverless and self-hosted modes.
 */
export type {
  BankId,
  BankAdapter,
  CanonicalTxn,
  CanonicalType,
  CategoryRule,
  CategoryRuleSet,
  TransferRuleSet,
  StatementMeta,
} from './types'

export { CANONICAL_HEADERS, txnsToTable, txnToRow } from './canonical'
export { listAdapters, getAdapter, detectBank } from './registry'
export type { DetectResult } from './registry'
export { processFiles, toDetectInput } from './process'
export type { BankFileInput, ProcessOptions, ProcessResult, FileResult } from './process'
export { resolveTargetAccount, statementSignature } from './accountResolver'
export type { AccountLike } from './accountResolver'
export { DEFAULT_CATEGORY_RULES, matchCategory, categorize } from './categoryRules'
export { DEFAULT_TRANSFER_RULES, isTransfer, resolveCounterpart } from './transferRules'
export {
  loadCategoryRules,
  saveCategoryRules,
  loadTransferRules,
  saveTransferRules,
  resetBankImportRules,
} from './rulesStore'
