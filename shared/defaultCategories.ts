/**
 * What "Reset to defaults" does with a category one of the defaults replaced.
 *
 * Both runtimes keep their own list of default categories (worker/src/profileData.ts and
 * frontend/src/core/storage/idb.ts), and a reset matches a profile's categories to it by name: a
 * match is kept and set back to the default, entries and all, and every other category goes. Food
 * was a default until Groceries and Eating out took its place. Matched by name alone, a reset would
 * delete it and leave its entries without a category; it renames it to Groceries instead, which is
 * what it held for most people.
 *
 * A reset sets a kept default back to the default, icon and all, except an icon the person chose
 * for Food: Food renamed is still their category (`resetKeepsIcon`).
 */

/** Each replaced default, by its lowercased name, and the lowercased default that took its place. */
export const REPLACED_DEFAULTS: Readonly<Record<string, string>> = { food: 'groceries' };

/**
 * The lowercased name of the default a category of this name is reset to: its replacement, for a
 * replaced default; else its own name, trimmed and lowercased.
 */
export function resetName(name: string): string {
  const key = name.trim().toLocaleLowerCase();
  return Object.prototype.hasOwnProperty.call(REPLACED_DEFAULTS, key)
    ? REPLACED_DEFAULTS[key]
    : key;
}

/** The icon each replaced default had by default, by its lowercased name. */
const REPLACED_DEFAULT_ICONS: Readonly<Record<string, string>> = { food: 'utensils' };

/** The icon values stored when nobody chose one (frontend/src/components/CategoryIcon.tsx). */
const UNCHOSEN_ICONS = new Set(['', 'tag', 'folder']);

/**
 * Whether a reset keeps this category's icon as it renames it to the default that replaced it: an
 * icon the person chose for Food stays. Food's old default icon, or none, becomes the new
 * default's. A category matched by its own name is set back to the default's icon.
 */
export function resetKeepsIcon(name: string, icon: string | null | undefined): boolean {
  const key = name.trim().toLocaleLowerCase();
  if (!Object.prototype.hasOwnProperty.call(REPLACED_DEFAULT_ICONS, key)) return false;
  const value = (icon ?? '').trim();
  return !UNCHOSEN_ICONS.has(value) && value !== REPLACED_DEFAULT_ICONS[key];
}

/** A category as the reset reads it. */
export interface ResetCategory {
  id: number;
  name: string;
  type?: string | null;
}

/** A default category as the reset reads it. */
export interface ResetDefault {
  name: string;
  type: string;
}

/**
 * What "Reset to defaults" does with each of a profile's categories.
 *
 * - `kept`: the category each default is set back to, by the default's lowercased name: the
 *   lowest-id one of its reset name and the default's type, or with none of that type, the
 *   lowest-id one of that name, so a default whose type was changed comes back as it was.
 * - `removed`: every other category, with where its entries go: into the kept one of its name when
 *   it has the default's type (a Groceries of the person's own beside Food), and otherwise into no
 *   category, as for any category that is no default. An expense Gifts an import made beside the
 *   income Gifts is not the income one's: matched by name alone, its expenses moved into income.
 *
 * Both runtimes reset by it (worker/src/profileData.ts, frontend/src/core/storage/idb.ts).
 */
export function planCategoryReset(
  existing: readonly ResetCategory[],
  defaults: readonly ResetDefault[]
): { kept: Map<string, number>; removed: Map<number, number | null> } {
  const byId = [...existing].sort((a, b) => a.id - b.id);
  const defaultOf = new Map(defaults.map((one) => [one.name.toLocaleLowerCase(), one]));
  const kept = new Map<string, number>();
  for (const [key, one] of defaultOf) {
    const named = byId.filter((category) => resetName(String(category.name ?? '')) === key);
    const canonical = named.find((category) => category.type === one.type) ?? named[0];
    if (canonical) kept.set(key, canonical.id);
  }
  const keptIds = new Set(kept.values());
  const removed = new Map<number, number | null>();
  for (const category of byId) {
    if (keptIds.has(category.id)) continue;
    const key = resetName(String(category.name ?? ''));
    const one = defaultOf.get(key);
    const into = one && category.type === one.type ? kept.get(key) : undefined;
    removed.set(category.id, into ?? null);
  }
  return { kept, removed };
}
