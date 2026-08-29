/**
 * Bank statement import — portable core.
 *
 * Detection, parsing and transformation of a bank's raw CSV/XLS statement into
 * the app's canonical import table. Pure TypeScript: no DOM, no localStorage, no
 * filesystem — so both runtimes use it. The browser runs it to power the Bank
 * Imports tab; the Worker runs it in `/api/v1/import` so an API caller uploading
 * an ERSTE or Revolut export gets the same adapter treatment as the UI instead
 * of falling back to generic-CSV header guessing.
 *
 * Browser-only persistence (remembered statements, user-edited rule sets) stays
 * in `frontend/src/core/bankImport/` — it is storage, not parsing.
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
  ParsedStatement,
  DetectInput,
  TransformContext,
} from './types';

export { CANONICAL_HEADERS, txnsToTable, txnToRow } from './canonical';
export { listAdapters, getAdapter, detectBank } from './registry';
export type { DetectResult } from './registry';
export { processFiles, toDetectInput } from './process';
export type { BankFileInput, ProcessOptions, ProcessResult, FileResult } from './process';
export { resolveTargetAccount, statementSignature } from './accountResolver';
export type { AccountLike } from './accountResolver';
export {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CATEGORY_RULES_WORLDWIDE,
  RULE_GROUPS,
  DEFAULT_RULE_GROUP_ID,
  rulesForGroup,
  matchCategory,
  categorize,
} from './categoryRules';
export type { RuleGroup } from './categoryRules';
export { DEFAULT_TRANSFER_RULES, isTransfer, resolveCounterpart } from './transferRules';
export type { XlsxModule, XlsxLoader, ParseDeps } from './xlsx';
