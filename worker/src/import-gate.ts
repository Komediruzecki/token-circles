import { parseImportNumber } from '../../shared/importNumber';

// Pre-commit sanity check for an unattended import.
//
// routes/imports.ts parseDateString() returns TODAY for anything it cannot read, by design -- an
// interactive importer has a human looking at the preview. An unattended caller does not, so a
// mis-detected column would land silently as a pile of transactions dated today. This module
// detects that case; it never parses anything for real.

export const MIN_PARSE_RATE = 0.95;
const MAX_SAMPLE = 10;
/** A transaction dated outside this range is a parse artefact, not a date. */
/** Plausible ledger years. Shared with parseDateString, which has the same Date-parser hole. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;

export interface GateResult {
  ok: boolean;
  dateParseRate: number;
  amountParseRate: number;
  reason: string | null;
  failing: { row: number; date: string; amount: string }[];
}

/** Mirrors the shapes parseDateString accepts, as a predicate rather than a parser. */
function looksLikeDate(raw: string): boolean {
  const s = raw.trim();
  if (s === '') return false;
  const inRange = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return inRange(parseInt(iso[2]!, 10), parseInt(iso[3]!, 10));

  // nn[/.-]nn[/.-]yyyy is ambiguous; parseDateString resolves it by range and falls back to
  // day-first. Readable here means "some assignment of the two numbers is a real month/day".
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const a = parseInt(dmy[1]!, 10);
    const b = parseInt(dmy[2]!, 10);
    return inRange(b, a) || inRange(a, b);
  }

  // The JS Date fallback parser is wildly permissive: new Date('REF-88213') is not an error,
  // it is the first of January, year 88213 -- it simply scavenges a number and calls it a year.
  // A bank reference column would sail through on that alone, which is the exact silent
  // corruption this gate exists to catch. Bound it to a plausible ledger range.
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return false;
  const year = parsed.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

export function assessImport(rows: string[][], mapping: Record<string, number>): GateResult {
  const empty = { dateParseRate: 0, amountParseRate: 0, failing: [] as GateResult['failing'] };

  if (mapping.date === undefined || mapping.amount === undefined) {
    return {
      ok: false,
      ...empty,
      reason: 'Both a date and an amount column must be mapped before importing.',
    };
  }
  if (rows.length === 0) {
    return { ok: false, ...empty, reason: 'The file contained no data rows.' };
  }

  const dateAt = mapping.date;
  const amountAt = mapping.amount;
  let dates = 0;
  let amounts = 0;
  const failing: GateResult['failing'] = [];

  rows.forEach((row, i) => {
    const rawDate = String(row[dateAt] ?? '');
    const rawAmount = String(row[amountAt] ?? '');
    const dateOk = looksLikeDate(rawDate);
    const amountOk = parseImportNumber(rawAmount) !== null;
    if (dateOk) dates += 1;
    if (amountOk) amounts += 1;
    if ((!dateOk || !amountOk) && failing.length < MAX_SAMPLE) {
      failing.push({ row: i + 1, date: rawDate, amount: rawAmount });
    }
  });

  const dateParseRate = dates / rows.length;
  const amountParseRate = amounts / rows.length;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  let reason: string | null = null;
  if (dateParseRate < MIN_PARSE_RATE) {
    reason = `Only ${pct(dateParseRate)} of rows have a readable date (need ${pct(MIN_PARSE_RATE)}). The date column may be mis-detected.`;
  } else if (amountParseRate < MIN_PARSE_RATE) {
    reason = `Only ${pct(amountParseRate)} of rows have a readable amount (need ${pct(MIN_PARSE_RATE)}). The amount column may be mis-detected.`;
  }

  return { ok: reason === null, dateParseRate, amountParseRate, reason, failing };
}
