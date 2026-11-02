/**
 * The words for a seal: its text alternative and the line for each month, worked out from the
 * same shares the drawing uses, so they can never say more than the picture shows. No amounts,
 * no categories, no names: how the months compare, and which kept money.
 *
 * Shared because the print mail (phase 5) needs the same description as the app's alt text. The
 * caller says how a month is named (`monthName`, 'YYYY-MM' to "March 2026"), as the browser and
 * the Worker each have their own way of formatting dates.
 */
import { addCalendarMonths } from '../calendarMonths';
import type { SealSlot } from './seal';

export interface SealWords {
  /** 'YYYY-MM' to the month's name and year, like "March 2026". */
  monthName: (month: string) => string;
}

const ORDINALS = [
  '',
  '',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
];

const monthAt = (from: string, i: number): string => addCalendarMonths(`${from}-01`, i).slice(0, 7);

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Each filled slot's rank by spending: 1 plus the number of months that spent strictly more, so
 * months that tie share a rank and the months under them still count every month above them
 * (100, 90, 90, 80 rank 1, 2, 2, 4). `least` marks the months that spent the least, and `alike`
 * says every month spent the same.
 */
function ranks(
  slots: readonly SealSlot[]
): Map<number, { rank: number; least: boolean; alike: boolean }> {
  const spent = slots.filter((s) => s !== null).map((s) => s!.spent);
  const lowest = Math.min(...spent);
  const alike = spent.every((v) => v === spent[0]);
  const out = new Map<number, { rank: number; least: boolean; alike: boolean }>();
  slots.forEach((s, i) => {
    if (s === null) return;
    const rank = 1 + spent.filter((v) => v > s.spent).length;
    out.set(i, { rank, least: s.spent === lowest, alike });
  });
  return out;
}

const filled = (slots: readonly SealSlot[]): number => slots.filter((s) => s !== null).length;

/** The line a tapped petal shows. */
export function monthLine(
  slots: readonly SealSlot[],
  from: string,
  i: number,
  words: SealWords
): string {
  const slot = slots[i];
  const name = words.monthName(monthAt(from, i));
  if (!slot) return `${name} is not on this print yet.`;
  const n = filled(slots);
  const kept =
    slot.kept > 0 ? 'kept money' : slot.kept < 0 ? 'more than came in' : 'came out about even';
  if (n === 1) {
    return slot.kept < 0
      ? `${name} is the only month here so far. It spent more than came in.`
      : `${name} is the only month here so far, and it ${kept}.`;
  }
  const { rank, least, alike } = ranks(slots).get(i)!;
  if (alike) {
    // One share for every month: none spent the most or the least. A share of 0 for all of them
    // means the heaviest month spent nothing, as any month that spent something is 100.
    const others = n === 2 ? 'the other month' : `the other ${n - 1} months`;
    const spent = slot.spent === 0 ? 'spent nothing' : `spent about the same as ${others}`;
    return `${name} ${spent}, and ${kept}.`;
  }
  const most = rank === 1 ? 'the most' : least ? 'the least' : `the ${ORDINALS[rank]} most`;
  return `${name} spent ${most} of these ${n} months, and ${kept}.`;
}

/** The text alternative: what the seal shows, in two or three sentences. */
export function sealSummary(slots: readonly SealSlot[], from: string, words: SealWords): string {
  const n = filled(slots);
  if (n === 0) return 'An empty seal with twelve places, one for each month you track.';
  const names = slots.map((s, i) => (s === null ? null : words.monthName(monthAt(from, i))));
  const r = ranks(slots);
  const pick = (is: (rank: { rank: number; least: boolean }) => boolean) =>
    names.filter((_, i) => r.has(i) && is(r.get(i)!)) as string[];
  const lastFilled = slots.reduce((last, s, i) => (s === null ? last : i), 0);
  const period = `${words.monthName(from)} to ${words.monthName(monthAt(from, n === 12 ? 11 : lastFilled))}`;
  const head =
    n === 12
      ? `A seal of twelve petals in a woven band, ${period}.`
      : `A seal with ${n} of its 12 petals so far, ${period}.`;
  const alike = [...r.values()][0].alike;
  const spread =
    n === 1
      ? ''
      : !alike
        ? ` ${list(pick((v) => v.rank === 1))} spent the most, ${list(pick((v) => v.least))} the least.`
        : slots.some((s) => s !== null && s.spent > 0)
          ? ' Every month spent about the same.'
          : ' None of these months spent anything.';
  const red = names.filter((_, i) => slots[i] !== null && slots[i]!.kept < 0) as string[];
  const band =
    red.length === 0
      ? ' Every month kept money or came out about even.'
      : ` The band turns copper for ${list(red)}, ${red.length === 1 ? 'which' : 'which each'} spent more than came in.`;
  return head + spread + band;
}
