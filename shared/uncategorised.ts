/**
 * An entry without a category, as every count of them reads it: circle 1 (guidance/facts.ts, for
 * the spending of the months it counts), Getting started and Your next step (orientation.ts, from
 * frontend/src/core/orientation.ts), the Transactions filter they link to, and the day-7 mail
 * (worker/src/weekOne.ts, which says the same in SQL).
 *
 * A transfer takes no category. An entry filed under a category its profile does not have has
 * none either: before #384 (July 2026) deleting a category in either runtime left its entries
 * pointing at it, and the list shows them with no category.
 */
export interface MaybeFiled {
  type?: string | null;
  category_id?: number | null;
}

export function isUncategorised(entry: MaybeFiled, has: (categoryId: number) => boolean): boolean {
  if (entry.type === 'transfer') return false;
  const id = entry.category_id;
  return typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !has(id);
}
