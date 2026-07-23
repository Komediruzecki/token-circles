import { describe, expect, it } from 'vitest';
import { parseImportNumber } from '../src/import-number';

describe('parseImportNumber', () => {
  it.each([
    ['3,177.94', 3177.94],
    ['3.177,94', 3177.94],
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

  it.each([
    '1,234',
    '1.234',
    '12,345',
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
