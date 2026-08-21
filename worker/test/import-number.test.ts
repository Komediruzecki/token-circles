import { describe, expect, it } from 'vitest';
import { parseImportNumber } from '../src/import-number';

describe('parseImportNumber', () => {
  it.each([
    ['2,468.13', 2468.13],
    ['2.468,13', 2468.13],
    ['1,234,567.89', 1234567.89],
    ['1.234.567,89', 1234567.89],
    ['1234,56', 1234.56],
    ['1 234,56', 1234.56],
    ['1 234 567,89', 1234567.89],
    ['1\u202f234.56', 1234.56],
    ['-1.234,56', -1234.56],
    ['(1,234.56)', -1234.56],
    [' 42.50 ', 42.5],
    [1234.56, 1234.56],
  ])('parses %j', (input, expected) => {
    expect(parseImportNumber(input)).toBeCloseTo(expected as number, 8);
  });

  // A lone separator is a decimal point now, so these parse rather than reject — see
  // shared/importNumber.ts. They carry the `ambiguous-separator` flag, which the import surfaces.
  it.each([
    ['1,234', 1.23],
    ['1.234', 1.23],
    ['12,345', 12.35],
    ['1.000', 1],
    ['754.312', 754.31],
  ])('reads a lone separator as a decimal point: %j', (input, expected) => {
    expect(parseImportNumber(input as string)).toBeCloseTo(expected as number, 8);
  });

  it.each([
    '',
    'abc',
    '1,2,3',
    '1,23,456',
    '1.234,567.89',
    '1  234',
    '12 34',
    'Infinity',
    '(-1,234.56)',
  ])('rejects ambiguous or invalid %j', (input) => {
    expect(parseImportNumber(input)).toBeNull();
  });
});
