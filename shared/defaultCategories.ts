/**
 * What "Reset to defaults" does with a category one of the defaults replaced.
 *
 * Both runtimes keep their own list of default categories (worker/src/profileData.ts and
 * frontend/src/core/storage/idb.ts), and a reset matches a profile's categories to it by name: a
 * match is kept and set back to the default, entries and all, and every other category goes. Food
 * was a default until Groceries and Eating out took its place. Matched by name alone, a reset would
 * delete it and leave its entries without a category; it renames it to Groceries instead, which is
 * what it held for most people.
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
