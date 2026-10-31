/**
 * Quick entry's guess (frontend/src/core/entry/parseEntry.ts) on the categories a cloud profile is
 * given: this runtime's defaults (src/profileData.ts), with Groceries and Eating out where Food
 * was. The hints go by a category's kind first, so the words that used to point at Food still find
 * a category. The local-first twin is frontend/src/core/entry/__tests__/parseEntry.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/profileData';
import { parseEntry } from '../../frontend/src/core/entry/parseEntry';
import type { ParseCategory } from '../../frontend/src/core/entry/parseEntry';

const DEFAULTS: ParseCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
  id: i + 1,
  name: c.name,
  type: c.type as 'income' | 'expense',
  kind: c.kind,
  parent_id: null,
}));

const guess = (text: string) =>
  parseEntry(text, { categories: DEFAULTS, today: '2026-07-13' }).categoryGuess;

describe("quick entry on the Worker's default categories", () => {
  it('guesses Eating out and Groceries for the words that mean them', () => {
    const eatingOut = [
      'coffee',
      'latte',
      'cafe',
      'lunch',
      'dinner',
      'breakfast',
      'restaurant',
      'snack',
      'meal',
    ];
    for (const word of eatingOut) expect(guess(`${word} 4.50`), word).toBe('Eating out');
    for (const word of ['grocery', 'groceries', 'food']) {
      expect(guess(`${word} 32`), word).toBe('Groceries');
    }
  });

  it('guesses the rest of the placeholder, and the other hints, as well', () => {
    expect(guess('groceries 32 yesterday')).toBe('Groceries');
    expect(guess('salary 3000')).toBe('Salary');
    expect(guess('uber 18')).toBe('Transportation');
    expect(guess('netflix 15.99')).toBe('Subscriptions');
  });
});
