/**
 * A learned category mapping, and the two requests that use them, as the Worker and the
 * local-first router accept them.
 *
 * A mapping is a piece of a transaction's text ("netflix") and the category a transaction holding
 * it belongs in. The auto-categorise dialog reads them (GET /api/categories/mappings). An API client
 * saves one (POST /api/categories/mappings), files transactions and learns their text (POST
 * /api/categories/apply-mappings), and asks for a category for each uncategorised transaction
 * (POST /api/categories/auto-map, shared/autoCategorize.ts).
 *
 * The two runtimes used to answer each of these differently (docs/plans/2026-10-07-form-errors.md,
 * slice 4b): local-first stored a pattern saved twice as a second mapping, filed transactions by
 * the stored mappings a request named rather than the transactions it listed, and filed rows on
 * auto-map where the Worker only suggests. Both now do what the Worker did, by these rules:
 *
 * - A mapping has a pattern: text, trimmed, at least one character.
 * - It names one of the profile's categories, by id.
 * - Its confidence is above 0 and at most 1, and 0.9 when it is left out.
 * - A pattern the profile already has, compared exactly once trimmed, is that mapping saved again:
 *   it takes the new category and confidence, and counts one more use.
 * - apply-mappings takes a list of `{ transaction_id, category_id, pattern }`. Every category must
 *   be the profile's, or nothing is filed; a transaction that is not the profile's is skipped. A
 *   pattern teaches a mapping in its matching form (lower case letters and digits), when that form
 *   has three characters or more.
 * - auto-map takes a list of transaction ids, or a description and an amount, or neither, for
 *   every uncategorised transaction.
 */
import { asId, asRecord, asNumber, isBlank } from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

/** The confidence a mapping is saved with when the body gives none, and every learned one has. */
export const DEFAULT_MAPPING_CONFIDENCE = 0.9;

/** The shortest matching form a learned pattern may have. */
export const LEARNED_PATTERN_MIN = 3;

/** The words for each refusal. An API client shows them; a summary joins them. */
export const CATEGORY_MAPPING_MESSAGES = {
  pattern: 'Give the text to match, like "netflix".',
  category: 'Choose a category from the list.',
  confidence: 'Use a confidence above 0 and up to 1, like 0.9.',
  mappings:
    'Send the transactions to file as a list, like [{"transaction_id": 12, "category_id": 3}].',
  transaction: 'Name the transaction by its id, like 12.',
  patternText: 'Send the pattern as text, like "netflix", or leave it out.',
  transactionIds: 'Send the transactions as a list of ids, like [12, 13], or leave it out.',
  description: 'Send the description as text, or leave it out.',
} as const;

const M = CATEGORY_MAPPING_MESSAGES;

/** A mapping as POST /api/categories/mappings stores it. */
export interface CategoryMappingInput {
  pattern: string;
  category_id: number;
  confidence: number;
}

/** One transaction to file, and the text to learn from it. */
export interface MappingToApply {
  transaction_id: number;
  category_id: number;
  pattern: string | null;
}

/** Which transactions auto-map looks at. */
export interface AutoMapRequest {
  /** These transactions, or null for the description below or every uncategorised one. */
  transaction_ids: number[] | null;
  /** With an amount: the uncategorised transactions whose text holds this description. */
  description: string | null;
  amount: unknown;
}

function done<T>(fields: FieldErrors, value: () => T): Checked<T> {
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value: value() };
}

/** A mapping to save: its trimmed pattern, its category and its confidence, or why not. */
export function checkCategoryMapping(body: unknown): Checked<CategoryMappingInput> {
  const raw = asRecord(body);
  const fields: FieldErrors = {};
  const pattern = typeof raw.pattern === 'string' ? raw.pattern.trim() : '';
  if (pattern === '') fields.pattern = M.pattern;
  const categoryId = asId(raw.category_id);
  if (categoryId === null) fields.category_id = M.category;
  let confidence = DEFAULT_MAPPING_CONFIDENCE;
  if (!isBlank(raw.confidence)) {
    const number = asNumber(raw.confidence);
    if (number === null || number <= 0 || number > 1) fields.confidence = M.confidence;
    else confidence = number;
  }
  return done(fields, () => ({ pattern, category_id: categoryId as number, confidence }));
}

/**
 * The transactions apply-mappings files, or why not. A field of one entry is named by its place
 * in the list, `mappings.<index>.<field>`, as the loan's rate periods are.
 */
export function checkApplyMappings(body: unknown): Checked<MappingToApply[]> {
  const list = asRecord(body).mappings;
  if (!Array.isArray(list)) return { ok: false, fields: { mappings: M.mappings } };
  const fields: FieldErrors = {};
  const value: MappingToApply[] = [];
  list.forEach((entry: unknown, index) => {
    const row = asRecord(entry);
    const transactionId = asId(row.transaction_id);
    const categoryId = asId(row.category_id);
    if (transactionId === null) fields[`mappings.${index}.transaction_id`] = M.transaction;
    if (categoryId === null) fields[`mappings.${index}.category_id`] = M.category;
    let pattern: string | null = null;
    if (typeof row.pattern === 'string') pattern = row.pattern;
    else if (typeof row.pattern === 'number' && Number.isFinite(row.pattern)) {
      pattern = String(row.pattern);
    } else if (!isBlank(row.pattern)) fields[`mappings.${index}.pattern`] = M.patternText;
    if (transactionId !== null && categoryId !== null) {
      value.push({ transaction_id: transactionId, category_id: categoryId, pattern });
    }
  });
  return done(fields, () => value);
}

/** The refusal for an entry whose category is not the profile's, at that entry's field. */
export function foreignMappingCategory(index: number): FieldErrors {
  return { [`mappings.${index}.category_id`]: M.category };
}

/**
 * The form a learned pattern is kept and matched in: lower case letters and digits only, so
 * "Netflix monthly" is "netflixmonthly". Null when that is shorter than three characters, which
 * would match too much to learn from.
 */
export function learnedPattern(pattern: string | null): string | null {
  if (pattern === null) return null;
  const normal = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normal.length >= LEARNED_PATTERN_MIN ? normal : null;
}

/** Which transactions auto-map looks at, or why the body cannot say. */
export function checkAutoMap(body: unknown): Checked<AutoMapRequest> {
  const raw = asRecord(body);
  const fields: FieldErrors = {};
  let ids: number[] | null = null;
  if (!isBlank(raw.transaction_ids)) {
    const read = Array.isArray(raw.transaction_ids)
      ? (raw.transaction_ids as unknown[]).map(asId)
      : null;
    if (read === null || read.some((id) => id === null)) {
      fields.transaction_ids = M.transactionIds;
    } else if (read.length > 0) ids = read as number[];
  }
  let description: string | null = null;
  if (typeof raw.description === 'string') description = raw.description;
  else if (!isBlank(raw.description)) fields.description = M.description;
  return done(fields, () => ({ transaction_ids: ids, description, amount: raw.amount }));
}

/**
 * Whether auto-map narrows to a description: the Worker's rule, a description and an amount that
 * are both given (an amount of 0 is not).
 */
export function autoMapsByDescription(request: AutoMapRequest): boolean {
  return (
    request.transaction_ids === null && Boolean(request.description) && Boolean(request.amount)
  );
}

/** A description in the form auto-map looks for it: lower case letters and digits only. */
export function autoMapDescription(description: string): string {
  return description
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}
