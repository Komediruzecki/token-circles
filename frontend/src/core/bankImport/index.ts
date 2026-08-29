/**
 * Bank statement import — public API for the browser.
 *
 * The detection/parse/transform core lives in `shared/bankImport` so the Worker's
 * `/api/v1/import` runs the exact same adapters (AGENTS.md: "Import it, don't fork it").
 * This barrel re-exports it and adds the browser-only persistence layer, so the Bank
 * Imports tab keeps a single import site.
 */
export { resolveTargetAccount, statementSignature } from '../../../../shared/bankImport'
export type { AccountLike } from '../../../../shared/bankImport'
export { CANONICAL_HEADERS, txnsToTable, txnToRow } from '../../../../shared/bankImport'
export { detectBank, getAdapter, listAdapters } from '../../../../shared/bankImport'
export type { DetectResult } from '../../../../shared/bankImport'
export { processFiles, toDetectInput } from '../../../../shared/bankImport'
export type {
  BankFileInput,
  FileResult,
  ProcessOptions,
  ProcessResult,
} from '../../../../shared/bankImport'
export {
  categorize,
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CATEGORY_RULES_WORLDWIDE,
  DEFAULT_RULE_GROUP_ID,
  matchCategory,
  RULE_GROUPS,
  rulesForGroup,
} from '../../../../shared/bankImport'
export type { RuleGroup } from '../../../../shared/bankImport'
export {
  DEFAULT_TRANSFER_RULES,
  isTransfer,
  resolveCounterpart,
} from '../../../../shared/bankImport'
export type {
  BankAdapter,
  BankId,
  CanonicalTxn,
  CanonicalType,
  CategoryRule,
  CategoryRuleSet,
  StatementMeta,
  TransferRuleSet,
} from '../../../../shared/bankImport'
export {
  loadCategoryRules,
  loadRuleGroup,
  loadTransferRules,
  resetBankImportRules,
  saveCategoryRules,
  saveRuleGroup,
  saveTransferRules,
} from './rulesStore'
