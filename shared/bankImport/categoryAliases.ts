/**
 * Category names the built-in bank-import rules used to give, and the name each gives now.
 *
 * The Croatian rules shipped three names from one person's own books. A newcomer's first import
 * offered them as new categories, so a stranger's space filled with someone else's labels. The
 * rules now give the default category instead (categoryRules.ts).
 *
 * A space that already has a category under an old name made it from those rules, so it keeps
 * getting the rows there: an import files a row named 'Salary' under 'Salary Eur' when the space
 * has 'Salary Eur', even when it also has the default 'Salary' beside it, and never offers or
 * creates a second category. Both runtimes match through `profileCategoryKey`, at the one place
 * an import looks a row's category up in the space's categories: the local-first import handler
 * (frontend/src/core/storage/handlers/importFlow.ts) and the Worker's (worker/src/routes/imports.ts).
 *
 * Nothing is renamed in storage, and a rule set the user saved keeps the names it was saved with.
 *
 * Rules for this table:
 * - Keys are the old names, values the names the rules give now. Matching is case-blind.
 * - One old name per new name. Two old names on one new name could not be told apart again.
 * - An entry stays for good: spaces made from the old rules keep their categories.
 */
export const RETIRED_RULE_CATEGORY_NAMES: Readonly<Record<string, string>> = {
  'Salary Eur': 'Salary',
  'Apartment (Bills)': 'Utilities',
  'Car (Gas)': 'Transportation',
};

const fold = (name: string): string => name.trim().toLowerCase();

/** Folded new name to folded old name. */
const OLD_BY_NEW = new Map(
  Object.entries(RETIRED_RULE_CATEGORY_NAMES).map(([old, now]) => [fold(now), fold(old)])
);

/**
 * The folded (trimmed, lower-case) name to look a row's category up by among the space's
 * categories. `has` answers whether the space has a category under a folded name. The old name
 * wins when the space has it; otherwise the row's own name is the key.
 */
export function profileCategoryKey(name: string, has: (folded: string) => boolean): string {
  const folded = fold(name);
  const old = OLD_BY_NEW.get(folded);
  return old !== undefined && has(old) ? old : folded;
}
