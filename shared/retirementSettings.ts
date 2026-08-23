/**
 * Retirement assumptions: the saved shape, its defaults, and how to fill it from a user's
 * own data.
 *
 * The model in ./retirement.ts is pure arithmetic and takes a fully-specified input. This
 * module is the layer above it: what gets stored in the `retirement_settings` row, how that
 * untrusted JSON becomes a valid input, and which fields can be answered from the accounts
 * and transactions the user already has instead of being asked for.
 *
 * It lives in shared/ for the same reason the model does — the Worker and the browser-only
 * storage layer both serve this endpoint, and the point of the exercise is that they stop
 * having separate opinions about it.
 */
import type {
  AllocationSlice,
  ExpensePeriod,
  IncomeStep,
  Lifestyle,
  Month,
  RetirementInput,
} from './retirement';
import { blendedReturnPct, isMonth, monthFromOrdinal, monthOrdinal } from './retirement';

/**
 * Simple mode asks for a single monthly contribution and ignores income, expenses and
 * raises. Advanced mode projects income and spending separately, which is what makes
 * planned pay steps, career breaks and one-off spending periods expressible.
 */
export type RetirementMode = 'simple' | 'advanced';

export interface RetirementSettings {
  mode: RetirementMode;
  /** Off pins the whole projection to nominal money; the target stops inflating too. */
  adjustForInflation: boolean;

  birthMonth: Month | null;
  lifeExpectancyAge: number;

  /** Opening portfolio. */
  netWorth: number;

  /** Simple mode only: what gets put away each month. */
  monthlyContribution: number;

  /** Advanced mode only. */
  monthlyIncome: number;
  monthlyExpenses: number;
  annualRaisePct: number;
  incomeSteps: IncomeStep[];
  expensePeriods: ExpensePeriod[];

  annualReturnPct: number;
  /** When set, the return comes from the allocation instead of `annualReturnPct`. */
  useAllocation: boolean;
  allocation: AllocationSlice[];

  annualInflationPct: number;
  safeWithdrawalRatePct: number;
  lifestyles: Lifestyle[];
}

export const DEFAULT_ALLOCATION: AllocationSlice[] = [
  { label: 'Equity', weightPct: 70, annualReturnPct: 8, erodesWithInflation: false },
  { label: 'Bonds', weightPct: 20, annualReturnPct: 4, erodesWithInflation: false },
  { label: 'Cash', weightPct: 10, annualReturnPct: 0, erodesWithInflation: true },
];

export const DEFAULT_SETTINGS: RetirementSettings = {
  mode: 'simple',
  adjustForInflation: true,
  birthMonth: null,
  lifeExpectancyAge: 90,
  netWorth: 0,
  monthlyContribution: 500,
  monthlyIncome: 0,
  monthlyExpenses: 0,
  annualRaisePct: 0,
  incomeSteps: [],
  expensePeriods: [],
  annualReturnPct: 7,
  useAllocation: false,
  allocation: DEFAULT_ALLOCATION,
  annualInflationPct: 2.5,
  safeWithdrawalRatePct: 4,
  lifestyles: [{ id: 'default', label: 'Retirement', monthlySpendToday: 2000 }],
};

/** Scenario band the UI draws around the expected return. */
export const RETURN_SCENARIOS = [
  { id: 'pessimistic', label: 'Pessimistic', offsetPct: -3 },
  { id: 'expected', label: 'Expected', offsetPct: 0 },
  { id: 'optimistic', label: 'Optimistic', offsetPct: 3 },
];

/**
 * Round to a fixed number of decimals, and normalise -0 away.
 *
 * Every number here ends up in an `<input type="number">` with a `step`, and HTML5 marks a
 * value that is not a whole multiple of that step invalid. An average like
 * 7.292500000001382 — which is what dividing a sum of money by a month count actually
 * produces — is therefore not merely ugly, it makes the form refuse to save.
 */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  // A tiny negative rounds to -0, which then formats as "-0" in the field.
  return rounded === 0 ? 0 : rounded;
}

function num(value: unknown, fallback: number, min: number, max: number, decimals = 2): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return round(Math.min(max, Math.max(min, n)), decimals);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function month(value: unknown, fallback: Month | null): Month | null {
  return typeof value === 'string' && isMonth(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeSteps(value: unknown): IncomeStep[] {
  return array(value)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const from = month(r.fromMonth, null);
      return from ? { fromMonth: from, monthlyAmount: num(r.monthlyAmount, 0, 0, 1e9) } : null;
    })
    .filter((s): s is IncomeStep => s !== null)
    .sort((a, b) => monthOrdinal(a.fromMonth) - monthOrdinal(b.fromMonth));
}

function normalizePeriods(value: unknown): ExpensePeriod[] {
  return array(value)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const from = month(r.fromMonth, null);
      if (!from) return null;
      const to = month(r.toMonth, null);
      // A window that ends before it starts would silently contribute nothing; drop the end
      // instead so the period at least means what it says.
      const period: ExpensePeriod = {
        fromMonth: from,
        monthlyAmount: num(r.monthlyAmount, 0, -1e9, 1e9),
      };
      if (to && monthOrdinal(to) >= monthOrdinal(from)) period.toMonth = to;
      return period;
    })
    .filter((p): p is ExpensePeriod => p !== null)
    .sort((a, b) => monthOrdinal(a.fromMonth) - monthOrdinal(b.fromMonth));
}

function normalizeAllocation(value: unknown): AllocationSlice[] {
  const slices = array(value).map((raw, i) => {
    const r = raw as Record<string, unknown>;
    return {
      label: str(r.label, `Asset ${i + 1}`),
      weightPct: num(r.weightPct, 0, 0, 100, 0),
      annualReturnPct: num(r.annualReturnPct, 0, -50, 50),
      erodesWithInflation: bool(r.erodesWithInflation, false),
    };
  });
  return slices.length > 0 ? slices : DEFAULT_ALLOCATION.map((a) => ({ ...a }));
}

function normalizeLifestyles(value: unknown): Lifestyle[] {
  const seen = new Set<string>();
  const list = array(value)
    .map((raw, i) => {
      const r = raw as Record<string, unknown>;
      let id = str(r.id, `lifestyle-${i + 1}`);
      // Duplicate ids would make the UI key two rows the same and edit both at once.
      while (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      return {
        id,
        label: str(r.label, `Lifestyle ${i + 1}`),
        monthlySpendToday: num(r.monthlySpendToday, 0, 0, 1e9),
      };
    })
    .filter((l) => l.monthlySpendToday > 0);
  return list.length > 0 ? list : DEFAULT_SETTINGS.lifestyles.map((l) => ({ ...l }));
}

/**
 * Coerce whatever is in the saved settings row into a usable shape.
 *
 * Everything here arrives as JSON that was last written by an older version of the app, so
 * every field falls back rather than throwing: a stored blob from before a field existed
 * has to keep working, and one bad number must not take the page down.
 */
export function normalizeSettings(raw: unknown): RetirementSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    mode: r.mode === 'advanced' ? 'advanced' : 'simple',
    adjustForInflation: bool(r.adjustForInflation, DEFAULT_SETTINGS.adjustForInflation),
    birthMonth: month(r.birthMonth, DEFAULT_SETTINGS.birthMonth),
    lifeExpectancyAge: num(r.lifeExpectancyAge, DEFAULT_SETTINGS.lifeExpectancyAge, 40, 120, 0),
    netWorth: num(r.netWorth, DEFAULT_SETTINGS.netWorth, -1e12, 1e12),
    monthlyContribution: num(
      r.monthlyContribution,
      DEFAULT_SETTINGS.monthlyContribution,
      -1e9,
      1e9
    ),
    monthlyIncome: num(r.monthlyIncome, DEFAULT_SETTINGS.monthlyIncome, 0, 1e9),
    monthlyExpenses: num(r.monthlyExpenses, DEFAULT_SETTINGS.monthlyExpenses, 0, 1e9),
    annualRaisePct: num(r.annualRaisePct, DEFAULT_SETTINGS.annualRaisePct, -50, 100),
    incomeSteps: normalizeSteps(r.incomeSteps),
    expensePeriods: normalizePeriods(r.expensePeriods),
    annualReturnPct: num(r.annualReturnPct, DEFAULT_SETTINGS.annualReturnPct, -50, 50),
    useAllocation: bool(r.useAllocation, DEFAULT_SETTINGS.useAllocation),
    allocation: normalizeAllocation(r.allocation),
    annualInflationPct: num(r.annualInflationPct, DEFAULT_SETTINGS.annualInflationPct, 0, 50),
    safeWithdrawalRatePct: num(
      r.safeWithdrawalRatePct,
      DEFAULT_SETTINGS.safeWithdrawalRatePct,
      0.1,
      20
    ),
    lifestyles: normalizeLifestyles(r.lifestyles),
  };
}

/** The return the projection will actually use, after the allocation toggle. */
export function effectiveReturnPct(settings: RetirementSettings): number {
  if (!settings.useAllocation) return settings.annualReturnPct;
  return blendedReturnPct(settings.allocation, settings.annualInflationPct);
}

/**
 * Turn saved assumptions into a model input.
 *
 * Simple mode maps the single contribution onto income with no expenses, so one code path
 * runs both modes: the contribution is what lands in the portfolio either way, and the
 * retirement target comes from the lifestyles rather than from current spending.
 */
export function settingsToInput(settings: RetirementSettings, today: Month): RetirementInput {
  const simple = settings.mode === 'simple';
  return {
    startMonth: today,
    birthMonth: settings.birthMonth ?? undefined,
    lifeExpectancyAge: settings.lifeExpectancyAge,
    netWorth: settings.netWorth,
    monthlyIncome: simple ? settings.monthlyContribution : settings.monthlyIncome,
    monthlyExpenses: simple ? 0 : settings.monthlyExpenses,
    annualReturnPct: effectiveReturnPct(settings),
    annualInflationPct: settings.adjustForInflation ? settings.annualInflationPct : 0,
    annualRaisePct: simple ? 0 : settings.annualRaisePct,
    incomeSteps: simple ? [] : settings.incomeSteps,
    expensePeriods: simple ? [] : settings.expensePeriods,
    safeWithdrawalRatePct: settings.safeWithdrawalRatePct,
    lifestyles: settings.lifestyles,
  };
}

/** What the app can observe about a user, gathered by whichever runtime is serving. */
export interface RetirementFacts {
  /** Total across every account, or null when there are none. */
  netWorth: number | null;
  /** Average monthly income over the observed window. */
  monthlyIncome: number | null;
  /** Average monthly spend over the observed window. */
  monthlyExpenses: number | null;
  /** Distinct calendar months the averages were taken over. */
  monthsObserved: number;
  /** Age recorded on an existing retirement goal, if there is one. */
  currentAge: number | null;
}

export interface DerivedField {
  field: string;
  value: number | string;
  source: string;
}

export interface DerivedSettings {
  settings: RetirementSettings;
  filled: DerivedField[];
  /** Fields that could not be answered from the data and still need a person. */
  missing: string[];
}

/**
 * One or two months of history average to whatever happened to be in them — a bonus, a
 * holiday, a month the import only half covered. Below this many months the averages are
 * offered as nothing at all rather than as a number the projection would treat as a fact.
 */
export const MIN_MONTHS_FOR_AVERAGES = 3;

/**
 * Fill what the data can answer, leave the rest alone.
 *
 * Only fields the user has not set are filled: the point is to save typing on first use,
 * not to overwrite a considered assumption every time the page loads. `filled` says what
 * was taken and where from, so the UI can show its working rather than presenting derived
 * numbers as though the user had entered them.
 */
export function deriveSettings(
  saved: RetirementSettings,
  facts: RetirementFacts,
  today: Month
): DerivedSettings {
  const settings = { ...saved };
  const filled: DerivedField[] = [];
  const missing: string[] = [];
  const enoughHistory = facts.monthsObserved >= MIN_MONTHS_FOR_AVERAGES;

  if (settings.netWorth === 0 && facts.netWorth !== null && facts.netWorth !== 0) {
    settings.netWorth = facts.netWorth;
    filled.push({ field: 'netWorth', value: facts.netWorth, source: 'Total of your accounts' });
  } else if (facts.netWorth === null) {
    missing.push('netWorth');
  }

  const monthsLabel = `${facts.monthsObserved} months of transactions`;

  if (enoughHistory && facts.monthlyIncome !== null && settings.monthlyIncome === 0) {
    settings.monthlyIncome = facts.monthlyIncome;
    filled.push({ field: 'monthlyIncome', value: facts.monthlyIncome, source: monthsLabel });
  }

  if (enoughHistory && facts.monthlyExpenses !== null && settings.monthlyExpenses === 0) {
    settings.monthlyExpenses = facts.monthlyExpenses;
    filled.push({ field: 'monthlyExpenses', value: facts.monthlyExpenses, source: monthsLabel });
  }

  // What the user actually saves is the better answer to "how much a month" than any
  // default, so simple mode gets it too once there is enough history to mean something.
  if (
    enoughHistory &&
    facts.monthlyIncome !== null &&
    facts.monthlyExpenses !== null &&
    settings.monthlyContribution === DEFAULT_SETTINGS.monthlyContribution
  ) {
    const saved_ = round(Math.max(0, facts.monthlyIncome - facts.monthlyExpenses));
    settings.monthlyContribution = saved_;
    filled.push({
      field: 'monthlyContribution',
      value: saved_,
      source: `Income minus spending over ${monthsLabel}`,
    });
  }

  // Retirement spending defaults to what the user spends now: the most defensible guess
  // available, and one they can see and change.
  if (
    enoughHistory &&
    facts.monthlyExpenses !== null &&
    settings.lifestyles.length === 1 &&
    settings.lifestyles[0].monthlySpendToday === DEFAULT_SETTINGS.lifestyles[0].monthlySpendToday
  ) {
    settings.lifestyles = [
      {
        ...settings.lifestyles[0],
        label: 'Current lifestyle',
        monthlySpendToday: facts.monthlyExpenses,
      },
    ];
    filled.push({
      field: 'lifestyles',
      value: facts.monthlyExpenses,
      source: `Your average spending over ${monthsLabel}`,
    });
  }

  if (settings.birthMonth === null) {
    if (facts.currentAge !== null && facts.currentAge > 0) {
      const derived = monthFromOrdinal(monthOrdinal(today) - Math.round(facts.currentAge * 12));
      settings.birthMonth = derived;
      filled.push({
        field: 'birthMonth',
        value: derived,
        source: `Age ${facts.currentAge} on your retirement goal`,
      });
    } else {
      missing.push('birthMonth');
    }
  }

  if (!enoughHistory) missing.push('monthlyIncome', 'monthlyExpenses');

  return { settings, filled, missing };
}

/** One transaction, as either runtime can produce it. */
export interface CashflowRow {
  /** `YYYY-MM-DD`; only the month is read. */
  date: string;
  amount: number;
  /** 'income' or 'expense'. Anything else is ignored. */
  type: string;
}

/**
 * Turn raw rows into the facts derivation works from.
 *
 * The averages divide by the number of months that actually had activity, not by the length
 * of the window: a user who imported four months of history should see their four-month
 * average, not that average quartered because the window was a year.
 *
 * Amounts are taken absolute. Expenses are stored negative in some imports and positive in
 * others, and a sign convention leaking in here would silently halve someone's spending.
 */
export function buildFacts(input: {
  accountBalances: number[];
  cashflow: CashflowRow[];
  currentAge: number | null;
}): RetirementFacts {
  const netWorth =
    input.accountBalances.length > 0
      ? round(input.accountBalances.reduce((sum, b) => sum + (Number.isFinite(b) ? b : 0), 0))
      : null;

  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};
  const months = new Set<string>();

  for (const row of input.cashflow) {
    if (typeof row.date !== 'string' || row.date.length < 7) continue;
    if (!Number.isFinite(row.amount)) continue;
    const m = row.date.substring(0, 7);
    if (row.type === 'income') {
      income[m] = (income[m] ?? 0) + Math.abs(row.amount);
      months.add(m);
    } else if (row.type === 'expense') {
      expenses[m] = (expenses[m] ?? 0) + Math.abs(row.amount);
      months.add(m);
    }
  }

  const mean = (totals: Record<string, number>): number | null => {
    const values = Object.values(totals);
    if (values.length === 0) return null;
    return round(values.reduce((a, b) => a + b, 0) / values.length);
  };

  return {
    netWorth,
    monthlyIncome: mean(income),
    monthlyExpenses: mean(expenses),
    monthsObserved: months.size,
    currentAge: input.currentAge,
  };
}

/** `YYYY-MM` for a date, for callers that have a Date rather than a string. */
export function monthOf(date: Date): Month {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
