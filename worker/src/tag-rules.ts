// Server-side helpers for the tag-rule engine. Matching semantics live in shared/tagRules.ts so
// the Worker and the local-first IndexedDB runtime can never drift; this module only handles the
// D1-specific parts — reading rules, narrowing the candidate scan, and writing tag links.
import {
  isTagRuleCriteriaEmpty,
  normalizeTagRuleCriteria,
  splitTagRuleConditions,
  TAG_RULE_SCAN_LIMIT,
  tagRuleScanNarrowing,
  transactionMatchesTagRule,
} from '../../shared/tagRules';
import * as db from './db';
import type { TagRuleCriteria, TagRuleTransaction } from '../../shared/tagRules';

// TAG_RULE_SCAN_LIMIT lives in shared/tagRules.ts so the Worker's SQL LIMIT and the IndexedDB
// runtime's in-memory slice cap agree. Re-exported for callers that import it from this module.
export { TAG_RULE_SCAN_LIMIT };

export interface TagRuleRow {
  id: number;
  profile_id: number;
  tag_id: number;
  name: string;
  criteria: string;
  auto_apply: number;
  created_at: string;
}

export interface ParsedTagRule {
  id: number;
  tag_id: number;
  name: string;
  auto_apply: boolean;
  criteria: TagRuleCriteria;
}

/** Columns the matcher reads. Selecting only these keeps a full-ledger scan cheap. */
const SCAN_COLUMNS =
  'id, type, amount, amount_local, date, description, beneficiary, payor, notes, means_of_payment, category_id, account_id, transfer_account_id';

/**
 * How many bound variables the scan's optional SQL pushdown may spend.
 *
 * D1's hard ceiling is 100 per statement; the scan itself always binds `profile_id`, and we keep a
 * few spare so a future column added to the WHERE clause can't silently reintroduce the overflow.
 */
const SCAN_PUSHDOWN_BUDGET = 90;

export function parseTagRule(row: TagRuleRow): ParsedTagRule {
  return {
    id: row.id,
    tag_id: row.tag_id,
    name: row.name ?? '',
    auto_apply: Number(row.auto_apply) === 1,
    criteria: normalizeTagRuleCriteria(row.criteria),
  };
}

export async function listTagRules(
  database: D1Database,
  profileId: number,
  opts: { tagId?: number; autoApplyOnly?: boolean } = {}
): Promise<ParsedTagRule[]> {
  let sql = 'SELECT * FROM tag_rules WHERE profile_id = ?';
  const params: unknown[] = [profileId];
  if (opts.tagId !== undefined) {
    sql += ' AND tag_id = ?';
    params.push(opts.tagId);
  }
  if (opts.autoApplyOnly) sql += ' AND auto_apply = 1';
  sql += ' ORDER BY id';
  const rows = await db.all<TagRuleRow>(database, sql, ...params);
  return rows.map(parseTagRule);
}

/**
 * Push whichever conditions are safely expressible into SQL so the in-memory scan sees fewer rows.
 *
 * Only valid when `match === 'all'`: under AND, filtering by any single condition can never drop a
 * row the full matcher would have kept. Under `'any'` (OR) no single condition may narrow the set,
 * so the scan stays unfiltered. The returned SQL is a pre-filter only — `transactionMatchesTagRule`
 * still makes the final call on every surviving row, so a narrowing bug can only cost performance,
 * never change which rows match.
 */
function narrowingClause(criteria: TagRuleCriteria): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  // Which conditions are narrowable is defined once, in shared/tagRules.ts, so the IndexedDB
  // runtime pre-filters its scan by exactly the same set (see its matchingTransactions).
  const narrowable = tagRuleScanNarrowing(criteria);
  if (!narrowable) return { sql: '', params };
  criteria = narrowable;

  // D1 hard-rejects a statement binding more than 100 variables ("too many SQL variables"), and
  // the pushdown's cost is driven by user-chosen list lengths. Per-clause caps are not enough:
  // their SUM is what blows the ceiling (50 categories + 25 accounts bound twice + profile_id is
  // already 101). So spend from ONE budget and skip any clause that no longer fits — safe by the
  // contract above, since a dropped clause only widens the scan, never the result.
  let budget = SCAN_PUSHDOWN_BUDGET;
  const take = (cost: number): boolean => {
    if (cost > budget) return false;
    budget -= cost;
    return true;
  };

  // Compare on the date part only, matching the shared matcher (which slices any imported time
  // component off transaction.date before comparing). A raw `date <= dateTo` would drop e.g.
  // '2024-01-15T10:00:00Z' when dateTo is '2024-01-15' — a row the in-memory matcher keeps — so the
  // pushdown would change the result set instead of merely shrinking the scan, breaking the
  // "narrowing can only cost performance, never change which rows match" contract. substr() forgoes
  // the date index, but the scan is already bounded by TAG_RULE_SCAN_LIMIT.
  if (criteria.dateFrom && take(1)) {
    parts.push('substr(date, 1, 10) >= ?');
    params.push(criteria.dateFrom);
  }
  if (criteria.dateTo && take(1)) {
    parts.push('substr(date, 1, 10) <= ?');
    params.push(criteria.dateTo);
  }
  if (criteria.types.length && take(criteria.types.length)) {
    parts.push(`type IN (${criteria.types.map(() => '?').join(',')})`);
    params.push(...criteria.types);
  }
  if (criteria.categoryIds.length && take(criteria.categoryIds.length)) {
    parts.push(`category_id IN (${criteria.categoryIds.map(() => '?').join(',')})`);
    params.push(...criteria.categoryIds);
  }
  // Accounts cost DOUBLE: the list is bound once for account_id and again for transfer_account_id.
  if (criteria.accountIds.length && take(criteria.accountIds.length * 2)) {
    const ph = criteria.accountIds.map(() => '?').join(',');
    parts.push(`(account_id IN (${ph}) OR transfer_account_id IN (${ph}))`);
    params.push(...criteria.accountIds, ...criteria.accountIds);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

export interface RuleMatchResult {
  /** Ids of transactions matching at least one of the supplied criteria sets. */
  ids: number[];
  /** Rows scanned — equals TAG_RULE_SCAN_LIMIT when the scan was truncated. */
  scanned: number;
  /** True when the ledger is larger than the scan cap, so results may be incomplete. */
  truncated: boolean;
}

/**
 * Find every transaction in `profileId` matching at least one of `criteriaList`.
 * Empty criteria are skipped, so a blank rule can never sweep the whole ledger.
 */
export async function matchTransactions(
  database: D1Database,
  profileId: number,
  criteriaList: TagRuleCriteria[]
): Promise<RuleMatchResult> {
  const active = criteriaList.filter((criteria) => !isTagRuleCriteriaEmpty(criteria));
  if (!active.length) return { ids: [], scanned: 0, truncated: false };

  // A single rule can be narrowed in SQL; several rules OR together, so the union has to be
  // computed over the unnarrowed set (each rule narrows differently).
  const narrowing = active.length === 1 ? narrowingClause(active[0]) : { sql: '', params: [] };
  const rows = await db.all<TagRuleTransaction & { id: number }>(
    database,
    `SELECT ${SCAN_COLUMNS} FROM transactions WHERE profile_id = ?${narrowing.sql}
     ORDER BY date DESC, id DESC LIMIT ${TAG_RULE_SCAN_LIMIT}`,
    profileId,
    ...narrowing.params
  );

  const ids: number[] = [];
  for (const row of rows) {
    if (active.some((criteria) => transactionMatchesTagRule(row, criteria))) ids.push(row.id);
  }

  return { ids, scanned: rows.length, truncated: rows.length >= TAG_RULE_SCAN_LIMIT };
}

export interface TagRuleConditionCount {
  key: string;
  label: string;
  matched: number;
}

/**
 * Count how many transactions each individual condition of a rule matches.
 *
 * Answers "why did my rule match nothing?" — under AND one unsatisfied condition zeroes the whole
 * result and the UI otherwise gives no clue which. Deliberately scans WITHOUT the narrowing
 * pushdown: narrowing already drops the rows failing the structural conditions, so counting over a
 * narrowed scan would report 0 for every condition and explain nothing.
 */
export async function explainTagRule(
  database: D1Database,
  profileId: number,
  criteria: TagRuleCriteria
): Promise<TagRuleConditionCount[]> {
  const conditions = splitTagRuleConditions(criteria);
  if (conditions.length < 2) return [];
  const rows = await db.all<TagRuleTransaction>(
    database,
    `SELECT ${SCAN_COLUMNS} FROM transactions WHERE profile_id = ?
     ORDER BY date DESC, id DESC LIMIT ${TAG_RULE_SCAN_LIMIT}`,
    profileId
  );
  return conditions.map((condition) => ({
    key: condition.key,
    label: condition.label,
    matched: rows.filter((row) => transactionMatchesTagRule(row, condition.criteria)).length,
  }));
}

// Chunk size for the id IN-lists below. Kept at 90 (not 100) so the "already tagged" COUNT —
// which binds `tag_id` PLUS a chunk of ids — stays at 91 binds, under D1's ~100 bound-variable
// ceiling. The rest of the codebase reserves the same headroom (see transactions.ts bulk chunking).
const LINK_CHUNK = 90;

/**
 * Link `transactionIds` to `tagId`, skipping rows already tagged. Returns how many links were
 * newly created. INSERT OR IGNORE makes re-running a rule idempotent against the composite PK.
 */
export async function linkTransactionsToTag(
  database: D1Database,
  tagId: number,
  transactionIds: number[]
): Promise<number> {
  if (!transactionIds.length) return 0;

  // Count first: D1Result.meta.changes is unreliable for OR IGNORE across a batch, and the caller
  // reports "newly tagged" to the user.
  let alreadyTagged = 0;
  for (let i = 0; i < transactionIds.length; i += LINK_CHUNK) {
    const chunk = transactionIds.slice(i, i + LINK_CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const row = await db.first<{ c: number }>(
      database,
      `SELECT COUNT(*) AS c FROM transaction_tags WHERE tag_id = ? AND transaction_id IN (${ph})`,
      tagId,
      ...chunk
    );
    alreadyTagged += row?.c ?? 0;
  }

  for (let i = 0; i < transactionIds.length; i += LINK_CHUNK) {
    const chunk = transactionIds.slice(i, i + LINK_CHUNK);
    await database.batch(
      chunk.map((txId) =>
        database
          .prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)')
          .bind(txId, tagId)
      )
    );
  }
  return transactionIds.length - alreadyTagged;
}

/**
 * Apply every auto-apply rule to one just-created transaction.
 *
 * Called from the transaction-create path, so it is deliberately fail-soft: a tagging error must
 * never fail (or roll back) a transaction the user successfully saved. Returns the tag ids applied.
 */
export async function autoApplyTagRules(
  database: D1Database,
  profileId: number,
  transactionId: number,
  transaction: TagRuleTransaction
): Promise<number[]> {
  try {
    const rules = await listTagRules(database, profileId, { autoApplyOnly: true });
    if (!rules.length) return [];
    const tagIds = new Set<number>();
    for (const rule of rules) {
      if (transactionMatchesTagRule(transaction, rule.criteria)) tagIds.add(rule.tag_id);
    }
    if (!tagIds.size) return [];
    await database.batch(
      [...tagIds].map((tagId) =>
        database
          .prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)')
          .bind(transactionId, tagId)
      )
    );
    return [...tagIds];
  } catch {
    // Best-effort: the transaction itself is already committed and correct.
    return [];
  }
}
