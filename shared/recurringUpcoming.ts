/**
 * What the active recurring rules add in the next 30 days: GET /api/recurring/upcoming, worked out
 * here so the Worker and local-first answer it alike. Local-first used to answer the active rules
 * themselves, and the Worker every occurrence of the next 30 days (the contract's
 * `recurring-upcoming`). Nothing in the app calls it yet.
 */
import { addDays, nextOccurrence } from './calendarMonths';
import { toCents } from './money';

/** A rule as the upcoming list reads it: its own fields and its category's name and colour. */
export interface UpcomingRule {
  id: number;
  description: string;
  amount: number;
  type: string;
  frequency: string;
  day_of_month: number | null;
  next_date: string | null;
  category_name?: string | null;
  category_color?: string | null;
}

/** One occurrence: the rule, on the date it falls. */
export interface UpcomingItem extends UpcomingRule {
  next_date: string;
}

export interface UpcomingCategory {
  name: string;
  color?: string | null;
  total: number;
  items: UpcomingItem[];
}

export interface UpcomingAnswer {
  /** The first 20 occurrences, soonest first. */
  transactions: UpcomingItem[];
  /** Every occurrence by category, the largest total first. */
  byCategory: UpcomingCategory[];
  /** What every occurrence adds up to. */
  totalMonthly: number;
  currency: string;
}

/** How many days ahead the list looks. */
export const UPCOMING_DAYS = 30;

/**
 * Each occurrence of `rules` from `today` (the person's, YYYY-MM-DD) to 30 days on. The rules are
 * the active ones; `currency` is the profile's base currency.
 */
export function upcomingRecurring(
  rules: readonly UpcomingRule[],
  today: string,
  currency: string
): UpcomingAnswer {
  const end = addDays(today, UPCOMING_DAYS);
  const upcoming: UpcomingItem[] = [];
  for (const r of rules) {
    // From the rule's next date. A rule whose next date has passed is listed once, on today, for
    // all it has missed: populate writes each missed period on its own date, one press each (a
    // monthly rule due 15 August, run on 10 October, writes 15 August, then 15 September), so
    // this one entry stands for them and is not one of their dates. After today the rule is
    // listed on its own dates, stepped from its next date and not from today's day, with the step
    // populate takes, so those are the dates populate will write. The monthly step here used to
    // be setMonth() and then the day, and setMonth() overflows first: a rule on the 31st went
    // from January to March, and February was never listed.
    const dates: string[] = [];
    let cursor = r.next_date || today;
    if (cursor <= today) {
      dates.push(today);
      while (cursor && cursor <= today) {
        cursor = nextOccurrence(cursor, r.frequency, r.day_of_month);
      }
    }
    while (cursor && cursor <= end) {
      dates.push(cursor);
      cursor = nextOccurrence(cursor, r.frequency, r.day_of_month);
    }
    for (const date of dates) {
      upcoming.push({
        id: r.id,
        description: r.description,
        amount: r.amount,
        type: r.type,
        frequency: r.frequency,
        day_of_month: r.day_of_month,
        next_date: date,
        category_name: r.category_name,
        category_color: r.category_color,
      });
    }
  }

  upcoming.sort((a, b) => a.next_date.localeCompare(b.next_date));

  const byCategory: Record<string, UpcomingCategory> = {};
  let total = 0;
  for (const item of upcoming) {
    const name = item.category_name || 'Uncategorized';
    byCategory[name] ??= { name, color: item.category_color, total: 0, items: [] };
    byCategory[name].total = toCents(byCategory[name].total + item.amount);
    byCategory[name].items.push(item);
    total = toCents(total + item.amount);
  }

  return {
    transactions: upcoming.slice(0, 20),
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    totalMonthly: total,
    currency,
  };
}
