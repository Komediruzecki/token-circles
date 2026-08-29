/**
 * The gate that stops an unattended import from committing garbage.
 *
 * It matters because parseDateString (routes/imports.ts) falls back to TODAY for anything it
 * cannot read -- so without this check, a mis-detected date column imports as a heap of
 * transactions dated today and nothing looks wrong until someone opens the ledger.
 */
import { describe, expect, it } from 'vitest';
import { assessImport, MIN_PARSE_RATE } from '../src/import-gate';

const mapping = { date: 0, description: 1, amount: 2 };

describe('assessImport', () => {
  it('passes a clean table', () => {
    const rows = [
      ['2026-01-05', 'Coffee', '-3.20'],
      ['06/01/2026', 'Salary', '2400,00'],
      ['2026-01-07', 'Rent', '-900'],
    ];
    const r = assessImport(rows, mapping);
    expect(r.ok).toBe(true);
    expect(r.dateParseRate).toBe(1);
    expect(r.amountParseRate).toBe(1);
    expect(r.failing).toEqual([]);
  });

  it('refuses when the date column is not dates, and names the rows', () => {
    const rows = [
      ['not a date', 'A', '1.00'],
      ['also not', 'B', '2.00'],
      ['2026-01-07', 'C', '3.00'],
    ];
    const r = assessImport(rows, mapping);
    expect(r.ok).toBe(false);
    expect(r.dateParseRate).toBeCloseTo(1 / 3);
    expect(r.reason).toContain('date');
    expect(r.failing).toHaveLength(2);
    expect(r.failing[0]).toMatchObject({ row: 1, date: 'not a date' });
  });

  it('refuses when amounts are not numbers', () => {
    const rows = [
      ['2026-01-05', 'A', 'n/a'],
      ['2026-01-06', 'B', 'pending'],
      ['2026-01-07', 'C', '3.00'],
    ];
    const r = assessImport(rows, mapping);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('amount');
  });

  it('refuses a table with no rows, and one missing a required mapping', () => {
    expect(assessImport([], mapping).ok).toBe(false);
    expect(assessImport([['2026-01-05', 'A', '1']], { description: 1 }).ok).toBe(false);
    expect(assessImport([['2026-01-05', 'A', '1']], { description: 1 }).reason).toContain('mapped');
  });

  it('accepts exactly at the threshold, refuses just under it', () => {
    const good = (i: number): string[] => [
      `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      'x',
      '1.00',
    ];
    const bad = (): string[] => ['zzz', 'x', '1.00'];

    const at = [
      ...Array.from({ length: 95 }, (_, i) => good(i)),
      ...Array.from({ length: 5 }, bad),
    ];
    expect(assessImport(at, mapping).dateParseRate).toBeCloseTo(MIN_PARSE_RATE);
    expect(assessImport(at, mapping).ok).toBe(true);

    const under = [
      ...Array.from({ length: 94 }, (_, i) => good(i)),
      ...Array.from({ length: 6 }, bad),
    ];
    expect(assessImport(under, mapping).ok).toBe(false);
  });

  it('rejects a reference number that JS Date would happily read as a year', () => {
    // new Date('REF-88213') is not Invalid Date -- it is 1 Jan 88213. A bank statement whose
    // first column is a reference number must not pass the gate on that technicality.
    expect(new Date('REF-88213').getTime()).not.toBeNaN(); // documents the trap
    const rows = [
      ['REF-88213', 'Coffee', '-3.20'],
      ['REF-88214', 'Rent', '-900.00'],
    ];
    const r = assessImport(rows, mapping);
    expect(r.ok).toBe(false);
    expect(r.dateParseRate).toBe(0);
    expect(r.reason).toContain('date');
  });

  it('caps the failing sample so a wholly broken file cannot return 10000 rows', () => {
    const rows = Array.from({ length: 500 }, () => ['zzz', 'x', 'nope']);
    expect(assessImport(rows, mapping).failing).toHaveLength(10);
  });
});
