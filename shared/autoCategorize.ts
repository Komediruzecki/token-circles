/**
 * The category auto-map suggests for an uncategorised transaction, the same in both runtimes.
 *
 * Moved from the Worker's POST /api/categories/auto-map (a port of the Express server's), so the
 * local-first router suggests what the Worker does rather than filing rows by its own keyword lists
 * (docs/plans/2026-10-07-form-errors.md, slice 4b). The rules, in order, keeping the best score:
 *
 * 1. The profile's learned mappings: a pattern found in the transaction's text scores its
 *    confidence, raised by how often it was used, up to half again.
 * 2. When nothing scored 0.8: the merchant dictionary below, for the profile's category of that
 *    name.
 * 3. When nothing scored 0.6: a category whose name holds a word of the transaction's text, scored
 *    by how much of the text it holds, up to 0.5.
 *
 * Text is compared in matching form, lower case letters and digits only.
 */

/** A category auto-map may suggest. */
export interface MatchCategory {
  id: number;
  name: string;
  color: string | null;
  type?: string | null;
}

/** A learned mapping, as stored. */
export interface LearnedMapping {
  id: number;
  pattern: string;
  category_id: number;
  confidence: number;
  use_count: number;
}

/** The text auto-map reads from a transaction. */
export interface MatchTransaction {
  description?: unknown;
  beneficiary?: unknown;
  payor?: unknown;
}

/** What auto-map suggests for one transaction. */
export interface CategorySuggestion {
  category_id: number;
  category_name: string;
  category_color: string | null;
  confidence: number;
}

// Built-in merchant dictionary (50+ common merchants), copied verbatim from
// backend/routes/categories.js.
export const MERCHANT_DICTIONARY: { pattern: string; category: string; confidence: number }[] = [
  // Streaming
  { pattern: 'netflix', category: 'Streaming', confidence: 0.95 },
  { pattern: 'spotify', category: 'Streaming', confidence: 0.95 },
  { pattern: 'youtube', category: 'Streaming', confidence: 0.9 },
  { pattern: 'disney+', category: 'Streaming', confidence: 0.95 },
  { pattern: 'hulu', category: 'Streaming', confidence: 0.95 },
  { pattern: 'apple tv', category: 'Streaming', confidence: 0.9 },
  { pattern: 'hbo', category: 'Streaming', confidence: 0.9 },
  { pattern: 'prime video', category: 'Streaming', confidence: 0.95 },
  // Shopping
  { pattern: 'amazon', category: 'Shopping', confidence: 0.9 },
  { pattern: 'ebay', category: 'Shopping', confidence: 0.95 },
  { pattern: 'walmart', category: 'Shopping', confidence: 0.95 },
  { pattern: 'target', category: 'Shopping', confidence: 0.95 },
  { pattern: 'costco', category: 'Shopping', confidence: 0.95 },
  { pattern: 'ikea', category: 'Shopping', confidence: 0.95 },
  { pattern: 'zara', category: 'Shopping', confidence: 0.95 },
  { pattern: 'h&m', category: 'Shopping', confidence: 0.95 },
  { pattern: 'macy', category: 'Shopping', confidence: 0.95 },
  // Food & Grocery
  { pattern: 'walmart grocery', category: 'Groceries', confidence: 0.95 },
  { pattern: 'costco', category: 'Groceries', confidence: 0.95 },
  { pattern: 'trader joe', category: 'Groceries', confidence: 0.95 },
  { pattern: 'whole foods', category: 'Groceries', confidence: 0.95 },
  { pattern: 'target grocery', category: 'Groceries', confidence: 0.95 },
  { pattern: 'kroger', category: 'Groceries', confidence: 0.9 },
  { pattern: 'safeway', category: 'Groceries', confidence: 0.9 },
  { pattern: 'albertsons', category: 'Groceries', confidence: 0.9 },
  { pattern: 'stop & shop', category: 'Groceries', confidence: 0.9 },
  { pattern: 'publix', category: 'Groceries', confidence: 0.9 },
  { pattern: 'whole foods market', category: 'Groceries', confidence: 0.95 },
  { pattern: 'sams club', category: 'Groceries', confidence: 0.9 },
  // Dining
  { pattern: 'starbucks', category: 'Dining', confidence: 0.95 },
  { pattern: 'mcdonalds', category: 'Dining', confidence: 0.95 },
  { pattern: 'burger king', category: 'Dining', confidence: 0.9 },
  { pattern: 'wendy', category: 'Dining', confidence: 0.9 },
  { pattern: 'taco bell', category: 'Dining', confidence: 0.9 },
  { pattern: 'pizza hut', category: 'Dining', confidence: 0.9 },
  { pattern: 'dominos', category: 'Dining', confidence: 0.9 },
  { pattern: 'subway', category: 'Dining', confidence: 0.9 },
  { pattern: 'panera', category: 'Dining', confidence: 0.9 },
  { pattern: 'chipotle', category: 'Dining', confidence: 0.9 },
  { pattern: 'chipotle mexican grill', category: 'Dining', confidence: 0.9 },
  { pattern: 'dunkin', category: 'Dining', confidence: 0.9 },
  { pattern: 'krispy kreme', category: 'Dining', confidence: 0.85 },
  { pattern: 'dunkin donuts', category: 'Dining', confidence: 0.85 },
  { pattern: 'starbucks coffee', category: 'Dining', confidence: 0.9 },
  { pattern: 'cafe', category: 'Dining', confidence: 0.85 },
  { pattern: 'restaurant', category: 'Dining', confidence: 0.85 },
  { pattern: 'dinner', category: 'Dining', confidence: 0.85 },
  { pattern: 'lunch', category: 'Dining', confidence: 0.85 },
  { pattern: 'breakfast', category: 'Dining', confidence: 0.85 },
  { pattern: 'brunch', category: 'Dining', confidence: 0.85 },
  { pattern: 'cafe coffee', category: 'Dining', confidence: 0.85 },
  // Utilities
  { pattern: 'electric', category: 'Utilities', confidence: 0.95 },
  { pattern: 'power', category: 'Utilities', confidence: 0.9 },
  { pattern: 'gas bill', category: 'Utilities', confidence: 0.9 },
  { pattern: 'gas', category: 'Utilities', confidence: 0.9 },
  { pattern: 'water bill', category: 'Utilities', confidence: 0.9 },
  { pattern: 'water', category: 'Utilities', confidence: 0.9 },
  { pattern: 'internet', category: 'Utilities', confidence: 0.85 },
  { pattern: 'phone', category: 'Utilities', confidence: 0.85 },
  { pattern: 'mobile', category: 'Utilities', confidence: 0.85 },
  { pattern: 'at&t', category: 'Utilities', confidence: 0.9 },
  { pattern: 'verizon', category: 'Utilities', confidence: 0.9 },
  { pattern: 't-mobile', category: 'Utilities', confidence: 0.9 },
  // Healthcare
  { pattern: 'pharmacy', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'cvs', category: 'Healthcare', confidence: 0.95 },
  { pattern: 'walgreens', category: 'Healthcare', confidence: 0.95 },
  { pattern: 'hospital', category: 'Healthcare', confidence: 0.9 },
  { pattern: 'doctor', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'clinic', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'dental', category: 'Healthcare', confidence: 0.9 },
  { pattern: 'optometrist', category: 'Healthcare', confidence: 0.9 },
  // Entertainment
  { pattern: 'cinema', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'theater', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'concert', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'ticketmaster', category: 'Entertainment', confidence: 0.95 },
  { pattern: 'steam', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'playstation', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'xbox', category: 'Entertainment', confidence: 0.9 },
  // Housing
  { pattern: 'rent', category: 'Housing', confidence: 0.95 },
  { pattern: 'mortgage', category: 'Housing', confidence: 0.95 },
  { pattern: 'hoa', category: 'Housing', confidence: 0.9 },
  { pattern: 'insurance', category: 'Housing', confidence: 0.7 },
  // Income
  { pattern: 'payroll', category: 'Salary', confidence: 0.95 },
  { pattern: 'salary', category: 'Salary', confidence: 0.95 },
  { pattern: 'direct deposit', category: 'Salary', confidence: 0.9 },
  { pattern: 'freelance', category: 'Freelance', confidence: 0.9 },
  { pattern: 'dividend', category: 'Investments', confidence: 0.95 },
  { pattern: 'interest', category: 'Investments', confidence: 0.9 },
];

/** Text in matching form: lower case letters and digits only. */
export function matchingForm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The categories in the order the Worker reads them (by type, then name), which decides between
 * two that score the same: the first one wins.
 */
function byTypeThenName(a: MatchCategory, b: MatchCategory): number {
  const type = (a.type ?? '') < (b.type ?? '') ? -1 : (a.type ?? '') > (b.type ?? '') ? 1 : 0;
  if (type !== 0) return type;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id;
}

/**
 * The category auto-map suggests for this transaction, or null for none. `categories` and
 * `learned` are the profile's; their order does not matter.
 */
export function suggestCategory(
  transaction: MatchTransaction,
  categories: readonly MatchCategory[],
  learned: readonly LearnedMapping[]
): CategorySuggestion | null {
  const ordered = [...categories].sort(byTypeThenName);
  const mappings = [...learned].sort((a, b) => a.id - b.id);
  const searchText =
    `${text(transaction.description)} ${text(transaction.beneficiary)} ${text(transaction.payor)}`.toLowerCase();
  const normalizedSearch = matchingForm(searchText);

  let bestMatch: CategorySuggestion | null = null;
  let bestScore = 0;
  const suggest = (category: MatchCategory, confidence: number): CategorySuggestion => ({
    category_id: category.id,
    category_name: category.name,
    category_color: category.color,
    confidence,
  });

  // 1. Learned mappings first (highest priority, boosted by use_count).
  for (const mapping of mappings) {
    if (normalizedSearch.includes(matchingForm(mapping.pattern))) {
      const score = mapping.confidence * Math.min(1 + Math.log10(mapping.use_count + 1) * 0.2, 1.5);
      if (score > bestScore) {
        bestScore = score;
        const category = ordered.find((c) => c.id === mapping.category_id);
        if (category) bestMatch = suggest(category, score);
      }
    }
  }

  // 2. The merchant dictionary.
  if (!bestMatch || bestScore < 0.8) {
    for (const merchant of MERCHANT_DICTIONARY) {
      if (normalizedSearch.includes(matchingForm(merchant.pattern))) {
        if (merchant.confidence > bestScore) {
          bestScore = merchant.confidence;
          const category = ordered.find(
            (c) => c.name.toLowerCase() === merchant.category.toLowerCase()
          );
          if (category) bestMatch = suggest(category, merchant.confidence);
        }
      }
    }
  }

  // 3. Words of the text that a category's name holds.
  if (!bestMatch || bestScore < 0.6) {
    const searchTokens = normalizedSearch.split(/[0-9]+/).filter((t) => t.length > 2);
    for (const category of ordered) {
      const name = category.name.toLowerCase();
      const categoryTokens = name.split(/[^a-z]+/).filter((t) => t.length > 2);
      let matches = 0;
      for (const token of searchTokens) {
        if (name.includes(token)) matches++;
      }
      if (matches > 0) {
        const score = (matches / Math.max(searchTokens.length, categoryTokens.length)) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = suggest(category, score);
        }
      }
    }
  }

  return bestMatch ? { ...bestMatch, confidence: Math.min(bestMatch.confidence, 1) } : null;
}
