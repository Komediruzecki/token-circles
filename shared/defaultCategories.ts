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
