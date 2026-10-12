/**
 * What an expense category holds: its kind, and whether it is needed every month.
 *
 * A kind is one of fifteen ids, the groups the official spending statistics publish (housing,
 * groceries, eating out and so on), so a person's spending can be set beside them whatever the
 * categories are called and in whatever language. Income, transfer and account categories take no
 * kind.
 *
 * Eight kinds are essential: what a month costs whatever happens. A person can say otherwise for
 * any one category ("Needed every month"); that choice is stored as `essential`, 1 or 0, and NULL
 * leaves it to the kind.
 *
 * A category stored without a kind still has one to go by, its effective kind: its own, else its
 * parent's, else a guess from its name (`kindForName`), else a guess from its parent's name. A
 * category with none of these counts as essential: it errs towards a larger cushion, and a card
 * can say how many categories it counted that way (`essentialOf`'s `via`).
 *
 * A category that holds transfers (`holdsTransfers`) holds money moved between accounts, not money
 * spent: what is filed under it is neither spending nor needed, whatever its kind.
 *
 * Pure, and used by both runtimes: the Worker stores kinds on the defaults and the categories an
 * import creates, and the app reads them.
 */

export const KINDS = [
  'housing',
  'utilities',
  'groceries',
  'eating_out',
  'transport',
  'health',
  'insurance',
  'childcare',
  'debt',
  'subscriptions',
  'shopping',
  'leisure',
  'gifts',
  'taxes',
  'other',
] as const;

export type Kind = (typeof KINDS)[number];

/** The words a form shows for each kind, in the order of `KINDS`. */
export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  housing: 'Housing',
  utilities: 'Utilities',
  groceries: 'Groceries',
  eating_out: 'Eating out',
  transport: 'Transport',
  health: 'Health',
  insurance: 'Insurance',
  childcare: 'Childcare and education',
  debt: 'Debt payments',
  subscriptions: 'Subscriptions',
  shopping: 'Shopping',
  leisure: 'Leisure',
  gifts: 'Gifts and money to people',
  taxes: 'Taxes and fees',
  other: 'Other',
};

/** The kinds a month costs whatever happens. */
export const ESSENTIAL_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'housing',
  'utilities',
  'groceries',
  'transport',
  'health',
  'insurance',
  'childcare',
  'debt',
]);

/** Whether `value` is one of the kinds, as stored. */
export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/** A kind as a body or a row gives it: one of the ids in any case, around any space; else null. */
export function readKind(raw: unknown): Kind | null {
  if (typeof raw !== 'string') return null;
  const kind = raw.trim().toLowerCase();
  return isKind(kind) ? kind : null;
}

/** Whether a category of `kind` is needed every month unless the person says otherwise. */
export function kindIsEssential(kind: Kind | null): boolean {
  return kind === null || ESSENTIAL_KINDS.has(kind);
}

/**
 * The names the app itself gives categories, and their kinds: the defaults of both runtimes, the
 * Food they used to have, and the names the bank import's rules file entries under
 * (shared/bankImport/categoryRules.ts). Transfers moves money between accounts and takes no kind.
 */
const NAMED: Readonly<Record<string, Kind | null>> = {
  // The defaults (worker/src/profileData.ts, frontend/src/core/storage/idb.ts).
  housing: 'housing',
  groceries: 'groceries',
  'eating out': 'eating_out',
  transportation: 'transport',
  utilities: 'utilities',
  healthcare: 'health',
  entertainment: 'leisure',
  insurance: 'insurance',
  shopping: 'shopping',
  education: 'childcare',
  subscriptions: 'subscriptions',
  gifts: 'gifts',
  // The default before Groceries and Eating out: it reads as groceries.
  food: 'groceries',
  // The bank import's rules.
  restaurant: 'eating_out',
  dining: 'eating_out',
  transport: 'transport',
  fuel: 'transport',
  'car (gas)': 'transport',
  health: 'health',
  travel: 'leisure',
  'apartment (bills)': 'utilities',
  'bank fees': 'taxes',
  transfers: null,
};

/**
 * Words that say what a name holds, tried in this order, each as a whole word. Eating out comes
 * before groceries so that "fast food" is eating out, and utilities before housing so that "home
 * internet" is a utility.
 */
const WORDS: readonly (readonly [Kind, RegExp])[] = [
  [
    'eating_out',
    /\b(restaurants?|dining|eating out|takeaways?|takeouts?|fast food|cafes?|coffee|lunch(es)?|dinners?)\b/,
  ],
  ['groceries', /\b(grocery|groceries|grocer|supermarkets?|food)\b/],
  [
    'utilities',
    /\b(utility|utilities|electricity|electric|water|energy|heating|internet|broadband|phones?|mobile)\b/,
  ],
  ['housing', /\b(rent|mortgage|housing|home|apartment|flat|house)\b/],
  ['insurance', /\b(insurance)\b/],
  [
    'transport',
    /\b(transport|transportation|fuel|petrol|diesel|car|cars|parking|taxis?|commute|commuting|train|trains|bus|buses|tolls?)\b/,
  ],
  [
    'health',
    /\b(health|healthcare|medical|medicine|doctors?|dentists?|dental|pharmacy|hospital|therapy)\b/,
  ],
  [
    'childcare',
    /\b(childcare|child care|daycare|nursery|kids|children|school|schooling|tuition|education)\b/,
  ],
  ['debt', /\b(loans?|debt|debts|repayments?)\b/],
  ['subscriptions', /\b(subscriptions?|streaming|memberships?)\b/],
  ['taxes', /\b(tax|taxes|fees?|charges)\b/],
  ['gifts', /\b(gifts?|presents?|donations?|charity)\b/],
  [
    'leisure',
    /\b(entertainment|leisure|travel|holidays?|vacations?|hobby|hobbies|sports?|gym|fun|movies|cinema|games?)\b/,
  ],
  ['shopping', /\b(shopping|clothes|clothing|electronics)\b/],
  ['other', /\b(other|misc|miscellaneous)\b/],
];

/**
 * The kind a category's name suggests, from English names: the app's own names first, then words
 * in the name. Null when the name says nothing a kind could be guessed from.
 */
export function kindForName(name: unknown): Kind | null {
  if (typeof name !== 'string') return null;
  // Accents go, so that "Café" reads as "cafe".
  const key = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (key === '') return null;
  if (Object.prototype.hasOwnProperty.call(NAMED, key)) return NAMED[key];
  for (const [kind, words] of WORDS) {
    if (words.test(key)) return kind;
  }
  return null;
}

/** A category as far as its kind goes: what both runtimes store, and what the app reads. */
export interface KindedCategory {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  kind?: unknown;
  essential?: unknown;
  parent_id?: unknown;
}

/** The category with that id, for a category's parent. */
export type CategoryLookup = (id: number) => KindedCategory | undefined;

/** A lookup over a list of categories, by id. */
export function categoryLookup(categories: readonly KindedCategory[]): CategoryLookup {
  const byId = new Map<number, KindedCategory>();
  for (const category of categories) {
    const id = Number(category.id);
    if (Number.isInteger(id)) byId.set(id, category);
  }
  return (id) => byId.get(id);
}

/** Whether a category of this type takes a kind: expense categories, and rows with no type. */
export function takesKind(type: unknown): boolean {
  return type === undefined || type === null || type === 'expense';
}

function parentOf(category: KindedCategory, lookup?: CategoryLookup): KindedCategory | undefined {
  const id = Number(category.parent_id);
  if (!lookup || category.parent_id === null || !Number.isInteger(id) || id <= 0) return undefined;
  const parent = lookup(id);
  return parent === category ? undefined : parent;
}

/**
 * The category names the bank import's rule sets file transfers under (shared/bankImport/
 * categoryRules.ts), as `transferNameKey` reads them. A transfer whose other account the import
 * cannot tell is filed by those rules like any other entry. Only the worldwide set has a transfers
 * category, Transfers. The Croatian set has none: such a transfer goes where its words match, else
 * under Other, and counts as spending there.
 */
export const TRANSFER_CATEGORY_NAMES: readonly string[] = ['transfers'];

/** A name with accents and case gone, and anything but letters and digits as one space. */
function transferNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether a category is itself one of transfers: by its type, or by its name. */
function namesTransfers(category: KindedCategory): boolean {
  if (category.type === 'transfer' || category.type === 'account') return true;
  return (
    typeof category.name === 'string' &&
    TRANSFER_CATEGORY_NAMES.includes(transferNameKey(category.name))
  );
}

/**
 * Whether entries filed under `category` move money between accounts instead of paying anyone: a
 * transfer or account category, one the bank import files transfers under, or one filed inside
 * either, as a category goes by its parent's kind. An expense filed under one is money moved, not
 * spent: the guidance counts it neither as spending nor as needed (facts.ts), whatever the person
 * chose for the category, and the recurring-payment finder never proposes it.
 */
export function holdsTransfers(
  category: KindedCategory | undefined,
  lookup?: CategoryLookup
): boolean {
  if (category === undefined) return false;
  if (namesTransfers(category)) return true;
  const parent = parentOf(category, lookup);
  return parent !== undefined && namesTransfers(parent);
}

/**
 * The kind a category goes by: its own, else its parent's, else the one its name suggests, else
 * the one its parent's name suggests. Null for a category that takes no kind, and for one nothing
 * suggests a kind for.
 */
export function effectiveKind(category: KindedCategory, lookup?: CategoryLookup): Kind | null {
  if (!takesKind(category.type)) return null;
  const parent = parentOf(category, lookup);
  return (
    readKind(category.kind) ??
    readKind(parent?.kind) ??
    kindForName(category.name) ??
    kindForName(parent?.name)
  );
}

/** A stored `essential`: 1 or 0 in D1, also read as true or false; null when the kind decides. */
export function readEssential(raw: unknown): boolean | null {
  if (raw === 1 || raw === true || raw === '1' || raw === 'true') return true;
  if (raw === 0 || raw === false || raw === '0' || raw === 'false') return false;
  return null;
}

/**
 * Why a category counts as essential or not: the person chose (`chosen`), its kind decides
 * (`kind`), or nothing says, and it counts as essential (`no-kind`).
 */
export type EssentialVia = 'chosen' | 'kind' | 'no-kind';

/** Whether a category is needed every month, the kind it goes by, and why. */
export function essentialOf(
  category: KindedCategory,
  lookup?: CategoryLookup
): { essential: boolean; kind: Kind | null; via: EssentialVia } {
  const kind = effectiveKind(category, lookup);
  const chosen = readEssential(category.essential);
  if (chosen !== null) return { essential: chosen, kind, via: 'chosen' };
  if (kind !== null) return { essential: ESSENTIAL_KINDS.has(kind), kind, via: 'kind' };
  return { essential: true, kind: null, via: 'no-kind' };
}

/** Whether a category is needed every month (`essentialOf`). */
export function isEssential(category: KindedCategory, lookup?: CategoryLookup): boolean {
  return essentialOf(category, lookup).essential;
}
