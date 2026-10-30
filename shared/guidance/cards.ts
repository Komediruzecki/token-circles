/**
 * The benchmark cards (design.md 2.2, guidance.md 5.3): the person's number beside the official
 * figures where they live, under "How you compare" in a circle's view. Each card has a title with
 * the person's own number, a sentence or two that compare it with the region and year named, the
 * band bar, one next step, and "Where this comes from". Both directions get a sentence and a step;
 * no card passes a verdict on anyone.
 *
 * Built behind the benchmarks gate (frontend/src/core/guidanceGate.ts): the app imports this module
 * with `import()` when the first card shows, so it and benchmarks.json are a chunk of their own,
 * never in the entry chunk and never fetched while the gate is closed.
 *
 * Pure, with the money formatter passed in, as the ledger's is.
 */
import {
  BAND_RULE,
  BENCHMARKS,
  bandFor,
  bandsFor,
  derivationFor,
  gapFor,
  referencesFor,
  sourceFor,
} from './benchmarks';
import {
  CLEAR_PICTURE_MONTHS,
  FIRST_CUSHION_MONTHS,
  FULL_CUSHION_MONTHS,
  SORTED_SHARE,
} from './circles';
import { gapOf, monthsText, shareOf } from './ledger';
import { percentText, principalLine, savingsTitle, shownRate } from './savingsWords';
import { DAYS_IN_A_MONTH, monthName } from '../orientation';
import type { Band, BandEntry, MetricId, Reference, RegionId, Strength } from './benchmarks';
import type { CircleNumber } from './circles';
import type { Debt, GuidanceFacts } from './facts';
import type { Kind } from './kinds';
import type { LedgerWords } from './ledger';

/** A tag on a card: its band, figures borrowed from another region, or a figure that is missing. */
export interface CardTag {
  kind: 'band' | 'borrowed' | 'missing';
  text: string;
}

/** The band bar: low, typical and high on one scale, with the person's mark. */
export interface CardBar {
  from: number;
  to: number;
  bands: { band: Band; from: number; to: number }[];
  /** Where the person is, held to the scale. */
  mark: number;
  /** Labels at the edges between bands. */
  edges: { at: number; text: string }[];
  /** The bar in words, for a screen reader. */
  label: string;
}

export interface CardSource {
  title: string;
  publisher: string;
  year: number;
  url: string;
}

export interface BenchmarkCard {
  id: string;
  metric: MetricId;
  /** The metric's name, over the title. */
  eyebrow: string;
  tags: CardTag[];
  title: string;
  /** One or two paragraphs. */
  body: string[];
  bar: CardBar | null;
  /** Borrowed, missing or thin evidence, in a sentence. */
  note: string | null;
  step: { label: string; hash: string } | null;
  /**
   * "Where this comes from": the band rule, the sources and how strong they are. Null on a card
   * that compares nothing yet.
   */
  where: { rule: string; sources: CardSource[]; strength: string } | null;
  /** "Based on 5 months. It firms up at 12.", under 12 months on file. */
  provisional: string | null;
  /**
   * Asked on the card while it has no answer: the housing card's "How do you live?", the
   * subscription card's "Who does this space cover?".
   */
  ask?: CardQuestion;
}

/** A question a card asks while its answer would change the comparison. */
export type CardQuestion = 'tenure' | 'household';

/** Where the cards are read. */
export interface CardContext {
  region: RegionId;
  /** The base currency: the unexpected bill is only quoted in its own. */
  currency: string;
  /** The tenure answer; a mortgage counts as a housing loan for the debt-payment lines. */
  tenure: string | null;
  /** The adults the space covers (3 stands for three or more); null until the person says. */
  adults: number | null;
}

/** What a band is called on its tag. Descriptive, never a verdict. */
const BAND_TAGS: Readonly<Record<Band, string>> = {
  low: 'Below typical',
  typical: 'Typical',
  high: 'Above typical',
};

/** How strong a figure is, in words. */
export const STRENGTH_WORDS: Readonly<Record<Strength, string>> = {
  strong: 'Strong evidence: official figures, recent.',
  moderate: 'Moderate evidence: official figures, older or less direct.',
  weak: 'Thin evidence: a convention or a survey, not an official line.',
};

/** The region as the copy names it: "Germany", "the EU". */
export function regionName(region: RegionId): string {
  return BENCHMARKS.regions.find((one) => one.id === region)?.inCopy ?? region;
}

/** The region as an adjective, for a tag: "No German figure". */
const REGION_ADJECTIVE: Readonly<Record<RegionId, string>> = {
  DE: 'German',
  HR: 'Croatian',
  EU27: 'EU',
  UK: 'UK',
  US: 'US',
};

/** A sentence that starts with the region: "The UK has", "Germany has". */
const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export { percentText };

/** An edge or a rate as the sources print it: "13.9", "4", "8.99". */
const figureText = (value: number): string => String(Math.round(value * 100) / 100);

/** A national average, to one decimal as its label prints it: "18.9", "9.0". */
const averageText = (value: number): string => value.toFixed(1);

/** "August 2026" for "2026-08-31". */
const monthYear = (date: string): string => `${monthName(date.slice(0, 7))} ${date.slice(0, 4)}`;

/** The publisher as a card cites it: "DZS", not "DZS (Croatian Bureau of Statistics)". */
function publisherOf(sourceId: string): string {
  const publisher = sourceFor(sourceId)?.publisher ?? '';
  return publisher.replace(/\s*\(.*\)$/, '');
}

/** The sources behind a card, without repeats, in the order given. */
function sourcesOf(ids: readonly string[]): CardSource[] {
  const out: CardSource[] = [];
  for (const id of new Set(ids)) {
    const source = sourceFor(id);
    if (!source || !source.url.startsWith('https://')) continue;
    out.push({
      title: source.title,
      publisher: source.publisher,
      year: source.dataYear,
      url: source.url,
    });
  }
  return out;
}

/**
 * "Where this comes from" for a metric in a region, with the references the card quotes and any
 * other sources its sentences name.
 */
function whereFrom(
  metric: MetricId,
  region: RegionId,
  bands: readonly BandEntry[],
  quoted: readonly Reference[],
  named: readonly string[] = []
): NonNullable<BenchmarkCard['where']> {
  const derivation = derivationFor(metric, region);
  const ids = [
    ...(derivation?.sourceIds ?? []),
    ...bands.flatMap((band) => band.sourceIds),
    ...quoted.map((ref) => ref.sourceId),
    ...named,
  ];
  const strength: Strength = derivation?.strength ?? bands[0]?.strength ?? 'moderate';
  return {
    rule: derivation?.text ?? BAND_RULE.text,
    sources: sourcesOf(ids),
    strength: STRENGTH_WORDS[strength],
  };
}

/** The bar for `value` on the bands given, from `from` to `to`. */
function barOf(
  bands: readonly BandEntry[],
  value: number,
  scale: { from: number; to: number },
  edgeText: (edge: number) => string,
  label: string
): CardBar | null {
  if (bands.length === 0) return null;
  const clamp = (n: number) => Math.min(scale.to, Math.max(scale.from, n));
  const parts = bands
    .map((band) => ({
      band: band.band,
      from: clamp(band.min ?? scale.from),
      to: clamp(band.max ?? scale.to),
    }))
    .filter((part) => part.to > part.from);
  const edges = parts.slice(1).map((part) => ({ at: part.from, text: edgeText(part.from) }));
  return {
    from: scale.from,
    to: scale.to,
    bands: parts,
    mark: clamp(Number.isFinite(value) ? value : scale.to),
    edges,
    label,
  };
}

/** "Based on 5 months. It firms up at 12.", while less than a year is on file. */
function provisionalOf(facts: GuidanceFacts): string | null {
  if (facts.firm) return null;
  const n = facts.months.length;
  return `Based on ${n} ${n === 1 ? 'month' : 'months'}. It firms up at ${CLEAR_PICTURE_MONTHS}.`;
}

/** The typical band's edges, for the bar's words: "Typical in Germany: 13.9% to 23.9%". */
function typicalText(bands: readonly BandEntry[], unit: (n: number) => string): string | null {
  const typical = bands.find((band) => band.band === 'typical');
  if (!typical) return null;
  if (typical.min !== null && typical.max !== null) {
    return `${unit(typical.min)} to ${unit(typical.max)}`;
  }
  if (typical.min !== null) return `${unit(typical.min)} or more`;
  return typical.max === null ? null : `under ${unit(typical.max)}`;
}

// ---------------------------------------------------------------------------------------------
// Savings rate (circle 5; the Dashboard gauge carries its band too)

/** The household saving rate the copy quotes: the reference in percent of disposable income. */
function savingRateRef(region: RegionId): Reference | null {
  return (
    referencesFor('savings.rate', region).find((ref) =>
      ref.unit.startsWith('percent of disposable income')
    ) ?? null
  );
}

/** The regions whose evidence the "1 in 4 households" sentence comes from. */
const EUROPEAN: ReadonlySet<RegionId> = new Set(['EU27', 'DE', 'HR']);

/** The largest spending line not needed every month, over the window. */
function flexibleLine(facts: GuidanceFacts): { name: string; perMonth: number } | null {
  const line = (facts.windowCategories ?? []).find(
    (category) => category.type === 'expense' && !category.essential && category.name !== ''
  );
  return line ? { name: line.name, perMonth: line.perMonth } : null;
}

export function savingsCard(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const { rate, cash } = facts.savings;
  if (rate === null || cash === null || facts.income === null || facts.spending === null) {
    return null;
  }
  const region = at.region;
  const name = regionName(region);
  const money = (n: number) => words.money(Math.round(n));
  const ref = savingRateRef(region);
  const bands = bandsFor('savings.rate', region);
  const quoted: Reference[] = ref ? [ref] : [];
  const body: string[] = [];
  let title: string;
  let step: BenchmarkCard['step'];
  let tags: CardTag[];
  // The rate shown is the one with loan principal added back (D6, LOAN_PRINCIPAL_IS_SAVING); when
  // cash alone runs below zero, the cash fact leads, as cash is what drains the cushion.
  const value = shownRate(facts) ?? rate;
  const band = bandFor('savings.rate', region, value);
  // The title and the principal line are the Dashboard gauge's too (savingsWords.ts).
  const principalSaid = principalLine(facts, words);
  if (cash < 0) {
    const n = facts.months.length;
    title = savingsTitle(facts, words) ?? '';
    const first = [`Over the last ${n} months, spending ran ahead of income.`];
    if (EUROPEAN.has(region)) {
      const dissaving = referencesFor('savings.rate', 'EU27').find(
        (one) => one.sourceId === 'eurostat-icw'
      );
      if (dissaving) quoted.push(dissaving);
      first.push(
        'About 1 in 4 households in the EU spends more than its income over a year (Eurostat, around 2020).'
      );
    }
    const heaviest = facts.heaviestMonth;
    if (heaviest) {
      const month = monthName(heaviest.month);
      first.push(
        heaviest.category
          ? `${month} was the heaviest month, mostly ${heaviest.category}.`
          : `${month} was the heaviest month.`
      );
      step = { label: `See what made ${month} heavier`, hash: '#analytics' };
    } else {
      step = { label: 'See where it went', hash: '#analytics' };
    }
    body.push(first.join(' '));
    if (principalSaid) body.push(principalSaid);
    tags = band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [];
  } else {
    title = savingsTitle(facts, words) ?? '';
    const average = ref ? `${averageText(ref.value ?? 0)}% (${ref.year})` : null;
    const adjective = REGION_ADJECTIVE[region];
    if (band?.band === 'high') {
      body.push(
        `${average ? `That's above the ${adjective} household average of ${average}. ` : ''}The retirement calculator shows where this rate leads in 10 or 20 years.`
      );
      step = { label: 'See where it leads', hash: '#retirement' };
    } else if (band?.band === 'typical') {
      body.push(
        `${average ? `Close to the ${adjective} average of ${average}. ` : ''}One more point is ${money(Math.max(1, facts.income / 100))} a month.`
      );
      step = { label: 'Try one point more', hash: '#compound' };
    } else {
      const line = flexibleLine(facts);
      const sentences = [
        ref
          ? `Households in ${name} save about ${averageText(ref.value ?? 0)}% on average (${ref.year}), much of it through pension payments taken from pay, which bank statements don't show.`
          : null,
        line
          ? `Your largest flexible line was ${line.name}, ${money(line.perMonth)} a month.`
          : null,
      ].filter((one): one is string => one !== null);
      body.push(sentences.join(' '));
      step = line
        ? { label: `Look at ${line.name}`, hash: '#analytics' }
        : { label: 'See where it goes', hash: '#analytics' };
    }
    if (principalSaid) body.push(principalSaid);
    tags = band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [];
  }
  const typical = typicalText(bands, (n) => `${figureText(n)}%`);
  return {
    id: 'savings-rate',
    metric: 'savings.rate',
    eyebrow: 'Savings rate',
    tags,
    title,
    body: body.filter((one) => one !== ''),
    bar: barOf(
      bands,
      value,
      { from: -10, to: 40 },
      (edge) => `${figureText(edge)}%`,
      `${typical ? `Typical in ${name}: ${typical}. ` : ''}Yours: ${percentText(value)}%.`
    ),
    note: null,
    step,
    where: whereFrom('savings.rate', region, bands, quoted),
    provisional: provisionalOf(facts),
  };
}

/** What the Dashboard gauge adds to the savings rate while the gate is open (design.md 2.3). */
export interface SavingsBand {
  /** The typical band's edges, in percent: the arc on the ring, and the target without a goal. */
  from: number;
  to: number;
  /** "Typical in Croatia: 4% to 14%" */
  legend: string;
  /** guidance.md 5.3's sentence for the band the rate is in, as the savings card says it. */
  comparison: string | null;
}

/** The savings rate's typical band where the person lives, and what the card says of their rate. */
export function savingsBand(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): SavingsBand | null {
  const bands = bandsFor('savings.rate', at.region);
  const typical = bands.find((band) => band.band === 'typical');
  const range = typicalText(bands, (n) => `${figureText(n)}%`);
  if (!typical || typical.min === null || typical.max === null || range === null) return null;
  // The card's first paragraph is its sentence for the band: every region has a household saving
  // rate to quote. The principal line, which the gauge says in every build, comes after it.
  const comparison = savingsCard(facts, words, at)?.body[0] ?? null;
  return {
    from: typical.min,
    to: typical.max,
    legend: `Typical in ${regionName(at.region)}: ${range}`,
    comparison,
  };
}

// ---------------------------------------------------------------------------------------------
// Cash cushion (circles 3 and 4)

/** The context line where the region has one, as a sentence. */
const CUSHION_CONTEXT: Partial<Record<RegionId, string>> = {
  EU27: "About half of EU households couldn't keep their usual living standard for three months on savings alone (Eurostat, 2020).",
  HR: "About a third of households in Croatia couldn't keep their usual living standard for three months on savings alone (Eurostat, 2020).",
  US: '55% of US adults have three months of expenses set aside (Federal Reserve, 2025).',
};

export function cushionCard(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const months = facts.cushionMonths;
  const liquid = facts.liquid;
  const essentials = facts.essentials;
  if (months === null || liquid === null || essentials === null || !(essentials > 0)) return null;
  if (!Number.isFinite(months)) return null;
  const region = at.region;
  const money = (n: number) => words.money(Math.round(n));
  const bands = bandsFor('cushion.months', region);
  const band = bandFor('cushion.months', region, months);
  const shown = monthsText(months);
  const monthsTitle = `Your cash covers ${shown} ${shown === '1' ? 'month' : 'months'} of essentials`;
  let title = monthsTitle;
  let body: string;
  let step: BenchmarkCard['step'];
  if (band?.band === 'low' || months < FIRST_CUSHION_MONTHS) {
    const days = Math.floor(months * DAYS_IN_A_MONTH);
    title = `Your cash covers ${days} ${days === 1 ? 'day' : 'days'} of essentials`;
    body = `The first cushion is one month of essential spending: ${money(essentials)}. You're ${money(gapOf(essentials, liquid))} away.`;
    step = { label: 'Start a one-month cushion', hash: '#goals' };
  } else if (band?.band === 'high' || months >= FULL_CUSHION_MONTHS) {
    body =
      "That's past the six months most guides stop at. Money beyond it could go toward your next goal; the compound interest calculator shows what time does to it.";
    step = { label: 'Plan your next goal', hash: '#goals' };
  } else {
    const milestone = months < 3 ? 3 : FULL_CUSHION_MONTHS;
    body = `Most guides aim for three to six months. That range is a convention, not a tested line; if your income moves around, the top of it fits better. Next milestone: ${milestone} months, ${money(gapOf(milestone * essentials, liquid))} away.`;
    step = { label: 'Open the emergency fund calculator', hash: '#emergency' };
  }
  const context = CUSHION_CONTEXT[region];
  const quoted = referencesFor('cushion.months', region);
  const tags: CardTag[] = band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [];
  let note: string | null = null;
  if (!context) {
    tags.push({ kind: 'missing', text: `No ${REGION_ADJECTIVE[region]} figure` });
    note = `${capital(regionName(region))} has no official figure for how many households could live three months on savings.`;
  }
  return {
    id: 'cushion',
    metric: 'cushion.months',
    eyebrow: 'Cash cushion',
    tags,
    title,
    body: context ? [body, context] : [body],
    bar: barOf(
      bands,
      months,
      { from: 0, to: 9 },
      (edge) => `${figureText(edge)} ${edge === 1 ? 'month' : 'months'}`,
      `Typical: 1 to 6 months. Yours: ${shown}.`
    ),
    note,
    step,
    where: whereFrom('cushion.months', region, bands, quoted),
    provisional: provisionalOf(facts),
  };
}

// ---------------------------------------------------------------------------------------------
// The unexpected-bill test (circles 3 and 4)

export function shockCard(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const region = at.region;
  const ref = referencesFor('shock.cover', region).find(
    (one) => one.shareUnable !== undefined && one.value !== null
  );
  const regionInfo = BENCHMARKS.regions.find((one) => one.id === region);
  // Quoted in the region's own currency only: with another base currency the card is left out,
  // and the cushion card covers the ground.
  if (!ref || ref.value === null || !regionInfo || regionInfo.currency !== at.currency) return null;
  const liquid = facts.liquid;
  if (liquid === null) return null;
  const testAmount = ref.value;
  const money = (n: number) => words.money(Math.round(n));
  const bands = bandsFor('shock.cover', region);
  const cover = liquid / testAmount;
  const band = bandFor('shock.cover', region, Math.max(0, cover));
  const name = regionName(region);
  const share = figureText(ref.shareUnable ?? 0);
  const cited = `${publisherOf(ref.sourceId)}, ${ref.year}`;
  const amount = money(testAmount);
  const low = cover < 1;
  const title = low
    ? `An unexpected ${amount} bill would be more than your cash today`
    : `You could pay an unexpected ${amount} bill from cash`;
  const body = low
    ? `${share}% of people in ${name} couldn't pay one from their own money either (${cited}). ${money(gapOf(testAmount, liquid))} more in savings would cover it.`
    : `${share}% of people in ${name} couldn't (${cited}).`;
  const step = low
    ? { label: `Build toward ${amount}`, hash: '#goals' }
    : facts.cushionMonths !== null && facts.cushionMonths < FIRST_CUSHION_MONTHS
      ? { label: 'Next: one month of essentials', hash: '#goals' }
      : null;
  return {
    id: 'shock',
    metric: 'shock.cover',
    eyebrow: 'Unexpected bill',
    tags: band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [],
    title,
    body: [body],
    bar: barOf(
      bands,
      cover,
      { from: 0, to: 2 },
      () => amount,
      `The test: ${amount}. Your money in reach: ${money(Math.max(0, liquid))}.`
    ),
    note: null,
    step,
    where: whereFrom('shock.cover', region, bands, [ref]),
    provisional: null,
  };
}

// ---------------------------------------------------------------------------------------------
// The interest rate on each debt (circle 4)

/**
 * The market rates the copy quotes per kind of debt, August 2026, as each region's reference in
 * benchmarks.json words them (a test holds each figure to its label). A kind with no figure for a
 * region is left out of the sentence rather than compared with another kind's.
 */
export const MARKET_RATES: Readonly<
  Record<RegionId, { sourceId: string; loan: number; card?: number; overdraft?: number }>
> = {
  EU27: { sourceId: 'ecb-mir-2026-08', loan: 8.59, card: 16.54 },
  DE: { sourceId: 'ecb-mir-2026-08', loan: 8.99, card: 17.52, overdraft: 9.46 },
  HR: { sourceId: 'ecb-mir-2026-08', loan: 5.41, overdraft: 5.55 },
  UK: { sourceId: 'boe-money-credit-2026-08', loan: 9.96, card: 21.55, overdraft: 20.27 },
  US: { sourceId: 'fed-g19-2026-08', loan: 11.9, card: 21.19 },
};

const MARKET_MONTH = 'August 2026';

const KIND_PLURAL: Readonly<Record<Debt['kind'], string>> = {
  loan: 'new consumer loans',
  card: 'credit cards',
  overdraft: 'overdrafts',
};

/**
 * How a rate stands against the market rate for its kind: within 1.5 points it is close; a card at
 * 6% is well below what cards cost, and the sentence says so rather than "close to".
 */
function comparedWith(rate: number, market: number): string {
  if (Math.abs(rate - market) <= 1.5) return 'Close to';
  return rate < market ? 'Below' : 'Above';
}

function debtLabel(debt: Debt): string {
  if (debt.name) return debt.name;
  return debt.kind === 'loan' ? 'A loan' : debt.kind === 'card' ? 'A card' : 'An overdraft';
}

export function debtRateCards(
  facts: GuidanceFacts,
  _words: LedgerWords,
  at: CardContext
): BenchmarkCard[] {
  const region = at.region;
  const name = regionName(region);
  const bands = bandsFor('debt.rate', region);
  const market = MARKET_RATES[region];
  const quoted = referencesFor('debt.rate', region);
  return facts.debts
    .filter((debt): debt is Debt & { rate: number } => debt.rate !== null && debt.owed > 0)
    .map((debt, index) => {
      const band = bandFor('debt.rate', region, debt.rate);
      const kindRate = debt.kind === 'loan' ? market.loan : market[debt.kind];
      const kindRef =
        kindRate === undefined
          ? null
          : `${capital(KIND_PLURAL[debt.kind])} in ${name} average ${figureText(kindRate)}% (${MARKET_MONTH}).`;
      const rate = figureText(debt.rate);
      let body: string;
      let step: { label: string; hash: string };
      const loanPage = debt.kind === 'loan' && debt.id !== null ? `#loans/${debt.id}` : '#loans';
      const page = debt.kind === 'loan' ? loanPage : '#accounts';
      if (band?.band === 'high') {
        body = `Debt at 10% or more is where most guides put extra money first, once a one-month cushion is in place.${kindRef ? ` ${kindRef}` : ''}`;
        step =
          debt.kind === 'loan'
            ? { label: 'Compare paying it off faster', hash: page }
            : { label: 'Open Accounts', hash: page };
      } else if (band?.band === 'typical') {
        body = `${kindRate === undefined ? '' : `${comparedWith(debt.rate, kindRate)} what ${KIND_PLURAL[debt.kind]} cost in ${name} (${figureText(kindRate)}%, ${MARKET_MONTH}). `}Paying it faster is a choice, not an emergency; the cushion comes first.`;
        step =
          debt.kind === 'loan'
            ? { label: 'See its payoff date', hash: page }
            : { label: 'Open Accounts', hash: page };
      } else {
        body =
          debt.kind === 'loan'
            ? "Cheap by today's rates. Paying it early saves little interest; the Loans page shows exactly how much."
            : "Cheap by today's rates. Paying it early saves little interest.";
        step =
          debt.kind === 'loan'
            ? { label: 'See the numbers', hash: page }
            : { label: 'Open Accounts', hash: page };
      }
      return {
        id: `debt-rate-${debt.kind}-${debt.id ?? index}`,
        metric: 'debt.rate' as const,
        eyebrow: 'Interest rate',
        tags: band ? [{ kind: 'band' as const, text: BAND_TAGS[band.band] }] : [],
        title: `${debtLabel(debt)} costs ${rate}% a year`,
        body: [body],
        bar: barOf(
          bands,
          debt.rate,
          { from: 0, to: 25 },
          (edge) => `${figureText(edge)}%`,
          `Typical: 4% to 10% a year. ${debtLabel(debt)}: ${rate}%.`
        ),
        note: 'These edges are a rule of thumb from personal-finance guides, not an official line.',
        step,
        where: whereFrom('debt.rate', region, bands, quoted),
        provisional: null,
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Debt payments (circle 4)

export function debtPaymentsCard(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const income = facts.income;
  if (income === null || !(income > 0) || !facts.accountsKnown) return null;
  const region = at.region;
  const name = regionName(region);
  const money = (n: number) => words.money(Math.round(n));
  const hasHousingLoan = at.tenure === 'mortgage';
  const bands = bandsFor('debt.serviceShare', region, { hasHousingLoan });
  const payments = facts.debts.reduce((sum, debt) => sum + (debt.payment ?? 0), 0);
  const share = (payments / income) * 100;
  const band = bandFor('debt.serviceShare', region, share, { hasHousingLoan });
  const line = bands.find((one) => one.band === 'typical')?.max ?? null;
  const borrowed = bands.find((one) => one.borrowedFrom !== undefined)?.borrowedFrom;
  const quoted = referencesFor('debt.serviceShare', region);
  const tags: CardTag[] = band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [];
  if (borrowed) {
    tags.push({ kind: 'borrowed', text: `${capital(regionName(borrowed))}'s figures` });
  }
  let note: string | null = null;
  if (bands.length === 0) {
    tags.push({ kind: 'missing', text: `No ${REGION_ADJECTIVE[region]} line` });
    note = `${capital(name)} has no official line for debt payments against income.`;
  }
  const shareText = percentText(share);
  let title = `Debt payments take ${shareText}% of your take-home pay`;
  let body: string[] = [];
  let step: BenchmarkCard['step'] = { label: 'See payoff dates', hash: '#loans' };
  if (payments <= 0) {
    title = 'No debt payments';
    const repaying = quoted.find((ref) => ref.value !== null);
    body = repaying
      ? [
          `${figureText(repaying.value ?? 0)}% of households in ${name} repay a loan other than a mortgage (${repaying.year}).`,
        ]
      : [];
    step = { label: 'Plan your next goal', hash: '#goals' };
  } else if (band?.band === 'high' && line !== null) {
    step = { label: 'See which loan ends first', hash: '#loans' };
    if (region === 'HR') {
      body = [
        `In Croatia, banks may lend past ${figureText(line)}% of income only as a limited exception (Croatian National Bank, 2025). It's a lending limit, not a verdict, and a useful line to get back under.`,
      ];
    } else if (region === 'US') {
      body = [
        "For US mortgages, Fannie Mae's standard limit is 36% of income before tax, higher in some cases. Measured on take-home pay, your share reads higher than theirs would.",
      ];
    } else {
      body = [
        `There's no official line in ${name}; Croatia's central bank uses ${figureText(line)}% as its limit for new loans.`,
      ];
    }
  } else if (bands.length > 0) {
    const next = facts.debts
      .filter((debt): debt is Debt & { ends: string } => debt.kind === 'loan' && !!debt.ends)
      .sort((a, b) => a.ends.localeCompare(b.ends))[0];
    if (next) {
      body = [
        `${debtLabel(next)} is the next to end, in ${monthYear(next.ends)}; that frees ${money(next.payment ?? 0)} a month.`,
      ];
    }
  }
  return {
    id: 'debt-payments',
    metric: 'debt.serviceShare',
    eyebrow: 'Debt payments',
    tags,
    title,
    body,
    bar:
      line === null
        ? null
        : barOf(
            bands,
            share,
            { from: 0, to: 60 },
            (edge) => `${figureText(edge)}%`,
            `The line: ${figureText(line)}% of take-home pay. Yours: ${shareText}%.`
          ),
    note,
    step,
    where: whereFrom('debt.serviceShare', region, bands, quoted),
    provisional: provisionalOf(facts),
  };
}

// ---------------------------------------------------------------------------------------------
// Subscriptions (circle 2)

const BAND_ORDER: Readonly<Record<Band, number>> = { low: 0, typical: 1, high: 2 };

/** The sentences a subscription card says per band, after "That's about {a year} a year." */
interface SubscriptionWords {
  high: string;
  typical: string;
  low: string;
  /** Sources the sentences name besides the bands'. */
  named: readonly string[];
}

/** The US and the UK have figures of their own (guidance.md 5.2, worked for the US). */
const SUBSCRIPTION_WORDS: Readonly<Partial<Record<RegionId, SubscriptionWords>>> = {
  US: {
    high: "People in the US report about 3 subscriptions, and $35 to $111 a month on average depending on the survey (Self Financial and CNET, 2026). In the March poll, 6 in 10 paid for at least one they hadn't used in a month.",
    typical:
      "That's in the usual range in the US. Recent surveys put the average between $35 and $111 a month, depending on what they count.",
    low: 'Fewer than most people in the US, who report about 3.',
    named: ['self-subscriptions-2026', 'cnet-subscriptions-2026'],
  },
  UK: {
    high: 'Adults in the UK hold about 3 subscriptions and spend about £41 a month on them (Department for Business and Trade, 2023).',
    typical:
      "That's in the usual range in the UK, where adults hold about 3 and spend about £41 a month on them (Department for Business and Trade, 2023).",
    low: 'Fewer than most adults in the UK, who hold about 3.',
    named: ['dbt-subscription-traps-2023'],
  },
};

/** The euro regions, which compare the count with the UK's (D4) and have no spend figure. */
function borrowedSubscriptionWords(region: RegionId): SubscriptionWords {
  const name = regionName(region);
  return {
    high: `${capital(name)} has no official count yet; in the UK, where there is one, adults hold about 3 (Department for Business and Trade, 2023). In an EU survey, 37% of people said they often keep paying for subscriptions they no longer use (European Commission, 2024).`,
    typical: `That's in the usual range for the UK, where adults hold about 3 (Department for Business and Trade, 2023); ${name} has no official count yet.`,
    low: `Fewer than most adults in the UK, who hold about 3; ${name} has no official count yet.`,
    named: ['dbt-subscription-traps-2023', 'ec-digital-fairness-2024'],
  };
}

const KEEP_OR_DROP =
  'Want fewer, or more out of the ones you keep? Each one on Bills is a quick yes or no.';
const NOT_HERE_YET =
  "If some are paid from a card that isn't here yet, import that statement and the scan will find them. And if there's a chore you repeat every week, a service that does it might be worth its price in time saved.";

/** A count or a share of one per adult, as the bar and the body write it: "3", "2.5". */
const countText = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * The subscriptions on Bills beside the usual count per adult, and in the UK and the US beside the
 * usual spend a month (guidance.md 4.4.1, 5.2): one card, in the higher of the two bands. The
 * spend is compared only in the region's own currency. Until the person says how many adults the
 * space covers, it counts one and asks. It waits for 3 tracked months, and firms up at 12, when the
 * yearly ones have come round (benchmarks.json's minData).
 */
export function subscriptionsCard(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const held = facts.subscriptions;
  if (!held || !facts.averaged) return null;
  const region = at.region;
  const name = regionName(region);
  const money = (n: number) => words.money(Math.round(n));
  const adults = at.adults !== null && at.adults > 0 ? at.adults : 1;
  const perAdult = held.count / adults;
  const countBands = bandsFor('subscriptions.count', region);
  const typical = countBands.find((one) => one.band === 'typical');
  const high = countBands.find((one) => one.band === 'high');
  if (!typical || typical.min === null || typical.max === null || !high || high.min === null) {
    return null;
  }
  const countBand = bandFor('subscriptions.count', region, perAdult);
  const regionInfo = BENCHMARKS.regions.find((one) => one.id === region);
  const spendShown = regionInfo !== undefined && regionInfo.currency === at.currency;
  const spendBands = spendShown ? bandsFor('subscriptions.monthlySpend', region) : [];
  const spendBand =
    spendBands.length > 0
      ? bandFor('subscriptions.monthlySpend', region, held.perMonth / adults)
      : null;
  const band = [countBand?.band, spendBand?.band]
    .filter((one): one is Band => one !== undefined)
    .sort((a, b) => BAND_ORDER[b] - BAND_ORDER[a])[0];
  const borrowed = typical.borrowedFrom;
  const said = SUBSCRIPTION_WORDS[region] ?? borrowedSubscriptionWords(region);
  let body: string;
  let step: { label: string; hash: string };
  if (band === 'high') {
    body = `That's about ${money(held.perMonth * 12)} a year. ${said.high}`;
    step = { label: 'Review them on Bills', hash: '#bills' };
  } else if (band === 'typical') {
    body = `${said.typical} ${KEEP_OR_DROP}`;
    step = { label: 'Open Bills', hash: '#bills' };
  } else {
    body = `${said.low} ${NOT_HERE_YET}`;
    step = { label: 'Import another account', hash: '#import' };
  }
  const paragraphs = [body];
  if (adults > 1) {
    paragraphs.push(
      `The surveys count per adult: with ${adults >= 3 ? '3 or more' : adults} adults here, that's ${countText(perAdult)} each.`
    );
  }
  const tags: CardTag[] = band ? [{ kind: 'band', text: BAND_TAGS[band] }] : [];
  if (borrowed) {
    tags.push({ kind: 'borrowed', text: `${capital(regionName(borrowed))}'s figures` });
  }
  const title =
    held.count === 0
      ? 'No subscriptions on Bills'
      : `${held.count} ${held.count === 1 ? 'subscription' : 'subscriptions'}, about ${money(held.perMonth)} a month`;
  const where = whereFrom(
    'subscriptions.count',
    region,
    [...countBands, ...spendBands],
    [],
    said.named
  );
  return {
    id: 'subscriptions',
    metric: 'subscriptions.count',
    eyebrow: 'Subscriptions',
    tags,
    title,
    body: paragraphs,
    bar: barOf(
      countBands,
      perAdult,
      { from: 0, to: Math.max(10, Math.ceil(high.min * 1.5)) },
      (edge) => countText(edge),
      `Typical in ${borrowed ? regionName(borrowed) : name}: ${countText(typical.min)} to ${countText(typical.max - 1)} per adult. Yours: ${countText(perAdult)}.`
    ),
    note:
      gapFor('subscriptions.monthlySpend', region) === null
        ? null
        : `${capital(name)} has no official figure for what subscriptions cost, so only the count is compared.`,
    step,
    where,
    provisional: provisionalOf(facts),
    ...(at.adults === null ? { ask: 'household' as const } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Groceries, eating out and transport, as shares of spending (circle 2)

/** What a share card says, per metric (guidance.md 5.3). */
interface ShareCopy {
  id: string;
  metric: MetricId;
  kind: Kind;
  eyebrow: string;
  title: (share: string, perMonth: string, band: Band | undefined) => string;
  /** The high band's sentence, after "Households in {region} spend {lo}% to {hi}%". */
  high: (range: string, year: number) => string;
  low: (name: string, facts: GuidanceFacts) => string;
  steps: (facts: GuidanceFacts) => Record<Band, { label: string; hash: string }>;
  /** A note on evidence that runs low in some regions. */
  note?: (region: RegionId) => string | null;
}

const SHARES: readonly ShareCopy[] = [
  {
    id: 'groceries',
    metric: 'spending.foodAtHome',
    kind: 'groceries',
    eyebrow: 'Groceries',
    title: (share) => `Groceries are ${share}% of your spending`,
    high: (range, year) =>
      `${range}, depending on income (${year}). A high share often means the rest of the budget is already lean, not that the shopping is lavish.`,
    low: (name) =>
      `Below most households in ${name}. If you also buy food in cash or on a card that isn't here, add it; otherwise eating out may be carrying the meals.`,
    steps: () => ({
      high: { label: 'Set a grocery budget', hash: '#budgets' },
      typical: { label: 'Compare with last year', hash: '#analytics' },
      low: { label: 'Check how food is sorted', hash: '#transactions' },
    }),
  },
  {
    id: 'eating-out',
    metric: 'spending.eatingOut',
    kind: 'eating_out',
    eyebrow: 'Eating out',
    title: (share, perMonth, band) =>
      band === 'high'
        ? `Eating out is ${share}% of your spending, about ${perMonth} a month`
        : `Eating out is ${share}% of your spending`,
    high: (range, year) =>
      `${range} (${year}). It's the line most people can move fastest, if they want to.`,
    low: (name) =>
      `Below most households in ${name}. If some meals are sorted under Groceries or Other, moving them sharpens this.`,
    steps: () => ({
      high: { label: 'Set an eating-out budget', hash: '#budgets' },
      typical: { label: 'See it month by month', hash: '#analytics' },
      low: { label: 'Check the sorting', hash: '#transactions' },
    }),
    note: (region) =>
      region === 'HR' || region === 'EU27'
        ? 'These figures come from the 2020 survey wave and run low.'
        : null,
  },
  {
    id: 'transport',
    metric: 'spending.transport',
    kind: 'transport',
    eyebrow: 'Transport',
    title: (share) => `Transport is ${share}% of your spending`,
    high: (range, year) => `${range}, car purchases included (${year}).`,
    low: (name, facts) =>
      facts.firm
        ? `Below most households in ${name}.`
        : `Below most households in ${name}. With fewer than 12 months here, yearly costs like insurance may not have come round yet.`,
    steps: (facts) => {
      const byMonth = { label: 'See transport by month', hash: '#analytics' };
      return {
        high: byMonth,
        typical: byMonth,
        low: facts.firm ? byMonth : { label: 'Import the rest of your year', hash: '#import' },
      };
    },
  },
];

/** The spread across income groups the copy quotes: "11.7% to 14.7%" and its year. */
function groupRangeOf(metric: MetricId, region: RegionId): Reference | null {
  return (
    referencesFor(metric, region).find(
      (ref) => ref.kind === 'groupRange' && ref.min !== undefined && ref.max !== undefined
    ) ?? null
  );
}

function shareCard(
  copy: ShareCopy,
  perMonth: number,
  spending: number,
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const region = at.region;
  const range = groupRangeOf(copy.metric, region);
  const bands = bandsFor(copy.metric, region);
  const typical = bands.find((one) => one.band === 'typical');
  if (!range || !typical || typical.max === null) return null;
  const name = regionName(region);
  const share = (perMonth / spending) * 100;
  const band = bandFor(copy.metric, region, share);
  const shown = percentText(share);
  const spread = `${averageText(range.min ?? 0)}% to ${averageText(range.max ?? 0)}%`;
  let body: string;
  if (band?.band === 'high') {
    body = copy.high(`Households in ${name} spend ${spread}`, range.year);
  } else if (band?.band === 'typical') {
    body = `Close to what households in ${name} spend: ${spread} on average, depending on income (${range.year}).`;
  } else {
    body = copy.low(name, facts);
  }
  const edges = typicalText(bands, (n) => `${figureText(n)}%`);
  return {
    id: copy.id,
    metric: copy.metric,
    eyebrow: copy.eyebrow,
    tags: band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [],
    title: copy.title(shown, words.money(Math.round(perMonth)), band?.band),
    body: [body],
    bar: barOf(
      bands,
      share,
      { from: 0, to: Math.max(10, Math.ceil((typical.max * 1.6) / 5) * 5) },
      (edge) => `${figureText(edge)}%`,
      `${edges ? `Typical in ${name}: ${edges}. ` : ''}Yours: ${shown}%.`
    ),
    note: copy.note?.(region) ?? null,
    step: copy.steps(facts)[band?.band ?? 'low'],
    where: whereFrom(copy.metric, region, bands, [range]),
    provisional: provisionalOf(facts),
  };
}

/**
 * Groceries, eating out and transport as shares of spending, once the averages run and enough of
 * the spending has a category to be shared out (`SORTED_SHARE`, the file's minimum): before that,
 * one card in their place says how much has one.
 */
export function spendingShareCards(
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard[] {
  const byKind = facts.spendingByKind;
  const spending = facts.spending;
  if (!byKind || spending === null || !(spending > 0)) return [];
  const sorted = facts.sortedShare ?? 0;
  if (sorted < SORTED_SHARE) {
    return [
      {
        id: 'spending-unsorted',
        metric: 'spending.foodAtHome',
        eyebrow: 'Groceries, eating out and transport',
        tags: [],
        title: `${shareOf(sorted, 100, false)}% of your spending has a category`,
        body: [
          `They're compared with households in ${regionName(at.region)} once ${SORTED_SHARE}% has one.`,
        ],
        bar: null,
        note: null,
        step: {
          label: 'Sort the entries without a category',
          hash: '#transactions?uncategorised=1',
        },
        where: null,
        provisional: null,
      },
    ];
  }
  return SHARES.map((copy) =>
    shareCard(copy, byKind[copy.kind] ?? 0, spending, facts, words, at)
  ).filter((card): card is BenchmarkCard => card !== null);
}

// ---------------------------------------------------------------------------------------------
// Housing costs, as a share of take-home pay (circle 2)

/** The kinds a home costs: rent or the mortgage, and its energy, water and charges. */
const HOUSING_KINDS: readonly Kind[] = ['housing', 'utilities'];

const RENTING: ReadonlySet<string> = new Set(['rentPrivate', 'rentSocial']);

/** The regions Eurostat's overburden figures cover. */
const EUROSTAT_HOUSING: ReadonlySet<RegionId> = new Set(['EU27', 'DE', 'HR']);

/** Who England's figures compare a household with, by tenure: the survey's groups. */
function englandGroup(tenure: string | null): string {
  if (tenure === 'rentPrivate') return 'private renters';
  if (tenure === 'rentSocial') return 'social renters';
  return 'mortgagors';
}

const ROOM_LEFT = 'That gap is room the rest of your plan can use.';

export function housingCard(
  facts: GuidanceFacts,
  _words: LedgerWords,
  at: CardContext
): BenchmarkCard | null {
  const income = facts.income;
  const byKind = facts.spendingByKind;
  if (!byKind || income === null || !(income > 0)) return null;
  const housing = HOUSING_KINDS.reduce((sum, kind) => sum + (byKind[kind] ?? 0), 0);
  if (!(housing > 0)) return null;
  const region = at.region;
  const name = regionName(region);
  const tenure = at.tenure;
  const renting = tenure !== null && RENTING.has(tenure);
  const bands = bandsFor('housing.share', region, { tenure });
  const typical = bands.find((one) => one.band === 'typical');
  const share = (housing / income) * 100;
  const band = bandFor('housing.share', region, share, { tenure });
  const refs = referencesFor('housing.share', region);
  const byUnit = (unit: string) => refs.find((ref) => ref.unit === unit && ref.value !== null);
  const average = byUnit('percent of disposable income');
  const quoted: Reference[] = [];
  const quote = (ref: Reference | undefined): number | null => {
    if (!ref || ref.value === null) return null;
    quoted.push(ref);
    return ref.value;
  };
  // England's figures are by tenure: the typical band starts at its group's own share.
  const england = typical?.min ?? null;
  let body: string;
  let step: { label: string; hash: string };
  if (band?.band === 'high') {
    step = { label: 'See where the rest goes', hash: '#analytics' };
    if (region === 'US') {
      body =
        "That's over the 50% line US housing agencies call a severe burden. They measure before tax, so their figure for you would be a little lower.";
    } else {
      const over = EUROSTAT_HOUSING.has(region)
        ? byUnit(renting ? 'percent of market-rate renters' : 'percent of people')
        : undefined;
      const overShare = quote(over);
      const who =
        overShare === null || !over
          ? ''
          : `; ${figureText(overShare)}% of ${renting ? 'people renting at market rates' : 'people'} in ${name} are over it too (${over.year})`;
      body = `That's over the 40% line Eurostat uses for a heavy housing burden${who}. Rent changes slowly, so room usually comes from the lines that move faster.`;
    }
  } else if (band?.band === 'typical') {
    step = { label: 'Compare renting and buying', hash: '#rentBuy' };
    if (region === 'US') {
      const renters = byUnit('percent of renter households');
      body =
        renting && quote(renters) !== null
          ? `Over 30% is what US agencies call cost-burdened; about half of US renters are (${renters?.year}).`
          : 'Over 30% is what US agencies call cost-burdened.';
    } else if (region === 'UK') {
      body = `${capital(englandGroup(tenure))} in England spend ${figureText(england ?? 0)}% of gross income on average (${typical?.year}).`;
    } else {
      const value = quote(average);
      const sentences = [
        value === null
          ? null
          : `Households in ${name} spend ${averageText(value)}% on average (${average?.year}).`,
      ];
      if (renting && region === 'HR') {
        const renters = byUnit('percent of market-rate renters');
        const over = quote(renters);
        if (over !== null) {
          sentences.push(
            `Most households in Croatia own their home outright, which keeps that average low; among people renting at market rates, ${figureText(over)}% pay over 40%.`
          );
        }
      } else if (renting && region === 'DE') {
        const rent = byUnit('percent of net income');
        const rentShare = quote(rent);
        if (rentShare !== null) {
          sentences.push(
            `Renters in Germany spend ${figureText(rentShare)}% of net income on rent (${rent?.year}).`
          );
        }
      }
      body = sentences.filter((one): one is string => one !== null).join(' ');
    }
  } else {
    step = { label: 'Put it toward your cushion', hash: '#goals' };
    if (region === 'US') {
      body = `Under the 30% line US agencies call cost-burdened. ${ROOM_LEFT}`;
    } else if (region === 'UK') {
      body = `Below the ${figureText(england ?? 0)}% that ${englandGroup(tenure)} in England spend on average (${typical?.year}). ${ROOM_LEFT}`;
    } else {
      const value = quote(average);
      body =
        value === null
          ? ROOM_LEFT
          : `Below the ${REGION_ADJECTIVE[region]} household average of ${averageText(value)}% (${average?.year}). ${ROOM_LEFT}`;
    }
  }
  const shown = percentText(share);
  const edges = typicalText(bands, (n) => `${figureText(n)}%`);
  return {
    id: 'housing',
    metric: 'housing.share',
    eyebrow: 'Housing costs',
    tags: band ? [{ kind: 'band', text: BAND_TAGS[band.band] }] : [],
    title: `Housing takes ${shown}% of your take-home pay`,
    body: [body],
    bar: barOf(
      bands,
      share,
      { from: 0, to: 60 },
      (edge) => `${figureText(edge)}%`,
      `${edges ? `Typical in ${name}: ${edges}. ` : ''}Yours: ${shown}%.`
    ),
    note: null,
    step,
    where: whereFrom('housing.share', region, bands, quoted),
    provisional: provisionalOf(facts),
    ...(tenure === null ? { ask: 'tenure' as const } : {}),
  };
}

// ---------------------------------------------------------------------------------------------

/**
 * The cards one circle's view shows under How you compare (guidance.md 3.3). The circles that have
 * any are `CARD_CIRCLES` (circleView.ts), which the view reads without loading this module.
 */
export function circleCards(
  circle: CircleNumber,
  facts: GuidanceFacts,
  words: LedgerWords,
  at: CardContext
): BenchmarkCard[] {
  const cards: (BenchmarkCard | null)[] = [];
  switch (circle) {
    case 2:
      cards.push(
        subscriptionsCard(facts, words, at),
        ...spendingShareCards(facts, words, at),
        housingCard(facts, words, at)
      );
      break;
    case 3:
      cards.push(cushionCard(facts, words, at), shockCard(facts, words, at));
      break;
    case 4:
      cards.push(
        cushionCard(facts, words, at),
        shockCard(facts, words, at),
        ...debtRateCards(facts, words, at),
        debtPaymentsCard(facts, words, at)
      );
      break;
    case 5:
      cards.push(savingsCard(facts, words, at));
      break;
    default:
      break;
  }
  return cards.filter((card): card is BenchmarkCard => card !== null);
}
