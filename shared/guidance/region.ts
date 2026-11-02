/**
 * Which region's official figures a person's numbers are compared with, and why.
 *
 * The first of these that says anything decides:
 *
 * 1. **The answer** to "Where do you live?" (shared/guidance/answers.ts). Somewhere else compares
 *    with the EU average, and says so.
 * 2. **The bank formats** of the profile's imports (`import_logs.bank_formats`), when the question
 *    is unanswered or skipped. DKB and Sparkasse mean Germany, Erste and PBZ Croatia, and ING the
 *    EU average: the adapter reads the Dutch export, and there are no Dutch figures. Revolut, Wise,
 *    YNAB and N26 use one format in every country they serve, so they say which bank, not where.
 *    The region the most import sessions point to wins, and a tie goes to the latest session.
 * 3. **The base currency**: EUR the EU average, GBP the United Kingdom, USD the United States.
 * 4. **The EU average.**
 *
 * No IBAN is read: none is stored, and the formats that carry one already name the country.
 *
 * Pure: the caller passes the answer, the profile's import logs and its base currency.
 */
import { bankFormatsOf } from '../bankFormats';
import type { BankId } from '../bankImport/types';
import type { RegionAnswer } from './answers';

/** The regions with figures: Germany, Croatia, the EU-27 average, the UK and the US. */
export const REGIONS = ['DE', 'HR', 'EU27', 'UK', 'US'] as const;
export type Region = (typeof REGIONS)[number];

/** How the region was set: the answer, somewhere else, the bank formats, the currency, or neither. */
export type RegionReason = 'answer' | 'elsewhere' | 'bank' | 'currency' | 'fallback';

export interface RegionChoice {
  region: Region;
  reason: RegionReason;
  /** What decided it: the bank format (`dkb`) or the base currency (`GBP`). Null otherwise. */
  via: string | null;
}

/** An import session as the log lists it. Only its formats and its order are read. */
export interface RegionImport {
  bank_formats?: unknown;
  created_at?: unknown;
  id?: unknown;
}

export interface RegionInput {
  answer?: RegionAnswer;
  /** The profile's import logs, in any order. */
  imports?: readonly RegionImport[];
  /** The base currency. */
  currency?: unknown;
}

/** The formats that say where a person lives, and where. */
export const FORMAT_REGIONS: Readonly<Partial<Record<BankId, Region>>> = {
  dkb: 'DE',
  sparkasse: 'DE',
  erste: 'HR',
  pbz: 'HR',
  ing: 'EU27',
};

const CURRENCY_REGIONS: ReadonlyMap<string, Region> = new Map<string, Region>([
  ['EUR', 'EU27'],
  ['GBP', 'UK'],
  ['USD', 'US'],
]);

/** Oldest first: by the time each ran, then by id. */
function chronological(a: RegionImport, b: RegionImport): number {
  const at = String(a.created_at ?? '');
  const bt = String(b.created_at ?? '');
  if (at !== bt) return at < bt ? -1 : 1;
  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

/** The region the import sessions point to, and the format of the latest that does, or null. */
function regionFromImports(
  imports: readonly RegionImport[]
): { region: Region; via: BankId } | null {
  const tally = new Map<Region, { sessions: number; latest: number; via: BankId }>();
  [...imports].sort(chronological).forEach((session, order) => {
    const seen = new Set<Region>();
    for (const format of bankFormatsOf(session.bank_formats)) {
      const region = FORMAT_REGIONS[format];
      if (!region || seen.has(region)) continue;
      seen.add(region);
      const sessions = (tally.get(region)?.sessions ?? 0) + 1;
      tally.set(region, { sessions, latest: order, via: format });
    }
  });
  let best: { region: Region; sessions: number; latest: number; via: BankId } | null = null;
  for (const [region, entry] of tally) {
    const ahead =
      !best ||
      entry.sessions > best.sessions ||
      (entry.sessions === best.sessions && entry.latest > best.latest);
    if (ahead) best = { region, ...entry };
  }
  return best ? { region: best.region, via: best.via } : null;
}

/** The region a profile's numbers are compared with, and how it was set. */
export function chooseRegion(input: RegionInput): RegionChoice {
  const { answer } = input;
  if (answer === 'elsewhere') return { region: 'EU27', reason: 'elsewhere', via: null };
  if (answer !== undefined && answer !== 'skipped') {
    return { region: answer, reason: 'answer', via: null };
  }
  const bank = regionFromImports(input.imports ?? []);
  if (bank) return { region: bank.region, reason: 'bank', via: bank.via };
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  const byCurrency = CURRENCY_REGIONS.get(currency);
  if (byCurrency) return { region: byCurrency, reason: 'currency', via: currency };
  return { region: 'EU27', reason: 'fallback', via: null };
}
