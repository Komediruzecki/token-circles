/**
 * Parsing for imported financial values.
 *
 * There is no library that solves this. Every candidate (numbro, currency.js, dinero.js,
 * parse-decimal-number) either wants the source locale declared up front or applies the same
 * guesswork — because the hard part isn't parsing, it's that `1.234` is genuinely 1234 in one
 * locale and 1.234 in another, and the string alone cannot say which. Import files don't carry a
 * locale, so a documented heuristic is the honest answer, and it lives here rather than in two
 * hand-copies (the Worker's and the frontend's were byte-identical apart from a doc comment).
 *
 * The rules, in order:
 *
 *   1,234.56  both separators   → the LAST one is the decimal point, the rest are grouping
 *   1.234.567 one char, repeated → all grouping, so an integer
 *   1.234     exactly one       → a decimal point. Always.
 *   1234      none              → an integer
 *
 * Rule 3 is a deliberate money-shaped choice: prices carry cents, so a lone separator is far more
 * often "euros and cents" than thousands. It is also the rule that can be wrong — `1.000` written
 * as European thousands means 1000, and this reads it as 1.00. That case is exactly the shape
 * flagged `ambiguous-separator`, so the import can put it in front of the user instead of quietly
 * losing three orders of magnitude.
 *
 * Fractions longer than two digits are rounded to two and flagged `rounded`; money has cents, and
 * the extra digits are conversion residue.
 */

/** Why a parsed value deserves the user's attention even though it parsed. */
export type ImportNumberFlag =
  /** A lone separator with exactly three digits after it — decimal here, but could be grouping. */
  | 'ambiguous-separator'
  /** More than two decimal places; rounded to cents. */
  | 'rounded';

export interface ImportNumberResult {
  /** The parsed value, or null when the text isn't a number at all. */
  value: number | null;
  flags: ImportNumberFlag[];
}

const SPACE_GROUP = /[\u0020\u00a0\u202f]/;
const CENTS = 2;

function isDigits(value: string): boolean {
  if (!value) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/**
 * Digits with optional grouping — `1 234`, `1.234.567`, or plain `1234`.
 * Returns the digits alone, or null when the grouping is malformed (`1,2,3`, `12 34`, `1  234`).
 * Grouping structure is still validated strictly: relaxing which separator means "decimal" is a
 * deliberate change; accepting nonsense is not.
 */
function ungroup(text: string, separators: RegExp): string | null {
  if (!separators.test(text)) return isDigits(text) ? text : null;
  const groups = text.split(separators);
  const first = groups[0]!;
  if (!isDigits(first) || first.length > 3) return null;
  if (!groups.slice(1).every((group) => group.length === 3 && isDigits(group))) return null;
  return groups.join('');
}

/** Round to cents without binary-floating-point drift (0.145 must not fall to 0.14). */
function roundToCents(whole: string, fraction: string): number {
  if (fraction.length <= CENTS) return Number(`${whole}.${fraction.padEnd(CENTS, '0')}`);
  const keep = fraction.slice(0, CENTS);
  const next = fraction.charCodeAt(CENTS) - 48;
  const scaled = Number(`${whole}${keep}`) + (next >= 5 ? 1 : 0);
  return scaled / 100;
}

/** A separator class combining the literal char with the space group. */
function groupPattern(char?: string): RegExp {
  return char ? new RegExp(`[\\u0020\\u00a0\\u202f\\${char}]`) : SPACE_GROUP;
}

/**
 * Did rounding to cents actually change the amount?
 *
 * Not the same question as "were there more than two decimal digits". A spreadsheet that
 * multiplies to convert a currency stores binary-float residue — 67.60000000000001, 23.400000000000002
 * — in hundreds of rows. Rounding those to 67.60 loses nothing and is not worth a word to the
 * user; rounding 754.312 to 754.31 is. Half a cent separates the two cleanly.
 */
function movedACent(value: number, rounded: number): boolean {
  return Math.abs(value - rounded) >= 0.0005;
}

const fail: ImportNumberResult = { value: null, flags: [] };

/**
 * Parse an imported money string, reporting anything the user should look at.
 * Returns `value: null` only when the text is not a number.
 */
export function parseImportNumberDetailed(value: unknown): ImportNumberResult {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail;
    const rounded = Math.round(value * 100) / 100;
    return { value: rounded, flags: movedACent(value, rounded) ? ['rounded'] : [] };
  }
  if (typeof value !== 'string') return fail;

  let source = value.trim().replace(/\u2212/g, '-');
  if (!source) return fail;

  let negative = false;
  let accountingNegative = false;
  if (source.startsWith('(') && source.endsWith(')')) {
    accountingNegative = true;
    negative = true;
    source = source.slice(1, -1).trim();
  }
  if (source.startsWith('+') || source.startsWith('-')) {
    if (accountingNegative) return fail;
    negative = source[0] === '-';
    source = source.slice(1);
  }
  if (!source || /[()+-]/.test(source)) return fail;

  const dots = (source.match(/\./g) || []).length;
  const commas = (source.match(/,/g) || []).length;
  const flags: ImportNumberFlag[] = [];

  let integerPart: string;
  let fraction: string;
  let grouping: RegExp;

  if (dots > 0 && commas > 0) {
    // Both present: whichever appears last is the decimal point, the other groups.
    const decimalIndex = Math.max(source.lastIndexOf('.'), source.lastIndexOf(','));
    const decimalSeparator = source[decimalIndex]!;
    integerPart = source.slice(0, decimalIndex);
    fraction = source.slice(decimalIndex + 1);
    // The decimal character may not appear again earlier — `1.234,567.89` names no real number.
    if (integerPart.includes(decimalSeparator)) return fail;
    grouping = groupPattern(decimalSeparator === '.' ? ',' : '.');
  } else if (dots > 1 || commas > 1) {
    // One character, used repeatedly: grouping, so there is no fractional part.
    integerPart = source;
    fraction = '';
    grouping = groupPattern(dots > 1 ? '.' : ',');
  } else if (dots === 1 || commas === 1) {
    const separator = dots === 1 ? '.' : ',';
    const decimalIndex = source.indexOf(separator);
    integerPart = source.slice(0, decimalIndex);
    fraction = source.slice(decimalIndex + 1);
    grouping = SPACE_GROUP;
    // The one shape that could equally be grouping. Read as a decimal; surfaced to the user.
    if (fraction.length === 3) flags.push('ambiguous-separator');
  } else {
    integerPart = source;
    fraction = '';
    grouping = SPACE_GROUP;
  }

  const whole = ungroup(integerPart, grouping);
  if (whole === null) return fail;
  if (fraction !== '' && !isDigits(fraction)) return fail;
  const parsed = roundToCents(whole, fraction);
  if (!Number.isFinite(parsed)) return fail;
  if (fraction.length > CENTS && movedACent(Number(`${whole}.${fraction}`), parsed)) {
    flags.push('rounded');
  }
  return { value: negative ? -parsed : parsed, flags };
}

/** The value alone, for call sites that don't surface warnings. */
export function parseImportNumber(value: unknown): number | null {
  return parseImportNumberDetailed(value).value;
}

/** One human sentence for the flags on a field, or null when there is nothing to say. */
export function describeImportNumberFlags(
  field: string,
  raw: string,
  flags: ImportNumberFlag[]
): string | null {
  if (flags.length === 0) return null;
  const shown = String(raw).trim();
  if (flags.includes('ambiguous-separator')) {
    return `${field} "${shown}" has three digits after the separator — read as a decimal. If your sheet meant thousands, fix the row before importing.`;
  }
  return `${field} "${shown}" has more than two decimals — rounded to cents.`;
}
