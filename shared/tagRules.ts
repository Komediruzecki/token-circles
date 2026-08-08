/**
 * Tag rules — the saved-filter engine behind the tag system.
 *
 * A tag rule is a reusable filter attached to a tag ("everything paid from the business
 * account", "any expense whose description mentions AWS"). The same rule is evaluated in two
 * places that must never disagree: the Cloudflare Worker (D1) and the local-first IndexedDB
 * runtime. Both import this module, so matching semantics are defined exactly once.
 *
 * Deliberate design points:
 *  - Criteria are stored as a JSON blob rather than columns. Rules are read in bulk and
 *    evaluated in memory (never used to build SQL), so there is nothing to index on, and new
 *    condition types don't need a migration.
 *  - An empty criteria object matches NOTHING. "Apply to all previous transactions" is a bulk
 *    write, so a half-filled rule must never sweep the whole ledger.
 */

export const TAG_RULE_MATCH_MODES = ['all', 'any'] as const;
export type TagRuleMatchMode = (typeof TAG_RULE_MATCH_MODES)[number];

/** Transaction types a rule can select. Mirrors shared/transactionInvariant.ts. */
export const TAG_RULE_TYPES = ['income', 'expense', 'transfer', 'deduction'] as const;
export type TagRuleTransactionType = (typeof TAG_RULE_TYPES)[number];

/** How a text condition is compared against a transaction field. */
export const TAG_RULE_TEXT_MODES = ['contains', 'equals', 'starts_with', 'ends_with'] as const;
export type TagRuleTextMode = (typeof TAG_RULE_TEXT_MODES)[number];

export interface TagRuleCriteria {
  /** 'all' = every populated condition must match; 'any' = at least one must. */
  match: TagRuleMatchMode;
  /** Transaction types to accept. Empty = don't constrain by type. */
  types: TagRuleTransactionType[];
  /** Category ids to accept. Empty = don't constrain by category. */
  categoryIds: number[];
  /** Account ids to accept, matched against account_id OR transfer_account_id. */
  accountIds: number[];
  /** Free-text match against `description`. */
  description: string;
  descriptionMode: TagRuleTextMode;
  /** Free-text match against `beneficiary` OR `payor` (whichever side is populated). */
  counterparty: string;
  counterpartyMode: TagRuleTextMode;
  /** Free-text match against `notes`. */
  notes: string;
  notesMode: TagRuleTextMode;
  /** Free-text match against `means_of_payment`. */
  meansOfPayment: string;
  meansOfPaymentMode: TagRuleTextMode;
  /** Inclusive bounds on the absolute transaction amount. */
  amountMin: number | null;
  amountMax: number | null;
  /** Inclusive ISO (YYYY-MM-DD) date bounds. */
  dateFrom: string | null;
  dateTo: string | null;
}

/** The transaction fields a rule can read. Both runtimes pass their raw row shape. */
export interface TagRuleTransaction {
  type?: unknown;
  amount?: unknown;
  amount_local?: unknown;
  date?: unknown;
  description?: unknown;
  beneficiary?: unknown;
  payor?: unknown;
  notes?: unknown;
  means_of_payment?: unknown;
  category_id?: unknown;
  account_id?: unknown;
  transfer_account_id?: unknown;
}

export const EMPTY_TAG_RULE_CRITERIA: TagRuleCriteria = {
  match: 'all',
  types: [],
  categoryIds: [],
  accountIds: [],
  description: '',
  descriptionMode: 'contains',
  counterparty: '',
  counterpartyMode: 'contains',
  notes: '',
  notesMode: 'contains',
  meansOfPayment: '',
  meansOfPaymentMode: 'contains',
  amountMin: null,
  amountMax: null,
  dateFrom: null,
  dateTo: null,
};

/**
 * Upper bound on transactions pulled into memory for one preview/apply pass. A personal ledger
 * sits far below this; the cap stops a pathological account exhausting memory. Both runtimes read
 * it — the Worker as a SQL LIMIT, the IndexedDB runtime as an in-memory slice — so "the most
 * recent N were scanned" truncation behaves identically, and callers surface `truncated` rather
 * than silently under-reporting.
 */
export const TAG_RULE_SCAN_LIMIT = 20000;

/** Cap on ids per list — keeps a stored rule from growing unboundedly via the API. */
const MAX_IDS = 200;
/** Cap on text-condition length. */
const MAX_TEXT = 200;

function str(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function textMode(value: unknown): TagRuleTextMode {
  return TAG_RULE_TEXT_MODES.includes(value as TagRuleTextMode)
    ? (value as TagRuleTextMode)
    : 'contains';
}

function idList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  // Bound the work, not just the result: stop after MAX_IDS valid ids OR a bounded number of
  // inputs, so a large all-invalid array (e.g. thousands of 0s) can't cost O(n) CPU on normalize.
  const limit = Math.min(value.length, MAX_IDS * 5);
  for (let i = 0; i < limit && seen.size < MAX_IDS; i++) {
    const raw = value[i];
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isInteger(n) && n > 0) seen.add(n);
  }
  return [...seen];
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Accept only YYYY-MM-DD so a malformed bound can't silently widen a rule. */
function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Coerce arbitrary input (API body, stored JSON, older rule versions) into a complete
 * criteria object. Never throws — unknown or malformed fields drop to their empty default,
 * which narrows a rule rather than widening it.
 */
export function normalizeTagRuleCriteria(input: unknown): TagRuleCriteria {
  let source: Record<string, unknown> = {};
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed && typeof parsed === 'object') source = parsed as Record<string, unknown>;
    } catch {
      // Stored blob is unreadable — fall through to empty criteria (matches nothing).
    }
  } else if (input && typeof input === 'object') {
    source = input as Record<string, unknown>;
  }

  const types = Array.isArray(source.types)
    ? [
        ...new Set(
          // Slice before filtering so an oversized input array is bounded work (there are only
          // four valid types; 64 is generous headroom).
          source.types
            .slice(0, 64)
            .filter((t): t is TagRuleTransactionType =>
              TAG_RULE_TYPES.includes(t as TagRuleTransactionType)
            )
        ),
      ]
    : [];

  const amountMin = numberOrNull(source.amountMin);
  const amountMax = numberOrNull(source.amountMax);
  const dateFrom = isoDateOrNull(source.dateFrom);
  const dateTo = isoDateOrNull(source.dateTo);

  return {
    match: source.match === 'any' ? 'any' : 'all',
    types,
    categoryIds: idList(source.categoryIds),
    accountIds: idList(source.accountIds),
    description: str(source.description),
    descriptionMode: textMode(source.descriptionMode),
    counterparty: str(source.counterparty),
    counterpartyMode: textMode(source.counterpartyMode),
    notes: str(source.notes),
    notesMode: textMode(source.notesMode),
    meansOfPayment: str(source.meansOfPayment),
    meansOfPaymentMode: textMode(source.meansOfPaymentMode),
    // Swap inverted bounds instead of silently matching nothing — a user typing
    // "100 to 10" plainly means the 10–100 band.
    amountMin:
      amountMin !== null && amountMax !== null ? Math.min(amountMin, amountMax) : amountMin,
    amountMax:
      amountMin !== null && amountMax !== null ? Math.max(amountMin, amountMax) : amountMax,
    dateFrom: dateFrom !== null && dateTo !== null && dateFrom > dateTo ? dateTo : dateFrom,
    dateTo: dateFrom !== null && dateTo !== null && dateFrom > dateTo ? dateFrom : dateTo,
  };
}

/** True when no condition is populated — such a rule matches nothing. */
export function isTagRuleCriteriaEmpty(criteria: TagRuleCriteria): boolean {
  return (
    criteria.types.length === 0 &&
    criteria.categoryIds.length === 0 &&
    criteria.accountIds.length === 0 &&
    criteria.description === '' &&
    criteria.counterparty === '' &&
    criteria.notes === '' &&
    criteria.meansOfPayment === '' &&
    criteria.amountMin === null &&
    criteria.amountMax === null &&
    criteria.dateFrom === null &&
    criteria.dateTo === null
  );
}

/**
 * The part of a rule that may pre-filter the candidate scan, as a reduced criteria object —
 * or null when nothing can be pre-filtered.
 *
 * Both runtimes bound how much of the ledger one apply/preview examines (TAG_RULE_SCAN_LIMIT,
 * newest first). The Worker narrows that scan in SQL; the IndexedDB runtime narrows it in memory.
 * If the two narrowed by different conditions, they would examine different windows and — once a
 * ledger exceeds the cap — tag different rows. Defining the narrowable subset ONCE here keeps them
 * in step, and returning a `TagRuleCriteria` means callers evaluate it with the very same
 * `transactionMatchesTagRule`, so the pre-filter can never drift from the real matcher.
 *
 * Only the structural conditions qualify (type / category / account / date) — the text and amount
 * conditions are left to the full matcher. Narrowing is valid only under `match: 'all'`: under AND
 * any single condition may safely shrink the candidate set, whereas under OR none may.
 */
export function tagRuleScanNarrowing(criteria: TagRuleCriteria): TagRuleCriteria | null {
  if (criteria.match !== 'all') return null;
  const narrowed: TagRuleCriteria = {
    ...EMPTY_TAG_RULE_CRITERIA,
    match: 'all',
    types: criteria.types,
    categoryIds: criteria.categoryIds,
    accountIds: criteria.accountIds,
    dateFrom: criteria.dateFrom,
    dateTo: criteria.dateTo,
  };
  return isTagRuleCriteriaEmpty(narrowed) ? null : narrowed;
}

/** One populated condition of a rule, isolated so it can be counted on its own. */
export interface TagRuleCondition {
  /** Stable identifier for the condition (`description`, `categories`, …). */
  key: string;
  /** Human-readable label, e.g. `description contains "AWS"`. */
  label: string;
  /** The condition on its own, ready to hand to `transactionMatchesTagRule`. */
  criteria: TagRuleCriteria;
}

/**
 * Split a rule into its individual populated conditions.
 *
 * Exists so a preview can answer "why did my rule match nothing?". Under `match: 'all'` a single
 * unsatisfied condition silently zeroes the whole result, and the user has no way to tell which —
 * the common trap being a category or account chip left selected from an earlier edit. Counting
 * each condition separately turns that dead end into a diagnosis.
 *
 * Each returned condition is a full `TagRuleCriteria` with exactly one field populated, so callers
 * evaluate it with the very same `transactionMatchesTagRule` and the breakdown can never disagree
 * with the real result.
 */
export function splitTagRuleConditions(criteria: TagRuleCriteria): TagRuleCondition[] {
  const out: TagRuleCondition[] = [];
  const base = (): TagRuleCriteria => ({ ...EMPTY_TAG_RULE_CRITERIA, match: 'all' });
  const textLabel: Record<TagRuleTextMode, string> = {
    contains: 'contains',
    equals: 'is',
    starts_with: 'starts with',
    ends_with: 'ends with',
  };

  if (criteria.types.length) {
    out.push({
      key: 'types',
      label: `type is ${criteria.types.join(' or ')}`,
      criteria: { ...base(), types: criteria.types },
    });
  }
  if (criteria.categoryIds.length) {
    out.push({
      key: 'categories',
      label: `${criteria.categoryIds.length} selected category(s)`,
      criteria: { ...base(), categoryIds: criteria.categoryIds },
    });
  }
  if (criteria.accountIds.length) {
    out.push({
      key: 'accounts',
      label: `${criteria.accountIds.length} selected account(s)`,
      criteria: { ...base(), accountIds: criteria.accountIds },
    });
  }
  if (criteria.description) {
    out.push({
      key: 'description',
      label: `description ${textLabel[criteria.descriptionMode]} "${criteria.description}"`,
      criteria: {
        ...base(),
        description: criteria.description,
        descriptionMode: criteria.descriptionMode,
      },
    });
  }
  if (criteria.counterparty) {
    out.push({
      key: 'counterparty',
      label: `counterparty ${textLabel[criteria.counterpartyMode]} "${criteria.counterparty}"`,
      criteria: {
        ...base(),
        counterparty: criteria.counterparty,
        counterpartyMode: criteria.counterpartyMode,
      },
    });
  }
  if (criteria.notes) {
    out.push({
      key: 'notes',
      label: `notes ${textLabel[criteria.notesMode]} "${criteria.notes}"`,
      criteria: { ...base(), notes: criteria.notes, notesMode: criteria.notesMode },
    });
  }
  if (criteria.meansOfPayment) {
    out.push({
      key: 'meansOfPayment',
      label: `payment ${textLabel[criteria.meansOfPaymentMode]} "${criteria.meansOfPayment}"`,
      criteria: {
        ...base(),
        meansOfPayment: criteria.meansOfPayment,
        meansOfPaymentMode: criteria.meansOfPaymentMode,
      },
    });
  }
  if (criteria.amountMin !== null || criteria.amountMax !== null) {
    const label =
      criteria.amountMin !== null && criteria.amountMax !== null
        ? `amount ${criteria.amountMin}–${criteria.amountMax}`
        : criteria.amountMin !== null
          ? `amount ≥ ${criteria.amountMin}`
          : `amount ≤ ${criteria.amountMax}`;
    out.push({
      key: 'amount',
      label,
      criteria: { ...base(), amountMin: criteria.amountMin, amountMax: criteria.amountMax },
    });
  }
  if (criteria.dateFrom !== null || criteria.dateTo !== null) {
    const label =
      criteria.dateFrom && criteria.dateTo
        ? `${criteria.dateFrom} → ${criteria.dateTo}`
        : criteria.dateFrom
          ? `from ${criteria.dateFrom}`
          : `until ${criteria.dateTo}`;
    out.push({
      key: 'date',
      label,
      criteria: { ...base(), dateFrom: criteria.dateFrom, dateTo: criteria.dateTo },
    });
  }
  return out;
}

/** Human-readable one-line summary of a rule, for list rows and confirmation copy. */
export function describeTagRuleCriteria(criteria: TagRuleCriteria): string {
  const parts: string[] = [];
  const textLabel: Record<TagRuleTextMode, string> = {
    contains: 'contains',
    equals: 'is',
    starts_with: 'starts with',
    ends_with: 'ends with',
  };
  if (criteria.types.length) parts.push(`type is ${criteria.types.join(' or ')}`);
  if (criteria.categoryIds.length) parts.push(`${criteria.categoryIds.length} category(s)`);
  if (criteria.accountIds.length) parts.push(`${criteria.accountIds.length} account(s)`);
  if (criteria.description)
    parts.push(`description ${textLabel[criteria.descriptionMode]} "${criteria.description}"`);
  if (criteria.counterparty)
    parts.push(`counterparty ${textLabel[criteria.counterpartyMode]} "${criteria.counterparty}"`);
  if (criteria.notes) parts.push(`notes ${textLabel[criteria.notesMode]} "${criteria.notes}"`);
  if (criteria.meansOfPayment)
    parts.push(`payment ${textLabel[criteria.meansOfPaymentMode]} "${criteria.meansOfPayment}"`);
  if (criteria.amountMin !== null && criteria.amountMax !== null) {
    parts.push(`amount ${criteria.amountMin}–${criteria.amountMax}`);
  } else if (criteria.amountMin !== null) {
    parts.push(`amount ≥ ${criteria.amountMin}`);
  } else if (criteria.amountMax !== null) {
    parts.push(`amount ≤ ${criteria.amountMax}`);
  }
  if (criteria.dateFrom && criteria.dateTo) {
    parts.push(`${criteria.dateFrom} → ${criteria.dateTo}`);
  } else if (criteria.dateFrom) {
    parts.push(`from ${criteria.dateFrom}`);
  } else if (criteria.dateTo) {
    parts.push(`until ${criteria.dateTo}`);
  }
  if (!parts.length) return 'No conditions — matches nothing';
  return parts.join(criteria.match === 'any' ? ' OR ' : ' AND ');
}

function textMatches(haystack: string, needle: string, mode: TagRuleTextMode): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  switch (mode) {
    case 'equals':
      return h === n;
    case 'starts_with':
      return h.startsWith(n);
    case 'ends_with':
      return h.endsWith(n);
    default:
      return h.includes(n);
  }
}

function field(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : '';
}

function toId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Evaluate one rule against one transaction.
 *
 * Only populated conditions are evaluated. Under `match: 'all'` every populated condition must
 * pass; under `'any'` at least one must. A rule with no populated conditions returns false in
 * both modes.
 */
export function transactionMatchesTagRule(
  transaction: TagRuleTransaction,
  criteria: TagRuleCriteria
): boolean {
  if (isTagRuleCriteriaEmpty(criteria)) return false;
  const any = criteria.match === 'any';

  // Each entry is [conditionIsActive, conditionPassed].
  const checks: [boolean, boolean][] = [];

  if (criteria.types.length) {
    checks.push([
      true,
      criteria.types.includes(String(transaction.type) as TagRuleTransactionType),
    ]);
  }

  if (criteria.categoryIds.length) {
    const catId = toId(transaction.category_id);
    checks.push([true, catId !== null && criteria.categoryIds.includes(catId)]);
  }

  if (criteria.accountIds.length) {
    // Money moving in OR out of a selected account counts — a transfer's destination side is
    // just as much "this account's activity" as its source side.
    const acct = toId(transaction.account_id);
    const dest = toId(transaction.transfer_account_id);
    const hit =
      (acct !== null && criteria.accountIds.includes(acct)) ||
      (dest !== null && criteria.accountIds.includes(dest));
    checks.push([true, hit]);
  }

  if (criteria.description) {
    checks.push([
      true,
      textMatches(field(transaction.description), criteria.description, criteria.descriptionMode),
    ]);
  }

  if (criteria.counterparty) {
    const beneficiary = field(transaction.beneficiary);
    const payor = field(transaction.payor);
    checks.push([
      true,
      textMatches(beneficiary, criteria.counterparty, criteria.counterpartyMode) ||
        textMatches(payor, criteria.counterparty, criteria.counterpartyMode),
    ]);
  }

  if (criteria.notes) {
    checks.push([true, textMatches(field(transaction.notes), criteria.notes, criteria.notesMode)]);
  }

  if (criteria.meansOfPayment) {
    checks.push([
      true,
      textMatches(
        field(transaction.means_of_payment),
        criteria.meansOfPayment,
        criteria.meansOfPaymentMode
      ),
    ]);
  }

  if (criteria.amountMin !== null || criteria.amountMax !== null) {
    // Compare on the stored transaction amount, not the base-currency conversion: the user
    // types the number they saw on the statement.
    const raw = transaction.amount;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    const amount = Number.isFinite(parsed) ? Math.abs(parsed) : null;
    let pass = amount !== null;
    if (pass && criteria.amountMin !== null && (amount as number) < criteria.amountMin)
      pass = false;
    if (pass && criteria.amountMax !== null && (amount as number) > criteria.amountMax)
      pass = false;
    checks.push([true, pass]);
  }

  if (criteria.dateFrom !== null || criteria.dateTo !== null) {
    // Dates are stored as ISO YYYY-MM-DD, so lexical comparison is chronological. Slice off any
    // time component an imported row may carry.
    const date = field(transaction.date).slice(0, 10);
    let pass = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (pass && criteria.dateFrom !== null && date < criteria.dateFrom) pass = false;
    if (pass && criteria.dateTo !== null && date > criteria.dateTo) pass = false;
    checks.push([true, pass]);
  }

  if (!checks.length) return false;
  return any ? checks.some(([, passed]) => passed) : checks.every(([, passed]) => passed);
}

/** True when the transaction matches at least one of the supplied rules. */
export function transactionMatchesAnyTagRule(
  transaction: TagRuleTransaction,
  criteriaList: TagRuleCriteria[]
): boolean {
  return criteriaList.some((criteria) => transactionMatchesTagRule(transaction, criteria));
}
