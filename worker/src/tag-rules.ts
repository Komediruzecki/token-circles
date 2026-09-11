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
import type { DataKeyring } from './data-keys';
import { TEXT_PREFIX } from './field-crypto';
import { openRows } from './sealed-rows';
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

/**
 * The unsealed columns the matcher reads. Selecting only these keeps a full-ledger scan cheap.
 * The sealed text columns are added per scan (scanColumns), and only those the criteria read.
 */
const BASE_SCAN_COLUMNS =
  'id, type, amount, amount_local, date, means_of_payment, category_id, account_id, transfer_account_id';

type SealedTextColumn = 'description' | 'beneficiary' | 'payor' | 'notes';

/** A scanned row: the structural fields, plus whichever sealed columns the scan selected. */
type ScanRow = TagRuleTransaction & Record<string, unknown> & { id: number };

/**
 * The sealed columns a criteria set reads, mirroring transactionMatchesTagRule in
 * shared/tagRules.ts: description, counterparty (beneficiary OR payor), notes. means_of_payment
 * is a text condition too, but not a sealed column.
 */
function sealedColumnsFor(criteria: TagRuleCriteria): SealedTextColumn[] {
  const cols: SealedTextColumn[] = [];
  if (criteria.description) cols.push('description');
  if (criteria.counterparty) cols.push('beneficiary', 'payor');
  if (criteria.notes) cols.push('notes');
  return cols;
}

/**
 * The SELECT list for a scan that reads `sealed`. A sealed column never travels without
 * text_enc, so openRows knows which form each row is in; a scan that reads no sealed column
 * reads no text_enc either, and is never opened.
 */
function scanColumns(sealed: ReadonlySet<SealedTextColumn>): string {
  return sealed.size
    ? `${BASE_SCAN_COLUMNS}, ${[...sealed].join(', ')}, text_enc`
    : BASE_SCAN_COLUMNS;
}

/**
 * One active rule, prepared so a row can be judged from its unsealed fields first.
 *
 * `structural` is the rule with its sealed-text conditions removed, or null when nothing else is
 * left. `textFree` means the rule reads no sealed column at all.
 */
interface RulePlan {
  criteria: TagRuleCriteria;
  textFree: boolean;
  structural: TagRuleCriteria | null;
}

function planRule(criteria: TagRuleCriteria): RulePlan {
  const structural: TagRuleCriteria = { ...criteria, description: '', counterparty: '', notes: '' };
  return {
    criteria,
    textFree: sealedColumnsFor(criteria).length === 0,
    structural: isTagRuleCriteriaEmpty(structural) ? null : structural,
  };
}

/**
 * What a rule says about a row from its UNSEALED fields alone — true or false when that already
 * decides it, null when the answer turns on sealed text. Exact, never a guess: under 'all' one
 * failing condition fails the rule, under 'any' one passing condition passes it, and the
 * structural criteria never read a sealed column (their text conditions are blank), so a row
 * still holding ciphertext is safe to judge here. Rows that stay undecided are the only ones the
 * scan opens — a rule's category or account then bounds the decryption, not just the SQL.
 */
function verdictWithoutText(row: ScanRow, plan: RulePlan): boolean | null {
  if (plan.textFree) return transactionMatchesTagRule(row, plan.criteria);
  if (!plan.structural) return null;
  const passes = transactionMatchesTagRule(row, plan.structural);
  if (plan.criteria.match === 'any') return passes ? true : null;
  return passes ? null : false;
}

// The shape field-crypto's sealText writes: `tc1.` + a 12-byte IV and at least a 16-byte GCM tag,
// both unpadded base64url. A description that merely starts with "tc1." does not fit it.
const SEALED_SHAPE = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;

function looksSealed(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(TEXT_PREFIX) &&
    SEALED_SHAPE.test(value.slice(TEXT_PREFIX.length))
  );
}

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
 *
 * `ring` and `ownerId` (the profile's owner) open the sealed text the criteria read. Only rows
 * whose answer turns on that text are opened, and only the columns the criteria reference are
 * selected at all; a row that cannot be opened fails the whole call rather than being matched as
 * ciphertext — a short "contains" needle can hit ciphertext by chance, and apply is a bulk write.
 */
export async function matchTransactions(
  database: D1Database,
  profileId: number,
  criteriaList: TagRuleCriteria[],
  ring: DataKeyring,
  ownerId: number
): Promise<RuleMatchResult> {
  const active = criteriaList.filter((criteria) => !isTagRuleCriteriaEmpty(criteria));
  if (!active.length) return { ids: [], scanned: 0, truncated: false };

  // A single rule can be narrowed in SQL; several rules OR together, so the union has to be
  // computed over the unnarrowed set (each rule narrows differently).
  const narrowing = active.length === 1 ? narrowingClause(active[0]) : { sql: '', params: [] };
  const sealed = new Set(active.flatMap(sealedColumnsFor));
  const rows = await db.all<ScanRow>(
    database,
    `SELECT ${scanColumns(sealed)} FROM transactions WHERE profile_id = ?${narrowing.sql}
     ORDER BY date DESC, id DESC LIMIT ${TAG_RULE_SCAN_LIMIT}`,
    profileId,
    ...narrowing.params
  );

  const plans = active.map(planRule);
  const matched = new Set<number>();
  const undecided: ScanRow[] = [];
  for (const row of rows) {
    let pending = false;
    let hit = false;
    for (const plan of plans) {
      const verdict = verdictWithoutText(row, plan);
      if (verdict === true) {
        hit = true;
        break;
      }
      if (verdict === null) pending = true;
    }
    if (hit) matched.add(row.id);
    else if (pending) undecided.push(row);
  }
  if (undecided.length) {
    const opened = await openRows(ring, ownerId, 'transactions', undecided);
    for (const row of opened) {
      if (active.some((criteria) => transactionMatchesTagRule(row, criteria))) matched.add(row.id);
    }
  }

  // Scan order (newest first) — callers take the first few as the preview sample.
  const ids = rows.filter((row) => matched.has(row.id)).map((row) => row.id);
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
  criteria: TagRuleCriteria,
  ring: DataKeyring,
  ownerId: number
): Promise<TagRuleConditionCount[]> {
  const conditions = splitTagRuleConditions(criteria);
  if (conditions.length < 2) return [];
  // Each text condition is counted on its own over the whole window, so every row is opened —
  // but only in the columns those conditions read.
  const sealed = new Set(conditions.flatMap((condition) => sealedColumnsFor(condition.criteria)));
  const scanned = await db.all<ScanRow>(
    database,
    `SELECT ${scanColumns(sealed)} FROM transactions WHERE profile_id = ?
     ORDER BY date DESC, id DESC LIMIT ${TAG_RULE_SCAN_LIMIT}`,
    profileId
  );
  const rows = sealed.size ? await openRows(ring, ownerId, 'transactions', scanned) : scanned;
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
 *
 * `transaction` must already be opened (openRows): its text is matched as it stands. A row whose
 * text is still sealed tags nothing — ciphertext could satisfy a short "contains" needle by
 * chance and mis-tag the row for good — and is logged, since it means the caller skipped openRows.
 */
export async function autoApplyTagRules(
  database: D1Database,
  profileId: number,
  transactionId: number,
  transaction: TagRuleTransaction
): Promise<number[]> {
  const stillSealed = (['description', 'beneficiary', 'payor', 'notes'] as const).filter((col) =>
    looksSealed(transaction[col])
  );
  if (stillSealed.length) {
    console.error(
      `[tag-rules] autoApplyTagRules: transaction ${transactionId} arrived with sealed ${stillSealed.join(', ')}; open it before matching`
    );
    return [];
  }
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
