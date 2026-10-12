/**
 * The official figures a person's numbers are set beside: for eleven metrics and five regions, the
 * band a value falls in (low, typical or high), the figures the copy quotes, and the metrics a
 * region has no figure for.
 *
 * They are `benchmarks.json`, the guidance research's file, shipped whole: every band names its
 * source URL and year, every metric and region has a `derivations` record saying which rule drew its
 * edges, and `about` says how to read a band (guidance.md section 4). Two changes from the research
 * copy besides its formatting: it cited the app's own plan at a path on the machine it was written
 * on, which has no place in this repo, so that source is left out; and the five cushion
 * derivations, which credited that plan with their edges, name the sources they keep instead.
 *
 * This is the one module that imports the file, so the app can load it as a chunk of its own when a
 * band is first needed, and the Worker never holds it.
 *
 * Two decisions are written down here (guidance.md section 7):
 *
 * - **D5, how wide "typical" is** (`BAND_RULE`). Where sources publish group averages, typical runs
 *   from 0.75 times the lowest to 1.25 times the highest; the savings rate's is the official rate
 *   plus or minus 5 points. `BAND_RULE` records the rule and redraws nothing: the research's
 *   generator drew the file's bands with it, outside this repo. A test holds every band it drew to
 *   it, so a different width fails that test until the file is drawn again.
 * - **D4 and D9, figures borrowed from another region** (`BORROWED_BANDS_USED`), which decides at
 *   run time which borrowed bands `bandsFor` reads. The file holds the UK's subscription count for
 *   the euro regions and Croatia's debt-payment lines for Germany and the EU, each marked
 *   `borrowedFrom`, and both are used, named as borrowed. Euro regions have no subscription-spend
 *   band (D4): the file states that gap, and a card compares the person with their own trend
 *   instead. The UK has no debt-payment band (D9), likewise.
 *
 * Pure, with no I/O: the caller works out the person's numbers and asks which band they fall in.
 */
import data from './benchmarks.json';
import type { Region } from './region';

/** The regions with figures: the ones `chooseRegion` (region.ts) picks from. */
export type RegionId = Region;

export type Band = 'low' | 'typical' | 'high';

/** The metrics, in the file's order. */
export const METRIC_IDS = [
  'subscriptions.count',
  'subscriptions.monthlySpend',
  'savings.rate',
  'cushion.months',
  'shock.cover',
  'housing.share',
  'spending.foodAtHome',
  'spending.eatingOut',
  'spending.transport',
  'debt.rate',
  'debt.serviceShare',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type Strength = 'strong' | 'moderate' | 'weak';

/** How a household lives, as the housing bands tell them apart. Only the UK's rows differ by it. */
export type Tenure = 'rentPrivate' | 'rentSocial' | 'mortgage' | 'outright' | 'unknown';

/** One band of one metric in one region: values from `min` to `max`. */
export interface BandEntry {
  metric: MetricId;
  region: RegionId;
  band: Band;
  /** Inclusive unless `minExclusive`; null for no lower edge. */
  min: number | null;
  /** Exclusive unless `maxInclusive`; null for no upper edge. */
  max: number | null;
  minExclusive?: boolean;
  maxInclusive?: boolean;
  unit: string;
  sourceUrl: string;
  year: number;
  sourceIds: string[];
  strength: Strength;
  /** The region whose figures these are, when not the region's own. */
  borrowedFrom?: RegionId;
  /** The household the band is for: only the matching rows apply. */
  when?: { tenure?: Tenure; hasHousingLoan?: boolean };
}

/** A figure the copy quotes beside a band: an average, a share, a test amount or a group range. */
export interface Reference {
  metric: MetricId;
  region: RegionId;
  /** Null for a group range, which has `min` and `max` instead. */
  value: number | null;
  kind?: 'groupRange';
  min?: number;
  max?: number;
  unit: string;
  label: string;
  sourceUrl: string;
  year: number;
  sourceId: string;
  /** For the unexpected-bill test: the share of people who could not pay it, in percent. */
  shareUnable?: number;
}

/** A metric a region has no band for, and why. */
export interface Gap {
  metric: MetricId;
  region: RegionId;
  reason: string;
}

/** Which rule drew a metric's edges in a region, in words, with its sources. */
export interface Derivation {
  metric: MetricId;
  region: RegionId;
  strength: Strength;
  sourceIds: string[];
  text: string;
  borrowedFrom: RegionId | null;
}

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** YYYY-MM-DD, or null for a table updated in place. */
  published: string | null;
  dataYear: number;
  measure: string;
  sample: string;
  official: boolean;
  notes: string;
}

export interface MetricInfo {
  id: MetricId;
  label: string;
  unit: string;
  goodDirection: 'higher' | 'lower' | 'neither';
  formula: string;
  minData: string;
}

export interface RegionInfo {
  id: RegionId;
  name: string;
  currency: string;
  /** How the copy names it: "Germany", "the EU". */
  inCopy: string;
}

/** The file, as read. */
export interface BenchmarkFile {
  schemaVersion: number;
  generatedOn: string;
  about: string;
  bandRule: { widenLow: number; widenHigh: number; text: string };
  regions: RegionInfo[];
  /**
   * The research's sketch of the region choice. Not read: `chooseRegion` (region.ts) decides, and
   * differs from it on purpose (N26 gives no hint, ING the EU average, no IBAN is stored).
   */
  regionChoice: unknown;
  metrics: MetricInfo[];
  entries: BandEntry[];
  derivations: Derivation[];
  references: Reference[];
  gaps: Gap[];
  sources: Source[];
}

/** Everything in the file. Read-only: nothing here or in a caller may change it. */
export const BENCHMARKS: Readonly<BenchmarkFile> = data as unknown as BenchmarkFile;

/**
 * D5, how wide "typical" is drawn where a source publishes no spread. From group averages
 * (subscriptions, groceries, eating out, transport): `widenLow` times the lowest to `widenHigh`
 * times the highest, because people vary more than group averages do. The savings rate: the
 * official rate plus or minus `savingsPoints`. The widths are the model's choice, not a statistic,
 * and "Where this comes from" says so (`text`).
 *
 * This records the rule; it cannot redraw a band. The research's generator drew every band in
 * benchmarks.json with these widths, outside this repo, and nothing here draws them again. A test
 * holds each band the rule drew to it, so changing a width here fails that test until the file is
 * drawn again with the new one.
 */
export const BAND_RULE = {
  widenLow: BENCHMARKS.bandRule.widenLow,
  widenHigh: BENCHMARKS.bandRule.widenHigh,
  savingsPoints: 5,
  text: BENCHMARKS.bandRule.text,
} as const;

/** Which metrics use the bands the file borrows from another region. */
export type BorrowedBands = Readonly<Partial<Record<MetricId, boolean>>>;

/**
 * D4 and D9: the metrics whose borrowed bands the app uses, from the file's `borrowedFrom` rows. A
 * metric set to false has no band in a region that only has borrowed ones (`gapFor` says so), and
 * the card shows the person's own number without a comparison. Every metric the file borrows for
 * is listed, so a file that borrows for another one fails a test until this says whether to use it.
 */
export const BORROWED_BANDS_USED: BorrowedBands = {
  // D4: the UK's count for the euro regions, which have no official count of their own.
  'subscriptions.count': true,
  // D9: Croatia's lending limits for Germany and the EU, named as Croatia's in the copy.
  'debt.serviceShare': true,
};

/** What a band depends on besides the value: the household's tenure and a housing loan. */
export interface BandFacts {
  /** A tenure without rows of its own (`outright`, unanswered) reads as `unknown`. */
  tenure?: string | null;
  /** None given reads as no housing loan. */
  hasHousingLoan?: boolean | null;
}

/** The rows of one metric in one region, in the file's order, with the borrowed ones not used. */
function rowsOf(metric: MetricId, region: RegionId, borrowed: BorrowedBands): BandEntry[] {
  return BENCHMARKS.entries.filter(
    (entry) =>
      entry.metric === metric &&
      entry.region === region &&
      (entry.borrowedFrom === undefined || borrowed[metric] === true)
  );
}

/**
 * The bands that apply to a household: the rows for its tenure and housing loan, or the rows with
 * no condition, low to high as the file lists them. Empty for a metric the region has no band for
 * (`gapFor` says why). `borrowed` stands in for `BORROWED_BANDS_USED`, to try another answer.
 */
export function bandsFor(
  metric: MetricId,
  region: RegionId,
  facts: BandFacts = {},
  borrowed: BorrowedBands = BORROWED_BANDS_USED
): readonly BandEntry[] {
  const rows = rowsOf(metric, region, borrowed);
  const tenures = new Set(rows.map((row) => row.when?.tenure).filter(Boolean));
  const tenure = facts.tenure && tenures.has(facts.tenure as Tenure) ? facts.tenure : 'unknown';
  const housingLoan = facts.hasHousingLoan === true;
  return rows.filter(
    ({ when }) =>
      (when?.tenure === undefined || when.tenure === tenure) &&
      (when?.hasHousingLoan === undefined || when.hasHousingLoan === housingLoan)
  );
}

/** Whether `value` lies inside the band's edges. */
export function inBand(entry: BandEntry, value: number): boolean {
  const { min, max } = entry;
  const above = min === null || (entry.minExclusive ? value > min : value >= min);
  const below = max === null || (entry.maxInclusive ? value <= max : value < max);
  return above && below;
}

/**
 * The band `value` falls in for this metric, region and household, or null: when the region has no
 * band for the metric (see `gapFor`), and for a value that is not a number or lies outside every
 * band, like a share below zero. Infinity lies above every edge, in the band open above: a cushion
 * with nothing needed every month (facts.ts) reads high.
 */
export function bandFor(
  metric: MetricId,
  region: RegionId,
  value: number,
  facts: BandFacts = {}
): BandEntry | null {
  if (Number.isNaN(value)) return null;
  return bandsFor(metric, region, facts).find((entry) => inBand(entry, value)) ?? null;
}

/** The figures the copy quotes for a metric in a region, in the file's order. */
export function referencesFor(metric: MetricId, region: RegionId): readonly Reference[] {
  return BENCHMARKS.references.filter((ref) => ref.metric === metric && ref.region === region);
}

/**
 * Why a region has no band for a metric, or null when it has bands: the file's stated gap, or the
 * borrowed figures this app does not use.
 */
export function gapFor(
  metric: MetricId,
  region: RegionId,
  borrowed: BorrowedBands = BORROWED_BANDS_USED
): string | null {
  if (rowsOf(metric, region, borrowed).length > 0) return null;
  const stated = BENCHMARKS.gaps.find((gap) => gap.metric === metric && gap.region === region);
  if (stated) return stated.reason;
  const lender = BENCHMARKS.entries.find(
    (entry) => entry.metric === metric && entry.region === region && entry.borrowedFrom
  )?.borrowedFrom;
  if (!lender) return null;
  const name = BENCHMARKS.regions.find((one) => one.id === lender)?.inCopy ?? lender;
  return `No figures of its own, and the app does not borrow ${name}'s.`;
}

/** The rule that drew a metric's edges in a region, in words. */
export function derivationFor(metric: MetricId, region: RegionId): Derivation | null {
  return (
    BENCHMARKS.derivations.find((row) => row.metric === metric && row.region === region) ?? null
  );
}

/** A source by its id. */
export function sourceFor(id: string): Source | null {
  return BENCHMARKS.sources.find((source) => source.id === id) ?? null;
}
