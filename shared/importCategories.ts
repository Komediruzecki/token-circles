/**
 * Which category an imported row files under, and which categories an import makes for its rows.
 * One rule for both runtimes (worker/src/routes/imports.ts and
 * frontend/src/core/storage/handlers/importFlow.ts).
 *
 * A row's category is matched by name and by type. Every new profile starts with the income
 * categories Gifts and Investments, and matched by name alone, an expense row under "Gifts" (a
 * present bought) went into income Gifts, and no expense category was made for it.
 *
 * - An expense row files under the expense category of its name, made if there is none.
 * - An income row files under the income category of its name. With none, it files under the
 *   expense category of that name, as money back: a refund in Groceries is Groceries' too
 *   (shared/guidance/facts.ts reads it so). An income category is made only when no category of
 *   either type has the name, in the profile or in this import.
 * - A transfer row's category is read by name alone, as before.
 *
 * Names match without case or surrounding spaces, as the import has always matched them.
 */

export interface ImportCategory {
  name: string;
  type?: string | null;
}

/** A row's category value and its type, as the import worked the type out. */
export interface TypedCategoryValue {
  name: string;
  type: string;
}

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

/** The category a row of `rowType` with category value `name` files under, if one exists. */
export function categoryForImportRow<T extends ImportCategory>(
  categories: readonly T[],
  name: string,
  rowType: string
): T | undefined {
  const key = keyOf(name);
  if (key === '') return undefined;
  const named = categories.filter((category) => keyOf(category.name) === key);
  if (rowType === 'expense') return named.find((category) => category.type === 'expense');
  if (rowType === 'income') {
    return (
      named.find((category) => category.type === 'income') ??
      named.find((category) => category.type === 'expense')
    );
  }
  return named[0];
}

/**
 * The categories an import makes for `rows`, each once, named as the first row spells it: the
 * expense categories first, so an income row in the same import files under an expense category
 * the import makes rather than getting one of its own. Transfer rows make none here.
 */
export function categoriesToMake(
  existing: readonly ImportCategory[],
  rows: readonly TypedCategoryValue[]
): TypedCategoryValue[] {
  const known: ImportCategory[] = [...existing];
  const made: TypedCategoryValue[] = [];
  for (const type of ['expense', 'income'] as const) {
    for (const row of rows) {
      const name = row.name.trim();
      if (row.type !== type || name === '') continue;
      if (categoryForImportRow(known, name, type) !== undefined) continue;
      known.push({ name, type });
      made.push({ name, type });
    }
  }
  return made;
}
